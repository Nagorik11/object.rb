export default function initVisitorProfile() {
  const byId = id => document.getElementById(id);
  const dialog = byId("visitor-dialog");
  const form = byId("visitor-form");
  const video = byId("visitor-video");
  const preview = byId("visitor-preview");
  const error = byId("visitor-error");
  const save = byId("visitor-save");
  const cancel = byId("visitor-cancel");
  let photo = null;
  let stream = null;
  let saving = false;
  let preparingPhoto = false;

  function stopCamera() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    byId("visitor-capture").disabled = true;
  }

  function showUser(user) {
    byId("user-name").textContent = user ? user.name : "Sin registrar";
    byId("browser-id").textContent = user ? user.id : "Sin UUID asignado";
    byId("access-level").textContent = user ? user.accessLevel : "Visitante · sin registrar";
    byId("visitor-register").hidden = !!user;
    byId("visitor-logout").hidden = !user;
    const avatar = byId("visitor-avatar");
    avatar.hidden = !user?.photo;
    if (user?.photo) avatar.src = user.photo;
    else avatar.removeAttribute("src");
  }

  function takePhoto(source, width, height) {
    if (!width || !height) throw new Error("Espera a que la cámara esté lista.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const size = Math.min(width, height);
    canvas.getContext("2d").drawImage(source, (width - size) / 2, (height - size) / 2, size, size, 0, 0, 256, 256);
    const candidate = canvas.toDataURL("image/jpeg", 0.75);
    if (candidate.length > 100000) throw new Error("Selecciona una imagen más sencilla.");
    photo = candidate;
    preview.src = photo;
    preview.hidden = false;
  }

  byId("visitor-register").addEventListener("click", () => {
    error.textContent = "";
    dialog.showModal();
  });
  cancel.addEventListener("click", () => { if (!saving) dialog.close(); });
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", stopCamera);
  window.addEventListener("pagehide", stopCamera);

  byId("visitor-camera").addEventListener("click", async () => {
    error.textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      error.textContent = "La cámara no está disponible. Puedes elegir una foto abajo.";
      return;
    }
    const button = byId("visitor-camera");
    if (button.disabled) return;
    button.disabled = true;
    stopCamera();
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (!dialog.open) { camera.getTracks().forEach(track => track.stop()); return; }
      stream = camera;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      byId("visitor-capture").disabled = false;
    } catch (_) {
      stopCamera();
      error.textContent = "No se pudo abrir la cámara. Revisa el permiso o elige una foto.";
    } finally { button.disabled = false; }
  });

  byId("visitor-capture").addEventListener("click", () => {
    try {
      takePhoto(video, video.videoWidth, video.videoHeight);
      stopCamera();
      error.textContent = "";
    } catch (failure) { error.textContent = failure.message; }
  });

  byId("visitor-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      error.textContent = "Elige una imagen de hasta 10 MB.";
      return;
    }
    preparingPhoto = true;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      takePhoto(image, image.naturalWidth, image.naturalHeight);
      stopCamera();
      error.textContent = "";
    } catch (_) { photo = null; preview.hidden = true; error.textContent = "No pudimos leer esa foto. Prueba otra imagen."; }
    finally { URL.revokeObjectURL(url); preparingPhoto = false; }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    if (!photo || preparingPhoto) { error.textContent = "Primero toma o elige tu foto."; return; }
    saving = true;
    save.disabled = cancel.disabled = true;
    save.textContent = "Guardando…";
    error.textContent = "";
    try {
      const response = await fetch("/api/visitors", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: byId("visitor-name").value.trim(), photo, consent: byId("visitor-consent").checked })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pudimos guardar el perfil.");
      showUser(data.user);
      dialog.close();
      form.reset();
      photo = null;
      preview.hidden = true;
      preview.removeAttribute("src");
    } catch (failure) { error.textContent = failure.message || "No hay conexión. Inténtalo de nuevo."; }
    finally {
      saving = false;
      save.disabled = cancel.disabled = false;
      save.textContent = "Crear mi perfil";
    }
  });

  byId("visitor-logout").addEventListener("click", async () => {
    const button = byId("visitor-logout");
    button.disabled = true;
    try {
      const response = await fetch("/api/visitor/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error();
      showUser(null);
    } catch (_) { byId("access-level").textContent = "No se pudo cerrar la sesión"; }
    finally { button.disabled = false; }
  });

  fetch("/api/me", { credentials: "same-origin" })
    .then(async response => {
      if (!response.ok) throw new Error();
      showUser((await response.json()).user);
    })
    .catch(() => { byId("access-level").textContent = "Sin conexión a shared-db"; });
}
