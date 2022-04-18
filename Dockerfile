FROM node:14.18.0 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clear --force
COPY . .
CMD ["npm", "run", "start:devnet"]