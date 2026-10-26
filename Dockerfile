FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY client/package*.json client/
RUN npm install --prefix client --include=dev
COPY . .
RUN npm run build --prefix client && rm -rf client/node_modules
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "server/src/server.js"]
