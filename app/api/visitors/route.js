import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";
import { ensureTables, getSessionUser } from "../../../lib/analytics";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

// GET /api/visitors?filter=all|reg|guest   → one row per visitor (browser) + counters   (admin only)
// GET /api/visitors?vid=XXXX               → full details of one visitor              (admin only)
export async function GET(request) {
  const { env } = getCloudflareContext();
  const me = await getSessionUser(request, env);
  if (!me) return json({ error: "Not logged in" }, 401, request);
  if (me.membership !== "Admin") return json({ error: "Forbidden" }, 403, request);
  await ensureTables(env);

  const url = new URL(request.url);
  const P = (sql, ...a) => env.DB.prepare(sql).bind(...a);

  // ---- details of one visitor ----
  const vid = url.searchParams.get("vid");
  if (vid) {
    const r = await env.DB.batch([
      P(
        "SELECT created_at, path, ref, ip, city, region, country, isp, device, browser, os, model, screen, lang, tz, username FROM visits WHERE vid=? ORDER BY id DESC LIMIT 50",
        vid
      ),
      P(
        "SELECT username, membership, email, mobile, created_at FROM accounts WHERE username IN (SELECT DISTINCT username FROM visits WHERE vid=? AND username IS NOT NULL)",
        vid
      ),
      P("SELECT ip, COUNT(*) AS n FROM visits WHERE vid=? GROUP BY ip ORDER BY n DESC LIMIT 10", vid),
    ]);
    return json({ vid, visits: r[0].results, accounts: r[1].results, ips: r[2].results }, 200, request);
  }

  // ---- list of visitors ----
  const filter = url.searchParams.get("filter");
  const where = filter === "reg" ? "WHERE g.username IS NOT NULL" : filter === "guest" ? "WHERE g.username IS NULL" : "";

  const r = await env.DB.batch([
    P(
      "WITH g AS (SELECT vid, COUNT(*) AS views, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen, MAX(username) AS username, MAX(id) AS last_id FROM visits GROUP BY vid) " +
        "SELECT g.vid, g.views, g.first_seen, g.last_seen, g.username, v.ip, v.city, v.region, v.country, v.isp, v.device, v.browser, v.os, v.model, v.screen, v.lang, v.tz " +
        "FROM g JOIN visits v ON v.id=g.last_id " + where + " ORDER BY g.last_seen DESC LIMIT 100"
    ),
    P(
      "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN username IS NOT NULL THEN 1 ELSE 0 END),0) AS reg FROM (SELECT vid, MAX(username) AS username FROM visits GROUP BY vid)"
    ),
  ]);

  const c = r[1].results[0] || { total: 0, reg: 0 };
  return json(
    { me: me.username, total: c.total, registered: c.reg, guests: c.total - c.reg, visitors: r[0].results },
    200,
    request
  );
}
