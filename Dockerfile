FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ARG APP_PORT=7002
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/logQuery.js ./logQuery.js
COPY --from=build /app/config.env ./config.env
COPY --from=build /app/dist ./dist
EXPOSE ${APP_PORT}
CMD ["node", "server.js"]

