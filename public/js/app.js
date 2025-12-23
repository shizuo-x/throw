document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const fileLabel = document.getElementById('fileLabel');
    const uploadForm = document.getElementById('uploadForm');
    const resultArea = document.getElementById('resultArea');
    const resultLink = document.getElementById('resultLink');
    const fileNameInput = document.getElementById('fileName');
    
    // Modal Elements
    const customModal = document.getElementById('customModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalMessage = document.getElementById('modalMessage');
    const modalClose = document.getElementById('modalClose');
    const modalOk = document.getElementById('modalOk');

    // Progress Elements
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    let isUploading = false;

    // Prevent accidental navigation/refresh
    window.addEventListener('beforeunload', (e) => {
        if (isUploading) {
            e.preventDefault();
            e.returnValue = ''; // Required for Chrome
            return ''; // Required for legacy browsers
        }
    });

    function showModal(title, message) {
        modalTitle.innerText = title;
        modalMessage.innerText = message;
        customModal.style.display = 'flex';
    }

    function closeModal() {
        customModal.style.display = 'none';
    }

    modalClose.addEventListener('click', closeModal);
    modalOk.addEventListener('click', closeModal);

    // Drag and Drop Logic
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            handleFileSelect(fileInput.files[0]);
        }
    });

    function handleFileSelect(file) {
        fileLabel.innerText = `SELECTED: ${file.name}`;
        // Auto-fill file name if empty
        if (!fileNameInput.value) {
            fileNameInput.value = file.name;
        }
    }

    // Chunked Upload Logic
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB Chunks (Small for robustness)

    async function uploadChunk(file, chunk, chunkIndex, totalChunks, uploadId) {
        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', totalChunks);
        formData.append('uploadId', uploadId);
        formData.append('originalName', file.name);

        const response = await fetch('/api/upload-chunk', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Chunk ${chunkIndex} failed`);
        }
        return response.json();
    }

    // Form Submission
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!fileInput.files.length) {
            showModal('ERROR', 'Please select a file first.');
            return;
        }

        const file = fileInput.files[0];
        const submitBtn = uploadForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.innerText;
        
        submitBtn.disabled = true;
        submitBtn.innerText = 'PREPARING...';
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.innerText = '0%';
        resultArea.style.display = 'none';
        
        isUploading = true; // Enable navigation protection

        try {
            // 1. Initialize Upload Session
            const initFormData = new FormData(uploadForm);
            initFormData.append('originalName', file.name);
            
            const initResponse = await fetch('/api/upload-init', {
                method: 'POST',
                body: initFormData
            });

            if (!initResponse.ok) throw new Error('Failed to initialize upload');
            const { uploadId } = await initResponse.json();

            submitBtn.innerText = 'UPLOADING...';

            // 2. Loop through chunks
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);
                
                let retries = 3;
                while (retries > 0) {
                    try {
                        await uploadChunk(file, chunk, i, totalChunks, uploadId);
                        
                        // Update Progress
                        const percent = Math.round(((i + 1) / totalChunks) * 100);
                        progressBar.style.width = `${percent}%`;
                        progressText.innerText = `${percent}%`;
                        break; // Success, move to next chunk
                    } catch (err) {
                        retries--;
                        console.warn(`Chunk ${i} failed, retrying... (${retries} left)`);
                        if (retries === 0) throw err;
                        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                    }
                }
            }

            // 3. Complete Upload
            submitBtn.innerText = 'FINALIZING...';
            const completeResponse = await fetch('/api/upload-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId })
            });

            const data = await completeResponse.json();

            if (completeResponse.ok) {
                resultArea.style.display = 'block';
                resultLink.innerText = data.link;
                resultLink.href = data.link;
                showModal('SUCCESS', 'File uploaded successfully!');
                progressBar.style.backgroundColor = '#a3c9a8'; // Green success
            } else {
                throw new Error(data.message || 'Finalization failed');
            }

        } catch (error) {
            console.error('Error:', error);
            showModal('ERROR', `Upload failed: ${error.message}`);
            progressBar.style.backgroundColor = 'red';
        } finally {
            isUploading = false; // Disable navigation protection
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
        }
    });

    // Copy to clipboard
    resultLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard.writeText(resultLink.href).then(() => {
            showModal('COPIED', 'Link copied to clipboard!');
        });
    });
});