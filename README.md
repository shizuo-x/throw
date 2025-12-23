# Throw

A simple, self-hosted temporary file sharing application. Securely upload files with password protection and automatic expiration.

## Features

- **Chunked Uploads:** Supports large file uploads via chunking.
- **Password Protection:** Optional password protection for downloads.
- **Auto-Expiration:** Files are automatically deleted after a set period (in hours).
- **Clean Interface:** Simple web interface for uploading and downloading.
- **Docker Support:** Easy deployment with Docker and Docker Compose.

## Prerequisites

- Node.js (v18+)
- Docker (optional, for containerized deployment)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/shizuo-x/throw.git
cd throw
```

### 2. Environment Setup

Create a `.env` file based on the example:

```bash
cp .env.example .env
```

Adjust the values in `.env` if necessary:
- `PORT`: Port the server runs on (default: 3000)
- `BASE_URL`: The public URL of your instance (default: http://localhost:3000)

### 3. Running Locally

Install dependencies:

```bash
npm install
```

Start the server:

```bash
node index.js
```

The application will be available at `http://localhost:3000` (or your specified port).

### 4. Running with Docker

Build and run using Docker Compose:

```bash
docker-compose up -d --build
```

The application will be available at `http://localhost:3009` (as configured in `docker-compose.yml`).

## Project Structure

- `public/`: Static assets (CSS, JS).
- `views/`: EJS templates for the frontend.
- `index.js`: Main server application logic.
- `uploads/`: Directory where permanent files are stored (ignored by git).
- `temp_chunks/`: Temporary directory for upload chunks (ignored by git).
- `uploads.db`: SQLite database file (ignored by git).

## License

ISC