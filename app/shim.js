/* Local runtime: provides the `dash` and `claude.use()` APIs the dashboard page was written against,
   backed by IndexedDB on this device, Alpha Vantage for prices, and an optional encrypted GitHub Gist sync. */
(function () {
  "use strict";
  const DB_NAME = "huishoudfinancien";
  const STORE = "docs";
  const SOURCES = {
    afschriften: { kind: "store", path: "data/users/me/fin/maanden" },
    instellingen: { kind: "store", path: "data/users/me/fin" },
    t212: { kind: "store", path: "data/users/me/fin/t212" },
    vermogen: { kind: "store", path: "data/users/me/fin/vermogen" },
    koersen: { kind: "koersen" }
  };
  const KOERS_PATH = "cache/koersen";
  const KOERS_MAX_UUR = 6;

  // ---------- storage ----------
  const docs = new Map(); // path -> { data, at, deleted? }
  let ready = false;
  let ver = 1;
  let idb = null;
  const openIdb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = (mode) => idb.transaction(STORE, mode).objectStore(STORE);
  const idbPut = (path, rec) => new Promise((res, rej) => { const q = tx("readwrite").put(rec, path); q.onsuccess = res; q.onerror = () => rej(q.error); });
  const idbAll = () => new Promise((res, rej) => {
    const out = new Map(); const q = tx("readonly").openCursor();
    q.onsuccess = () => { const c = q.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
    q.onerror = () => rej(q.error);
  });
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const listeners = new Map(); // path -> Set(fn)
  function changed(paths, { sync = true } = {}) {
    ver++;
    for (const p of paths) for (const fn of listeners.get(p) || []) { try { fn(snap(p)); } catch (e) { console.error(e); } }
    scheduleRender();
    if (sync && window.APP && APP.syncSoon) APP.syncSoon();
  }
  async function writeDoc(path, data, opts) {
    const rec = data === null ? { deleted: true, at: Date.now() } : { data: clone(data), at: Date.now() };
    docs.set(path, rec);
    if (idb) await idbPut(path, rec);
    changed([path], opts);
  }
  function snap(path) {
    const r = docs.get(path);
    const exists = !!(r && !r.deleted);
    return { id: path.split("/").pop(), exists, data: () => (exists ? clone(r.data) : undefined) };
  }

  // Public store helpers for app.js (sync, backup)
  const store = {
    all: () => new Map(docs),
    async mergeIn(remote) { // remote: { path: rec } ; newest `at` wins
      const touched = [];
      for (const [p, rec] of Object.entries(remote)) {
        const cur = docs.get(p);
        if (!cur || (rec.at || 0) > (cur.at || 0)) { docs.set(p, rec); if (idb) await idbPut(p, rec); touched.push(p); }
      }
      if (touched.length) changed(touched, { sync: false });
      return touched.length;
    },
    write: writeDoc,
    get: (p) => docs.get(p)
  };

  // ---------- sources ----------
  function storeRows(path) {
    const segs = path.split("/").length;
    if (segs % 2 === 0) {
      const r = docs.get(path);
      return r && !r.deleted ? [{ id: path.split("/").pop(), ...clone(r.data) }] : [];
    }
    const rows = [];
    for (const [p, r] of docs) {
      if (r.deleted || !p.startsWith(path + "/") || p.split("/").length !== segs + 1) continue;
      rows.push({ id: p.split("/").pop(), ...clone(r.data) });
    }
    return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const rowCache = new Map(); // id -> { ver, value }
  const calcs = new Map();
  const loaders = new Map();
  const koers = { busy: false, error: null, requested: false };

  function res(status, data, extra) {
    const columns = Array.isArray(data) && data[0] && typeof data[0] === "object" ? Object.keys(data[0]) : [];
    return { status, data, columns, message: null, refreshing: false, truncated: false, meta: [], ...extra };
  }
  function data(id) {
    const c = rowCache.get(id);
    if (c && c.ver === ver) return c.value;
    let v;
    if (!ready) v = res("loading", calcs.has(id) ? null : []);
    else if (calcs.has(id)) v = runCalc(id);
    else if (SOURCES[id] && SOURCES[id].kind === "store") v = res("ok", storeRows(SOURCES[id].path));
    else if (SOURCES[id] && SOURCES[id].kind === "koersen") v = koersData();
    else v = res("missing", []);
    rowCache.set(id, { ver, value: v });
    return v;
  }
  function runCalc(id) {
    const c = calcs.get(id);
    const ins = c.inputs.map((i) => data(i));
    const bad = ins.find((i) => i.status !== "ok");
    if (bad) return res(bad.status === "loading" ? "loading" : bad.status, null, { message: bad.message });
    try {
      const out = c.fn(...ins.map((i) => i.data));
      return res("ok", out, { refreshing: ins.some((i) => i.refreshing) });
    } catch (e) {
      console.error("calc " + id, e);
      return res("error", null, { message: String((e && e.message) || e) });
    }
  }

  // ---------- prices (Alpha Vantage) ----------
  function koersData() {
    const r = docs.get(KOERS_PATH);
    const rows = r && !r.deleted && r.data ? r.data.rows || [] : [];
    const key = localStorage.getItem("av_key");
    const oud = !r || Date.now() - (r.at || 0) > KOERS_MAX_UUR * 3600e3;
    if (key && oud && !koers.busy && !koers.requested) { koers.requested = true; setTimeout(() => fetchKoersen(false), 0); }
    if (!key && !rows.length) return res("ok", [], { nokey: true });
    if (koers.error && !rows.length) return res("error", [], { message: koers.error });
    return res("ok", rows, { refreshing: koers.busy, nokey: !key, fetchedAt: r ? r.at : null, message: koers.error });
  }
  async function av(tool, args) {
    const key = localStorage.getItem("av_key");
    if (!key) throw new Error("Geen Alpha Vantage-sleutel ingesteld.");
    const q = new URLSearchParams({ function: tool, ...args, apikey: key });
    const r = await fetch("https://www.alphavantage.co/query?" + q.toString());
    if (!r.ok) throw new Error("Alpha Vantage antwoordde " + r.status);
    return r.json();
  }
  async function fetchKoersen(force) {
    const l = loaders.get("koersen");
    if (!l || koers.busy) return;
    if (!navigator.onLine) { koers.error = "Geen internet: de laatst opgehaalde koersen blijven staan."; ver++; scheduleRender(); return; }
    koers.busy = true; koers.error = null; ver++; scheduleRender();
    try {
      const args = { from_symbol: "EUR", to_symbol: "USD", datatype: "json", outputsize: "compact" };
      const answer = await av("FX_DAILY", args);
      if (answer && (answer.Information || answer.Note || answer["Error Message"])) throw new Error(answer.Information || answer.Note || answer["Error Message"]);
      const out = await l.fn({ answer, items: [answer], args, call: (tool, a) => av(tool, a), read: {} });
      const rows = Array.isArray(out) ? out : out.rows || out.data || [];
      await writeDoc(KOERS_PATH, { rows });
    } catch (e) {
      koers.error = String((e && e.message) || e);
    } finally {
      koers.busy = false; ver++; scheduleRender();
    }
  }

  // ---------- drawing ----------
  const draws = new Map(); // name -> spec
  const mounted = new WeakMap(); // el -> { made }
  const onDataFns = [];
  function runDraw(name) {
    const spec = draws.get(name);
    if (!spec) return;
    document.querySelectorAll(`[data-draw="${CSS.escape(name)}"]`).forEach((el) => {
      if (el.parentElement && el.parentElement.closest("[data-draw]")) return;
      try {
        if (typeof spec === "function") spec(el);
        else {
          let m = mounted.get(el);
          if (!m) { el.replaceChildren(); m = { made: spec.mount ? spec.mount(el) : undefined }; mounted.set(el, m); }
          if (spec.update) spec.update(el, m.made);
        }
      } catch (e) { console.error("draw " + name, e); }
    });
  }
  function renderAll() {
    for (const fn of onDataFns) { try { fn(); } catch (e) { console.error(e); } }
    for (const name of draws.keys()) runDraw(name);
  }
  let pending = false;
  function scheduleRender() {
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; renderAll(); });
  }
  let lastW = 0;
  new ResizeObserver(() => { const w = document.documentElement.clientWidth; if (w !== lastW) { lastW = w; ver++; scheduleRender(); } }).observe(document.documentElement);

  // ---------- params ----------
  const PARAMS_KEY = "params";
  const readParams = () => { try { return { kpi_periode: "1", ...JSON.parse(localStorage.getItem(PARAMS_KEY) || "{}") }; } catch (e) { return { kpi_periode: "1" }; } };

  // ---------- dash ----------
  const dash = {
    colors: ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"],
    data,
    calc(id, spec) { calcs.set(id, spec); },
    loader(id, spec) { loaders.set(id, spec); },
    onData(fn) { onDataFns.push(fn); try { fn(); } catch (e) { console.error(e); } },
    draw(name, spec) {
      if (spec === undefined) { runDraw(name); return; }
      draws.set(name, spec);
      if (document.readyState !== "loading") runDraw(name);
    },
    params: () => readParams(),
    setParams(p) {
      const cur = readParams();
      for (const [k, v] of Object.entries(p)) { if (v === null || v === undefined) delete cur[k]; else cur[k] = v; }
      try { localStorage.setItem(PARAMS_KEY, JSON.stringify(cur)); } catch (e) {}
      ver++; scheduleRender();
    },
    resetParams() { try { localStorage.removeItem(PARAMS_KEY); } catch (e) {} ver++; scheduleRender(); },
    setLink(name) { try { history.replaceState(null, "", "#" + name); } catch (e) {} },
    refresh(id) { if (id === "koersen") fetchKoersen(true); else { ver++; scheduleRender(); } }
  };

  // ---------- claude.use ----------
  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      get: async () => snap(path),
      set: async (d) => writeDoc(path, d),
      update: async (d) => { const cur = docs.get(path); writeDoc(path, { ...((cur && !cur.deleted && cur.data) || {}), ...d }); },
      delete: async () => writeDoc(path, null),
      onSnapshot(next) {
        if (!listeners.has(path)) listeners.set(path, new Set());
        listeners.get(path).add(next);
        const go = () => { if (ready) next(snap(path)); else setTimeout(go, 50); };
        setTimeout(go, 0);
        return () => listeners.get(path).delete(next);
      },
      collection: (sub) => colRef(path + "/" + sub)
    };
  }
  function colRef(path) {
    return {
      path,
      doc: (id) => docRef(path + "/" + id),
      add: async (d) => { const id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); await writeDoc(path + "/" + id, d); return docRef(path + "/" + id); }
    };
  }
  const dbApi = { doc: docRef, collection: colRef };
  const userApi = { id: async () => "me", me: async () => ({ id: "me", name: "" }), isOwner: async () => true, canEdit: async () => true };
  window.claude = { use: async (name) => (name === "db" ? dbApi : name === "user" ? userApi : null) };
  window.dash = dash;
  window.STORE = store;
  window.KOERS = { fetch: fetchKoersen };

  // ---------- boot ----------
  (async () => {
    try {
      idb = await openIdb();
      const all = await idbAll();
      for (const [k, v] of all) docs.set(k, v);
    } catch (e) {
      console.error("IndexedDB niet beschikbaar", e);
    }
    ready = true; store.ready = true; ver++;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleRender); else scheduleRender();
    document.dispatchEvent(new Event("app-ready"));
  })();
})();
