# Backend (Python FastAPI)

This backend is fully Python-only and serves all API and real-time features for VoteSecure.

Default auth mode in current build: direct registration and login (no required OTP verification).

## Stack

- FastAPI
- python-socketio
- PostgreSQL (psycopg2)
- Redis
- PyJWT
- passlib/bcrypt
- AES-256-CBC ballot encryption

## Files

- main.py: API routes, auth, vote flow, startup logic
- server.py: entrypoint to run uvicorn
- requirements.txt: backend dependencies
- db/schema.sql: database schema
- .env.example: required environment variables

## Run Locally

1. Ensure PostgreSQL is running on localhost:5432.
2. Ensure Redis is running on localhost:6379.
3. Create env file:
   - PowerShell: Copy-Item .env.example .env
4. For manual local run, set:
   - DB_HOST=localhost
   - REDIS_HOST=localhost
5. Install dependencies:
   - pip install -r requirements.txt
6. Start backend:
   - python server.py

Backend base URL:
- http://localhost:5000

Health check:
- http://localhost:5000/health

## Run With Docker

From project root:
- docker compose up --build backend postgres redis

For Docker Compose, set in backend/.env:

- DB_HOST=postgres
- REDIS_HOST=redis

## Browser Access Notes

- Backend is API-only; use frontend UI at http://localhost:5173
- OpenAPI docs are available at:
  - http://localhost:5000/docs
  - http://localhost:5000/redoc

## Required Environment Values

Set these in .env:

- PORT
- DB_HOST
- DB_PORT
- DB_NAME
- DB_USER
- DB_PASSWORD
- REDIS_HOST
- REDIS_PORT
- JWT_ACCESS_SECRET
- JWT_REFRESH_SECRET
- JWT_ACCESS_EXPIRY
- JWT_REFRESH_EXPIRY
- ENCRYPTION_KEY (exactly 32 characters)
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASS
- CLIENT_URL
- ADMIN_NAME
- ADMIN_EMAIL
- ADMIN_PASSWORD

SMTP values are optional only if you do not need email notifications.

## Default Admin

Seeded/updated from env on startup:

- Name: ADMIN_NAME
- Email: ADMIN_EMAIL
- Password: ADMIN_PASSWORD

## Notes On Current Behavior

- Registration does not require OTP verification in default flow.
- Vote confirmation email failure does not fail vote persistence.
- Legacy OTP endpoints still exist but are not required for current signup/login flow.
