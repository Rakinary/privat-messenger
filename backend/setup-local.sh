#!/bin/bash
set -e

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

docker compose up -d
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init

echo ""
echo "Setup done."
echo "Create users with:"
echo "npm run create:user -- --email max@example.com --username max --password max123"
echo ""
echo "Start server with:"
echo "npm run start:dev"
