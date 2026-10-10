import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";
import { ensureTables, sqlTime, getSessionUser } from "../../../lib/analytics";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

const TZ = 210; // Iran time = UTC+3:30 (minutes)
const DAY = 864e5;

// start of "today" in Iran time, as a UTC sql string
function dayStart(daysAgo) {
  const local = new Date(Date.now() + TZ * 60000 - daysAgo * DAY);
  local.setUTCHours(0, 0, 0, 0);
  return sqlTime(new Date(local.getTime() - TZ * 60000));
}

// GET /api/stats?range=today|7d|30d|all → numbers + details for the admin popup (admin only)
export async function GET(request) {
  const { env } = getCloudflareContext();
  const me = await getSessionUser(request, env);
  if (!me) return json({ error: "Not logged in" }, 401, request);
  if (me.membership !== "Admin") return json({ error: "Forbidden" }, 403, request);

  await ensureTables(env);

  const range = new URL(request.url).searchParams.get("range") || "today";
  const since =
    range === "today" ? dayStart(0)
    : range === "7d" ? sqlTime(new Date(Date.now() - 7 * DAY))
    : range === "30d" ? sqlTime(new Date(Date.now() - 30 * DAY))
    : "1970-01-01 00:00:00";

  const days = range === "30d" || range === "all" ? 30 : 7;
  const chartFrom = dayStart(days - 1);
  const online = sqlTime(new Date(Date.now() - 5 * 60000));
  const P = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const dayExpr = "strftime('%Y-%m-%d', datetime(created_at,'+" + TZ + " minutes'))";
  // "mine" = every visit from a browser in which the admin was ever logged in
  const mineIds = "(SELECT vid FROM visits WHERE username=?)";

  const r = await env.DB.batch([
    P("SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors, COALESCE(SUM(new_session),0) AS sessions FROM visits WHERE created_at>=?", since),
    P("SELECT COUNT(*) AS n FROM (SELECT vid FROM visits GROUP BY vid HAVING MIN(created_at)>=?)", since),
    P("SELECT COUNT(*) AS n FROM accounts WHERE datetime(created_at)>=?", since),
    P("SELECT COUNT(*) AS n FROM accounts"),
    P("SELECT COUNT(DISTINCT vid) AS n FROM visits WHERE created_at>=?", online),
    P("SELECT " + dayExpr + " AS d, COUNT(*) AS v FROM visits WHERE created_at>=? GROUP BY d", chartFrom),
    P("SELECT " + dayExpr + " AS d, COUNT(*) AS s FROM accounts WHERE datetime(created_at)>=datetime(?) GROUP BY d", chartFrom),
    P("SELECT path AS k, COUNT(*) AS n FROM visits WHERE created_at>=? GROUP BY path ORDER BY n DESC LIMIT 5", since),
    P("SELECT CASE WHEN ref='' THEN 'direct' ELSE ref END AS k, COUNT(*) AS n FROM visits WHERE created_at>=? GROUP BY k ORDER BY n DESC LIMIT 5", since),
    P("SELECT device AS k, COUNT(*) AS n FROM visits WHERE created_at>=? GROUP BY device ORDER BY n DESC", since),
    P("SELECT country AS k, COUNT(*) AS n FROM visits WHERE created_at>=? GROUP BY country ORDER BY n DESC LIMIT 5", since),
    P("SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM visits WHERE created_at>=? AND vid IN " + mineIds, since, me.username),
    P(
      "SELECT created_at, ip, city, region, country, isp, device, browser, os, model, screen, lang, tz, path, ref, username, " +
        "CASE WHEN vid IN " + mineIds + " THEN 1 ELSE 0 END AS mine FROM visits ORDER BY id DESC LIMIT 30",
      me.username
    ),
    P(
      "SELECT a.username, a.membership, a.email, a.mobile, a.created_at, " +
        "(SELECT ip FROM visits v WHERE v.username=a.username ORDER BY v.id DESC LIMIT 1) AS ip, " +
        "(SELECT created_at FROM visits v WHERE v.username=a.username ORDER BY v.id DESC LIMIT 1) AS last_seen, " +
        "(SELECT browser FROM visits v WHERE v.username=a.username ORDER BY v.id DESC LIMIT 1) AS browser, " +
        "(SELECT os FROM visits v WHERE v.username=a.username ORDER BY v.id DESC LIMIT 1) AS os, " +
        "(SELECT model FROM visits v WHERE v.username=a.username ORDER BY v.id DESC LIMIT 1) AS model, " +
        "(SELECT city FROM visits v WHERE v.username=a.username ORDER BY v.id DESC LIMIT 1) AS city " +
        "FROM accounts a ORDER BY a.rowid DESC LIMIT 30"
    ),
  ]);

  const main = r[0].results[0] || {};
  const mine = r[11].results[0] || {};
  const vMap = Object.fromEntries(r[5].results.map((x) => [x.d, x.v]));
  const sMap = Object.fromEntries(r[6].results.map((x) => [x.d, x.s]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + TZ * 60000 - i * DAY).toISOString().slice(0, 10);
    series.push({ d, v: vMap[d] || 0, s: sMap[d] || 0 });
  }

  return json(
    {
      range,
      views: main.views || 0,
      visitors: main.visitors || 0,
      sessions: main.sessions || 0,
      mineViews: mine.views || 0,
      mineVisitors: mine.visitors || 0,
      newVisitors: r[1].results[0].n,
      signups: r[2].results[0].n,
      totalUsers: r[3].results[0].n,
      online: r[4].results[0].n,
      series,
      pages: r[7].results,
      sources: r[8].results,
      devices: r[9].results,
      countries: r[10].results,
      recent: r[12].results,
      users: r[13].results,
    },
    200,
    request
  );
}
