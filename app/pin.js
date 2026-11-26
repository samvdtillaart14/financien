/* PIN lock for this device. Loaded at the very start of <body>, so a locked app never shows its
   content. The PIN itself is never stored, only a PBKDF2 hash; it is never synced. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const html = document.documentElement;
  const dlg = document.getElementById("app-lock");
  if (!dlg) return;
  const ITER = 310000, MIN = 4, MAX = 8, IDLE_MIN = 5;

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  const rec = () => { try { const r = JSON.parse(ls.get("pin") || "null"); return r && r.hash ? r : null; } catch (e) { return null; } };
  const naMin = () => { const v = parseInt(ls.get("pin_na"), 10); return [0, 1, 5, 15].includes(v) ? v : 1; };

  // ---------- hashing ----------
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function hash(pin, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
    return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, 256));
  }
  async function klopt(pin) { const r = rec(); return !!r && (await hash(pin, unb64(r.salt), r.iter || ITER)) === r.hash; }
  async function bewaar(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return ls.set("pin", JSON.stringify({ v: 1, len: pin.length, iter: ITER, salt: b64(salt), hash: await hash(pin, salt, ITER) }));
  }

  // ---------- wrong attempts: wait 30 s after 5 tries, then longer ----------
  const WACHT = [30, 60, 120, 300, 900];
  const fouten = () => parseInt(ls.get("pin_fout"), 10) || 0;
  const wachtTot = () => parseInt(ls.get("pin_wacht"), 10) || 0;
  function fout() {
    const n = fouten() + 1;
    ls.set("pin_fout", String(n));
    if (n >= 5) ls.set("pin_wacht", String(Date.now() + WACHT[Math.min(n - 5, WACHT.length - 1)] * 1000));
    return n;
  }
  const goed = () => { ls.set("pin_fout", null); ls.set("pin_wacht", null); };

  // ---------- screen ----------
  const el = {
    titel: $("#app-lock-titel"), sub: $("#app-lock-sub"), dots: $("#app-lock-dots"), msg: $("#app-lock-msg"),
    pad: $("#app-lock-pad"), links: $("#app-lock-links"), terug: $("#app-lock-terug"), volgende: $("#app-lock-volgende"),
    invoer: $("#app-lock-invoer"), wis: $("#app-lock-wis"), in: $("#app-lock-in")
  };
  let modus = null;   // "slot" (app locked) | "check" (current PIN before a change) | "nieuw" | "herhaal"
  let invoer = "", eerste = "", bezig = false, naCheck = null, klaar = null, tik = null;
  const TEKST = {
    slot: ["Voer je pincode in", ""],
    check: ["Voer je huidige pincode in", ""],
    nieuw: ["Kies een pincode", `${MIN} tot ${MAX} cijfers`],
    herhaal: ["Herhaal je pincode", ""]
  };
  const lengte = () => (modus === "nieuw" ? 0 : modus === "herhaal" ? eerste.length : (rec() || {}).len || 0);

  function teken() {
    const n = lengte() || Math.max(MIN, invoer.length);
    el.dots.replaceChildren(...Array.from({ length: n }, (_, i) => { const d = document.createElement("i"); if (i < invoer.length) d.className = "vol"; return d; }));
    el.dots.setAttribute("aria-label", `${invoer.length} ${invoer.length === 1 ? "cijfer" : "cijfers"} ingevoerd`);
    el.volgende.hidden = modus !== "nieuw";
    el.volgende.disabled = invoer.length < MIN;
    el.terug.disabled = !invoer.length;
    const wacht = wachtTot() - Date.now();
    const dicht = bezig || (wacht > 0 && (modus === "slot" || modus === "check"));
    el.pad.querySelectorAll("button[data-cijfer]").forEach((b) => (b.disabled = dicht));
    if (wacht > 0 && (modus === "slot" || modus === "check")) {
      const s = Math.ceil(wacht / 1000);
      el.msg.textContent = `Te vaak een verkeerde pincode. Probeer het over ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} opnieuw.`;
      clearTimeout(tik); tik = setTimeout(teken, 1000);
    } else if (/^Te vaak/.test(el.msg.textContent)) el.msg.textContent = "";
  }
  function toon(m, melding = "") {
    modus = m; invoer = ""; bezig = false;
    el.titel.textContent = TEKST[m][0];
    el.sub.textContent = TEKST[m][1];
    el.msg.textContent = melding;
    el.links.textContent = m === "slot" ? "Vergeten?" : "Annuleren";
    el.links.setAttribute("aria-label", m === "slot" ? "Pincode vergeten" : "Annuleren");
    el.wis.hidden = true; el.invoer.hidden = false;
    teken();
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
    try { el.in.focus({ preventScroll: true }); } catch (e) {}
  }
  function sluit() {
    modus = null; invoer = ""; eerste = ""; naCheck = null;
    clearTimeout(tik);
    if (dlg.open) dlg.close();
  }
  function schud() {
    el.dots.classList.remove("app-lock-schud"); void el.dots.offsetWidth; el.dots.classList.add("app-lock-schud");
  }

  // ---------- lock / unlock ----------
  let actief = Date.now(), weg = 0;
  const opSlot = () => html.classList.contains("app-locked");
  function vergrendel() {
    if (!rec()) return;
    html.classList.add("app-locked");
    klaar = null; naCheck = null; eerste = "";
    try { document.activeElement && document.activeElement.blur(); } catch (e) {}
    toon("slot");
  }
  function ontgrendel() {
    goed();
    html.classList.remove("app-locked", "app-cover");
    sluit();
    actief = Date.now();
  }

  async function verstuur() {
    if (bezig) return;
    if (modus === "nieuw") {
      if (invoer.length < MIN) { el.msg.textContent = `Kies minstens ${MIN} cijfers.`; return; }
      eerste = invoer; toon("herhaal"); return;
    }
    if (modus === "herhaal") {
      if (invoer !== eerste) { eerste = ""; schud(); toon("nieuw", "De pincodes waren niet gelijk. Kies opnieuw."); return; }
      bezig = true; teken();
      const ok = await bewaar(eerste);
      const cb = klaar; sluit(); klaar = null;
      if (cb) cb(ok ? "Pincode ingesteld. De app vraagt hem voortaan bij openen." : "Opslaan lukte niet in deze browser.", !ok);
      return;
    }
    if (wachtTot() > Date.now()) return;
    bezig = true; teken();
    const ok = await klopt(invoer);
    bezig = false;
    if (ok) {
      if (modus === "slot") ontgrendel();
      else { goed(); const volgende = naCheck; naCheck = null; volgende && volgende(); }
      return;
    }
    const n = fout();
    schud();
    invoer = "";
    el.msg.textContent = n >= 5 ? "" : `Onjuiste pincode.${n >= 2 ? ` Nog ${5 - n} ${5 - n === 1 ? "poging" : "pogingen"} voordat je moet wachten.` : ""}`;
    teken();
  }
  function cijfer(c) {
    if (bezig || !modus || !el.wis.hidden) return;
    if ((modus === "slot" || modus === "check") && wachtTot() > Date.now()) return;
    const max = lengte() || MAX;
    if (invoer.length >= max) return;
    invoer += c;
    if (!/^Te vaak/.test(el.msg.textContent)) el.msg.textContent = "";
    teken();
    if (lengte() && invoer.length === lengte()) setTimeout(verstuur, 120);
  }
  function terug() { if (bezig || !invoer) return; invoer = invoer.slice(0, -1); teken(); }
  function annuleer() {
    const cb = klaar; sluit(); klaar = null;
    if (cb) cb("");
  }

  el.pad.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.cijfer) cijfer(b.dataset.cijfer);
    else if (b === el.terug) terug();
    else if (b === el.links) { if (modus === "slot") { el.invoer.hidden = true; el.wis.hidden = false; el.titel.textContent = "Pincode vergeten?"; el.sub.textContent = ""; } else annuleer(); }
  });
  el.volgende.addEventListener("click", verstuur);
  dlg.addEventListener("keydown", (ev) => {
    if (!el.wis.hidden) return;
    if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); cijfer(ev.key); }
    else if (ev.key === "Backspace") { ev.preventDefault(); terug(); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (modus === "nieuw") verstuur(); }
  });
  dlg.addEventListener("cancel", (ev) => { ev.preventDefault(); if (modus && modus !== "slot") annuleer(); });
  dlg.addEventListener("close", () => { if (opSlot() && rec()) setTimeout(() => { if (!dlg.open) toon("slot"); }, 0); });

  // ---------- forgotten PIN: wipe everything on this device ----------
  $("#app-lock-wis-terug").addEventListener("click", () => toon("slot"));
  $("#app-lock-wis-ja").addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try { if (window.STORE && STORE.wipe) await STORE.wipe(); } catch (e) {}
    const thema = ls.get("thema");
    try { localStorage.clear(); } catch (e) {}
    if (thema) ls.set("thema", thema);
    try { sessionStorage.setItem("app-gewist", "1"); } catch (e) {}
    location.reload();
  });

  // ---------- auto-lock: after time away, and after a while untouched ----------
  document.addEventListener("visibilitychange", () => {
    if (!rec()) return;
    if (document.visibilityState === "hidden") {
      weg = Date.now();
      if (naMin() === 0) vergrendel(); else html.classList.add("app-cover");
    } else {
      html.classList.remove("app-cover");
      if (!opSlot() && weg && Date.now() - weg >= naMin() * 60e3) vergrendel();
      weg = 0; actief = Date.now();
    }
  });
  window.addEventListener("pageshow", (ev) => { if (ev.persisted && rec() && !opSlot()) vergrendel(); });
  const bezigMet = () => { actief = Date.now(); };
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach((t) => window.addEventListener(t, bezigMet, { passive: true, capture: true }));
  setInterval(() => {
    if (rec() && !opSlot() && document.visibilityState === "visible" && Date.now() - actief >= Math.max(naMin(), IDLE_MIN) * 60e3) vergrendel();
  }, 15e3);

  // ---------- start: lock before anything else is drawn ----------
  if (rec()) vergrendel(); else html.classList.remove("app-locked");

  // ---------- menu: set, change, turn off ----------
  function menu() {
    const st = $("#app-pin-status"); if (!st) return;
    const zet = $("#app-pin-zet"), uit = $("#app-pin-uit"), nu = $("#app-pin-nu"), rij = $("#app-pin-na-rij"), sel = $("#app-pin-na");
    const melding = (t, bad) => { st.textContent = t; st.classList.toggle("app-bad", !!bad); };
    const ververs = (t, bad) => {
      const aan = !!rec();
      zet.textContent = aan ? "Pincode wijzigen" : "Pincode instellen";
      uit.hidden = nu.hidden = rij.hidden = !aan;
      sel.value = String(naMin());
      melding(t || (aan ? "Staat aan: de app vraagt je pincode bij openen." : "Staat uit: wie je ontgrendelde telefoon heeft, kan de app openen."), bad);
    };
    const kies = () => { klaar = ververs; eerste = ""; toon("nieuw"); };
    zet.addEventListener("click", () => {
      if (rec()) { naCheck = kies; klaar = ververs; toon("check"); } else kies();
    });
    uit.addEventListener("click", () => {
      klaar = ververs;
      naCheck = () => { ls.set("pin", null); const cb = klaar; sluit(); klaar = null; cb && cb("Pincode staat uit."); };
      toon("check");
    });
    nu.addEventListener("click", () => {
      const m = $("#app-menu"); if (m && m.open) m.close();
      vergrendel();
    });
    sel.addEventListener("change", () => { ls.set("pin_na", sel.value); ververs(); });
    ververs();
    try {
      if (sessionStorage.getItem("app-gewist")) {
        sessionStorage.removeItem("app-gewist");
        const u = $("#app-update");
        if (u) u.textContent = "Alle gegevens op dit toestel zijn gewist. Zet ze terug via Menu: vul je GitHub-token en sync-wachtwoord in, of lees een back-up in.";
      }
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", menu); else menu();
  window.PIN = { vergrendel };
})();
