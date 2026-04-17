#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "[session-start] Installing npm workspace dependencies..."
npm install --no-audit --no-fund

echo "[session-start] Generating Prisma client..."
DATABASE_URL="${DATABASE_URL:-postgresql://placeholder:placeholder@localhost:5432/placeholder}" \
DIRECT_URL="${DIRECT_URL:-postgresql://placeholder:placeholder@localhost:5432/placeholder}" \
npm run db:generate

echo "[session-start] Setup complete."
