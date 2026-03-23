FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
RUN npm install
EXPOSE 4000
CMD ["node", "server.js"]
