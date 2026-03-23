FROM node:20-alpine
ARG VITE_API_URL=http://localhost:3000
ARG BUILD_VERSION=unknown
WORKDIR /app
RUN echo "{\"api_url\":\"${VITE_API_URL}\",\"version\":\"${BUILD_VERSION}\"}" > config.json
COPY server.js ./
EXPOSE 9100
CMD ["node", "server.js"]
