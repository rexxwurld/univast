FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first so this layer caches between code changes.
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "server.js"]
