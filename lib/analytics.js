// Shared helpers for visit tracking + admin stats.
let ready = false;

// creates the "visits" table automatically the first time it is needed
export async function ensureTables(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, vid TEXT NOT NULL, path TEXT, ref TEXT, device TEXT, country TEXT, new_session INTEGER DEFAULT 0, created_at TEXT NOT NULL)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_created ON visits(created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits(vid)"),
  ]);
  ready = true;
}

// UTC time as "YYYY-MM-DD HH:MM:SS"
export const sqlTime = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");

// Admin = usernames listed in ADMIN_USERS (comma separated, optional variable).
// If ADMIN_USERS is not set, the FIRST registered account is the admin.
export async function checkAdmin(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return 401;
  const s = await env.DB.prepare("SELECT username FROM sessions WHERE token=?").bind(token).first();
  if (!s) return 401;

  let admins = String(env.ADMIN_USERS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!admins.length) {
    const first = await env.DB.prepare("SELECT username FROM accounts ORDER BY rowid LIMIT 1").first();
    if (first) admins = [String(first.username).toLowerCase()];
  }
  return admins.includes(String(s.username).toLowerCase()) ? 200 : 403;
}
