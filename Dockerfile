FROM node:20-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN yarn install
COPY . .

RUN yarn generate
RUN yarn build

FROM node:20-alpine as indexer-bridge-runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src/.generate/index.schema.prisma ./
RUN mkdir -p src/.generate
COPY --from=builder /app/src/.generate ./src/.generate
RUN apk add --no-cache openssl
CMD sh -c "sleep 15 && npx prisma migrate dev --name init --schema ./index.schema.prisma && node dist/src/main.js"
