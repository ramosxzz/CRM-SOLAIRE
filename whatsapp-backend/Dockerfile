FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3001

CMD ["npm", "start"]
