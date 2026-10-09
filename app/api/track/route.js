import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";
import { ensureTables, sqlTime } from "../../../lib/analytics";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

// POST /api/track → stores one page view (public, called by the frontend on every visit)
export async function POST(request) {
  const { env } = getCloudflareContext();
  const b = await request.json().catch(() => null);
  if (!b || !/^[A-Za-z0-9-]{8,64}$/.test(String(b.vid || ""))) {
    return json({ error: "bad request" }, 400, request);
  }

  await ensureTables(env);
  const clip = (v, n) => String(v || "").slice(0, n);
  const device = ["mobile", "tablet", "desktop"].includes(b.device) ? b.device : "desktop";

  await env.DB.prepare(
    "INSERT INTO visits (vid,path,ref,device,country,new_session,created_at) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(
      b.vid,
      clip(b.path || "/", 100),
      clip(b.ref, 100),
      device,
      clip(request.headers.get("cf-ipcountry"), 2),
      b.ns ? 1 : 0,
      sqlTime()
    )
    .run();

  return json({ ok: true }, 200, request);
}
