FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN yarn install
COPY . .

RUN INDEXER_MODE=fast yarn generate && yarn build && mv dist dist-fast
RUN rm -rf src/.generate
RUN INDEXER_MODE=slow yarn generate && yarn build && mv dist dist-slow

FROM node:20-alpine AS indexer-bridge-runner
WORKDIR /app
COPY --from=builder /app/dist-fast ./dist-fast
COPY --from=builder /app/dist-slow ./dist-slow
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/src/.generate/index.schema.prisma ./
RUN mkdir -p src/.generate
COPY --from=builder /app/src/.generate ./src/.generate
RUN apk add --no-cache openssl
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
