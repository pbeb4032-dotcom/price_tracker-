FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./
COPY README.md ./

ENV NODE_ENV=production
CMD ["npm","start"]
