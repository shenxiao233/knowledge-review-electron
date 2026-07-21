#!/bin/sh
set -eu

# Retry migrations while PostgreSQL is starting or briefly unavailable.
attempt=0
until npx prisma migrate deploy; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Database migration failed after 30 attempts." >&2
    exit 1
  fi
  echo "Database is not ready; retrying migration ($attempt/30)..." >&2
  sleep 2
done

exec node dist/server.js
