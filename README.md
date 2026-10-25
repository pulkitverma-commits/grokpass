# GrokPass

Zero-knowledge one-time secret & photo sharing.

## Stack
- **Next.js** (App Router) on **Vercel**
- **Supabase Auth** + **PostgreSQL** + **Storage**
- **Mandrill** for transactional emails (login confirmation, optional link delivery)

## Features
- Client-side AES-GCM encryption (key never leaves the browser / stays in URL fragment)
- Text secrets + encrypted photo/file uploads
- One-time reveal + expiry
- User login & dashboard
- No plaintext ever stored

## Setup

### 1. Supabase
1. Create a project at https://supabase.com
2. Enable Auth (Email provider)
3. Create table `secrets`:
   ```sql
   create table secrets (
     id uuid primary key default gen_random_uuid(),
     user_id uuid references auth.users,
     ciphertext text,
     file_path text,
     expires_at timestamptz,
     viewed boolean default false,
     created_at timestamptz default now()
   );
   ```
4. Create a Storage bucket `encrypted-secrets` (private)
5. Copy Project URL and anon key

### 2. Mandrill
1. Get API key from Mailchimp/Mandrill
2. Use it for Supabase Auth email templates or a custom `/api/send` route

### 3. Environment variables (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
MANDRILL_API_KEY=...
```

### 4. Deploy
Push this repo and connect to Vercel, or:
```bash
npx vercel --prod
```

## Local
```bash
npm install
npm run dev
```

The current code embeds encrypted data in the URL hash for demo purposes.  
Replace the create/reveal logic with Supabase inserts + Storage uploads for production one-time deletion.
