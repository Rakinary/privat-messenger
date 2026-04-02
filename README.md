# Messenger App

A full-stack messenger application with mobile frontend (React Native/Expo) and backend (NestJS with Prisma and PostgreSQL).

## Project Structure

- `mobile/` - React Native mobile application using Expo
- `backend/` - NestJS backend API with real-time messaging via Socket.IO

## Prerequisites

- Node.js (v18+)
- npm or yarn
- Docker and Docker Compose (for backend database)
- Expo CLI (for mobile development)

## Quick Start

### Automatic Setup (Recommended)

Use the provided scripts for easy setup and running:

**On macOS/Linux:**
```bash
./run.sh
```

**On Windows:**
```bash
run.bat
```

The scripts will ask you to choose between:
- **Local development**: Runs both backend and mobile app locally
- **Remote backend**: Runs only mobile app, connects to remote backend via tunnel

The scripts will automatically:
- Install dependencies for frontend and backend (local mode)
- Set up environment variables (copy `.env.example` to `.env` if needed)
- Start PostgreSQL database with Docker (local mode)
- Run Prisma migrations (local mode)
- Start backend (http://localhost:3000) and mobile (Expo) servers

### Remote Backend Mode

If your backend is deployed remotely (e.g., via Cloudflare Tunnel), choose "Remote backend" mode when running the scripts. The mobile app will automatically connect to the remote API URL configured in `mobile/src/api/client.ts`.

To update the remote URL, edit the `API_URL` in `mobile/src/api/client.ts` or set the `API_URL` environment variable.

### Manual Setup

If you prefer manual setup, follow these steps:

#### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   - Copy `.env.example` to `.env`
   - Configure your database URL and JWT secrets

4. Start the database with Docker:
   ```bash
   docker-compose up -d
   ```

5. Run Prisma migrations:
   ```bash
   npm run prisma:migrate
   ```

6. Seed the database (optional):
   ```bash
   npm run seed:users
   ```

7. Start the development server:
   ```bash
   npm run start:dev
   ```

#### Mobile Setup

1. Navigate to the mobile directory:
   ```bash
   cd mobile
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Expo development server:
   ```bash
   npm start
   ```

4. Run on your device/simulator:
   - For iOS: `npm run ios`
   - For Android: `npm run android`
   - For Web: `npm run web`

## Features

- User authentication and authorization
- Real-time messaging with Socket.IO
- Direct and group chats
- Push notifications
- File attachments
- Admin panel

## API Documentation

Once the backend is running, you can access the API documentation at `http://localhost:3000/api`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests (if any)
5. Submit a pull request

## License

This project is private and not licensed for public use.