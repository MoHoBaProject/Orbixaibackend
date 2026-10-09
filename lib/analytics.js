// Shared helpers for visit tracking + admin stats.
let ready = false;

// Runs automatically (no manual SQL needed):
// 1) creates the "visits" table
// 2) if nobody has membership "Admin" yet, the FIRST registered account becomes "Admin"
//    (everyone else keeps membership "Free", which is what registration already sets)
export async function ensureTables(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, vid TEXT NOT NULL, path TEXT, ref TEXT, device TEXT, country TEXT, new_session INTEGER DEFAULT 0, created_at TEXT NOT NULL)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits(vid)"),
    env.DB.prepare(
      "UPDATE accounts SET membership='Admin' WHERE rowid=(SELECT MIN(rowid) FROM accounts) AND NOT EXISTS (SELECT 1 FROM accounts WHERE membership='Admin')"
    ),
  ]);
  ready = true;
}

// UTC time as "YYYY-MM-DD HH:MM:SS"
export const sqlTime = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");

// 200 = admin, 401 = not logged in, 403 = logged in but membership is not "Admin"
export async function checkAdmin(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return 401;
  await ensureTables(env);
  const a = await env.DB.prepare(
    "SELECT a.membership FROM sessions s JOIN accounts a ON a.username=s.username WHERE s.token=?"
  )
    .bind(token)
    .first();
  if (!a) return 401;
  return a.membership === "Admin" ? 200 : 403;
}
