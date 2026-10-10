import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";
import { ensureTables, sqlTime, getSessionUser, parseUA } from "../../../lib/analytics";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

// POST /api/track → stores one page view (public, called by the frontend on every visit)
export async function POST(request) {
  const { env, cf } = getCloudflareContext();
  const b = await request.json().catch(() => null);
  if (!b || !/^[A-Za-z0-9-]{8,64}$/.test(String(b.vid || ""))) {
    return json({ error: "bad request" }, 400, request);
  }

  await ensureTables(env);
  const clip = (v, n) => String(v || "").slice(0, n);
  const device = ["mobile", "tablet", "desktop"].includes(b.device) ? b.device : "desktop";
  const user = await getSessionUser(request, env); // null if not logged in
  const ua = parseUA(request.headers.get("user-agent") || "");

  await env.DB.prepare(
    "INSERT INTO visits (vid,path,ref,device,country,new_session,created_at,ip,city,region,isp,tz,lang,browser,os,model,screen,username) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
    .bind(
      b.vid,
      clip(b.path || "/", 100),
      clip(b.ref, 100),
      device,
      clip(request.headers.get("cf-ipcountry") || (cf && cf.country), 2),
      b.ns ? 1 : 0,
      sqlTime(),
      clip(request.headers.get("cf-connecting-ip"), 64),
      clip(cf && cf.city, 60),
      clip(cf && cf.region, 60),
      clip(cf && cf.asOrganization, 80),
      clip(b.tz, 40),
      clip(b.lang, 20),
      ua.browser,
      ua.os,
      clip(b.model, 40),
      clip(b.screen, 20),
      user ? user.username : null
    )
    .run();

  return json({ ok: true }, 200, request);
}
