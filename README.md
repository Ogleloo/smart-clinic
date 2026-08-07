# Smart Clinic

A queue and appointment management app for walk-in clinics. Patients book
appointments, check queue position and wait estimates in real time, and
clinic staff (reception, nurses, admins) manage the walk-in queue —
without patients needing to guess how long they'll be waiting.

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript
- [Tailwind CSS](https://tailwindcss.com) v4, design tokens in `app/globals.css`
- [Supabase](https://supabase.com) — Postgres, Auth, Row Level Security, Realtime
- `@supabase/ssr` for server/browser Supabase clients

Row Level Security is the authorization boundary: every table is scoped
to the caller by policy, so client code never filters by `patient_id` or
similar — it relies on the database to only return what the caller is
allowed to see.

## Running locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your Supabase project's
   URL and publishable (anon) key:

   ```bash
   cp .env.example .env.local
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Other scripts

- `npm run build` — production build
- `npm run lint` — ESLint
- `npx tsc --noEmit` — typecheck
- `npx supabase gen types typescript --project-id <project-id> > lib/types/database.types.ts` —
  regenerate database types after a schema change
