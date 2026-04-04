#!/bin/bash
set -e

echo "🚀 Starting Messenger on Raspberry Pi..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUDFLARE_PID=""
CLOUDFLARE_LOG=""

cleanup() {
    echo ""
    echo "🛑 Stopping services..."
    [ -n "$CLOUDFLARE_PID" ] && kill "$CLOUDFLARE_PID" 2>/dev/null || true
    [ -n "$CLOUDFLARE_LOG" ] && rm -f "$CLOUDFLARE_LOG"
    exit 0
}
trap cleanup INT TERM

# ── 1. Backend via pm2 ──────────────────────────────────────────────────────
echo "🔧 Ensuring backend is running..."
cd "$SCRIPT_DIR/backend"

if ! pm2 describe messenger > /dev/null 2>&1; then
    echo "📦 Backend not running, starting..."
    [ ! -d "node_modules" ] && npm install
    [ ! -d "dist" ] && { echo "🔨 Building..."; npm run build; }
    npx prisma migrate deploy
    pm2 start dist/src/main.js --name messenger
    pm2 save
else
    echo "✅ Backend already running via pm2"
fi

cd "$SCRIPT_DIR"

# ── 2. Cloudflare tunnel for backend (port 3000) ────────────────────────────
if ! command -v cloudflared >/dev/null 2>&1; then
    echo "❌ cloudflared not found. Install:"
    echo "   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o cloudflared"
    echo "   chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/"
    exit 1
fi

echo "☁️  Starting Cloudflare tunnel for backend (port 3000)..."
CLOUDFLARE_LOG=$(mktemp /tmp/cloudflared-XXXXXX.log)
cloudflared tunnel --url "http://localhost:3000" --no-autoupdate > "$CLOUDFLARE_LOG" 2>&1 &
CLOUDFLARE_PID=$!

BACKEND_API_URL=""
for _ in $(seq 1 30); do
    if ! kill -0 "$CLOUDFLARE_PID" 2>/dev/null; then
        echo "❌ Cloudflare tunnel exited:"; cat "$CLOUDFLARE_LOG"; exit 1
    fi
    BACKEND_API_URL=$(grep -Eo 'https://[-[:alnum:]]+\.trycloudflare\.com' "$CLOUDFLARE_LOG" | head -n 1)
    [ -n "$BACKEND_API_URL" ] && break
    sleep 1
done

if [ -z "$BACKEND_API_URL" ]; then
    echo "❌ Timed out waiting for tunnel:"; cat "$CLOUDFLARE_LOG"; exit 1
fi
echo "✅ Backend tunnel: $BACKEND_API_URL"

# ── 3. Start Expo with built-in tunnel ──────────────────────────────────────
echo "📱 Starting Expo..."
cd "$SCRIPT_DIR/mobile"

[ ! -d "node_modules" ] && { echo "📦 Installing mobile dependencies..."; npm install; }

# Install ngrok for Expo tunnel if needed
if ! npx @expo/ngrok --version > /dev/null 2>&1; then
    echo "📦 Installing @expo/ngrok..."
    npm install --save-dev @expo/ngrok@^4.0.3
fi

# Write backend URL to .env
cat > .env << EOF
EXPO_PUBLIC_API_URL=$BACKEND_API_URL
EOF

echo ""
echo "🔗 Backend URL: $BACKEND_API_URL"
echo ""

export EXPO_PUBLIC_API_URL="$BACKEND_API_URL"

# --tunnel makes Expo create its own ngrok tunnel for Metro bundler
# QR code will contain a public URL that works from any network
npx expo start --tunnel --clear

cd "$SCRIPT_DIR"
