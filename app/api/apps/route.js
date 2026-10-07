import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

// returns the apps this account has activated (so the frontend can restore them)
export async function GET(request) {
  const { env } = getCloudflareContext();
  const t = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const s = t ? await env.DB.prepare("SELECT username FROM sessions WHERE token=?").bind(t).first() : null;
  if (!s) return json({ error: "Please log in first" }, 401, request);

  const { results } = await env.DB.prepare("SELECT app FROM app_configs WHERE username=?").bind(s.username).all();
  return json({ apps: (results || []).map((r) => r.app) }, 200, request);
}