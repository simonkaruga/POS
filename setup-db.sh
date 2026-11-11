#!/bin/bash

echo "🗄️ Setting up Faida POS Database..."

# Go to API directory where .env is located
cd apps/api

# Remove existing database
rm -f dev.db

# Run migrations
echo "📋 Running migrations..."
npx prisma migrate dev --name init --schema ../../prisma/schema.prisma

# Run seed
echo "🌱 Seeding data..."
npx ts-node --project ../../tsconfig.json ../../prisma/seed.ts

echo "✅ Database setup complete!"
echo "📋 Login: owner@premiercafe.co.ke / password123"