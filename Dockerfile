FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3480
ENV PORT=3480 DATA_DIR=/data NODE_ENV=production
CMD ["node", "server.js"]
