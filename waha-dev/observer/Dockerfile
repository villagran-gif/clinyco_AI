FROM node:20-alpine
WORKDIR /app

COPY waha-dev/observer/package*.json ./
RUN npm install --omit=dev

COPY waha-dev/observer/ ./

# Shared analyzers imported via ../../analysis/... at runtime.
COPY analysis /analysis

EXPOSE 3001
CMD ["node", "server.js"]
