# CampusOne Backend — Setup

## 1. Supabase
1. Create a project named `campusone-vesit` at supabase.com.
2. Go to **SQL Editor → New query**, paste the contents of `supabase_schema.sql`, and click **Run**.
   This creates all 14 tables, indexes, RLS policies, and seeds the VESIT college row.
3. Go to **Project Settings → API** and copy:
   - Project URL → `SUPABASE_URL`
   - `service_role` key (NOT `anon`) → `SUPABASE_SERVICE_KEY`
   Share the **Project URL and anon key only** with the team via a private doc/DM — never the service_role key, never in GitHub.

## 2. Cloudinary
1. Create a free account at cloudinary.com.
2. From the Dashboard, copy Cloud Name, API Key, API Secret into `.env`.

## 3. Local setup
```bash
cp .env.example .env
# fill in the values from steps 1 and 2, plus a random JWT_SECRET
npm install
npm run dev
```
Visit `http://localhost:4000/health` — should return `{"status":"ok"}`.

## 4. Deploy to Render
1. Push this folder to a GitHub repo (`.env` is gitignored — never commit it).
2. On Render: New → Web Service → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add all variables from `.env` in Render's Environment tab.
4. Once live, confirm `https://<your-render-url>/health` works, then share that base URL with the team.

## Endpoints implemented
- `POST /auth/signup` — `{ name, email, password }`, validates college email domain
- `POST /auth/login` — `{ email, password }`, returns JWT
- `GET /auth/me` — requires `Authorization: Bearer <token>`
- `GET /timetable?division=A` — scoped to caller's college
- `POST /timetable` — admin only
- `POST /notes` — multipart form: `file`, `subject`, `year`, `topic`
- `GET /notes?subject=&year=&topic=`
- `GET /notes/:id/download`

Test all of these in Postman and export the collection to share with the team.
