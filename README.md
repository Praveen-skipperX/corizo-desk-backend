# Corizo Desk — Backend API

Express API for Corizo Desk (MongoDB, Redis, BullMQ).

> **Note:** This API is **not** intended for Vercel serverless. Deploy on Render, Railway, Fly.io, or a VPS. Connect the **frontend** repo to Vercel.

## Production checklist (for Vercel frontend)

Set these on your API host:

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://your-app.vercel.app` |
| `FRONTEND_URLS` | Optional comma-separated preview URLs |
| `MONGODB_URI` | Atlas connection string |
| `REDIS_URL` | Redis / Upstash URL |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Strong secrets |
| `RESEND_API_KEY` | Email delivery |

In production, refresh cookies use `SameSite=None; Secure` so the Vercel SPA can keep sessions across domains.

## Local

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
npm run worker   # separate terminal
```
