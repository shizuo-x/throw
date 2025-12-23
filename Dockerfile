FROM node:18-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

# Rebuild better-sqlite3 specifically for the container arch
RUN npm rebuild better-sqlite3

COPY . .

EXPOSE 3009

CMD ["node", "index.js"]