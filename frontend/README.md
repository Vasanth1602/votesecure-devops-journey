# Frontend (React + Vite)

This frontend provides voter and admin interfaces for VoteSecure.

## Stack

- React 18
- Vite
- React Router
- Tailwind CSS
- Recharts
- socket.io-client

## Run Locally

1. Install dependencies:
   - npm install
2. Start dev server:
   - npm run dev
3. Open browser:
   - http://localhost:5173

The Vite dev server proxies API and websocket traffic to backend:

- /api -> http://localhost:5000
- /socket.io -> http://localhost:5000

## Run With Docker

From project root:
- docker compose up --build frontend backend postgres redis

Then open:
- http://localhost:5173

In Docker, frontend is served by Nginx and proxies:

- /api -> backend:5000
- /socket.io -> backend:5000

## End-to-End Browser Flow

1. Open http://localhost:5173
2. Login as admin (admin@votesecure.com / Admin@123)
3. Create election and candidates
4. Activate election
5. Register voter account (no OTP required in current build)
6. Login as voter and cast vote
7. View live results and audit trail

## Build For Production

- npm run build
- npm run preview
