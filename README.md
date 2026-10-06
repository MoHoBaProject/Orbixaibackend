8# Orbix AI Backend

Next.js backend for Orbix AI (orbixai.ir), deployed on Cloudflare (same pipeline as the frontend).

## Endpoints
- `GET /api/health` → `{ ok, service, time, db }` — `db` is `"not configured"` until a D1 database is bound.

## Local run
```
npm install
npm run dev        # http://localhost:3001/api/health
```
(In the frontend, set `BACKEND_URL` in `public/legacy/script2.js` to `http://localhost:3001` while testing.)

## Deploy on Cloudflare (Git integration, like the frontend)
1. Push this folder to its own GitHub repo.
2. Cloudflare → Workers & Pages → Create → import that repo.
3. Settings → Build:
   - Build command: `npx @opennextjs/cloudflare build --dangerouslyUseUnsupportedNextVersion`
   - Deploy command: `npx @opennextjs/cloudflare deploy`
4. After deploy, open `https://<your-worker>.workers.dev/api/health` — you should see `"ok": true`.
5. Put that address in the frontend (`BACKEND_URL` in `public/legacy/script2.js`) and push the frontend.

## CORS
`ALLOWED_ORIGIN` in `wrangler.toml` (`[vars]`) controls which site may call the API. `"*"` allows any; once the frontend address is final, set it to that address.

## Database (Cloudflare D1) — only when needed
See the commented block at the bottom of `wrangler.toml`. After binding, `/api/health` reports `db: "connected"` by itself.
