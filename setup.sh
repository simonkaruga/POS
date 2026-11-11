#!/bin/bash

set -e

echo "🚀 Faida POS - Complete Setup Script"
echo "===================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi
echo "✓ Node.js found: $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    exit 1
fi
echo "✓ npm found: $(npm -v)"
echo ""

# Step 1: Install root dependencies
echo "📦 Step 1/6: Installing root dependencies..."
npm install --legacy-peer-deps || echo "⚠️  Root install had warnings (continuing...)"
echo "✓ Root dependencies installed"
echo ""

# Step 2: Install API dependencies
echo "📦 Step 2/6: Installing API dependencies..."
cd apps/api
npm install || echo "⚠️  API install had warnings (continuing...)"
cd ../..
echo "✓ API dependencies installed"
echo ""

# Step 3: Generate Prisma Client
echo "🔧 Step 3/6: Generating Prisma Client..."
cd apps/api
npx prisma generate --schema=../../prisma/schema.prisma || {
    echo "❌ Prisma generate failed"
    exit 1
}
cd ../..
echo "✓ Prisma Client generated"
echo ""

# Step 4: Run migrations
echo "🗄️  Step 4/6: Running database migrations..."
cd apps/api
npx prisma migrate dev --name init --schema=../../prisma/schema.prisma || {
    echo "❌ Migration failed."
    exit 1
}
cd ../..
echo "✓ Database migrated"
echo ""

# Step 5: Install web dependencies
echo "📦 Step 5/6: Installing web dependencies..."
cd apps/web
npm install || echo "⚠️  Web install had warnings (continuing...)"
cd ../..
echo "✓ Web dependencies installed"
echo ""

# Step 6: Create start script
echo "📝 Step 6/6: Creating start script..."
cat > start.sh << 'EOF'
#!/bin/bash

echo "🚀 Starting Faida POS..."
echo ""
echo "API will run on: http://localhost:3000"
echo "Web will run on: http://localhost:3005"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

npm run dev
EOF

chmod +x start.sh
echo "✓ Start script created"
echo ""

echo "✅ Setup complete!"
echo ""
echo "To start the application:"
echo "  ./start.sh"
echo ""
echo "Access points:"
echo "  • API: http://localhost:3000"
echo "  • Web: http://localhost:3005"
echo ""
