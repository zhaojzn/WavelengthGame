FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/

EXPOSE 3001

CMD ["node", "server/index.js"]
