import { getCloudflareContext } from "@opennextjs/cloudflare";
import { DEST } from "../../../../lib/destinations";

export const dynamic = "force-dynamic";
const ok = () => new Response("ok");

async function tgFile(token, fileId) {
  const g = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
  if (!g.ok) throw new Error("getFile: " + g.description);
  return (await fetch(`https://api.telegram.org/file/bot${token}/${g.result.file_path}`)).blob();
}

export async function POST(request, { params }) {
  const { env } = getCloudflareContext();
  const username = decodeURIComponent(params.id);

  const { results } = await env.DB.prepare("SELECT app, config FROM app_configs WHERE username=?")
    .bind(username)
    .all();
  const cfg = {};
  for (const r of results || []) {
    try { cfg[r.app] = JSON.parse(r.config); } catch (e) { /* skip */ }
  }
  const tg = cfg.Telegram;

  if (!tg || !tg.secret || request.headers.get("x-telegram-bot-api-secret-token") !== tg.secret) {
    return new Response("no", { status: 403 });
  }

  const targets = Object.keys(DEST).filter((n) => cfg[n]);
  if (!targets.length) return ok();

  try {
    const { channel_post: p } = await request.json();
    if (!p) return ok();

    const want = tg.channel.replace(/^@/, "").toLowerCase();
    const same = (p.chat.username || "").toLowerCase() === want || String(p.chat.id) === want;
    if (!same) return ok();

    const photo = p.photo && p.photo[p.photo.length - 1];
    const fileId = photo ? photo.file_id : p.video && p.video.file_id;
    const kind = photo ? "photo" : "video";
    const blob = fileId ? await tgFile(tg.botToken, fileId) : null;

    if (!blob && !p.text) return ok();

    const jobs = targets.map((n) =>
      blob ? DEST[n].media(cfg[n], kind, blob, p.caption || "") : DEST[n].text(cfg[n], p.text)
    );
    const res = await Promise.allSettled(jobs);
    res.forEach((r, i) => {
      if (r.status === "rejected") console.error(targets[i] + ": " + r.reason.message);
    });
  } catch (err) {
    console.error(err.message);
  }
  return ok();
}
