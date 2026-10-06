import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";
const ok = () => new Response("ok");

async function bale(bot, method, body) {
  const r = await fetch(`https://tapi.bale.ai/bot${bot}/${method}`, { method: "POST", body });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description);
}

async function tgFile(token, fileId) {
  const g = await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`)).json();
  if (!g.ok) throw new Error("getFile: " + g.description);
  return (await fetch(`https://api.telegram.org/file/bot${token}/${g.result.file_path}`)).blob();
}

export async function POST(request, { params }) {
  const { env } = getCloudflareContext();
  const username = decodeURIComponent(params.id);

  const { results } = await env.DB.prepare(
    "SELECT app, config FROM app_configs WHERE username=? AND app IN ('Telegram','Bale')"
  )
    .bind(username)
    .all();
  const cfg = {};
  for (const r of results || []) {
    try { cfg[r.app] = JSON.parse(r.config); } catch (e) { /* skip */ }
  }
  const tg = cfg.Telegram;
  const bl = cfg.Bale;

  if (!tg || !tg.secret || request.headers.get("x-telegram-bot-api-secret-token") !== tg.secret) {
    return new Response("no", { status: 403 });
  }
  if (!bl) return ok(); // Bale is not activated yet

  try {
    const { channel_post: p } = await request.json();
    if (!p) return ok();

    const want = tg.channel.replace(/^@/, "").toLowerCase();
    const same = (p.chat.username || "").toLowerCase() === want || String(p.chat.id) === want;
    if (!same) return ok();

    const fd = new FormData();
    fd.append("chat_id", bl.channel);

    if (p.photo || p.video) {
      const photo = p.photo && p.photo[p.photo.length - 1];
      fd.append(
        photo ? "photo" : "video",
        await tgFile(tg.botToken, photo ? photo.file_id : p.video.file_id),
        photo ? "p.jpg" : "v.mp4"
      );
      if (p.caption) fd.append("caption", p.caption);
      await bale(bl.botToken, photo ? "sendPhoto" : "sendVideo", fd);
    } else if (p.text) {
      fd.append("text", p.text);
      await bale(bl.botToken, "sendMessage", fd);
    }
  } catch (err) {
    console.error(err.message);
  }
  return ok();
}
