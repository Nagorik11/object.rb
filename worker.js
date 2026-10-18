


/**
 * RD.Object — Cloudflare Workers AI
 * Archivo único: interfaz + API.
 * Configura un binding de Workers AI llamado AI.
 */
import { identityResponse } from "./worker/identity.js";
import initVisitorProfile from "./worker/visitor-client.js";

const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT = `
Eres RD.Object, un asistente inteligente experimental derivado de ADA.
Responde en el idioma del usuario.
Sé preciso, útil, analítico y claro.
Eres experto en lenguaje, semiótica y funciones metalingüísticas.

Cuando resulte pertinente, explica mediante ejemplos de código Python
para ayudar al usuario a aprender programación.
No afirmes haber ejecutado código si no lo has ejecutado.

No inventes hechos, fuentes, citas ni resultados.
Reconoce la incertidumbre y solicita contexto cuando sea necesario.
Distingue hechos comprobables, hipótesis e interpretaciones.

Esta versión no dispone de navegación web ni de una herramienta URL.context.
No afirmes haber leído enlaces. Si necesitas el contenido de una página,
pide al usuario que lo pegue en la conversación.
`;

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RD.Object | Workers AI</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;
  background:#090e1c;
  color:#eaf0ff;
  font-family:system-ui,sans-serif;
}
main{
  height:100dvh;
  max-width:900px;
  margin:auto;
  display:flex;
  flex-direction:column;
  padding:16px;
}
header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  padding:12px 4px 20px;
  flex-wrap:wrap;
}
.header-actions{display:flex;align-items:center;gap:12px;min-width:0;max-width:100%}
.access-card{
  margin:0;
  padding:12px 14px;
  border:1px solid #2a3958;
  border-radius:12px;
  background:#111b30;
  min-width:0;
  max-width:320px;
}
.access-card dt{font-size:11px;color:#96a4c0;margin-bottom:4px}
.access-card dd{margin:0;font-size:12px;overflow-wrap:anywhere}
.access-card dd + dt{margin-top:10px}
#browser-id{font-family:ui-monospace,monospace;color:#eaf0ff}
.access-level{display:inline-block;color:#76dfb7;background:#76dfb710;border:1px solid #76dfb740;border-radius:6px;padding:4px 8px}
.header-actions button{flex-shrink:0}
.visitor-avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;margin-bottom:8px}
.visitor-actions{display:flex;gap:8px;margin-top:10px}
.visitor-actions button{font-size:12px;padding:7px 9px}
dialog{width:min(440px,calc(100% - 24px));max-height:90dvh;overflow:auto;background:#111b30;color:#eaf0ff;border:1px solid #3b4b69;border-radius:16px;padding:22px}
dialog::backdrop{background:#000b}
dialog h2{margin-top:0}
.visitor-form{display:grid;padding:0;border:0;gap:12px}
.visitor-form input[type=text]{width:100%;padding:12px;border:1px solid #3b4b69;border-radius:8px;background:#0b1426;color:white;font:inherit}
.visitor-form input[type=file]{max-width:100%;font:inherit}
.visitor-form label{line-height:1.5}
.visitor-form p{margin:0;line-height:1.5;color:#96a4c0;font-size:13px}
.portrait-preview{max-width:100%;width:200px;aspect-ratio:1;object-fit:cover;border-radius:12px;justify-self:center}
#visitor-error{color:#ffb4b4}
h1{font-size:22px;margin:0}
small{color:#96a4c0}
.panel{
  flex:1;
  min-height:0;
  background:#111b30;
  border:1px solid #2a3958;
  border-radius:16px;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
.status{
  padding:15px;
  border-bottom:1px solid #293957;
  color:#76dfb7;
  font-size:13px;
}
#chat{
  flex:1;
  overflow-y:auto;
  padding:18px;
  display:flex;
  flex-direction:column;
  gap:14px;
}
.msg{
  max-width:90%;
  padding:13px 16px;
  border-radius:14px;
  line-height:1.55;
  white-space:pre-wrap;
  overflow-wrap:anywhere;
}
.user{align-self:flex-end;background:#5057bb}
.assistant{align-self:flex-start;background:#24344f}
.error{color:#ffb4b4}
form{
  display:flex;
  gap:10px;
  padding:14px;
  border-top:1px solid #293957;
}
textarea{
  flex:1;
  min-width:0;
  padding:13px;
  border-radius:10px;
  border:1px solid #3b4b69;
  background:#0b1426;
  color:white;
  font:inherit;
  resize:vertical;
}
button{
  border:0;
  padding:12px 18px;
  background:#7778eb;
  color:white;
  border-radius:10px;
  cursor:pointer;
}
button:disabled{opacity:.5;cursor:wait}
footer{
  color:#7183a5;
  font-size:11px;
  text-align:center;
  padding:12px;
}
@media(max-width:520px){
  main{padding:8px}
  header{padding:10px 4px}
  .header-actions{width:100%}
  .access-card{flex:1;max-width:none}
  .msg{max-width:96%}
  form{gap:8px;padding:10px}
  button{padding:10px 12px}
}
</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>RD.Object</h1>
    <small>Inteligencia artificial · Cloudflare Workers</small>
  </div>
  <div class="header-actions">
    <dl class="access-card" aria-label="Identificación y acceso">
      <dt>Nombre</dt>
      <dd><img id="visitor-avatar" class="visitor-avatar" alt="Tu foto de perfil" hidden> <span id="user-name">Sin registrar</span></dd>
      <dt id="browser-id-label">UUID de usuario</dt>
      <dd id="browser-id">Sin UUID asignado</dd>
      <dt>Nivel de acceso</dt>
      <dd><span id="access-level" class="access-level">Visitante · sin registrar</span></dd>
      <dd class="visitor-actions">
        <button id="visitor-register" type="button">Crear mi perfil</button>
        <button id="visitor-logout" type="button" hidden>Salir</button>
      </dd>
    </dl>
    <button id="clear" type="button">Nuevo chat</button>
  </div>
</header>
<section class="panel">
  <div class="status" id="status">Comprobando Workers AI...</div>
  <div id="chat" role="log" aria-live="polite"></div>
  <form id="form">
    <textarea
      id="input"
      rows="2"
      maxlength="4000"
      aria-label="Mensaje para RD.Object"
      placeholder="Pregunta a RD.Object..."
      required
    ></textarea>
    <button id="send" type="submit">Enviar</button>
  </form>
</section>
<footer>
  Historial guardado en este navegador · Sin navegación web
</footer>
</main>
<dialog id="visitor-dialog" aria-labelledby="visitor-title">
  <h2 id="visitor-title">Preséntate</h2>
  <form id="visitor-form" class="visitor-form">
    <label for="visitor-name">¿Cómo te llamas?</label>
    <input id="visitor-name" type="text" autocomplete="nickname" minlength="2" maxlength="80" required>
    <p>Agrega una foto para tu perfil de visitante.</p>
    <video id="visitor-video" class="portrait-preview" autoplay muted playsinline hidden></video>
    <img id="visitor-preview" class="portrait-preview" alt="Vista previa de tu foto" hidden>
    <div class="visitor-actions">
      <button id="visitor-camera" type="button">Activar cámara</button>
      <button id="visitor-capture" type="button" disabled>Tomar foto</button>
    </div>
    <label for="visitor-file">O elige una foto</label>
    <input id="visitor-file" type="file" accept="image/*" capture="user">
    <label><input id="visitor-consent" type="checkbox" required> Acepto guardar mi nombre y foto como perfil de visitante.</label>
    <p>Recibirás un UUID propio y acceso de visitante. La foto no verifica tu identidad ni permite entrar a otras cuentas.</p>
    <p id="visitor-error" role="alert"></p>
    <div class="visitor-actions">
      <button id="visitor-cancel" type="button">Cancelar</button>
      <button id="visitor-save" type="submit">Crear mi perfil</button>
    </div>
  </form>
</dialog>
<script src="/visitor.js" defer></script>

<script>
(function(){
  const chat = document.getElementById("chat");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const form = document.getElementById("form");
  const clear = document.getElementById("clear");
  const status = document.getElementById("status");
  const KEY = "rd-object-history-v2";
  let busy = false;
  let history = [];

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(saved)) {
      history = saved.filter(function(m){
        return m &&
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string" &&
          m.content.trim() &&
          m.content.length <= (m.role === "user" ? 4000 : 16000);
      }).slice(-12);
    }
  } catch (_) {}

  function bubble(role, content){
    const div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "user" : "assistant");
    div.textContent = content;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
    return div;
  }

  function save(){
    try {
      localStorage.setItem(KEY, JSON.stringify(history.slice(-12)));
    } catch (_) {}
  }

  function render(){
    chat.replaceChildren();
    if (!history.length) {
      bubble("assistant", "Hola, soy RD.Object. ¿Qué deseas explorar?");
    } else {
      history.forEach(function(m){ bubble(m.role, m.content); });
    }
  }

  function setBusy(value){
    busy = value;
    send.disabled = value;
    input.disabled = value;
    clear.disabled = value;
  }

  render();

  fetch("/api/health")
    .then(async function(res){
      const data = await res.json();
      status.textContent = data.aiConfigured
        ? "● Binding AI configurado · Llama 3.1 8B"
        : "● Falta configurar el binding AI";
    })
    .catch(function(){
      status.textContent = "● No se pudo comprobar el servicio";
    });
  clear.addEventListener("click", function(){
    if (busy) return;
    history = [];
    save();
    render();
    input.focus();
  });

  input.addEventListener("keydown", function(e){
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy) form.requestSubmit();
    }
  });

  form.addEventListener("submit", async function(e){
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;

    setBusy(true);
    input.value = "";

    const previousHistory = history.slice();
    // Conserva pares completos y agrega la pregunta actual.
    const messages = history.slice(-10).concat({
      role: "user",
      content: text
    });

    bubble("user", text);
    const pending = bubble("assistant", "Pensando...");
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, 90000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messages }),
        signal: controller.signal
      });

      let data;
      try {
        data = await res.json();
      } catch (_) {
        throw new Error("El servidor devolvió una respuesta no válida.");
      }

      if (!res.ok) {
        throw new Error(data.error || "Error HTTP " + res.status);
      }
      if (typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("El modelo no devolvió texto.");
      }

      pending.textContent = data.reply;
      history = messages.concat({
        role: "assistant",
        content: data.reply
      }).slice(-12);
      save();
    } catch (err) {
      history = previousHistory;
      pending.classList.add("error");
      pending.textContent = err.name === "AbortError"
        ? "Se agotó el tiempo de espera. Puedes volver a intentarlo."
        : "Error: " + err.message;
      input.value = text;
    } finally {
      clearTimeout(timer);
      setBusy(false);
      input.focus();
      chat.scrollTop = chat.scrollHeight;
    }
  });
})();
</script>
</body>
</html>`;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

// Limita el cuerpo mientras se recibe, antes de cargarlo completo.
async function readBody(request, maxBytes) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        const error = new Error("Solicitud demasiado grande");
        error.status = 413;
        throw error;
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const identity = await identityResponse(request, env);
    if (identity) return identity;
    if (request.method === "GET" && url.pathname === "/visitor.js") {
      return new Response("(" + initVisitorProfile.toString() + ")();", {
        headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "DENY"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      const aiConfigured = typeof env.AI?.run === "function";
      return json({
        ok: aiConfigured,
        app: "RD.Object",
        model: MODEL,
        aiConfigured
      }, aiConfigured ? 200 : 503);
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json({ error: "Usa POST para esta ruta" }, 405);
      }

      if (typeof env.AI?.run !== "function") {
        return json({ error: "Falta configurar el binding AI" }, 503);
      }

      // Comprobación de origen; no sustituye autenticación.
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) {
        return json({ error: "Origen no permitido" }, 403);
      }

      const contentType = (request.headers.get("Content-Type") || "")
        .split(";")[0].trim().toLowerCase();

      if (contentType !== "application/json") {
        return json({ error: "Se requiere application/json" }, 415);
      }

      try {
        const raw = await readBody(request, 262144);

        let body;
        try {
          body = JSON.parse(raw);
        } catch (_) {
          return json({ error: "JSON inválido" }, 400);
        }

        if (
          !body ||
          !Array.isArray(body.messages) ||
          !body.messages.length ||
          body.messages.length > 12
        ) {
          return json({ error: "Historial inválido" }, 400);
        }

        const messages = [];

        for (const m of body.messages) {
          if (
            !m ||
            !["user", "assistant"].includes(m.role) ||
            typeof m.content !== "string" ||
            !m.content.trim() ||
            m.content.length > (m.role === "user" ? 4000 : 16000)
          ) {
            return json({ error: "Mensaje inválido" }, 400);
          }

          messages.push({
            role: m.role,
            content: m.content.trim()
          });
        }

        if (messages.at(-1).role !== "user") {
          return json({ error: "Se requiere un mensaje final del usuario" }, 400);
        }

        // Descarta respuestas iniciales sin su pregunta asociada.
        while (messages.length && messages[0].role === "assistant") {
          messages.shift();
        }

        // Mantiene contexto reciente dentro de un límite de caracteres.
        let total = messages.reduce((sum, m) => sum + m.content.length, 0);
        while (total > 24000 && messages.length > 1) {
          total -= messages.shift().content.length;
          while (messages.length > 1 && messages[0].role === "assistant") {
            total -= messages.shift().content.length;
          }
        }

        const result = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages
          ],
          max_tokens: 1024,
          temperature: 0.3
        });

        const reply = typeof result?.response === "string"
          ? result.response.trim()
          : "";

        if (!reply) {
          return json({ error: "Respuesta vacía del modelo" }, 502);
        }

        if (reply.length > 16000) {
          return json({ error: "La respuesta supera el límite de tamaño" }, 502);
        }

        return json({ reply, model: MODEL });
      } catch (error) {
        if (error?.status === 413) {
          return json({ error: "Solicitud demasiado grande" }, 413);
        }

        console.error("RD.Object: error de inferencia", error);
        return json({
          error: "Error de inferencia. Revisa los logs del Worker."
        }, 502);
      }
    }

    return json({ error: "Ruta no encontrada" }, 404);
  }
};
