# Corizo Desk — Backend API

Express API for Corizo Desk (MongoDB, Redis, BullMQ).

## Vercel deploy (API)

This repo can run as a Vercel serverless function via `api/index.js`.

### Required environment variables on Vercel

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Atlas connection string |
| `REDIS_URL` | Upstash / Redis Cloud URL (`rediss://…`) |
| `JWT_ACCESS_SECRET` | Strong secret |
| `JWT_REFRESH_SECRET` | Strong secret |
| `FRONTEND_URL` | `https://desk.corizo.in` |
| `FRONTEND_URLS` | Optional extra origins (comma-separated) |
| `RESEND_API_KEY` | Email delivery |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Sheets connector |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Sheets connector (use `\n` for newlines) |

`https://desk.corizo.in` is always allowed for CORS.

### Notes

- Sheet sync workers (BullMQ) do **not** run on Vercel serverless. For reliable background sync, also run `npm run worker` on a always-on host, or move the API to Render/Railway.
- Frontend must set `VITE_API_URL=https://corizo-desk-backend.vercel.app/api` and redeploy.

## Local

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
npm run worker   # separate terminal
```
