#!/bin/sh
set -e
MODE=${INDEXER_MODE:-fast}
sleep 15
npx prisma migrate dev --name init --schema ./index.schema.prisma
exec node dist-${MODE}/src/main.js
