FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bridge.js logger.js healthcheck.js diagnose.js ./
COPY lib ./lib
RUN mkdir /state && chown node:node /state
USER node
ENV NODE_ENV=production TZ=Europe/Berlin
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD ["node", "healthcheck.js"]
CMD ["node", "bridge.js"]
FROM base AS test
USER root
RUN npm ci --include=dev --ignore-scripts
COPY eslint.config.js ./
COPY test ./test
USER node
RUN npm test && npm run lint
FROM base AS production
