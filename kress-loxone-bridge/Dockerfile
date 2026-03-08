# Multi-arch build – works on Raspberry Pi (arm64/armv7) and x86
FROM node:18-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY bridge.js ./
COPY logger.js ./

# config.json is mounted via volume at runtime:
#   ./config.json → /app/config.json

CMD ["node", "bridge.js"]
