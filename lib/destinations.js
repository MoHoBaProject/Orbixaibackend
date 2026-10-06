// Destination messengers. Telegram is the source; every destination below receives the posts.
const j = async (r) => {
  try { return await r.json(); } catch (e) { return {}; }
};

// ---------- Bale (Telegram-compatible Bot API) ----------
const bale = {
  tokenRe: /^\d{5,}:[A-Za-z0-9_-]{20,}$/,
  channelRe: /^(@[A-Za-z0-9_]{4,}|-?\d{5,})$/,
  norm: (v) => {
    let c = String(v || "").trim().replace(/^https?:\/\/(t\.me|ble\.ir)\//i, "");
    return /^[A-Za-z]/.test(c) ? "@" + c : c;
  },
  async check(cfg) {
    const m = await j(await fetch(`https://tapi.bale.ai/bot${cfg.botToken}/getMe`));
    return m.ok ? null : "Bale bot token is invalid";
  },
  async text(cfg, text) {
    const fd = new FormData();
    fd.append("chat_id", cfg.channel);
    fd.append("text", text);
    const d = await j(await fetch(`https://tapi.bale.ai/bot${cfg.botToken}/sendMessage`, { method: "POST", body: fd }));
    if (!d.ok) throw new Error("Bale: " + d.description);
  },
  async media(cfg, kind, blob, caption) {
    const fd = new FormData();
    fd.append("chat_id", cfg.channel);
    if (caption) fd.append("caption", caption);
    fd.append(kind, blob, kind === "photo" ? "p.jpg" : "v.mp4");
    const method = kind === "photo" ? "sendPhoto" : "sendVideo";
    const d = await j(await fetch(`https://tapi.bale.ai/bot${cfg.botToken}/${method}`, { method: "POST", body: fd }));
    if (!d.ok) throw new Error("Bale: " + d.description);
  },
};

// ---------- Eitaa (through eitaayar.ir) ----------
const eitaa = {
  tokenRe: /^[A-Za-z0-9:_-]{10,}$/,
  channelRe: /^[A-Za-z0-9_]{3,}$/,
  norm: (v) => String(v || "").trim().replace(/^https?:\/\/eitaa\.com\//i, "").replace(/^@/, ""),
  async check(cfg) {
    const r = await fetch(`https://eitaayar.ir/api/${cfg.botToken}/getMe`);
    const d = await j(r);
    return r.ok && d.ok !== false ? null : "Eitaa token is invalid";
  },
  async text(cfg, text) {
    const fd = new FormData();
    fd.append("chat_id", cfg.channel);
    fd.append("text", text);
    const d = await j(await fetch(`https://eitaayar.ir/api/${cfg.botToken}/sendMessage`, { method: "POST", body: fd }));
    if (!d.ok) throw new Error("Eitaa: " + JSON.stringify(d).slice(0, 150));
  },
  async media(cfg, kind, blob, caption) {
    const fd = new FormData();
    fd.append("chat_id", cfg.channel);
    fd.append("title", "Orbix");
    if (caption) fd.append("caption", caption);
    fd.append("file", blob, kind === "photo" ? "p.jpg" : "v.mp4");
    const d = await j(await fetch(`https://eitaayar.ir/api/${cfg.botToken}/sendFile`, { method: "POST", body: fd }));
    if (!d.ok) throw new Error("Eitaa: " + JSON.stringify(d).slice(0, 150));
  },
};

// ---------- Rubika (Bot API v3) ----------
const rbCall = async (token, method, body) => {
  const d = await j(
    await fetch(`https://botapi.rubika.ir/v3/${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
  );
  if (d.status !== "OK") throw new Error("Rubika: " + (d.status || d.message || "error"));
  return d.data || d;
};

const rubika = {
  tokenRe: /^[A-Za-z0-9_-]{20,}$/,
  channelRe: /^[A-Za-z0-9]{10,}$/,
  norm: (v) => String(v || "").trim(),
  async check(cfg) {
    try {
      await rbCall(cfg.botToken, "getMe");
    } catch (e) {
      return "Rubika bot token is invalid";
    }
    try {
      await rbCall(cfg.botToken, "getChat", { chat_id: cfg.channel });
    } catch (e) {
      return "Rubika bot cannot access this chat ID. Make sure the bot is admin of the channel";
    }
    return null;
  },
  async text(cfg, text) {
    await rbCall(cfg.botToken, "sendMessage", { chat_id: cfg.channel, text });
  },
  async media(cfg, kind, blob, caption) {
    const up = await rbCall(cfg.botToken, "requestSendFile", { type: kind === "photo" ? "Image" : "File" });
    const fd = new FormData();
    fd.append("file", blob, kind === "photo" ? "p.jpg" : "v.mp4");
    const u = await j(await fetch(up.upload_url, { method: "POST", body: fd }));
    const fileId = (u.data || u).file_id;
    if (!fileId) throw new Error("Rubika upload failed");
    await rbCall(cfg.botToken, "sendFile", { chat_id: cfg.channel, file_id: fileId, text: caption || undefined });
  },
};

export const DEST = { Bale: bale, Eitaa: eitaa, Rubika: rubika };
