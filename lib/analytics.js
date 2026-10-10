// Shared helpers for visit tracking + admin stats.
let ready = false;

// extra info stored for every visit (columns are added automatically if missing)
const VISIT_COLS = {
  ip: "TEXT", city: "TEXT", region: "TEXT", isp: "TEXT", tz: "TEXT", lang: "TEXT",
  browser: "TEXT", os: "TEXT", model: "TEXT", screen: "TEXT", username: "TEXT",
};

// Runs automatically (no manual SQL needed):
// 1) creates the "visits" table and adds any missing columns
// 2) if nobody has membership "Admin" yet, the FIRST registered account becomes "Admin"
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

  const cols = await env.DB.prepare("PRAGMA table_info(visits)").all();
  const have = new Set(cols.results.map((c) => c.name));
  for (const [name, type] of Object.entries(VISIT_COLS)) {
    if (have.has(name)) continue;
    try {
      await env.DB.prepare("ALTER TABLE visits ADD COLUMN " + name + " " + type).run();
    } catch (e) {} // another request added it at the same time
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_user ON visits(username)").run();
  ready = true;
}

// UTC time as "YYYY-MM-DD HH:MM:SS"
export const sqlTime = (d = new Date()) => d.toISOString().slice(0, 19).replace("T", " ");

// logged-in user of this request (from the Bearer token) or null
export async function getSessionUser(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  await ensureTables(env);
  const row = await env.DB.prepare(
    "SELECT a.username, a.membership FROM sessions s JOIN accounts a ON a.username=s.username WHERE s.token=?"
  )
    .bind(token)
    .first();
  return row || null;
}

// browser + operating system from the User-Agent header
export function parseUA(ua = "") {
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Other";
  const os = /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "Other";
  return { browser, os };
}
