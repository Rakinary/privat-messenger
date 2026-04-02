@echo off
REM Cross-platform run script for Messenger App (Windows version)
REM For macOS/Linux, use ./run.sh

echo 🚀 Starting Messenger App...
echo 📱 Detected Windows

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running. Please start Docker first.
    pause
    exit /b 1
)

REM Ask user for mode
echo Choose mode:
echo 1) Local development (backend + mobile)
echo 2) Remote backend (only mobile, backend is remote)
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    set MODE=local
    echo 🏠 Running in LOCAL mode
) else if "%choice%"=="2" (
    set MODE=remote
    echo 🌐 Running in REMOTE mode (only mobile app)
) else (
    echo ❌ Invalid choice
    pause
    exit /b 1
)

REM Function to start backend
:start_backend
if "%MODE%"=="remote" (
    echo 🌐 Skipping backend start (remote mode)
    goto :mobile
)

echo 🔧 Starting backend...
cd backend

REM Check if .env exists
if not exist .env (
    echo ⚠️  .env file not found. Copying from .env.example...
    copy .env.example .env
    echo ✏️  Please edit .env file with your configuration before running again.
    cd ..
    goto :mobile
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing backend dependencies...
    npm install
)

REM Start database
echo 🐘 Starting PostgreSQL database...
docker-compose up -d

REM Wait for database to be ready
echo ⏳ Waiting for database to be ready...
timeout /t 10 /nobreak >nul

REM Run migrations
echo 🗄️  Running Prisma migrations...
npm run prisma:migrate

REM Generate Prisma client
npm run prisma:generate

REM Start backend server
echo 🚀 Starting NestJS server...
start /B npm run start:dev

cd ..
echo ✅ Backend started
goto :mobile

:mobile
REM Start mobile
echo 📱 Starting mobile app...
cd mobile

REM Set API URL based on mode
if "%MODE%"=="local" (
    set API_URL=http://localhost:3000
    echo 🔗 Using local backend: %API_URL%
) else (
    set API_URL=https://sic-their-personnel-upcoming.trycloudflare.com
    echo 🔗 Using remote backend: %API_URL%
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing mobile dependencies...
    npm install
)

REM Start Expo
echo 🚀 Starting Expo development server...
start /B npm start

cd ..
echo ✅ Mobile app started

echo.
echo 🎉 Services are running!
if "%MODE%"=="local" (
    echo 📱 Mobile: Open Expo app on your device or press 'w' in terminal for web
    echo 🔧 Backend: http://localhost:3000
) else (
    echo 📱 Mobile: Open Expo app on your device or press 'w' in terminal for web
    echo 🔗 Connected to remote backend
)
echo.
echo Press any key to stop all services...

pause >nul

REM Stop services
if "%MODE%"=="local" (
    echo 🛑 Stopping services...
    docker-compose down
) else (
    echo 🛑 Stopping mobile app...
)
taskkill /f /im node.exe >nul 2>&1

echo ✅ All services stopped
pause