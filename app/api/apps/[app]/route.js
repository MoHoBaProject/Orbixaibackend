import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../../lib/cors";
import { DEST } from "../../../../lib/destinations";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

const rand = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Telegram is the source of the posts
const telegram = {
  tokenRe: /^\d{5,}:[A-Za-z0-9_-]{20,}$/,
  channelRe: /^(@[A-Za-z0-9_]{4,}|-?\d{5,})$/,
  norm: (v) => {
    let c = String(v || "").trim().replace(/^https?:\/\/t\.me\//i, "");
    return /^[A-Za-z]/.test(c) ? "@" + c : c;
  },
  async check(cfg) {
    const base = `https://api.telegram.org/bot${cfg.botToken}`;
    const m = await (await fetch(base + "/getMe")).json();
    if (!m.ok) return "Telegram bot token is invalid";
    const c = await (
      await fetch(`${base}/getChatMember?chat_id=${encodeURIComponent(cfg.channel)}&user_id=${m.result.id}`)
    ).json();
    if (!c.ok) return "Bot cannot access the channel (" + (c.description || "unknown") + "). Check the channel username and add the bot as admin";
    if (!["administrator", "creator"].includes(c.result.status)) return "The bot must be an admin of the channel";
    return null;
  },
};

const APPS = { Telegram: telegram, ...DEST };

function bearer(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

async function currentUser(env, request) {
  const t = bearer(request);
  if (!t) return null;
  const s = await env.DB.prepare("SELECT username FROM sessions WHERE token=?").bind(t).first();
  return s ? s.username : null;
}

export async function PUT(request, { params }) {
  const app = APPS[params.app];
  if (!app) return json({ error: "Unknown app" }, 404, request);

  const { env } = getCloudflareContext();
  const username = await currentUser(env, request);
  if (!username) return json({ error: "Please log in first" }, 401, request);

  const body = await request.json().catch(() => null);
  const src = (body && body.config) || {};
  const cfg = {
    botToken: String(src.botToken || "").trim(),
    channel: app.norm(src.channel),
  };

  if (!app.tokenRe.test(cfg.botToken)) return json({ error: "Bot token format is invalid" }, 400, request);
  if (!app.channelRe.test(cfg.channel)) return json({ error: "Channel ID is invalid" }, 400, request);

  try {
    const err = await app.check(cfg);
    if (err) return json({ error: err }, 400, request);
  } catch (e) {
    return json({ error: "Could not reach " + params.app + " to verify the details" }, 502, request);
  }

  // Telegram: register the webhook so every new channel post is sent to this backend automatically
  if (params.app === "Telegram") {
    cfg.secret = rand(16);
    try {
      const w = await (
        await fetch(`https://api.telegram.org/bot${cfg.botToken}/setWebhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: `${new URL(request.url).origin}/api/tg-webhook/${encodeURIComponent(username)}`,
            secret_token: cfg.secret,
            allowed_updates: ["channel_post"],
          }),
        })
      ).json();
      if (!w.ok) return json({ error: "Webhook: " + (w.description || "failed") }, 400, request);
    } catch (e) {
      return json({ error: "Could not set the Telegram webhook" }, 502, request);
    }
  }

  await env.DB.prepare(
    "INSERT INTO app_configs (username,app,config,updated_at) VALUES (?,?,?,?) " +
      "ON CONFLICT(username,app) DO UPDATE SET config=excluded.config, updated_at=excluded.updated_at"
  )
    .bind(username, params.app, JSON.stringify(cfg), new Date().toISOString())
    .run();

  return json({ ok: true }, 200, request);
}

export async function DELETE(request, { params }) {
  if (!APPS[params.app]) return json({ error: "Unknown app" }, 404, request);
  const { env } = getCloudflareContext();
  const username = await currentUser(env, request);
  if (!username) return json({ error: "Please log in first" }, 401, request);

  if (params.app === "Telegram") {
    const row = await env.DB.prepare("SELECT config FROM app_configs WHERE username=? AND app=?")
      .bind(username, "Telegram")
      .first();
    try {
      const c = row && JSON.parse(row.config);
      if (c && c.botToken) await fetch(`https://api.telegram.org/bot${c.botToken}/deleteWebhook`);
    } catch (e) {
      /* best effort */
    }
  }
  await env.DB.prepare("DELETE FROM app_configs WHERE username=? AND app=?").bind(username, params.app).run();
  return json({ ok: true }, 200, request);
}
