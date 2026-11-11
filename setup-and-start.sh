#!/bin/bash

echo "🚀 Faida POS - Complete Setup & Start"
echo "======================================"
echo ""

# Add DATABASE_URL to root .env if missing
if ! grep -q "DATABASE_URL" .env 2>/dev/null; then
  echo "📝 Adding DATABASE_URL to .env..."
  echo 'DATABASE_URL="file:./apps/api/dev.db"' >> .env
fi

# Run migrations
echo "🗄️  Running database migrations..."
npx prisma migrate dev --name init --skip-seed

# Run seed
echo "🌱 Seeding database with sample data..."
npx prisma db seed

# Check if seed was successful
if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Database setup complete!"
  echo ""
  echo "📋 Default Login Credentials:"
  echo "   Email: owner@demo.com"
  echo "   Password: password123"
  echo ""
else
  echo "⚠️  Seed failed, but continuing..."
fi

# Start servers
echo "🚀 Starting API and Web servers..."
echo ""

# Kill existing processes
lsof -ti:3010 | xargs kill -9 2>/dev/null || true
lsof -ti:3005 | xargs kill -9 2>/dev/null || true

# Start API
cd apps/api
npm run start:dev > /tmp/pos-api.log 2>&1 &
API_PID=$!
cd ../..

# Start Web
cd apps/web
npm run dev > /tmp/pos-web.log 2>&1 &
WEB_PID=$!
cd ../..

echo "⏳ Waiting for servers to start..."
sleep 5

echo ""
echo "✅ Servers started!"
echo ""
echo "📍 API:  http://localhost:3010"
echo "📍 Web:  http://localhost:3005"
echo ""
echo "📋 Login with:"
echo "   Email: owner@demo.com"
echo "   Password: password123"
echo ""
echo "📋 Logs:"
echo "   API:  tail -f /tmp/pos-api.log"
echo "   Web:  tail -f /tmp/pos-web.log"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Trap Ctrl+C
trap "echo '\n🛑 Stopping servers...'; kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM

# Wait
wait $API_PID $WEB_PID
