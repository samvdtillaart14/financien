/* App settings, backup and encrypted sync through a secret GitHub Gist. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const GIST_FILE = "huishoudfinancien.enc.json";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  };
  const status = (sel, txt, bad) => { const el = $(sel); if (el) { el.textContent = txt; el.classList.toggle("app-bad", !!bad); } };

  // ---------- crypto ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function sleutel(pass, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function pipe(bytes, Stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream("gzip"))).arrayBuffer()); }
  async function versleutel(obj, pass) {
    let bytes = enc.encode(JSON.stringify(obj)), gz = false;
    if (typeof CompressionStream === "function") { bytes = await pipe(bytes, CompressionStream); gz = true; }
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sleutel(pass, salt), bytes);
    return { app: "huishoudfinancien", v: 1, gz, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function ontsleutel(box, pass) {
    let bytes;
    try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await sleutel(pass, unb64(box.salt)), unb64(box.ct))); }
    catch (e) { throw new Error("Verkeerd sync-wachtwoord: de gegevens in je Gist zijn met een ander wachtwoord versleuteld."); }
    if (box.gz) {
      if (typeof DecompressionStream !== "function") throw new Error("Deze browser kan de sync niet uitpakken. Werk je browser bij.");
      bytes = await pipe(bytes, DecompressionStream);
    }
    return JSON.parse(dec.decode(bytes));
  }

  // ---------- GitHub Gist ----------
  async function gh(path, opts = {}) {
    const r = await fetch("https://api.github.com" + path, {
      cache: "no-store",
      ...opts,
      headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + ls.get("gh_token"), "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) }
    });
    if (r.status === 401) throw new Error("GitHub-token ongeldig of verlopen.");
    if (r.status === 403 || r.status === 404) throw new Error("GitHub weigert de toegang (" + r.status + "). Heeft je token het recht Gists: lezen en schrijven?");
    if (!r.ok) throw new Error("GitHub antwoordde " + r.status);
    return r.status === 204 ? null : r.json();
  }
  async function vindGist() {
    const id = ls.get("gist_id");
    if (id) { try { return await gh("/gists/" + id); } catch (e) { if (!/404/.test(e.message)) throw e; ls.set("gist_id", ""); } }
    for (let page = 1; page <= 5; page++) {
      const lijst = await gh(`/gists?per_page=100&page=${page}`);
      const hit = lijst.find((g) => g.files && g.files[GIST_FILE]);
      if (hit) { ls.set("gist_id", hit.id); return gh("/gists/" + hit.id); }
      if (lijst.length < 100) break;
    }
    return null;
  }
  async function leesGist(g) {
    const f = g.files[GIST_FILE];
    if (!f) return null;
    const txt = f.truncated ? await (await fetch(f.raw_url, { cache: "no-store" })).text() : f.content;
    return JSON.parse(txt);
  }

  // ---------- sync ----------
  let bezig = false, opnieuw = false, timer = null;
  const syncAan = () => !!(ls.get("gh_token") && ls.get("sync_pass"));
  async function sync() {
    if (!syncAan()) { zetSyncStatus(); return; }
    if (!navigator.onLine) { status("#app-sync-status", "Offline: synchroniseert zodra je weer internet hebt."); return; }
    if (bezig) { opnieuw = true; return; }
    bezig = true; status("#app-sync-status", "Synchroniseren…");
    try {
      const pass = ls.get("sync_pass");
      const g = await vindGist();
      let remote = {};
      if (g) { const box = await leesGist(g); if (box) remote = (await ontsleutel(box, pass)).docs || {}; }
      const binnen = await STORE.mergeIn(remote);
      const lokaal = Object.fromEntries(STORE.all());
      const nieuwer = Object.entries(lokaal).some(([p, r]) => !remote[p] || (r.at || 0) > (remote[p].at || 0));
      if (nieuwer || !g) {
        const box = await versleutel({ docs: lokaal, at: Date.now() }, pass);
        const body = JSON.stringify({ description: "Huishoudfinanciën (versleuteld)", files: { [GIST_FILE]: { content: JSON.stringify(box) } }, ...(g ? {} : { public: false }) });
        const res = g ? await gh("/gists/" + g.id, { method: "PATCH", body }) : await gh("/gists", { method: "POST", body });
        ls.set("gist_id", res.id);
      }
      ls.set("sync_at", String(Date.now()));
      status("#app-sync-status", `Gesynchroniseerd om ${new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}` + (binnen ? ` · ${binnen} onderdelen bijgewerkt van je andere toestel` : ""));
    } catch (e) {
      status("#app-sync-status", "Sync mislukt: " + ((e && e.message) || e), true);
    } finally {
      bezig = false;
      if (opnieuw) { opnieuw = false; setTimeout(sync, 500); }
    }
  }
  function zetSyncStatus() {
    const t = ls.get("sync_at");
    status("#app-sync-status", syncAan() ? (t ? "Laatst gesynchroniseerd: " + new Date(+t).toLocaleString("nl-NL") : "Sync staat aan.") : "Sync staat uit: vul een GitHub-token en sync-wachtwoord in.");
  }
  window.APP = { syncSoon() { if (!syncAan()) return; clearTimeout(timer); timer = setTimeout(sync, 2500); }, sync };

  // ---------- settings form ----------
  function vulForm() {
    const f = $("#app-form"); if (!f) return;
    f.querySelector("#app-av").value = ls.get("av_key");
    f.querySelector("#app-gh").value = ls.get("gh_token");
    f.querySelector("#app-pass").value = ls.get("sync_pass");
    zetSyncStatus();
  }
  document.querySelectorAll("#app-form").forEach((f) => f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const oudPass = ls.get("sync_pass");
    ls.set("av_key", f.querySelector("#app-av").value.trim());
    ls.set("gh_token", f.querySelector("#app-gh").value.trim());
    const pass = f.querySelector("#app-pass").value;
    if (pass && pass.length < 10) { status("#app-form-status", "Kies een sync-wachtwoord van minstens 10 tekens.", true); return; }
    ls.set("sync_pass", pass);
    if (pass !== oudPass) ls.set("gist_id", "");
    status("#app-form-status", "Opgeslagen op dit toestel.");
    if (ls.get("av_key")) KOERS.fetch(true);
    sync();
  }));
  document.querySelectorAll("#app-sync-nu").forEach((b) => b.addEventListener("click", sync));
  document.querySelectorAll("#app-koers-nu").forEach((b) => b.addEventListener("click", () => KOERS.fetch(true)));
  document.querySelectorAll("#app-bijwerken").forEach((b) => b.addEventListener("click", async () => {
    status("#app-versie-status", "Bijwerken…");
    try {
      if ("serviceWorker" in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      if (window.caches) for (const k of await caches.keys()) if (k.startsWith("financien-")) await caches.delete(k);
    } catch (e) {}
    location.reload();
  }));

  // ---------- tabs: start a newly opened tab at the top ----------
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "instant" })));

  // ---------- theme ----------
  function zetThema(t) {
    document.documentElement.dataset.theme = t;
    const donker = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", donker ? "#1d1c1a" : "#faf9f5"));
  }
  document.querySelectorAll("#app-thema").forEach((sel) => {
    sel.value = ls.get("thema") || "light";
    sel.addEventListener("change", () => { ls.set("thema", sel.value); zetThema(sel.value); });
  });
  zetThema(ls.get("thema") || "light");
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => zetThema(ls.get("thema") || "light"));

  // ---------- backup ----------
  document.querySelectorAll("#app-export").forEach((b) => b.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "huishoudfinancien", v: 1, at: Date.now(), docs: Object.fromEntries(STORE.all()) })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `huishoudfinancien-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status("#app-backup-status", "Back-up gemaakt. Bewaar hem op een veilige plek: hij is niet versleuteld.");
  }));
  document.querySelectorAll("#app-import").forEach((inp) => inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== "huishoudfinancien" || !j.docs) throw new Error("Dit is geen back-up van deze app.");
      const n = await STORE.mergeIn(j.docs);
      status("#app-backup-status", `Back-up ingelezen: ${n} onderdelen toegevoegd of bijgewerkt.`);
      APP.syncSoon();
    } catch (e) { status("#app-backup-status", "Niet ingelezen: " + ((e && e.message) || e), true); }
    inp.value = "";
  }));

  // ---------- lifecycle ----------
  const start = () => { vulForm(); sync(); };
  if (window.STORE && STORE.ready) start(); else document.addEventListener("app-ready", start, { once: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
  window.addEventListener("online", sync);
  window.addEventListener("focus", () => sync());
  setInterval(() => { if (document.visibilityState === "visible") sync(); }, 60e3);

  if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    let herladen = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !herladen) { herladen = true; location.reload(); } });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then((reg) => {
        reg.addEventListener("updatefound", () => { if (hadController) status("#app-update", "Nieuwe versie wordt geladen…"); });
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      }).catch(() => {});
    });
  }
})();
