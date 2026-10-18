const COOKIE = "__Host-rd-visitor";
const TTL = 30 * 24 * 60 * 60;

function reply(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers
  } });
}

async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function sessionToken(request) {
  const cookie = (request.headers.get("Cookie") || "").split(";")
    .map(value => value.trim()).find(value => value.startsWith(COOKIE + "="));
  const token = cookie?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token || "") ? token : null;
}

function userView(row) {
  let profile = {};
  try { profile = JSON.parse(row.profile || "{}"); } catch (_) {}
  return {
    id: row.id, name: row.display_name, accessLevel: "Visitante",
    photo: typeof profile.visitor_photo === "string" && profile.visitor_photo.startsWith("data:image/jpeg;base64,")
      ? profile.visitor_photo : null
  };
}

async function currentUser(request, db) {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.display_name, u.profile FROM users u
    JOIN rd_visitor_sessions s ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`)
    .bind(await hash(token), Math.floor(Date.now() / 1000)).first();
}

async function readRegistration(request) {
  const reader = request.body?.getReader();
  if (!reader) throw { status: 400 };
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 120000) { await reader.cancel(); throw { status: 413 }; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw { status: 400 }; }
}

function validPhoto(photo) {
  if (typeof photo !== "string" || photo.length > 100000 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) return false;
  try {
    const bytes = atob(photo.slice("data:image/jpeg;base64,".length));
    return bytes.length >= 4 && bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 &&
      bytes.charCodeAt(bytes.length - 2) === 255 && bytes.charCodeAt(bytes.length - 1) === 217;
  } catch (_) { return false; }
}

export async function identityResponse(request, env) {
  const url = new URL(request.url);
  if (!["/api/me", "/api/visitors", "/api/visitor/logout"].includes(url.pathname)) return null;
  const method = url.pathname === "/api/me" ? "GET" : "POST";
  if (request.method !== method) return reply({ error: "Método no permitido" }, 405, { Allow: method });
  if (!env.SHARED_DB?.prepare || !env.SHARED_DB?.batch) {
    return reply({ error: "Falta conectar shared-db con el binding SHARED_DB." }, 503);
  }
  if (request.method === "POST" && request.headers.get("Origin") !== url.origin) {
    return reply({ error: "Origen no permitido" }, 403);
  }
  try {
    const db = env.SHARED_DB;
    if (url.pathname === "/api/me") {
      const user = await currentUser(request, db);
      return reply({ user: user ? userView(user) : null });
    }
    if (url.pathname === "/api/visitor/logout") {
      const token = sessionToken(request);
      if (token) await db.prepare("UPDATE rd_visitor_sessions SET expires_at = 0 WHERE token_hash = ?").bind(await hash(token)).run();
      return reply({ user: null }, 200, { "Set-Cookie": COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
    }
    if ((request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
      return reply({ error: "Se requiere application/json" }, 415);
    }
    if (await currentUser(request, db)) return reply({ error: "Este navegador ya tiene un perfil de visitante." }, 409);
    const body = await readRegistration(request);
    const name = typeof body?.name === "string" ? body.name.trim().normalize("NFC") : "";
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f<>]/.test(name)) {
      return reply({ error: "Escribe tu nombre (entre 2 y 80 caracteres)." }, 422);
    }
    if (body.consent !== true) return reply({ error: "Confirma que deseas guardar tu nombre y foto." }, 422);
    if (!validPhoto(body.photo)) return reply({ error: "Toma una foto o selecciona una imagen válida." }, 422);

    const id = crypto.randomUUID();
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
    const now = Math.floor(Date.now() / 1000);
    const timestamp = new Date().toISOString();
    const ipHash = await hash(request.headers.get("CF-Connecting-IP") || "unknown");
    const profile = JSON.stringify({ roles: ["visitor"], visitor_photo: body.photo });
    // D1 batches are atomic; the rate limit is checked within the INSERT.
    const result = await db.batch([
      db.prepare(`INSERT INTO users
        (id, handle, display_name, email, locale, timezone, status, profile, meta, created_at, updated_at)
        SELECT ?, ?, ?, NULL, 'es', 'UTC', 'active', ?, ?, ?, ?
        WHERE (SELECT COUNT(*) FROM rd_visitor_sessions WHERE ip_hash = ? AND created_at > ?) < 5`)
        .bind(id, "visitor-" + id, name, profile, JSON.stringify({ registration: "photo-and-name" }), timestamp, timestamp, ipHash, now - 3600),
      db.prepare(`INSERT INTO rd_visitor_sessions (token_hash, user_id, ip_hash, created_at, expires_at)
        SELECT ?, id, ?, ?, ? FROM users WHERE id = ?`).bind(await hash(token), ipHash, now, now + TTL, id),
      db.prepare("DELETE FROM rd_visitor_sessions WHERE expires_at <= ? AND created_at <= ?").bind(now, now - 3600)
    ]);
    if (!result[0]?.meta?.changes) return reply({ error: "Alcanzaste el límite de registros. Inténtalo en una hora." }, 429);
    return reply({ user: userView({ id, display_name: name, profile }) }, 201, {
      "Set-Cookie": COOKIE + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + TTL
    });
  } catch (error) {
    if (error?.status === 413) return reply({ error: "La foto es demasiado grande." }, 413);
    if (error?.status === 400) return reply({ error: "Solicitud inválida." }, 400);
    // Never log names, photographs, query bindings, or session tokens.
    return reply({ error: "No pudimos acceder al registro de visitantes. Revisa el binding y la migración de shared-db." }, 503);
  }
}
