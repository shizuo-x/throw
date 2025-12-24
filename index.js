require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const fs = require('fs');
const fsExtra = require('fs-extra'); // For easy directory removal/moves
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Setup DB
const dataDir = 'data';
fsExtra.ensureDirSync(dataDir);
const dbPath = path.join(dataDir, 'uploads.db');

const db = new sqlite3(dbPath);
db.exec(`
    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        originalName TEXT,
        filename TEXT,
        uploaderName TEXT,
        passwordHash TEXT,
        uploadTime INTEGER,
        expiryTime INTEGER
    )
`);

// Setup Multer for Chunks (Temp Storage)
const upload = multer({ dest: 'temp_chunks/' });

// Ensure dirs exist
fsExtra.ensureDirSync('uploads');
fsExtra.ensureDirSync('temp_chunks');

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.use(express.json()); // Need JSON parsing for init/complete

// 1. Init Upload Session
app.post('/api/upload-init', upload.none(), async (req, res) => {
    try {
        const uploadId = uuidv4();
        // Store metadata temporarily (in memory or separate DB table, simplified here to just dir creation)
        // We'll trust the client to pass metadata again or store in a 'temp_sessions' map.
        // For statelessness, let's create a directory for this uploadId.
        await fsExtra.ensureDir(path.join('temp_chunks', uploadId));
        
        // Save metadata to a JSON file in that dir
        const metadata = {
            fileName: req.body.fileName,
            uploaderName: req.body.uploaderName,
            password: req.body.password,
            expiryHours: req.body.expiryHours,
            originalName: req.body.originalName,
            startTime: Date.now()
        };
        await fsExtra.writeJson(path.join('temp_chunks', uploadId, 'metadata.json'), metadata);

        res.json({ uploadId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Init failed' });
    }
});

// 2. Handle Chunk
app.post('/api/upload-chunk', upload.single('file'), async (req, res) => {
    try {
        const { uploadId, chunkIndex } = req.body;
        const chunkPath = path.join('temp_chunks', uploadId, `chunk-${chunkIndex}`);
        
        // Move uploaded temp file to organized chunk path
        await fsExtra.move(req.file.path, chunkPath, { overwrite: true });
        
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Chunk failed' });
    }
});

// 3. Complete & Assemble
app.post('/api/upload-complete', async (req, res) => {
    try {
        const { uploadId } = req.body;
        const sessionDir = path.join('temp_chunks', uploadId);
        
        if (!fs.existsSync(sessionDir)) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const metadata = await fsExtra.readJson(path.join(sessionDir, 'metadata.json'));
        
        // Assemble File
        const fileId = uuidv4();
        const finalExt = path.extname(metadata.originalName);
        const finalFilename = `${fileId}${finalExt}`;
        const finalPath = path.join('uploads', finalFilename);

        // Sort chunks
        const files = await fsExtra.readdir(sessionDir);
        const chunkFiles = files.filter(f => f.startsWith('chunk-')).sort((a, b) => {
            return parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]);
        });

        // Append chunks to final file
        const writeStream = fs.createWriteStream(finalPath);
        for (const chunkFile of chunkFiles) {
            const chunkData = await fsExtra.readFile(path.join(sessionDir, chunkFile));
            writeStream.write(chunkData);
        }
        writeStream.end();

        await new Promise(fulfill => writeStream.on('finish', fulfill));

        // Save to DB
        let passwordHash = null;
        if (metadata.password && metadata.password.trim() !== '') {
            passwordHash = await bcrypt.hash(metadata.password, 10);
        }

        const uploadTime = Date.now();
        const expiryTime = uploadTime + (parseInt(metadata.expiryHours) * 60 * 60 * 1000);

        const stmt = db.prepare('INSERT INTO files (id, originalName, filename, uploaderName, passwordHash, uploadTime, expiryTime) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run(fileId, metadata.fileName, finalFilename, metadata.uploaderName, passwordHash, uploadTime, expiryTime);

        // Cleanup Temp
        await fsExtra.remove(sessionDir);

        res.json({ link: `${BASE_URL}/file/${fileId}` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Assembly failed' });
    }
});

// View File/Download Page
app.get('/file/:id', (req, res) => {
    const { id } = req.params;
    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) {
        return res.status(404).render('404');
    }

    if (Date.now() > file.expiryTime) {
        // Double check expiry (cleanup job might not have run yet)
        return res.status(404).render('404');
    }

    // Calc remaining time
    const diffMs = file.expiryTime - Date.now();
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    const timeRemaining = `${diffHrs}h ${diffMins}m`;

    res.render('download', { 
        file: {
            id: file.id,
            originalName: file.originalName,
            uploaderName: file.uploaderName,
            hasPassword: !!file.passwordHash
        },
        timeRemaining,
        error: null
    });
});

// Handle Download with Password
app.post('/file/:id/download', async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    
    const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
    const file = stmt.get(id);

    if (!file) {
        return res.status(404).render('404');
    }

    if (Date.now() > file.expiryTime) {
        return res.status(404).render('404');
    }

    if (file.passwordHash) {
        if (!password) {
            return res.render('download', { 
                file: { id: file.id, originalName: file.originalName, uploaderName: file.uploaderName, hasPassword: true }, 
                timeRemaining: 'Calculating...', 
                error: 'Password required' 
            });
        }

        const match = await bcrypt.compare(password, file.passwordHash);
        if (!match) {
             // Recalculate time for render
             const diffMs = file.expiryTime - Date.now();
             const diffHrs = Math.floor(diffMs / 3600000);
             const diffMins = Math.floor((diffMs % 3600000) / 60000);
             const timeRemaining = `${diffHrs}h ${diffMins}m`;

            return res.render('download', { 
                file: { id: file.id, originalName: file.originalName, uploaderName: file.uploaderName, hasPassword: true }, 
                timeRemaining, 
                error: 'Incorrect Password' 
            });
        }
    }

    // Serve file
    const filePath = path.join(__dirname, 'uploads', file.filename);
    res.download(filePath, file.originalName);
});

// Cleanup Job (Runs every hour)
cron.schedule('0 * * * *', () => {
    console.log('Running cleanup job...');
    const now = Date.now();
    const stmt = db.prepare('SELECT * FROM files WHERE expiryTime < ?');
    const expiredFiles = stmt.all(now);

    const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');

    expiredFiles.forEach(file => {
        try {
            fs.unlinkSync(path.join(__dirname, 'uploads', file.filename));
            console.log(`Deleted file: ${file.filename}`);
        } catch (err) {
            console.error(`Failed to delete file ${file.filename}:`, err.message);
        }
        deleteStmt.run(file.id);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});