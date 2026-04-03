FROM node:20-alpine

WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev=false

COPY api/src ./src
COPY api/tsconfig.json ./

ENV API_PORT=8787
EXPOSE 8787

CMD ["npm","run","start"]
