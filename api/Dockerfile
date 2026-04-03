FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false

COPY src ./src
COPY tsconfig.json ./

ENV API_PORT=8787
EXPOSE 8787

CMD ["npm","run","start"]
