import { getCloudflareContext } from "@opennextjs/cloudflare";
import { json, preflight } from "../../../../lib/cors";

export const dynamic = "force-dynamic";

export function OPTIONS(request) {
  return preflight(request);
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPass(pass, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 },
    key,
    256
  );
  return hex(bits);
}

async function newSession(env, username) {
  const token = rand(24);
  await env.DB.prepare("INSERT INTO sessions (token,username,created_at) VALUES (?,?,?)")
    .bind(token, username, new Date().toISOString())
    .run();
  return token;
}

const publicUser = (a) => ({
  username: a.username,
  email: a.email,
  mobile: a.mobile,
  photo: a.photo,
  membership: a.membership,
});

function bearer(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

export async function POST(request, { params }) {
  const { env } = getCloudflareContext();
  const action = params.action;

  if (action === "logout") {
    const t = bearer(request);
    if (t) await env.DB.prepare("DELETE FROM sessions WHERE token=?").bind(t).run();
    return json({ ok: true }, 200, request);
  }

  const b = await request.json().catch(() => null);
  if (!b) return json({ error: "Bad request" }, 400, request);
  const username = String(b.username || "").trim();
  const password = String(b.password || "");

  if (action === "register") {
    const email = String(b.email || "").trim();
    const mobile = String(b.mobile || "").trim();
    const photo = b.photo ? String(b.photo) : null;

    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username))
      return json({ error: "Username must be 3-30 letters, numbers, . _ -" }, 400, request);
    if (username.toLowerCase() === "admin")
      return json({ error: "This username is already taken" }, 409, request);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400, request);
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Invalid email" }, 400, request);
    if (!mobile) return json({ error: "Please fill all required fields" }, 400, request);
    if (photo && (!photo.startsWith("data:image/") || photo.length > 400000))
      return json({ error: "Photo is too large" }, 400, request);

    const exists = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE username=? COLLATE NOCASE")
      .bind(username)
      .first();
    if (exists) return json({ error: "This username is already taken" }, 409, request);

    const salt = rand(16);
    const passHash = await hashPass(password, salt);
    await env.DB.prepare(
      "INSERT INTO accounts (username,pass_hash,salt,email,mobile,photo,membership,created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
      .bind(username, passHash, salt, email, mobile, photo, "Free", new Date().toISOString())
      .run();

    const token = await newSession(env, username);
    return json({ token, user: { username, email, mobile, photo, membership: "Free" } }, 200, request);
  }

  if (action === "login") {
    const a = await env.DB.prepare("SELECT * FROM accounts WHERE username=? COLLATE NOCASE").bind(username).first();
    if (!a || (await hashPass(password, a.salt)) !== a.pass_hash)
      return json({ error: "Invalid username or password" }, 401, request);
    const token = await newSession(env, a.username);
    return json({ token, user: publicUser(a) }, 200, request);
  }

  return json({ error: "Not found" }, 404, request);
}

export async function GET(request, { params }) {
  if (params.action !== "me") return json({ error: "Not found" }, 404, request);
  const { env } = getCloudflareContext();
  const t = bearer(request);
  if (!t) return json({ error: "Not logged in" }, 401, request);
  const a = await env.DB.prepare(
    "SELECT a.* FROM sessions s JOIN accounts a ON a.username=s.username WHERE s.token=?"
  )
    .bind(t)
    .first();
  if (!a) return json({ error: "Not logged in" }, 401, request);
  return json({ user: publicUser(a) }, 200, request);
}
