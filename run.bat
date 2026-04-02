@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Messenger launcher for Windows
REM Mirrors run.sh behavior: local/remote modes + Cloudflare tunnels.

echo 🚀 Starting Messenger App...
echo 🪟 Detected Windows

set "MODE=%MODE%"
if "%MODE%"=="" set "MODE=local"

if /I "%~1"=="--remote" set "MODE=remote"
if /I "%~1"=="--local" set "MODE=local"

if /I "%MODE%"=="local" (
  echo 🏠 Running in LOCAL mode
) else if /I "%MODE%"=="remote" (
  echo 🌐 Running in REMOTE mode
) else (
  echo ❌ Invalid MODE: %MODE%
  echo Use MODE=local^|remote or flags --local / --remote
  exit /b 1
)

set "DEFAULT_REMOTE_API_URL=https://sic-their-personnel-upcoming.trycloudflare.com"
set "BACKEND_API_URL="
set "LAST_TUNNEL_URL="
set "EXPO_PORT=8081"

call :start_backend
if errorlevel 1 (
  echo ❌ Backend startup failed.
  exit /b 1
)

call :start_mobile
if errorlevel 1 (
  echo ❌ Mobile startup failed.
  call :cleanup
  exit /b 1
)

echo.
echo 🎉 Services are running!
if /I "%MODE%"=="local" (
  echo 📱 Open Expo Go on your phone and scan the QR code
  echo 🌍 Works without shared Wi-Fi via Cloudflare tunnels
  echo 🔧 Local backend: http://localhost:3000
) else (
  echo 📱 Open Expo Go on your phone and scan the QR code
  echo 🌍 Works without shared Wi-Fi via Cloudflare tunnel for Metro
  echo 🔗 Connected to remote backend
)
echo.
echo Press any key to stop all services...
pause >nul

call :cleanup
exit /b 0

:start_backend
if /I "%MODE%"=="remote" (
  echo 🌐 Skipping backend start (remote mode)
  exit /b 0
)

docker info >nul 2>&1
if errorlevel 1 (
  echo ❌ Docker is not running. Please start Docker first.
  exit /b 1
)

echo 🔧 Starting backend...
pushd backend

if not exist .env (
  echo ⚠️ .env file not found. Copying from .env.example...
  copy .env.example .env >nul
  echo ✏️ Please edit backend\.env and run again.
  popd
  exit /b 1
)

if not exist node_modules (
  echo 📦 Installing backend dependencies...
  call npm install
  if errorlevel 1 (
    popd
    exit /b 1
  )
)

REM Remove stale postgres container if exists
for /f "delims=" %%N in ('docker ps -a --format "{{.Names}}" ^| findstr /R /C:"^messenger-postgres$"') do (
  echo 🧹 Removing stale container messenger-postgres...
  docker rm -f messenger-postgres >nul 2>&1
  goto :after_stale_remove
)
:after_stale_remove

echo 🐘 Starting PostgreSQL database...
docker-compose up -d
if errorlevel 1 (
  popd
  exit /b 1
)

echo ⏳ Waiting for database to be ready...
timeout /t 10 /nobreak >nul

echo 🗄️ Running Prisma migrations...
call npm run prisma:migrate
if errorlevel 1 (
  popd
  exit /b 1
)

call npm run prisma:generate
if errorlevel 1 (
  popd
  exit /b 1
)

echo 🚀 Starting NestJS server...
start "messenger-backend" cmd /c "npm run start:dev"

popd
echo ✅ Backend started
exit /b 0

:start_mobile
echo 📱 Starting mobile app...
pushd mobile

if /I "%MODE%"=="local" (
  call :start_cloudflare_tunnel "Backend API" 3000
  if errorlevel 1 (
    popd
    exit /b 1
  )
  set "BACKEND_API_URL=!LAST_TUNNEL_URL!"
  echo 🔗 Using backend tunnel: !BACKEND_API_URL!
) else (
  set "BACKEND_API_URL=%DEFAULT_REMOTE_API_URL%"
  echo 🔗 Using remote backend: !BACKEND_API_URL!
)

if not exist node_modules (
  echo 📦 Installing mobile dependencies...
  call npm install
  if errorlevel 1 (
    popd
    exit /b 1
  )
)

call :start_cloudflare_tunnel "Metro" %EXPO_PORT%
if errorlevel 1 (
  popd
  exit /b 1
)
set "EXPO_PACKAGER_PROXY_URL=!LAST_TUNNEL_URL!"

echo 🚀 Starting Expo development server...
echo 🔗 Expo tunnel URL: !EXPO_PACKAGER_PROXY_URL!
echo 🔗 App backend URL: !BACKEND_API_URL!

start "messenger-expo" cmd /c "set API_URL=!BACKEND_API_URL!&& set EXPO_PUBLIC_API_URL=!BACKEND_API_URL!&& set EXPO_PACKAGER_PROXY_URL=!EXPO_PACKAGER_PROXY_URL!&& npx expo start --host localhost --port %EXPO_PORT% --clear"

popd
echo ✅ Mobile app started
exit /b 0

:start_cloudflare_tunnel
set "LAST_TUNNEL_URL="
set "TUNNEL_NAME=%~1"
set "TUNNEL_PORT=%~2"
set "CLOUDFLARE_LOG=%TEMP%\messenger-cloudflared-%RANDOM%.log"

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo ❌ cloudflared is not installed.
  echo Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  exit /b 1
)

echo ☁️ Starting Cloudflare tunnel for %TUNNEL_NAME% on port %TUNNEL_PORT%...
start "cf-%TUNNEL_NAME%" /b cmd /c "cloudflared tunnel --url http://localhost:%TUNNEL_PORT% --no-autoupdate > \"%CLOUDFLARE_LOG%\" 2>&1"

for /L %%I in (1,1,30) do (
  for /f "usebackq delims=" %%U in (`powershell -NoProfile -Command "$m = Get-Content -Path '%CLOUDFLARE_LOG%' ^| Select-String -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' ^| Select-Object -First 1; if ($m) { $m.Matches[0].Value }"`) do set "LAST_TUNNEL_URL=%%U"

  if defined LAST_TUNNEL_URL goto :tunnel_url_found

  timeout /t 1 /nobreak >nul
)

:tunnel_url_found
if defined LAST_TUNNEL_URL (
  echo ✅ Cloudflare tunnel ready (%TUNNEL_NAME%): !LAST_TUNNEL_URL!
  exit /b 0
)

echo ❌ Timed out waiting for Cloudflare tunnel URL (%TUNNEL_NAME%).
echo --- cloudflared logs ---
type "%CLOUDFLARE_LOG%"
exit /b 1

:cleanup
echo 🛑 Stopping services...
taskkill /f /fi "WINDOWTITLE eq messenger-backend*" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq messenger-expo*" >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq cf-*" >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1

if /I "%MODE%"=="local" (
  pushd backend
  docker-compose down >nul 2>&1
  popd
)

echo ✅ All services stopped
exit /b 0
