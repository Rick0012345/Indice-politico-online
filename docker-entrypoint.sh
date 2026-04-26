#!/bin/sh
set -e

if [ "${RUN_PRISMA_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying Prisma migrations..."
  npx prisma migrate deploy
fi

exec "$@"
