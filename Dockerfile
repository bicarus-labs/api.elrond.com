FROM node:16.15.0 AS builder
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NETWORK=devnet
ENV ELASTICSEARCH_URLS=https://${NETWORK}-index.elrond.com
ENV GATEWAY_URLS=https://${NETWORK}-gateway.multiversx.com

ENV RABBITMQ_HOST=127.0.0.1
ENV RABBITMQ_PORT=5672
ENV RABBITMQ_USER=guest
ENV RABBITMQ_PASS=guest

ENV REDIS_HOST=127.0.0.1
ENV REDIS_PORT=6379

ENV DATABASE_ENABLE=false

ENV MONGO_HOST=127.0.0.1
ENV MONGO_PORT=27017
ENV MONGO_USER=admin
ENV MONGO_PASS=admin
ENV MONGO_DBNAME=api

ENV MYSQL_HOST=127.0.0.1
ENV MYSQL_PORT=3306
ENV MYSQL_USER=admin
ENV MYSQL_PASS=admin
ENV MYSQL_DBNAME=api

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clear --force
COPY . .
RUN npm run init
EXPOSE 3001 3099
ENTRYPOINT ["/app/entrypoint.sh"]