import { json, preflight } from "../../../lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

const dec = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const clean = (h) => dec(h.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")).trim();

function parse(html) {
  return html.split('data-post="').slice(1).map((b) => {
    const id = +((b.match(/^[^"]+\/(\d+)"/) || [])[1] || 0);
    const t = b.match(/js-message_text[^>]*>([\s\S]*?)<\/div>/);
    const photos = [...b.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    const videos = [...b.matchAll(/<video[^>]*src="([^"]+)"/g)].map((m) => dec(m[1]));
    return { id, text: t ? clean(t[1]) : "", photos, videos };
  });
}

async function bale(token, method, body) {
  const r = await fetch(`https://tapi.bale.ai/bot${token}/${method}`, {
    method: "POST",
    ...(body instanceof FormData
      ? { body }
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description || "bale error");
}

async function sendMedia(token, chat, kind, url, caption) {
  const file = await fetch(url);
  if (!file.ok) throw new Error("download failed " + file.status);
  const fd = new FormData();
  fd.append("chat_id", chat);
  if (caption) fd.append("caption", caption);
  fd.append(kind, await file.blob(), kind === "photo" ? "p.jpg" : "v.mp4");
  await bale(token, kind === "photo" ? "sendPhoto" : "sendVideo", fd);
}

export async function POST(request) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400, request); }

  const channel = String(b.channel || "").replace(/^.*t\.me\/(s\/)?/, "").replace(/^@/, "");
  const { baleToken, baleChatId } = b;
  if (!channel || !baleToken || !baleChatId) return json({ error: "missing fields" }, 400, request);

  const afterId = +b.afterId || 0;
  const limit = Math.min(+b.limit || 3, 5);

  const res = await fetch(`https://t.me/s/${channel}`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return json({ error: "telegram " + res.status }, 502, request);

  let posts = parse(await res.text()).filter((p) => p.id > afterId);
  posts = afterId ? posts.slice(0, limit) : posts.slice(-limit);

  let sent = 0, lastId = afterId, error = null;
  for (const p of posts) {
    try {
      const long = p.text.length > 1000;
      const hasMedia = p.photos.length || p.videos.length;
      if (!hasMedia || long) {
        if (p.text) await bale(baleToken, "sendMessage", { chat_id: baleChatId, text: p.text });
      }
      let caption = hasMedia && !long ? p.text : "";
      for (const u of p.photos) { await sendMedia(baleToken, baleChatId, "photo", u, caption); caption = ""; }
      for (const u of p.videos) { await sendMedia(baleToken, baleChatId, "video", u, caption); caption = ""; }
      sent++;
      lastId = p.id;
    } catch (e) {
      error = `post ${p.id}: ${e.message}`;
      break;
    }
  }
  return json({ sent, lastId, error }, 200, request);
}
