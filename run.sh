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

# Function to start backend
start_backend() {
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
echo "🎉 Both services are running!"
echo "📱 Mobile: Open Expo app on your device or press 'w' in terminal for web"
echo "🔧 Backend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
trap 'echo ""; echo "🛑 Stopping services..."; kill $BACKEND_PID $MOBILE_PID 2>/dev/null; docker-compose down; exit 0' INT

# Keep script running
wait