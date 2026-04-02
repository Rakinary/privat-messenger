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

# Mode selection
# Default behavior: no questions, full local stack + Cloudflare tunnels.
MODE="${MODE:-local}"
if [ "$1" = "--remote" ]; then
    MODE="remote"
elif [ "$1" = "--local" ]; then
    MODE="local"
fi

if [ "$MODE" = "local" ]; then
    echo "🏠 Running in LOCAL mode (auto)"
elif [ "$MODE" = "remote" ]; then
    echo "🌐 Running in REMOTE mode"
else
    echo "❌ Invalid MODE: $MODE"
    echo "Use MODE=local|remote or flags --local / --remote"
    exit 1
fi

# Function to start backend
start_backend() {
    if [ "$MODE" = "remote" ]; then
        echo "🌐 Skipping backend start (remote mode)"
        return 0
    fi

    # Docker is required only in local mode where backend DB is started.
    if ! docker info > /dev/null 2>&1; then
        echo "❌ Docker is not running. Please start Docker first."
        return 1
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

    if docker ps -a --format '{{.Names}}' | grep -qx 'messenger-postgres'; then
        echo "🧹 Removing stale container messenger-postgres..."
        docker rm -f messenger-postgres >/dev/null 2>&1 || true
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

# Expo/Cloudflare settings
EXPO_PORT=8081
USE_CLOUDFLARE_TUNNEL=1
CLOUDFLARE_PIDS=""
CLOUDFLARE_LOG_FILES=""
LAST_TUNNEL_URL=""
BACKEND_API_URL=""
DEFAULT_REMOTE_API_URL="https://sic-their-personnel-upcoming.trycloudflare.com"

find_available_port() {
    local port=$1
    while lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do
        port=$((port + 1))
    done
    echo "$port"
}

start_cloudflare_tunnel() {
    local tunnel_name="$1"
    local tunnel_port="$2"
    local cloudflare_pid=""
    local cloudflare_log_file=""

    if [ "$USE_CLOUDFLARE_TUNNEL" -ne 1 ]; then
        return 0
    fi

    if ! command -v cloudflared >/dev/null 2>&1; then
        echo "⚠️  cloudflared is not installed. Starting Expo without Cloudflare tunnel."
        echo "    Install with: brew install cloudflared"
        return 1
    fi

    echo "☁️  Starting Cloudflare tunnel for $tunnel_name on port $tunnel_port..."

    cloudflare_log_file=$(mktemp -t messenger-cloudflared.XXXXXX.log)
    cloudflared tunnel --url "http://localhost:$tunnel_port" --no-autoupdate > "$cloudflare_log_file" 2>&1 &
    cloudflare_pid=$!
    CLOUDFLARE_PIDS="$CLOUDFLARE_PIDS $cloudflare_pid"
    CLOUDFLARE_LOG_FILES="$CLOUDFLARE_LOG_FILES $cloudflare_log_file"

    for _ in $(seq 1 30); do
        if ! kill -0 "$cloudflare_pid" 2>/dev/null; then
            echo "❌ Cloudflare tunnel process exited unexpectedly ($tunnel_name)."
            echo "--- cloudflared logs ---"
            cat "$cloudflare_log_file"
            return 1
        fi

        LAST_TUNNEL_URL=$(grep -Eo 'https://[-[:alnum:]]+\.trycloudflare\.com' "$cloudflare_log_file" | head -n 1)
        if [ -n "$LAST_TUNNEL_URL" ]; then
            echo "✅ Cloudflare tunnel ready ($tunnel_name): $LAST_TUNNEL_URL"
            return 0
        fi
        sleep 1
    done

    echo "❌ Timed out waiting for Cloudflare tunnel URL ($tunnel_name)."
    echo "--- cloudflared logs ---"
    cat "$cloudflare_log_file"
    return 1
}

# Function to start mobile
start_mobile() {
    echo "📱 Starting mobile app..."
    cd mobile

    # Set API URL based on mode
    if [ "$MODE" = "local" ]; then
        start_cloudflare_tunnel "Backend API" 3000
        if [ $? -eq 0 ] && [ -n "$LAST_TUNNEL_URL" ]; then
            BACKEND_API_URL="$LAST_TUNNEL_URL"
            echo "🔗 Using backend tunnel: $BACKEND_API_URL"
        else
            echo "❌ Backend tunnel is required for phone access outside your local network."
            echo "   Fix cloudflared and run the script again."
            return 1
        fi
    else
        BACKEND_API_URL="${BACKEND_API_URL:-$DEFAULT_REMOTE_API_URL}"
        echo "🔗 Using remote backend: $BACKEND_API_URL"
    fi
    export API_URL="$BACKEND_API_URL"
    export EXPO_PUBLIC_API_URL="$BACKEND_API_URL"

    # Install dependencies if node_modules doesn't exist
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing mobile dependencies..."
        npm install
    fi

    EXPO_PORT=$(find_available_port "$EXPO_PORT")
    start_cloudflare_tunnel "Metro" "$EXPO_PORT"
    if [ $? -ne 0 ] || [ -z "$LAST_TUNNEL_URL" ]; then
        echo "❌ Cannot start Expo without Metro tunnel URL."
        return 1
    fi
    export EXPO_PACKAGER_PROXY_URL="$LAST_TUNNEL_URL"

    # Start Expo
    echo "🚀 Starting Expo development server..."
    if [ -n "$EXPO_PACKAGER_PROXY_URL" ]; then
        echo "🔗 Expo tunnel URL: $EXPO_PACKAGER_PROXY_URL"
    fi
    echo "🔗 App backend URL: $EXPO_PUBLIC_API_URL"
    npx expo start --host localhost --port "$EXPO_PORT" --clear &
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
    echo "📱 Open Expo Go on your phone and scan the QR code"
    echo "🌍 Works without shared Wi-Fi via Cloudflare tunnels"
    echo "🔧 Local backend: http://localhost:3000"
else
    echo "📱 Open Expo Go on your phone and scan the QR code"
    echo "🌍 Works without shared Wi-Fi via Cloudflare tunnel for Metro"
    echo "🔗 Connected to remote backend"
fi
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for Ctrl+C
if [ "$MODE" = "local" ]; then
    trap 'echo ""; echo "🛑 Stopping services..."; kill $BACKEND_PID $MOBILE_PID $CLOUDFLARE_PIDS 2>/dev/null; for log_file in $CLOUDFLARE_LOG_FILES; do [ -f "$log_file" ] && rm -f "$log_file"; done; docker-compose down; exit 0' INT
else
    trap 'echo ""; echo "🛑 Stopping mobile app..."; kill $MOBILE_PID $CLOUDFLARE_PIDS 2>/dev/null; for log_file in $CLOUDFLARE_LOG_FILES; do [ -f "$log_file" ] && rm -f "$log_file"; done; exit 0' INT
fi

# Keep script running
wait