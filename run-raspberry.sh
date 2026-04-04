#!/bin/bash
set -e

echo "🚀 Starting Messenger on Raspberry Pi..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPO_PORT=8081
CLOUDFLARE_PIDS=""
CLOUDFLARE_LOG_FILES=""
LAST_TUNNEL_URL=""
BACKEND_API_URL=""

cleanup() {
    echo ""
    echo "🛑 Stopping services..."
    kill $CLOUDFLARE_PIDS $MOBILE_PID 2>/dev/null || true
    for log_file in $CLOUDFLARE_LOG_FILES; do
        [ -f "$log_file" ] && rm -f "$log_file"
    done
    exit 0
}
trap cleanup INT TERM

# ── 1. Backend via pm2 ──────────────────────────────────────────────────────
echo "🔧 Ensuring backend is running..."
cd "$SCRIPT_DIR/backend"

if ! pm2 describe messenger > /dev/null 2>&1; then
    echo "📦 Backend not running, starting..."
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    if [ ! -d "dist" ]; then
        echo "🔨 Building backend..."
        npm run build
    fi
    npx prisma migrate deploy
    pm2 start dist/src/main.js --name messenger
    pm2 save
else
    echo "✅ Backend already running via pm2"
fi

cd "$SCRIPT_DIR"

# ── Helper: start cloudflare tunnel ────────────────────────────────────────
start_tunnel() {
    local name="$1"
    local port="$2"

    if ! command -v cloudflared >/dev/null 2>&1; then
        echo "❌ cloudflared not found. Install with:"
        echo "   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared"
        echo "   chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/"
        exit 1
    fi

    echo "☁️  Starting Cloudflare tunnel for $name (port $port)..."
    local log_file
    log_file=$(mktemp /tmp/cloudflared-XXXXXX.log)
    cloudflared tunnel --url "http://localhost:$port" --no-autoupdate > "$log_file" 2>&1 &
    local pid=$!
    CLOUDFLARE_PIDS="$CLOUDFLARE_PIDS $pid"
    CLOUDFLARE_LOG_FILES="$CLOUDFLARE_LOG_FILES $log_file"

    for _ in $(seq 1 30); do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo "❌ Cloudflare tunnel ($name) exited unexpectedly:"
            cat "$log_file"
            exit 1
        fi
        LAST_TUNNEL_URL=$(grep -Eo 'https://[-[:alnum:]]+\.trycloudflare\.com' "$log_file" | head -n 1)
        if [ -n "$LAST_TUNNEL_URL" ]; then
            echo "✅ Tunnel ready ($name): $LAST_TUNNEL_URL"
            return 0
        fi
        sleep 1
    done

    echo "❌ Timed out waiting for tunnel ($name):"
    cat "$log_file"
    exit 1
}

# ── 2. Tunnel for backend (port 3000) ───────────────────────────────────────
start_tunnel "Backend API" 3000
BACKEND_API_URL="$LAST_TUNNEL_URL"

# ── 3. Tunnel for Metro/Expo bundler ────────────────────────────────────────
start_tunnel "Metro bundler" "$EXPO_PORT"
METRO_TUNNEL_URL="$LAST_TUNNEL_URL"

# ── 4. Start Expo ───────────────────────────────────────────────────────────
echo "📱 Starting Expo..."
cd "$SCRIPT_DIR/mobile"

if [ ! -d "node_modules" ]; then
    echo "📦 Installing mobile dependencies..."
    npm install
fi

# Write .env with backend tunnel URL
cat > .env << EOF
EXPO_PUBLIC_API_URL=$BACKEND_API_URL
EOF

echo ""
echo "🔗 Backend URL:  $BACKEND_API_URL"
echo "🔗 Metro tunnel: $METRO_TUNNEL_URL"
echo ""

export EXPO_PUBLIC_API_URL="$BACKEND_API_URL"
export EXPO_PACKAGER_PROXY_URL="$METRO_TUNNEL_URL"

npx expo start --host localhost --port "$EXPO_PORT" --clear &
MOBILE_PID=$!

echo ""
echo "🎉 All services running!"
echo "📱 Scan the QR code above with Expo Go"
echo "🌍 Works from any network (Cloudflare tunnels active)"
echo ""
echo "Press Ctrl+C to stop everything"

wait
