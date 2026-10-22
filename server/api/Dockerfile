# No packages to install: Node 24 runs the TypeScript itself and has SQLite built in.
FROM node:24-alpine
WORKDIR /app
COPY src ./src
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 NODE_NO_WARNINGS=1
USER node
EXPOSE 8080
CMD ["node", "src/main.ts"]
