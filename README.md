# OnePeek

Zero-knowledge secret, file and Wi-Fi sharing at [onepeek.io](https://onepeek.io).

## Stack
- **Next.js 14** (App Router) on **Vercel**
- **Supabase** Auth + PostgreSQL + Storage
- **Mandrill** for email (alerts, one-time codes, emailed links); Resend also supported
- **Web Push** (VAPID) for browser alerts
- **Leaflet** + **OpenFreeMap** tiles (with marker clustering), **Photon/Nominatim** (OpenStreetMap) for place search and area names — all free, no keys

## Features
- Text, files/images up to 50 MB and Wi-Fi details, encrypted in the browser with AES-256-GCM
- The key lives only in the link's `#fragment`, which browsers never send to a server
- 1–10 views per link, expiry from 5 minutes to 7 days (30 days on OnePeek+), viewer timer
- Locks: recipient email + one-time code, open-after time, daily hours window, country allow-list, geofence
- Blur-until-held with a watermark, QR codes for in-person handover and Wi-Fi joining
- Request a secret: answers are encrypted to the requester's ECDH P-256 key
- Signed-in history with where it was opened, Burn now, email + browser alerts
- `/encryption` explains the design; `/.well-known/security.txt` for reports

## Setup

### 1. Supabase (SQL editor, in order)
1. `supabase/schema.sql`
2. `supabase/migrations/002_history_and_open_location.sql`
3. `supabase/migrations/003_precise_location_geofence.sql`
4. `supabase/migrations/004_controls_requests_alerts.sql` — add `SUPABASE_SERVICE_ROLE_KEY` to Vercel and redeploy **before** running this one, because opening a secret now goes through the server.

Storage: the project-wide upload limit (Settings → Storage) must be at least 50 MB.

### 2. Environment variables (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...          # server only: open, unlock codes, requests, alerts
NEXT_PUBLIC_SITE_URL=https://onepeek.io
MANDRILL_API_KEY=...                   # email
EMAIL_FROM="OnePeek Secret <secret@onepeek.io>"
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...       # browser alerts (npx web-push generate-vapid-keys)
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:secret@onepeek.io
# Maps: OpenFreeMap + Leaflet; place search/names: Photon + Nominatim (no keys needed)
```

### 3. Deploy
Push to `main` — Vercel deploys automatically. `vercel.json` schedules `/api/cleanup` daily.

## Local
```bash
npm install
npm run dev
```
