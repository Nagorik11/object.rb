import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import initVisitorProfile from "./visitor-client.js";

const photo = "data:image/jpeg;base64,/9j/2Q==";
const user = { id: "97c5a531-68dd-4660-8f98-5e31b365fe1a", name: "Ana", accessLevel: "Visitante", photo };

async function browser({ storedUser = null, cameraDenied = false, saveFailure = false } = {}) {
  const nodes = new Map();
  const requests = [];
  let stopped = false;
  let cameraOptions;
  function element() {
    return { textContent: "", value: "", checked: false, hidden: false, disabled: false, open: false,
      listeners: {}, videoWidth: 640, videoHeight: 480,
      addEventListener(event, callback) { this.listeners[event] = callback; },
      removeAttribute(name) { delete this[name]; },
      reset() {}, async play() {},
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.(); }
    };
  }
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement(tag) {
      assert.equal(tag, "canvas");
      return { getContext: () => ({ drawImage() {} }), toDataURL(type, quality) {
        assert.equal(type, "image/jpeg"); assert.ok(quality < 1); return photo;
      }};
    }
  };
  for (const id of ["visitor-name", "visitor-consent"]) document.getElementById(id);
  const context = {
    document, window: { addEventListener() {} },
    navigator: { mediaDevices: { async getUserMedia(options) {
      cameraOptions = options;
      if (cameraDenied) throw new Error("Permission denied");
      return { getTracks: () => [{ stop() { stopped = true; } }] };
    }}},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === "/api/me") return { ok: true, json: async () => ({ user: storedUser }) };
      if (url === "/api/visitors") return {
        ok: !saveFailure, json: async () => saveFailure ? { error: "Base no disponible" } : { user }
      };
      return { ok: true, json: async () => ({ user: null }) };
    }
  };
  vm.runInNewContext("(" + initVisitorProfile.toString() + ")()", context);
  await new Promise(setImmediate);
  return { nodes, requests, get stopped() { return stopped; }, get cameraOptions() { return cameraOptions; } };
}

test("profile card uses the database UUID and does not start the camera on load", async () => {
  const state = await browser({ storedUser: { ...user, name: "<b>Ana</b>" } });
  assert.equal(state.nodes.get("browser-id").textContent, user.id);
  assert.equal(state.nodes.get("user-name").textContent, "<b>Ana</b>");
  assert.equal(state.nodes.get("access-level").textContent, "Visitante");
  assert.equal(state.cameraOptions, undefined);
  assert.equal(state.nodes.get("visitor-register").hidden, true);
});

test("camera capture, name and consent create a profile only after the server saves it", async () => {
  const state = await browser();
  const node = id => state.nodes.get(id);
  node("visitor-register").listeners.click();
  await node("visitor-camera").listeners.click();
  assert.equal(state.cameraOptions.audio, false);
  node("visitor-capture").listeners.click();
  assert.equal(state.stopped, true);
  state.nodes.get("visitor-name").value = "Ana";
  state.nodes.get("visitor-consent").checked = true;
  await node("visitor-form").listeners.submit({ preventDefault() {} });
  const sent = JSON.parse(state.requests.find(request => request.url === "/api/visitors").options.body);
  assert.deepEqual(sent, { name: "Ana", photo, consent: true });
  assert.equal(node("browser-id").textContent, user.id);
  assert.equal(node("visitor-dialog").open, false);
  assert.equal(node("visitor-save").disabled, false);
});

test("camera permission denial offers the file fallback without sending a profile", async () => {
  const state = await browser({ cameraDenied: true });
  state.nodes.get("visitor-register").listeners.click();
  await state.nodes.get("visitor-camera").listeners.click();
  assert.match(state.nodes.get("visitor-error").textContent, /permiso o elige una foto/);
  assert.equal(state.requests.length, 1);
  assert.equal(state.nodes.get("visitor-dialog").open, true);
});

test("failed persistence never displays an invented UUID and keeps the form available", async () => {
  const state = await browser({ saveFailure: true });
  const node = id => state.nodes.get(id);
  node("visitor-register").listeners.click();
  await node("visitor-camera").listeners.click();
  node("visitor-capture").listeners.click();
  node("visitor-name").value = "Ana";
  node("visitor-consent").checked = true;
  await node("visitor-form").listeners.submit({ preventDefault() {} });
  assert.equal(node("browser-id").textContent, "Sin UUID asignado");
  assert.equal(node("visitor-error").textContent, "Base no disponible");
  assert.equal(node("visitor-dialog").open, true);
  assert.equal(node("visitor-save").disabled, false);
});
