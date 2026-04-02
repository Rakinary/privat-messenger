#!/bin/bash

# Cross-platform run script for Messenger App
# Supports macOS and Linux. For Windows, use run.bat

echo "🚀 Starting Messenger App..."

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "📱 Detected macOS"
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "🐧 Detected Linux"
    OS="linux"
else
    echo "❌ Unsupported OS: $OSTYPE"
    echo "This script supports macOS and Linux."
    echo "For Windows, please use run.bat"
    exit 1
fi

# Check if Docker is running (for backend database)
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Ask user for mode
echo "Choose mode:"
echo "1) Local development (backend + mobile)"
echo "2) Remote backend (only mobile, backend is remote)"
read -p "Enter choice (1 or 2): " choice

if [ "$choice" = "1" ]; then
    MODE="local"
    echo "🏠 Running in LOCAL mode"
elif [ "$choice" = "2" ]; then
    MODE="remote"
    echo "🌐 Running in REMOTE mode (only mobile app)"
else
    echo "❌ Invalid choice"
    exit 1
fi

# Function to start backend
start_backend() {
    if [ "$MODE" = "remote" ]; then
        echo "🌐 Skipping backend start (remote mode)"
        return 0
    fi

    echo "🔧 Starting backend..."
    cd backend

    # Check if .env exists
    if [ ! -f .env ]; then
        echo "⚠️  .env file not found. Copying from .env.example..."
        cp .env.example .env
        echo "✏️  Please edit .env file with your configuration before running again."
        return 1
    fi

    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing backend dependencies..."
        npm install
    fi

    # Start database
    echo "🐘 Starting PostgreSQL database..."
    docker-compose up -d

    # Wait for database to be ready
    echo "⏳ Waiting for database to be ready..."
    sleep 10

    # Run migrations
    echo "🗄️  Running Prisma migrations..."
    npm run prisma:migrate

    # Generate Prisma client
    npm run prisma:generate

    # Start backend server in background
    echo "🚀 Starting NestJS server..."
    npm run start:dev &
    BACKEND_PID=$!

    cd ..
    echo "✅ Backend started (PID: $BACKEND_PID)"
}

# Function to start mobile
start_mobile() {
    echo "📱 Starting mobile app..."
    cd mobile

    # Set API URL based on mode
    if [ "$MODE" = "local" ]; then
        export API_URL="http://localhost:3000"
        echo "🔗 Using local backend: $API_URL"
    else
        export API_URL="https://sic-their-personnel-upcoming.trycloudflare.com"
        echo "🔗 Using remote backend: $API_URL"
    fi

    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing mobile dependencies..."
        npm install
    fi

    # Start Expo
    echo "🚀 Starting Expo development server..."
    npm start &
    MOBILE_PID=$!

    cd ..
    echo "✅ Mobile app started (PID: $MOBILE_PID)"
}

# Start services
start_backend
if [ $? -eq 0 ]; then
    start_mobile
fi

# Wait for user input to stop
echo ""
echo "🎉 Services are running!"
if [ "$MODE" = "local" ]; then
    echo "📱 Mobile: Open Expo app on your device or press 'w' in terminal for web"
    echo "🔧 Backend: http://localhost:3000"
else
    echo "📱 Mobile: Open Expo app on your device or press 'w' in terminal for web"
    echo "🔗 Connected to remote backend"
fi
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
if [ "$MODE" = "local" ]; then
    trap 'echo ""; echo "🛑 Stopping services..."; kill $BACKEND_PID $MOBILE_PID 2>/dev/null; docker-compose down; exit 0' INT
else
    trap 'echo ""; echo "🛑 Stopping mobile app..."; kill $MOBILE_PID 2>/dev/null; exit 0' INT
fi

# Keep script running
wait