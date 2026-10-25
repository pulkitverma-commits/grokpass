# GrokPass

Zero-knowledge one-time secret & photo sharing.

## Stack
- **Next.js** (App Router) on **Vercel**
- **Supabase Auth** + **PostgreSQL** + **Storage**
- **Mandrill** for transactional emails (login confirmation, optional link delivery)

## Features
- Every secret (text, code or file) is encrypted in the browser with AES-256-GCM
- The key lives only in the link's `#fragment`, which browsers never send to a server
- Short links: `/s/<10-char id>#<key>` — ciphertext is stored in Supabase, not in the URL
- Text secrets + encrypted photo/file uploads up to 10 MB
- Images are shown in the browser with a Download button (no automatic download)
- Optional viewer timer: the secret vanishes N seconds after it is opened
- One-time reveal (atomic delete on open) + expiry (1 h / 24 h / 7 d) + daily cleanup cron
- User login & dashboard (Supabase Auth)

## Setup

### 1. Supabase
1. Create a project at https://supabase.com
2. Run `supabase/schema.sql` in the SQL editor. It creates:
   - `secrets` / `secret_claims` tables (RLS on, no direct access)
   - `create_secret`, `peek_secret`, `open_secret`, `reap_expired_secrets` RPC functions
   - a private `secrets` storage bucket (10 MB limit) with insert-only access until a secret is opened
3. Copy the Project URL and anon key

### 2. Environment variables (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
MANDRILL_API_KEY=...        # optional, for emailing links
MANDRILL_FROM=...           # optional
```

### 3. Deploy
Push to `main` — Vercel deploys automatically. `vercel.json` schedules `/api/cleanup` daily.

## Local
```bash
npm install
npm run dev
```
