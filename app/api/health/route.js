import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

// GET /api/health → tells the frontend the backend is alive (and whether the D1 database answers)
export async function GET() {
  let db = "not configured";
  try {
    const { env } = getCloudflareContext();
    if (env && env.DB) {
      await env.DB.prepare("SELECT 1").first();
      db = "connected";
    }
  } catch (err) {
    // outside Cloudflare (plain `next dev`) there is no context → just report it
    db = "unavailable: " + (err && err.message ? err.message : String(err));
  }

  return json({
    ok: true,
    service: "ai-hub-backend",
    time: new Date().toISOString(),
    db,
  });
}
