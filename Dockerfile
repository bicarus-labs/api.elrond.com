FROM node:14.18.0 AS builder
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clear --force
COPY . .
EXPOSE 3001
CMD ["npm", "run", "start:devnet"]