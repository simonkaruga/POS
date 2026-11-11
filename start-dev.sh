#!/bin/bash

# Faida POS - Development Startup Script
# Starts API backend and Web frontend concurrently

echo "🚀 Starting Faida POS Development Environment..."
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Check if database exists
if [ ! -f "apps/api/dev.db" ]; then
  echo "🗄️  Setting up database..."
  cd apps/api
  npx prisma migrate dev
  npx prisma db seed
  cd ../..
fi

# Start both API and Web in parallel
echo ""
echo "✅ Starting services..."
echo "   - API: http://localhost:3010"
echo "   - Web: http://localhost:3005"
echo ""

# Use concurrently to run both
npx concurrently \
  -n "API,WEB" \
  -c "blue,green" \
  "cd apps/api && npm run start:dev" \
  "cd apps/web && npm run dev"
