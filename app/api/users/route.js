import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

export async function POST(request) {
  const { env } = getCloudflareContext();
  if (!env.ADMIN_KEY || request.headers.get("authorization") !== "Bearer " + env.ADMIN_KEY) {
    return json({ error: "unauthorized" }, 401, request);
  }

  const b = await request.json().catch(() => null);
  if (!b || !b.tgToken || !b.tgChannel || !b.baleToken || !b.baleChat) {
    return json({ error: "missing fields" }, 400, request);
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const secret = crypto.randomUUID().replace(/-/g, "");

  const r = await fetch(`https://api.telegram.org/bot${b.tgToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${new URL(request.url).origin}/api/tg-webhook/${id}`,
      secret_token: secret,
      allowed_updates: ["channel_post"],
    }),
  });
  const d = await r.json();
  if (!d.ok) return json({ error: "telegram: " + d.description }, 400, request);

  await env.DB.prepare(
    "INSERT INTO users (id,tg_token,tg_channel,bale_token,bale_chat,secret) VALUES (?,?,?,?,?,?)"
  )
    .bind(id, b.tgToken, b.tgChannel.replace(/^@/, ""), b.baleToken, b.baleChat, secret)
    .run();

  return json({ ok: true, id }, 200, request);
}
