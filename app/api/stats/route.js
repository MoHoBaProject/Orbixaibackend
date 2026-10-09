import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";
import { ensureTables, sqlTime, checkAdmin } from "../../../lib/analytics";

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

// GET /api/stats?range=today|7d|30d|all → numbers for the admin popup (admin only)
export async function GET(request) {
  const { env } = getCloudflareContext();
  const code = await checkAdmin(request, env);
  if (code !== 200) return json({ error: code === 401 ? "Not logged in" : "Forbidden" }, code, request);

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
  ]);

  const main = r[0].results[0] || {};
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
      newVisitors: r[1].results[0].n,
      signups: r[2].results[0].n,
      totalUsers: r[3].results[0].n,
      online: r[4].results[0].n,
      series,
      pages: r[7].results,
      sources: r[8].results,
      devices: r[9].results,
      countries: r[10].results,
    },
    200,
    request
  );
}
