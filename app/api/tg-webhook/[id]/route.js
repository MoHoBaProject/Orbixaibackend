import { getCloudflareContext } from "@opennextjs/cloudflare";

export const dynamic = "force-dynamic";
const ok = () => new Response("ok");

async function bale(u, method, body) {
  const r = await fetch(`https://tapi.bale.ai/bot${u.bale_token}/${method}`, { method: "POST", body });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description);
}

async function tgFile(u, fileId) {
  const g = await (await fetch(`https://api.telegram.org/bot${u.tg_token}/getFile?file_id=${fileId}`)).json();
  if (!g.ok) throw new Error("getFile: " + g.description);
  return (await fetch(`https://api.telegram.org/file/bot${u.tg_token}/${g.result.file_path}`)).blob();
}

export async function POST(request, { params }) {
  const { env } = getCloudflareContext();
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(params.id).first();
  if (!u || request.headers.get("x-telegram-bot-api-secret-token") !== u.secret) {
    return new Response("no", { status: 403 });
  }

  try {
    const { channel_post: p } = await request.json();
    if (!p || (p.chat.username || "").toLowerCase() !== u.tg_channel.toLowerCase()) return ok();

    const fd = new FormData();
    fd.append("chat_id", u.bale_chat);

    if (p.photo || p.video) {
      const photo = p.photo && p.photo[p.photo.length - 1];
      fd.append(
        photo ? "photo" : "video",
        await tgFile(u, photo ? photo.file_id : p.video.file_id),
        photo ? "p.jpg" : "v.mp4"
      );
      if (p.caption) fd.append("caption", p.caption);
      await bale(u, photo ? "sendPhoto" : "sendVideo", fd);
    } else if (p.text) {
      fd.append("text", p.text);
      await bale(u, "sendMessage", fd);
    }
  } catch (err) {
    console.error(err.message);
  }
  return ok();
}
