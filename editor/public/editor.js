// Portfolio-Editor – lange Seiten mit Fotos, Videos, Textboxen und handgemalter Tinte,
// verlinkte Projektseiten und eine Node-Übersicht aller Seiten.
import {
  W, MW, TILE, SCREEN, BG, INK, SYSTEM_FONTS, esc, styleOf, itemHTML, pageHTML, pageH,
  posVarParts, posVar, mediaUrl, ensureIds, newId, mergeEntry, pinTopY,
} from '/shared/render.mjs';
import { randomCut } from '/shared/randomcut.mjs';
import { fontFaceCSS } from '/shared/document.mjs';

const $ = id => document.getElementById(id);
const body = document.body;
const stage = $('stage'), itemsEl = $('items'), tilesEl = $('tiles'), inputEl = $('input');
const ovl = $('ovl'), handlesEl = $('handles'), scroller = $('scroller');
const insp = $('inspector'), mediaGrid = $('mediaGrid'), menu = $('ctxmenu');
const graphView = $('graphView'), pageView = $('pageView'), world = $('world'), nodesEl = $('nodes'), wireG = $('wireG');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch {} };

// ---------- API ----------
async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
const postJSON = (url, data) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

// ---------- Zustand ----------
let site = null;            // {title, styles, graph}
let pages = [];             // [{id,title}]
let fonts = [];             // [{family,file}]
let allPages = new Map();   // id -> page (für Übersicht & „verlinkt von")
let page = null;            // aktuelle Seite
let mode = 'desktop';       // 'desktop' | 'mobile'
let L = null;               // aktive Ansicht: Desktop = page selbst, Handy = abgeleitete Ansicht (buildMobileL)
const LW = () => L.width || W;
let media = [];             // Medien der aktuellen Seite
let view = 'page';
let tool = 'select';
let brushSize = 22;
let sel = -1;               // gewähltes Element (Index in L.items)
let multi = [];             // Mehrfachauswahl (⇧-Klick): Objekt-Referenzen aus L.items, immer ≥ 2
let zoom = 1, scale = 1;    // scale = Bildschirm-px pro Seiten-Einheit
let dirty = false;
const dirtyTiles = new Set();
let editing = null;         // Textbearbeitung {i,isNew,before}
let lastStyle = 'text';
let spaceDown = false;

const edMedia = (pid, f) => `/media/${encodeURIComponent(pid)}/${encodeURIComponent(f)}`;
const edOpt = { media: edMedia, link: null, pos: posVar, editor: true };

// ---------- Status ----------
let statusTimer = null;
function setStatus(text, kind = '', sticky = false) {
  const s = $('status');
  s.textContent = text; s.title = text; s.className = 'status ' + kind;
  clearTimeout(statusTimer);
  if (text && !sticky) statusTimer = setTimeout(() => { s.textContent = ''; s.className = 'status'; }, kind === 'err' ? 7000 : 2500);
}

// ---------- Undo / Redo ----------
let undoStack = [], redoStack = [], lastUndoKey = null, lastUndoAt = 0;
const snapshot = () => { syncBack(); return JSON.stringify({ items: page.items, strokes: page.strokes, top: page.top, bottom: page.bottom, m: page.m }); };
function pushUndo(key) {
  const now = Date.now();
  if (key && key === lastUndoKey && now - lastUndoAt < 1500) { lastUndoAt = now; return; }
  lastUndoKey = key || null; lastUndoAt = now;
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  updateHistory();
}
function applyState(s) {
  tearDownCrop();
  editing = null;
  multi = [];
  const o = JSON.parse(s);
  Object.assign(page, o);
  if (mode === 'mobile' && page.m) L = buildMobileL(); else { L = page; if (mode === 'mobile') setModeUI('desktop'); }
  if (sel >= L.items.length) sel = -1;
  clearLasso();
  ensureTiles(); layout(); renderItems(); redrawAllTiles(); renderInspector(); renderMedia();
  markDirty();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); applyState(undoStack.pop()); lastUndoKey = null; updateHistory(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); applyState(redoStack.pop()); lastUndoKey = null; updateHistory(); }
function updateHistory() { $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length; }

// ---------- Speichern ----------
let saving = false, saveAgain = false, saveTimer = null;
function markDirty() {
  syncBack();
  if (page && page.m) updateMobileBadge();
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1500); // Autosave
}
function tileEmpty(t) {
  const d = t.ctx.getImageData(0, 0, LW(), TILE).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}
async function save() {
  if (!page) return;
  clearTimeout(saveTimer);
  if (saving) { saveAgain = true; return; }
  saving = true;
  const pg = page, lay = L, pre = lay.mobile ? 'mink' : 'ink';
  try {
    setStatus('Speichere…', '', true);
    measureTexts();
    syncBack();
    const keys = new Set(lay.ink || []);
    const [a, b] = tileRange();
    for (const k of [...keys]) if (k < a || k > b) keys.delete(k);
    const todo = [...dirtyTiles]; dirtyTiles.clear();
    for (const k of todo) {
      const t = tiles.get(k);
      if (!t) continue;
      if (tileEmpty(t)) { keys.delete(k); continue; }
      const blob = await new Promise(r => t.cv.toBlob(r, 'image/png'));
      try { await api(`/api/ink?id=${encodeURIComponent(pg.id)}&pre=${pre}&k=${k}`, { method: 'POST', body: blob }); }
      catch (e) { dirtyTiles.add(k); throw e; }
      keys.add(k);
    }
    lay.ink = [...keys].sort((x, y) => x - y);
    const draws = [...pg.items, ...(pg.m?.own || [])].filter(it => it.type === 'draw');
    for (const it of draws) {
      if (it.up === it.v) continue;
      const blob = await new Promise(r => drawRaster(it).toBlob(r, 'image/png'));
      await api(`/api/drawobj?id=${encodeURIComponent(pg.id)}&item=${it.id}`, { method: 'POST', body: blob });
      it.up = it.v;
      if (lay.mobile) { const v = lay.items.find(x => x.id === it.id); if (v) v.up = it.v; }
    }
    pg.updated = new Date().toISOString();
    await postJSON(`/api/page?id=${encodeURIComponent(pg.id)}`, pg);
    await postJSON(`/api/ink-clean?id=${encodeURIComponent(pg.id)}&pre=${pre}`, { keep: lay.ink });
    await postJSON(`/api/draw-clean?id=${encodeURIComponent(pg.id)}`, { keep: draws.map(it => it.id) });
    if (pg === page) dirty = false;
    setStatus('Gespeichert ✓', 'ok');
  } catch (e) {
    setStatus('Speichern fehlgeschlagen: ' + e.message, 'err');
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; save(); }
  }
}
let siteTimer = null;
function saveSite() { clearTimeout(siteTimer); siteTimer = setTimeout(flushSite, 500); }
async function flushSite() {
  clearTimeout(siteTimer); siteTimer = null;
  try { await postJSON('/api/site', site); } catch (e) { setStatus('Fehler: ' + e.message, 'err'); }
}
window.addEventListener('beforeunload', e => { if (dirty) { save(); e.preventDefault(); e.returnValue = ''; } });

// ---------- Werkzeuge ----------
function setTool(t) {
  if (cropState) exitCrop(true);
  if (editing) commitText();
  tool = t;
  body.dataset.tool = t;
  for (const b of document.querySelectorAll('#tools .tool')) b.classList.toggle('active', b.dataset.tool === t);
  if (t !== 'select') select(-1);
  if (t !== 'lasso') clearLasso();
}
$('tools').addEventListener('click', e => { const b = e.target.closest('.tool'); if (b) setTool(b.dataset.tool); });
function setBrush(v) {
  brushSize = clamp(Math.round(v), 2, 160);
  $('brushSize').value = brushSize; $('brushSizeVal').textContent = brushSize;
}
$('brushSize').addEventListener('input', () => setBrush(Number($('brushSize').value)));

// ---------- Layout / Zoom ----------
const PAD = 28;
function toPage(cx, cy) {
  const r = stage.getBoundingClientRect();
  return { x: (cx - r.left) / scale, y: L.top + (cy - r.top) / scale };
}
function layout() {
  if (!page || view !== 'page') return;
  const avail = Math.max(300, scroller.clientWidth - PAD * 2);
  const wpx = Math.round((L.mobile ? Math.min(avail, 430) : avail) * zoom);
  scale = wpx / LW();
  stage.style.width = wpx + 'px';
  stage.style.height = Math.round(pageH(L) * scale) + 'px';
  stage.style.setProperty('--s', scale);
  stage.style.setProperty('--top', L.top);
  stage.style.background = page.bg || BG;
  $('extTop').style.width = $('extBottom').style.width = wpx + 'px';
  stage.style.setProperty('--u', scale + 'px');
  stage.style.setProperty('--k', scale);
  updatePinVars();
  ovl.setAttribute('viewBox', `0 ${L.top} ${LW()} ${pageH(L)}`);
  layoutTiles(); renderHandles(); renderOverlay();
  if (cropState) cropState.refresh();
  $('zoomFit').textContent = Math.round(zoom * 100) + '%';
}
new ResizeObserver(() => layout()).observe(scroller);
// „Bildschirm" im Editor = sichtbarer Teil der weißen Seite (wie live: Seite beginnt am oberen Browserrand,
// endet am unteren). Der Erweitern-Balken und der dunkle Rand zählen nicht dazu.
function screenRect() {
  const sr = scroller.getBoundingClientRect(), st = stage.getBoundingClientRect();
  const top = Math.max(sr.top, st.top), bottom = Math.min(sr.top + scroller.clientHeight, st.bottom);
  return { top, bottom: Math.max(top + 1, bottom), height: Math.max(1, bottom - top) };
}
function updatePinVars() {
  const st = stage.getBoundingClientRect(), sc = screenRect();
  itemsEl.style.setProperty('--pinTop', sc.top + 'px');
  itemsEl.style.setProperty('--pinBottom', (innerHeight - sc.bottom) + 'px');
  itemsEl.style.setProperty('--pinLeft', st.left + 'px');
}
scroller.addEventListener('scroll', () => {
  updatePinVars();
  if (L && targets().some(i => L.items[i]?.pin)) renderHandles(); // Auswahlrahmen fixierter Elemente mitführen
});
window.addEventListener('resize', () => { if (page && view === 'page') updatePinVars(); });
function setZoom(z, cx, cy) {
  z = clamp(z, 0.25, 6);
  const sr = scroller.getBoundingClientRect();
  if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
  const r = stage.getBoundingClientRect();
  const px = (cx - r.left) / scale, py = (cy - r.top) / scale;
  zoom = z; layout();
  const r2 = stage.getBoundingClientRect();
  scroller.scrollLeft += r2.left + px * scale - cx;
  scroller.scrollTop += r2.top + py * scale - cy;
}
$('zoomIn').onclick = () => setZoom(zoom * 1.25);
$('zoomOut').onclick = () => setZoom(zoom / 1.25);
$('zoomFit').onclick = () => setZoom(1);
scroller.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
}, { passive: false });
// Leertaste halten + ziehen = Fläche schieben
scroller.addEventListener('pointerdown', e => {
  if (!spaceDown) return;
  e.preventDefault(); e.stopPropagation();
  const sx = e.clientX, sy = e.clientY, ox = scroller.scrollLeft, oy = scroller.scrollTop;
  const mv = ev => { scroller.scrollLeft = ox - (ev.clientX - sx); scroller.scrollTop = oy - (ev.clientY - sy); };
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}, true);

// ---------- Tinte: Kacheln ----------
const tiles = new Map(); // k -> {cv, ctx}
function tileRange() { return [Math.floor(L.top / TILE), Math.floor((L.bottom - 1) / TILE)]; }
function ensureTiles() {
  const [a, b] = tileRange();
  for (const k of [...tiles.keys()]) if (k < a || k > b) { tiles.get(k).cv.remove(); tiles.delete(k); }
  for (let k = a; k <= b; k++) {
    if (tiles.has(k)) continue;
    const cv = document.createElement('canvas');
    cv.width = LW(); cv.height = TILE;
    tilesEl.appendChild(cv);
    tiles.set(k, { cv, ctx: cv.getContext('2d', { willReadFrequently: false }) });
    renderTile(k);
  }
  layoutTiles();
}
function layoutTiles() {
  for (const [k, t] of tiles) { t.cv.style.top = (k * TILE - L.top) * scale + 'px'; t.cv.style.height = TILE * scale + 'px'; }
}
const bbCache = new WeakMap();
function sbox(s) {
  let b = bbCache.get(s.points);
  if (!b || b.size !== s.size) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of s.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const r = s.size / 2 + 4;
    b = { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r, size: s.size };
    bbCache.set(s.points, b);
  }
  return b;
}
function renderTile(k) {
  const t = tiles.get(k); if (!t) return;
  const c = t.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, LW(), TILE);
  c.setTransform(1, 0, 0, 1, 0, -k * TILE);
  const y0 = k * TILE, y1 = y0 + TILE;
  for (const s of L.strokes) {
    if (!s.points.length) continue;
    const b = sbox(s);
    if (b.maxY < y0 || b.minY > y1) continue;
    renderStroke(c, s);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}
function redrawRange(minY, maxY) {
  for (const k of tiles.keys()) {
    if ((k + 1) * TILE < minY || k * TILE > maxY) continue;
    renderTile(k); dirtyTiles.add(k);
  }
}
function redrawAllTiles() { for (const k of tiles.keys()) { renderTile(k); dirtyTiles.add(k); } }

// ---------- Pinsel-Rendering (aus Fotowebsite übernommen, deterministisch) ----------
const TAU = Math.PI * 2;
function hash2(x, y) { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); }
function radiusFor(p, size) { return size * (0.22 + 0.78 * clamp(p, 0, 1)) / 2; }
function wobble(x, y) { return Math.sin(x * 0.028 + y * 0.017) * 0.6 + Math.sin(x * 0.011 - y * 0.023) * 0.4; }
// --- Tinten-Stellschrauben ---
const WOBBLE_AMOUNT = 0.05;
const SPECK_CHANCE = 0.972;
const SPECK_ALPHA = 0.18;
function plainDab(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.4, r), 0, TAU); c.fill(); }
function inkDab(c, x, y, r, dir = 0) {
  r = Math.max(0.4, r) * (1 + WOBBLE_AMOUNT * wobble(x, y));
  c.globalAlpha = 0.93 + 0.07 * hash2(x * 0.7, y * 0.9);
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  if (r > 1.6 && hash2(x * 0.5, y * 0.5) > SPECK_CHANCE) {
    const side = hash2(y, x) > 0.5 ? 1 : -1;
    const off = r * (0.7 + 0.3 * hash2(x * 1.7, y));
    const nx = x + Math.cos(dir + Math.PI / 2) * off * side;
    const ny = y + Math.sin(dir + Math.PI / 2) * off * side;
    const len = r * (0.45 + 0.5 * hash2(nx, ny));
    const thick = r * (0.07 + 0.08 * hash2(ny, nx));
    c.globalAlpha = SPECK_ALPHA * (0.5 + 0.5 * hash2(nx * 0.3, ny * 0.3));
    c.save(); c.translate(nx, ny); c.rotate(dir);
    c.beginPath(); c.ellipse(0, 0, len, thick, 0, 0, TAU); c.fill();
    c.restore();
  }
  c.globalAlpha = 1;
}
function stampSegment(c, a, b, size, ink) {
  const fn = ink ? inkDab : plainDab;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy), dir = Math.atan2(dy, dx);
  const rA = radiusFor(a.p, size), rB = radiusFor(b.p, size);
  const spacing = Math.max(1, Math.min(rA, rB) * (ink ? 0.3 : 0.4));
  const steps = Math.max(1, Math.ceil(dist / spacing));
  for (let s = 1; s <= steps; s++) { const t = s / steps; fn(c, a.x + dx * t, a.y + dy * t, rA + (rB - rA) * t, dir); }
}
function strokeStyleFor(c, s) {
  c.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  c.fillStyle = s.color || INK;
}
function renderStroke(c, s) {
  c.save();
  strokeStyleFor(c, s);
  const ink = s.tool !== 'eraser';
  const pts = s.points;
  (ink ? inkDab : plainDab)(c, pts[0].x, pts[0].y, radiusFor(pts[0].p, s.size)); // erster Tupfer = wie live
  for (let i = 1; i < pts.length; i++) stampSegment(c, pts[i - 1], pts[i], s.size, ink);
  c.restore();
}
function stampLive(a, b, s, first) {
  const r = s.size;
  const minY = Math.min(a.y, b.y) - r, maxY = Math.max(a.y, b.y) + r;
  for (const [k, t] of tiles) {
    if ((k + 1) * TILE < minY || k * TILE > maxY) continue;
    const c = t.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, -k * TILE);
    strokeStyleFor(c, s);
    if (first) (s.tool === 'eraser' ? plainDab : inkDab)(c, a.x, a.y, radiusFor(a.p, s.size));
    else stampSegment(c, a, b, s.size, s.tool !== 'eraser');
    c.restore();
    dirtyTiles.add(k);
  }
}

// ---------- Zeichnen (Pointer + Druck) ----------
let drawing = null;
const hud = $('hud');
let penSeen = false, penMax = 0, hintShown = false;
function pointFromEvent(e) {
  const { x, y } = toPage(e.clientX, e.clientY);
  let p = e.pressure;
  if (e.pointerType === 'pen') {
    if (p == null || Number.isNaN(p)) p = 0.5;
    penSeen = true; penMax = Math.max(penMax, e.pressure || 0);
  } else p = 0.5;
  hud.textContent = `${e.pointerType || 'maus'} · Druck ${(e.pressure || 0).toFixed(2)}`;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, p: Math.round(p * 1000) / 1000 };
}
$('hintClose').onclick = () => { $('pressureHint').hidden = true; };

inputEl.addEventListener('pointerdown', e => {
  if (spaceDown || (e.pointerType === 'mouse' && e.button !== 0)) return;
  e.preventDefault();
  e.stopPropagation(); // sonst hebt der Leer-Klick-Handler der Fläche z. B. die neue Textbox gleich wieder auf
  if (tool === 'brush' || tool === 'eraser') {
    capture(inputEl, e);
    pushUndo();
    drawing = { tool, size: brushSize, points: [pointFromEvent(e)] };
    stampLive(drawing.points[0], drawing.points[0], drawing, true);
  } else if (tool === 'lasso') lassoDown(e);
  else if (tool === 'text') createText(toPage(e.clientX, e.clientY));
});
inputEl.addEventListener('pointermove', e => {
  if (lasso) return lassoMove(e);
  if (!drawing) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) {
    const pt = pointFromEvent(ev);
    const prev = drawing.points[drawing.points.length - 1];
    if (pt.x === prev.x && pt.y === prev.y) continue;
    stampLive(prev, pt, drawing, false);
    drawing.points.push(pt);
  }
});
function endStroke() {
  if (lasso) return lassoUp();
  if (!drawing) return;
  drawing.id = newId();
  L.strokes.push(drawing);
  drawing = null;
  markDirty();
  if (penSeen && penMax < 0.02 && !hintShown) { $('pressureHint').hidden = false; hintShown = true; }
}
inputEl.addEventListener('pointerup', endStroke);
inputEl.addEventListener('pointercancel', endStroke);

// ---------- Lasso (Striche auswählen / verschieben / skalieren) ----------
let lasso = null, lassoSel = [], selBox = null;
const HANDLE_HIT = 14;
const boxCorners = b => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function bboxOf(idx) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of idx) {
    const s = L.strokes[i], r = s.size / 2;
    for (const p of s.points) { minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r); maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r); }
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function renderOverlay() {
  if (!page) return;
  const u = 1 / scale;
  let h = '';
  if (lasso && lasso.type === 'draw' && lasso.points.length > 1) {
    h += `<polyline points="${lasso.points.map(p => `${p.x},${p.y}`).join(' ')}" fill="rgba(79,140,255,.08)" stroke="#4f8cff" stroke-width="1.5" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>`;
  }
  if (selBox) {
    h += `<rect x="${selBox.x}" y="${selBox.y}" width="${selBox.w}" height="${selBox.h}" fill="none" stroke="#4f8cff" stroke-width="1.5" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>`;
    const hs = 10 * u;
    for (const c of boxCorners(selBox)) h += `<rect x="${c.x - hs / 2}" y="${c.y - hs / 2}" width="${hs}" height="${hs}" fill="#fff" stroke="#4f8cff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  }
  ovl.innerHTML = h;
  const bar = $('lassoBar');
  bar.hidden = !(selBox && lassoSel.length && !lasso);
  if (!bar.hidden) { bar.style.left = (selBox.x + selBox.w) * scale + 'px'; bar.style.top = (selBox.y - L.top) * scale + 'px'; }
}
function clearLasso() { const had = lassoSel.length; lasso = null; lassoSel = []; selBox = null; renderOverlay(); if (had && page) renderInspector(); }
const clonePts = i => L.strokes[i].points.map(q => ({ ...q }));
function lassoDown(e) {
  capture(inputEl, e);
  const p = toPage(e.clientX, e.clientY);
  const hit = HANDLE_HIT / scale;
  if (selBox && lassoSel.length) {
    const cs = boxCorners(selBox);
    const ci = cs.findIndex(c => Math.hypot(c.x - p.x, c.y - p.y) < hit);
    if (ci >= 0) {
      pushUndo();
      const anchor = cs[(ci + 2) % 4];
      lasso = { type: 'resize', anchor, d0: Math.hypot(cs[ci].x - anchor.x, cs[ci].y - anchor.y) || 1,
        orig: lassoSel.map(clonePts), sizes: lassoSel.map(i => L.strokes[i].size), box0: { ...selBox } };
      return;
    }
    if (p.x >= selBox.x && p.x <= selBox.x + selBox.w && p.y >= selBox.y && p.y <= selBox.y + selBox.h) {
      pushUndo();
      lasso = { type: 'move', start: p, orig: lassoSel.map(clonePts), box0: { ...selBox }, last: { ...selBox } };
      return;
    }
  }
  clearLasso();
  lasso = { type: 'draw', points: [p] };
}
function lassoMove(e) {
  e.preventDefault();
  const p = toPage(e.clientX, e.clientY);
  if (lasso.type === 'draw') { lasso.points.push(p); renderOverlay(); return; }
  const prev = selBox;
  if (lasso.type === 'move') {
    const dx = p.x - lasso.start.x, dy = p.y - lasso.start.y;
    lassoSel.forEach((idx, k) => { L.strokes[idx].points = lasso.orig[k].map(q => ({ x: q.x + dx, y: q.y + dy, p: q.p })); });
    selBox = { ...lasso.box0, x: lasso.box0.x + dx, y: lasso.box0.y + dy };
  } else {
    const a = lasso.anchor;
    const s = Math.max(0.05, Math.hypot(p.x - a.x, p.y - a.y) / lasso.d0);
    lassoSel.forEach((idx, k) => {
      L.strokes[idx].points = lasso.orig[k].map(q => ({ x: a.x + (q.x - a.x) * s, y: a.y + (q.y - a.y) * s, p: q.p }));
      L.strokes[idx].size = Math.max(1, lasso.sizes[k] * s);
    });
    selBox = bboxOf(lassoSel);
  }
  redrawRange(Math.min(prev.y, selBox.y) - 10, Math.max(prev.y + prev.h, selBox.y + selBox.h) + 10);
  renderOverlay(); dirty = true;
}
function lassoUp() {
  if (lasso.type === 'draw' && lasso.points.length > 2) {
    const poly = lasso.points;
    lassoSel = [];
    L.strokes.forEach((s, i) => {
      if (s.tool === 'eraser' || !s.points.length) return;
      let n = 0; for (const pt of s.points) if (pointInPoly(pt.x, pt.y, poly)) n++;
      if (n > s.points.length * 0.5) lassoSel.push(i);
    });
    selBox = lassoSel.length ? bboxOf(lassoSel) : null;
  } else if (lasso.type !== 'draw') markDirty();
  lasso = null;
  renderOverlay();
  renderInspector();
}
function deleteLassoSel() {
  if (!lassoSel.length) return false;
  pushUndo();
  const b = selBox;
  const set = new Set(lassoSel);
  if (L.mobile) for (const i of lassoSel) { const src = L.strokes[i].src; if (src && !page.m.skip.includes(src)) page.m.skip.push(src); }
  L.strokes = L.strokes.filter((_, i) => !set.has(i));
  clearLasso();
  redrawRange(b.y - 10, b.y + b.h + 10);
  markDirty();
  return true;
}

// ---------- Elemente (Fotos, Videos, Text) ----------
// Element i liegt entweder auf der Seite (#items) oder – fixiert – in der Pin-Ebene (bleibt beim Scrollen stehen)
const itemEl = i => itemsEl.querySelector(`:scope > [data-i="${i}"]`);
const boxEl = el => (el && el.classList.contains('it-text') && el.firstElementChild) || el; // Text: innerer, skalierter Block
const rectOf = el => boxEl(el).getBoundingClientRect();
function renderItems() {
  itemsEl.innerHTML = L.items.map((it, i) => itemHTML(it, i, L, site, edOpt)).join('');
  paintDraws(); startRandoms();
  markProcessing();
  measureTexts();
  renderHandles();
}
function rerenderItem(i) {
  const old = itemEl(i); if (!old) return renderItems();
  const t = document.createElement('template');
  t.innerHTML = itemHTML(L.items[i], i, L, site, edOpt);
  old.replaceWith(t.content.firstChild);
  paintDraws(); startRandoms();
  markProcessing(); measureTexts(); renderHandles();
}
function syncItem(i) {
  const el = itemEl(i); if (!el) return;
  const q = posVarParts(L.items[i]);
  el.style.left = q.left; el.style.top = q.top || ''; el.style.bottom = q.bottom || ''; el.style.width = q.width;
  if (q.height) el.style.height = q.height;
}
function measureTexts() {
  if (!page || !scale) return;
  L.items.forEach((it, i) => {
    if (it.type !== 'text') return;
    const tx = boxEl(itemEl(i));
    if (tx && tx.offsetHeight) it.h = Math.round(tx.offsetHeight); // .tx ist in Einheiten gesetzt
  });
}
function itemBox(i) {
  const it = L.items[i];
  const h = it.type === 'text' ? (boxEl(itemEl(i))?.offsetHeight || it.h || 0) : it.h;
  return { x: it.x, y: it.y, w: it.w, h };
}
function select(i) {
  if (editing && editing.i !== i) commitText();
  if (cropState && i !== sel) exitCrop(true);
  sel = i; multi = [];
  renderHandles(); renderInspector(); updatePinBtn();
}
// Indizes aller gewählten Objekte (Mehrfach- oder Einzelauswahl)
const multiIdx = () => multi.map(o => L.items.indexOf(o)).filter(i => i >= 0).sort((a, b) => a - b);
const targets = () => (multi.length ? multiIdx() : sel >= 0 && L.items[sel] ? [sel] : []);
function setSelection(objs) {
  objs = objs.filter(o => L.items.includes(o));
  if (objs.length <= 1) return select(objs.length ? L.items.indexOf(objs[0]) : -1);
  if (editing) commitText();
  if (cropState) exitCrop(true);
  sel = -1; multi = objs;
  renderHandles(); renderInspector(); updatePinBtn();
}
function toggleInSelection(i) {
  const o = L.items[i];
  const cur = multi.length ? [...multi] : sel >= 0 ? [L.items[sel]] : [];
  const k = cur.indexOf(o);
  if (k >= 0) cur.splice(k, 1); else cur.push(o);
  setSelection(cur);
}
function updatePinBtn() {
  const t = targets(), all = t.length > 0 && t.every(i => L.items[i].pin);
  $('btnPin').disabled = !t.length;
  $('btnPin').classList.toggle('toggle', all);
  $('btnPin').classList.toggle('active', all);
}
function renderHandles() {
  handlesEl.innerHTML = '';
  if (page && multi.length && !cropState) {
    const st = stage.getBoundingClientRect();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const i of multiIdx()) {
      const el = itemEl(i); if (!el) continue;
      const r = rectOf(el);
      const b = document.createElement('div');
      b.className = 'selbox multi' + (L.items[i].pin ? ' pinned' : '');
      Object.assign(b.style, { left: r.left - st.left + 'px', top: r.top - st.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      handlesEl.appendChild(b);
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
    if (x1 < Infinity) {
      const g = document.createElement('div');
      g.className = 'selbox group';
      Object.assign(g.style, { left: x1 - st.left - 6 + 'px', top: y1 - st.top - 6 + 'px', width: x2 - x1 + 12 + 'px', height: y2 - y1 + 12 + 'px' });
      handlesEl.appendChild(g);
    }
    return;
  }
  if (!page || sel < 0 || !L.items[sel] || cropState) return;
  const it = L.items[sel], el = itemEl(sel);
  if (!el) return;
  const host = handlesEl;
  const r = rectOf(el), st = stage.getBoundingClientRect();
  const Lx = r.left - st.left, T = r.top - st.top, Wd = r.width, Hd = r.height;
  const box = document.createElement('div');
  box.className = 'selbox' + (it.pin ? ' pinned' : '');
  Object.assign(box.style, { left: Lx + 'px', top: T + 'px', width: Wd + 'px', height: Hd + 'px' });
  host.appendChild(box);
  const hs = it.type === 'text' ? [['w', 0, 0.5], ['e', 1, 0.5]] : [['nw', 0, 0], ['ne', 1, 0], ['se', 1, 1], ['sw', 0, 1]];
  for (const [c, fx, fy] of hs) {
    const h = document.createElement('div');
    h.className = 'handle ' + c; h.dataset.c = c;
    h.style.left = Lx + Wd * fx + 'px'; h.style.top = T + Hd * fy + 'px';
    host.appendChild(h);
  }
}

let drag = null;
// Drag-Start: bei unten fixierten Elementen wird intern in „Abstand von oben" gerechnet
function dragOrig(i) {
  const o = { ...L.items[i] };
  if (o.pin === 'b') {
    const hs = screenRect().height / scale, oh = o.type === 'text' ? itemBox(i).h : o.h;
    o.y = hs - o.y - oh; o._hs = hs; o._oh = oh;
  }
  return o;
}
const onItemDown = e => {
  if (tool !== 'select' || spaceDown || e.button !== 0) return;
  const el = e.target.closest('.it'); if (!el) return;
  const i = Number(el.dataset.i);
  if (editing && editing.i === i) return; // Klick in den Text = Cursor setzen
  e.preventDefault();
  if (editing) { commitText(); return; }
  if (e.shiftKey) { toggleInSelection(i); return; } // ⇧-Klick: zur Auswahl hinzufügen / entfernen
  if (multi.includes(L.items[i])) { // Teil der Mehrfachauswahl -> alle zusammen ziehen
    drag = { mode: 'multi', start: toPage(e.clientX, e.clientY), list: multiIdx().map(j => ({ j, o: dragOrig(j) })), moved: false };
    return;
  }
  select(i);
  drag = { mode: 'move', i, start: toPage(e.clientX, e.clientY), o: dragOrig(i), moved: false };
};
itemsEl.addEventListener('pointerdown', onItemDown);
const onItemDbl = e => {
  const el = e.target.closest('.it'); if (!el || tool !== 'select') return;
  const i = Number(el.dataset.i);
  if (L.items[i].type === 'text') startText(i);
  else if (L.items[i].type === 'draw') ungroupDraw();
  else if (L.items[i].type === 'random') return;
  else enterCrop();
};
itemsEl.addEventListener('dblclick', onItemDbl);
const onHandleDown = e => {
  const h = e.target.closest('.handle'); if (!h || sel < 0) return;
  e.preventDefault(); e.stopPropagation();
  drag = { mode: 'resize', c: h.dataset.c, i: sel, start: toPage(e.clientX, e.clientY), o: dragOrig(sel), moved: false };
};
handlesEl.addEventListener('pointerdown', onHandleDown);
window.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = toPage(e.clientX, e.clientY);
  const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!drag.moved) { if (Math.hypot(dx, dy) * scale < 3) return; drag.moved = true; pushUndo(); }
  if (drag.mode === 'multi') {
    for (const { j, o } of drag.list) {
      const it = L.items[j], ty = o.y + dy;
      it.x = Math.round(o.x + dx);
      it.y = Math.round(o.pin === 'b' ? o._hs - ty - (it.type === 'text' ? o._oh : it.h) : ty);
      syncItem(j);
    }
    renderHandles();
    return;
  }
  const it = L.items[drag.i], o = drag.o;
  if (drag.mode === 'move') {
    it.x = Math.round(o.x + dx); it.y = Math.round(o.y + dy);
  } else if (it.type === 'text') {
    if (drag.c === 'w') { const nw = Math.max(60, o.w - dx); it.x = Math.round(o.x + o.w - nw); it.w = Math.round(nw); }
    else it.w = Math.round(Math.max(60, o.w + dx));
  } else {
    const ar = o.w / o.h, c = drag.c;
    const fx = c.includes('w') ? o.x + o.w : o.x, fy = c.includes('n') ? o.y + o.h : o.y;
    const nw = Math.max(30, o.w + (c.includes('e') ? dx : -dx)), nh = nw / ar;
    it.w = Math.round(nw); it.h = Math.round(nh);
    it.x = Math.round(c.includes('w') ? fx - nw : fx);
    it.y = Math.round(c.includes('n') ? fy - nh : fy);
  }
  if (o.pin === 'b') it.y = Math.round(o._hs - it.y - (it.type === 'text' ? o._oh : it.h)); // zurück in „Abstand von unten"
  syncItem(drag.i);
  renderHandles();
  if (it.pin) showPinGuide(drag.i);
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.moved) { measureTexts(); renderHandles(); markDirty(); }
  hidePinGuide();
  drag = null;
});
// Klick ins Leere hebt die Auswahl auf
scroller.addEventListener('pointerdown', e => {
  if (tool !== 'select' || cropState || spaceDown) return;
  if (e.target.closest('.it, .handle, .extend') || e.shiftKey) return;
  if (editing) commitText();
  if (sel >= 0 || multi.length) select(-1);
});

// ---------- Text ----------
function createText(p) {
  const before = snapshot();
  const w = L.mobile ? MW - 140 : 1000;
  const it = { id: newId(), type: 'text', x: Math.round(L.mobile ? 70 : p.x), y: Math.round(p.y - 20), w, h: 60, text: '' };
  if (site.styles.some(s => s.id === lastStyle)) it.style = lastStyle;
  L.items.push(it);
  setTool('select');
  renderItems();
  select(L.items.length - 1);
  startText(L.items.length - 1, true, before);
}
function startText(i, isNew = false, before = null) {
  if (editing) commitText();
  const outer = itemEl(i); if (!outer) return;
  const el = boxEl(outer);
  editing = { i, isNew, before: before || snapshot() };
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.spellcheck = false;
  outer.classList.add('editing');
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  el.addEventListener('input', onTextInput);
  el.addEventListener('blur', commitText);
  el.addEventListener('paste', onTextPaste);
}
function onTextInput() { measureTexts(); renderHandles(); }
function onTextPaste(e) {
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
}
function commitText() {
  if (!editing) return;
  const { i, isNew, before } = editing;
  editing = null;
  const outer = itemEl(i), el = boxEl(outer);
  const it = L.items[i];
  let txt = '';
  if (el) {
    txt = el.innerText.replace(/\n$/, '');
    el.removeEventListener('input', onTextInput); el.removeEventListener('blur', commitText); el.removeEventListener('paste', onTextPaste);
    el.contentEditable = 'false'; outer.classList.remove('editing');
  }
  if (!it) return;
  if (!txt.trim()) {
    L.items.splice(i, 1);
    if (sel === i) sel = -1; else if (sel > i) sel--;
    if (!isNew) { undoStack.push(before); redoStack = []; }
  } else if (txt !== it.text || isNew) {
    it.text = txt; undoStack.push(before); redoStack = [];
  } else { renderHandles(); return; }
  updateHistory(); renderItems(); renderInspector(); markDirty();
}

// ---------- Fläche erweitern / kürzen ----------
function boundsChanged() { ensureTiles(); layout(); }
function extendDrag(which) {
  return e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY, o = { top: L.top, bottom: L.bottom };
    let moved = false;
    const mv = ev => {
      const d = (ev.clientY - y0) / scale;
      if (!moved && Math.abs(ev.clientY - y0) < 4) return;
      if (!moved) { moved = true; pushUndo(); }
      if (which === 'top') L.top = Math.round(Math.min(o.top - d, L.bottom - 300));
      else L.bottom = Math.round(Math.max(o.bottom + d, L.top + 300));
      boundsChanged();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (!moved) extend(which);
      else { markDirty(); renderInspector(); }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
}
function extend(which) {
  pushUndo();
  if (which === 'top') L.top -= SCREEN; else L.bottom += SCREEN;
  boundsChanged();
  if (which === 'top') scroller.scrollTop = 0;
  else scroller.scrollTop = scroller.scrollHeight;
  markDirty(); renderInspector();
}
$('extTop').addEventListener('pointerdown', extendDrag('top'));
$('extBottom').addEventListener('pointerdown', extendDrag('bottom'));
function contentBounds() {
  let minY = Infinity, maxY = -Infinity;
  L.items.forEach((it, i) => { if (it.pin) return; const b = itemBox(i); minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.h); });
  for (const s of L.strokes) if (s.points.length && s.tool !== 'eraser') { const b = sbox(s); minY = Math.min(minY, b.minY); maxY = Math.max(maxY, b.maxY); }
  return minY === Infinity ? null : { minY, maxY };
}
function trim(which) {
  const b = contentBounds(); if (!b) return setStatus('Seite ist leer');
  pushUndo();
  const M = 80;
  if (which === 'top') L.top = Math.round(Math.min(b.minY - M, L.bottom - 300));
  else L.bottom = Math.round(Math.max(b.maxY + M, L.top + 300));
  boundsChanged(); markDirty(); renderInspector();
}

// ---------- Zuschneiden (live auf der Fläche) ----------
let cropState = null;
const CROP_MIN = 40;
function innerFromGeom(box, full) {
  return `width:${full.w / box.w * 100}%;height:${full.h / box.h * 100}%;left:${(full.x - box.x) / box.w * 100}%;top:${(full.y - box.y) / box.h * 100}%`;
}
function tearDownCrop() { if (cropState) { cropState.layer.remove(); cropState = null; } }
function exitCrop(commit) {
  if (!cropState) return;
  const { it, full, box } = cropState;
  tearDownCrop();
  if (!commit) { if (undoStack.length) undoStack.pop(); updateHistory(); renderHandles(); renderInspector(); return; }
  const fr = { x: (box.x - full.x) / full.w, y: (box.y - full.y) / full.h, w: box.w / full.w, h: box.h / full.h };
  const isFull = fr.x < 0.002 && fr.y < 0.002 && fr.w > 0.998 && fr.h > 0.998;
  it.x = Math.round(box.x); it.y = Math.round(box.y); it.w = Math.round(box.w); it.h = Math.round(box.h);
  if (isFull) delete it.crop; else it.crop = fr;
  renderItems(); renderInspector(); markDirty();
}
function enterCrop() {
  if (sel < 0 || cropState) return;
  const it = L.items[sel];
  if (it.type === 'text' || it.type === 'draw' || it.type === 'random') return;
  if (it.pin) return setStatus('Zum Zuschneiden erst die Fixierung lösen', 'err');
  pushUndo();
  const c = it.crop || { x: 0, y: 0, w: 1, h: 1 };
  const full = { w: it.w / c.w, h: it.h / c.h };
  full.x = it.x - c.x * full.w; full.y = it.y - c.y * full.h;
  const box = { x: it.x, y: it.y, w: it.w, h: it.h };
  const mk = () => {
    const m = document.createElement(it.type === 'video' ? 'video' : 'img');
    m.src = mediaUrl(edOpt, page.id, it.src);
    if (it.type === 'video') { m.muted = true; m.loop = true; m.autoplay = true; m.playsInline = true; }
    return m;
  };
  const layer = document.createElement('div'); layer.className = 'crop-layer';
  const ghost = mk(); ghost.className = 'crop-ghost';
  const bright = document.createElement('div'); bright.className = 'crop-bright';
  const brightIn = mk(); bright.appendChild(brightIn);
  const frame = document.createElement('div'); frame.className = 'crop-frame';
  for (const cl of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) { const h = document.createElement('div'); h.className = 'ch ' + cl; h.dataset.c = cl; frame.appendChild(h); }
  layer.append(ghost, bright, frame);
  stage.appendChild(layer);
  const px = b => ({ left: b.x * scale + 'px', top: (b.y - L.top) * scale + 'px', width: b.w * scale + 'px', height: b.h * scale + 'px' });
  function refresh() {
    Object.assign(ghost.style, px(full)); Object.assign(bright.style, px(box)); Object.assign(frame.style, px(box));
    brightIn.style.cssText = innerFromGeom(box, full);
  }
  cropState = { layer, it, full, box, refresh };
  refresh(); renderHandles(); renderInspector();

  let d = null;
  layer.addEventListener('pointerdown', e => {
    if (!e.target.closest('.crop-frame')) { exitCrop(true); return; }
    e.preventDefault(); e.stopPropagation();
    capture(layer, e);
    d = { c: e.target.classList.contains('ch') ? e.target.dataset.c : null, start: toPage(e.clientX, e.clientY), o: { ...box } };
  });
  layer.addEventListener('pointermove', e => {
    if (!d) return;
    const p = toPage(e.clientX, e.clientY);
    const dx = p.x - d.start.x, dy = p.y - d.start.y, o = d.o, F = full;
    if (!d.c) {
      box.x = clamp(o.x + dx, F.x, F.x + F.w - o.w); box.y = clamp(o.y + dy, F.y, F.y + F.h - o.h);
    } else {
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      if (d.c.includes('w')) x1 = clamp(o.x + dx, F.x, x2 - CROP_MIN);
      if (d.c.includes('e')) x2 = clamp(x2 + dx, x1 + CROP_MIN, F.x + F.w);
      if (d.c.includes('n')) y1 = clamp(o.y + dy, F.y, y2 - CROP_MIN);
      if (d.c.includes('s')) y2 = clamp(y2 + dy, y1 + CROP_MIN, F.y + F.h);
      Object.assign(box, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
    refresh();
  });
  layer.addEventListener('pointerup', () => { d = null; });
}
const toggleCrop = () => (cropState ? exitCrop(true) : enterCrop());

// ---------- Fixieren (am Bildschirm verankern) ----------
// Element bleibt beim Umschalten genau dort, wo es gerade auf dem Bildschirm zu sehen ist.
function setPin(mode, { undo = true, quiet = false } = {}) {
  const idx = targets().filter(i => (L.items[i].pin || '') !== mode && itemEl(i));
  if (!idx.length) return;
  if (cropState) exitCrop(true);
  if (undo) pushUndo();
  const st = stage.getBoundingClientRect(), sc = screenRect(), vis = sc.height / scale;
  for (const i of idx) { // erst alle umrechnen (DOM unverändert), dann einmal neu zeichnen
    const it = L.items[i], r = rectOf(itemEl(i)), h = r.height / scale;
    if (!mode) { it.y = Math.round(L.top + (r.top - st.top) / scale); delete it.pin; }
    else {
      const top = clamp((r.top - sc.top) / scale, 0, Math.max(0, vis - h)); // außerhalb? -> in den Bildschirm holen
      it.pin = mode;
      it.y = Math.round(mode === 't' ? top : vis - top - h);
    }
  }
  renderItems(); renderInspector(); updatePinBtn(); markDirty();
  if (!quiet) setStatus(mode ? `Fixiert – bleibt beim Scrollen ${mode === 't' ? 'oben' : 'unten'} stehen` : 'Scrollt wieder mit der Seite', 'ok');
}

// ---------- Handschrift-Objekte (gruppierte Striche) ----------
// item {type:'draw', x,y,w,h, bw,bh (Größe beim Gruppieren), strokes (lokal, 0..bw/0..bh), v (Version), up (hochgeladene Version)}
const rasterCache = new Map(); // id -> {v, cv}
function drawRaster(it) {
  const c = rasterCache.get(it.id);
  if (c && c.v === it.v) return c.cv;
  const f = Math.min(2, 4096 / Math.max(it.bw, it.bh)); // doppelte Auflösung -> bleibt beim Vergrößern scharf
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(it.bw * f)); cv.height = Math.max(1, Math.round(it.bh * f));
  const ctx = cv.getContext('2d');
  ctx.setTransform(f, 0, 0, f, 0, 0);
  for (const s of it.strokes) if (s.points.length) renderStroke(ctx, s);
  rasterCache.set(it.id, { v: it.v, cv });
  return cv;
}
function paintDraws() {
  L.items.forEach((it, i) => {
    if (it.type !== 'draw') return;
    const cv = itemEl(i)?.querySelector('canvas'); if (!cv) return;
    const r = drawRaster(it);
    cv.width = r.width; cv.height = r.height;
    cv.getContext('2d').drawImage(r, 0, 0);
  });
}
const r1 = v => Math.round(v * 10) / 10;
function startRandoms() { /* im Editor nur Standbild – abgespielt wird in der Vorschau/live */ }
function groupLasso() {
  if (!lassoSel.length) return;
  const b0 = bboxOf(lassoSel);
  const bx = Math.floor(b0.x - 2), by = Math.floor(b0.y - 2);
  const bw = Math.ceil(b0.x + b0.w + 2) - bx, bh = Math.ceil(b0.y + b0.h + 2) - by;
  const selSet = new Set(lassoSel), first = Math.min(...lassoSel);
  const hits = s => { const q = sbox(s); return q.maxX > bx && q.minX < bx + bw && q.maxY > by && q.minY < by + bh; };
  // gewählte Striche + Radierer, die danach darüber radiert haben (sonst käme Wegradiertes zurück)
  const parts = L.strokes.filter((s, i) => selSet.has(i) || (s.tool === 'eraser' && i > first && hits(s)));
  pushUndo();
  const it = {
    id: newId(), type: 'draw', x: bx, y: by, w: bw, h: bh, bw, bh, v: newId(),
    strokes: parts.map(s => ({ tool: s.tool, size: s.size, ...(s.color ? { color: s.color } : {}), points: s.points.map(p => ({ x: r1(p.x - bx), y: r1(p.y - by), p: p.p })) })),
  };
  const ids = new Set(lassoSel.map(i => L.strokes[i].id).filter(Boolean));
  L.strokes = L.strokes.filter((_, i) => !selSet.has(i));
  L.items.push(it);
  // Desktop: gibt es schon ein Handy-Layout, ersetzen die Handy-Kopien dieser Striche durch das neue Objekt
  if (!L.mobile && page.m) {
    const copies = page.m.strokes.filter(s => ids.has(s.src));
    if (copies.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity;
      for (const c of copies) { const q = sbox(c); minX = Math.min(minX, q.minX); minY = Math.min(minY, q.minY); maxX = Math.max(maxX, q.maxX); }
      page.m.strokes = page.m.strokes.filter(s => !ids.has(s.src));
      const w = Math.round(maxX - minX);
      page.m.place.push({ ref: it.id, x: Math.round(minX), y: Math.round(minY), w, h: Math.round(w * bh / bw) });
    }
  }
  clearLasso();
  redrawRange(by - 20, by + bh + 20);
  setTool('select');
  renderItems(); select(L.items.length - 1); markDirty();
  setStatus('Handschrift ist jetzt ein Objekt – verschieben, skalieren, fixieren, verlinken', 'ok');
}
function ungroupDraw() {
  if (sel < 0 || L.items[sel].type !== 'draw') return;
  pushUndo(); // ein Undo-Schritt für Lösen + Auflösen
  if (L.items[sel].pin) setPin('', { undo: false, quiet: true }); // erst zurück auf die Seite
  const it = L.items[sel];
  const k = it.w / it.bw;
  const news = it.strokes.map(s => ({ ...s, id: newId(), size: Math.max(1, s.size * k),
    points: s.points.map(p => ({ x: r1(it.x + p.x * k), y: r1(it.y + p.y * k), p: p.p })) }));
  const start = L.strokes.length;
  L.strokes = [...L.strokes, ...news];
  L.items.splice(sel, 1);
  if (L.mobile && page.items.some(b => b.id === it.id) && !page.m.hide.includes(it.id)) page.m.hide.push(it.id);
  sel = -1;
  redrawRange(it.y - 20, it.y + it.h + 20);
  renderItems(); markDirty();
  // gleich als Lasso-Auswahl, damit man direkt weiterarbeiten (oder neu gruppieren) kann
  setTool('lasso');
  lassoSel = news.map((s, j) => start + j).filter(i => L.strokes[i].tool !== 'eraser');
  selBox = bboxOf(lassoSel);
  renderOverlay(); renderInspector();
  setStatus('In Striche aufgelöst – mit ⌘G wieder gruppieren', 'ok');
}

// Mess-Hilfe beim Verschieben fixierter Objekte: Abstand zur Bildschirmkante, an der das Objekt hängt
let guideTimer = null;
function hidePinGuide() { clearTimeout(guideTimer); $('pinGuide').hidden = true; }
function showPinGuide(i, autoHide = false) {
  const it = L.items[i], g = $('pinGuide'), el = itemEl(i);
  if (!it?.pin || !el) return hidePinGuide();
  const r = rectOf(el), sr = scroller.getBoundingClientRect(), st = stage.getBoundingClientRect();
  const top = it.pin === 't';
  const sc = screenRect(), edgeY = top ? sc.top : sc.bottom;
  const a = top ? edgeY : r.bottom, b = top ? r.top : edgeY; // Maßlinie von a nach b
  const x = r.left + Math.min(r.width / 2, 60);
  const left = Math.max(st.left, sr.left), right = Math.min(st.right, sr.left + scroller.clientWidth);
  Object.assign($('pgEdge').style, { left: left + 'px', width: Math.max(0, right - left) + 'px', top: edgeY + 'px' });
  Object.assign($('pgLine').style, { left: x + 'px', top: Math.min(a, b) + 'px', height: Math.abs(b - a) + 'px' });
  const pct = (it.y / LW() * 100).toFixed(1).replace('.', ',');
  $('pgLabel').innerHTML = `${top ? '↑' : '↓'} ${Math.round(it.y)} px <small>${pct} % der Breite</small>`;
  const short = Math.abs(b - a) < 34;
  Object.assign($('pgLabel').style, { left: x + 10 + 'px', top: (short ? (top ? Math.max(a, b) + 6 : Math.min(a, b) - 30) : (a + b) / 2 - 13) + 'px' });
  g.hidden = false;
  clearTimeout(guideTimer);
  if (autoHide) guideTimer = setTimeout(hidePinGuide, 1000);
}

// ---------- Element-Aktionen ----------
function deleteItem() {
  const objs = targets().map(i => L.items[i]);
  if (!objs.length) return;
  pushUndo();
  L.items = L.items.filter(o => !objs.includes(o));
  // Handy: nur ausblenden – am Desktop bleibt es
  for (const gone of objs) if (L.mobile && page.items.some(b => b.id === gone.id) && !page.m.hide.includes(gone.id)) page.m.hide.push(gone.id);
  sel = -1; multi = [];
  renderItems(); renderInspector(); renderMedia(); markDirty();
}
function duplicateItem() {
  const idx = targets();
  if (!idx.length) return;
  pushUndo();
  const copies = idx.map(i => {
    const copy = JSON.parse(JSON.stringify(L.items[i]));
    copy.x += 40; copy.y += copy.pin === 'b' ? -40 : 40; copy.id = newId();
    if (copy.type === 'draw') { delete copy.up; } // neue ID -> eigenes PNG
    return copy;
  });
  L.items.push(...copies);
  renderItems(); setSelection(copies); markDirty();
}
// Ebenen: alle Elemente (auch fixierte) teilen sich eine Reihenfolge – Index = Ebene (hinten -> vorne)
function reorder(front) { moveLayer(front ? Infinity : -Infinity); }
function moveLayer(d) {
  const objs = targets().map(i => L.items[i]);
  if (!objs.length) return;
  const isSel = o => objs.includes(o);
  let next;
  if (d === Infinity) next = [...L.items.filter(o => !isSel(o)), ...objs];
  else if (d === -Infinity) next = [...objs, ...L.items.filter(o => !isSel(o))];
  else { // jedes gewählte Objekt tauscht mit dem nächsten NICHT gewählten Nachbarn
    next = [...L.items];
    const order = d > 0 ? [...next.keys()].reverse() : [...next.keys()];
    for (const k of order) {
      const n = k + (d > 0 ? 1 : -1);
      if (n < 0 || n >= next.length || !isSel(next[k]) || isSel(next[n])) continue;
      [next[k], next[n]] = [next[n], next[k]];
    }
  }
  if (next.every((o, k) => o === L.items[k])) return setStatus(d > 0 ? 'Liegt schon ganz vorne' : 'Liegt schon ganz hinten');
  pushUndo();
  L.items = next;
  if (!multi.length) sel = L.items.indexOf(objs[0]);
  renderItems(); renderInspector(); markDirty();
}
function nudge(dx, dy) {
  const idx = targets();
  if (!idx.length) return;
  pushUndo('nudge');
  for (const i of idx) {
    const it = L.items[i]; it.x += dx; it.y += it.pin === 'b' ? -dy : dy; // unten fixiert: y zählt von unten
    syncItem(i);
  }
  renderHandles(); markDirty();
  if (idx.length === 1 && L.items[idx[0]].pin) showPinGuide(idx[0], true);
}

// ---------- Medien ----------
function viewCenter() {
  const sr = scroller.getBoundingClientRect();
  return toPage(sr.left + sr.width / 2, sr.top + sr.height / 2);
}
function mediaDims(src, kind) {
  return new Promise(res => {
    const url = mediaUrl(edOpt, page.id, src);
    if (kind === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => res({ w: v.videoWidth || 1920, h: v.videoHeight || 1080 });
      v.onerror = () => res({ w: 1920, h: 1080 });
      v.src = url;
    } else {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({ w: 1600, h: 1000 });
      im.src = url;
    }
  });
}
function placeMedia(src, kind, dims, at, extra = {}) {
  const ar = dims.w / dims.h || 1.5;
  let w = LW() * (L.mobile ? 0.86 : 0.4), h = w / ar;
  if (h > SCREEN * 0.75) { h = SCREEN * 0.75; w = h * ar; }
  const c = at || viewCenter();
  pushUndo();
  const it = { id: newId(), type: kind, src, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w: Math.round(w), h: Math.round(h), ...extra };
  if (kind === 'video' && !it.mode) it.mode = 'loop';
  L.items.push(it);
  setTool('select');
  renderItems(); select(L.items.length - 1); renderMedia(); markDirty();
}
async function placeFromLibrary(m, at) {
  const dims = await mediaDims(m.name, m.kind);
  placeMedia(m.name, m.kind, dims, at, m.kind === 'video' && m.poster ? { poster: m.poster } : {});
}
function uploadFile(file) {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?id=${encodeURIComponent(page.id)}&name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = ev => { if (ev.lengthComputable) setStatus(`Lade ${file.name} … ${Math.round(ev.loaded / ev.total * 100)} %`, '', true); };
    xhr.onload = () => {
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200 || j.error) { setStatus(`${file.name}: ${j.error || 'Upload fehlgeschlagen'}`, 'err'); resolve(null); }
      else resolve(j);
    };
    xhr.onerror = () => { setStatus('Upload fehlgeschlagen', 'err'); resolve(null); };
    xhr.send(file);
  });
}
async function handleFiles(files, at) {
  const pid = page.id;
  let off = 0, ok = 0;
  for (const f of files) {
    const r = await uploadFile(f);
    if (!r || !page || page.id !== pid) continue;
    ok++;
    if (r.job) watching.add(r.job);
    let dims = { w: r.w, h: r.h };
    if (!r.w || !r.h) dims = r.job ? { w: 1920, h: 1080 } : await mediaDims(r.name, r.kind);
    const pos = at ? { x: at.x + off, y: at.y + off } : null; off += 60;
    if (r.job) await pollJobs(); // „wird optimiert"-Markierung sofort zeigen
    placeMedia(r.name, r.kind, dims, pos, r.kind === 'video' && r.poster ? { poster: r.poster } : {});
  }
  if (ok) setStatus(watching.size ? 'Hochgeladen – Video wird optimiert…' : 'Hochgeladen ✓', 'ok');
  await refreshMedia();
}
async function refreshMedia() {
  if (!page) return;
  try { media = (await api('/api/media?id=' + encodeURIComponent(page.id))).media; } catch {}
  renderMedia();
}
const fmtSize = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
function renderMedia() {
  if (!page) return;
  const placed = new Set(L.items.map(i => i.src));
  const running = jobs.filter(j => j.page === page.id && (j.status === 'läuft' || j.status === 'wartet'));
  const failed = jobs.filter(j => j.page === page.id && j.status === 'fehler');
  let h = running.map(j => `<div class="media-item"><div class="badge">⏳ ${esc(j.name)} · ${j.status === 'wartet' ? 'wartet' : Math.round(j.progress * 100) + ' %'}</div></div>`).join('');
  h += failed.map(j => `<div class="media-item"><div class="badge err">✕ ${esc(j.name)}: ${esc(j.error || 'Fehler')}</div></div>`).join('');
  h += media.map((m, i) => {
    const url = edMedia(page.id, m.name);
    const thumb = m.kind === 'video'
      ? (m.poster ? `<img src="${esc(edMedia(page.id, m.poster))}" alt="">` : `<video src="${esc(url)}#t=0.5" muted preload="metadata"></video>`)
      : `<img src="${esc(url)}" alt="" loading="lazy">`;
    const big = m.size > 95 * 1048576;
    return `<div class="media-item${placed.has(m.name) ? ' placed' : ''}" draggable="true" data-m="${i}" title="${esc(m.name)}">${thumb}` +
      `<div class="badge${big ? ' warn' : ''}">${m.kind === 'video' ? '▶ ' : ''}${big ? '⚠ zu groß für GitHub · ' : ''}${fmtSize(m.size)}</div></div>`;
  }).join('');
  if (!h) h = '<div class="note" style="grid-column:1/-1">Noch keine Medien. Einfach Dateien auf die Fläche ziehen.</div>';
  mediaGrid.innerHTML = h;
}
mediaGrid.addEventListener('click', e => {
  const el = e.target.closest('[data-m]'); if (!el) return;
  placeFromLibrary(media[Number(el.dataset.m)]);
});
mediaGrid.addEventListener('dragstart', e => {
  const el = e.target.closest('[data-m]'); if (!el) return;
  e.dataTransfer.setData('application/x-media', el.dataset.m);
  e.dataTransfer.effectAllowed = 'copy';
});
mediaGrid.addEventListener('contextmenu', e => {
  const el = e.target.closest('[data-m]'); if (!el) return;
  e.preventDefault();
  const m = media[Number(el.dataset.m)];
  showMenu(e.clientX, e.clientY, [
    { label: 'Platzieren', fn: () => placeFromLibrary(m) },
    '-',
    { label: 'Datei aus dem Ordner löschen', danger: true, fn: async () => {
      if (L.items.some(it => it.src === m.name) && !confirm(`${m.name} wird auf dieser Seite noch benutzt. Trotzdem löschen?`)) return;
      await postJSON('/api/media-delete', { id: page.id, name: m.name });
      refreshMedia();
    } },
  ]);
});
$('btnPin').onclick = e => {
  const t = targets();
  if (!t.length) return setStatus('Erst ein Objekt anklicken, dann fixieren', 'err');
  const pins = new Set(t.map(i => L.items[i].pin || ''));
  const r = e.currentTarget.getBoundingClientRect(), cur = pins.size === 1 ? [...pins][0] : null;
  showMenu(r.left, r.bottom + 4, [
    { label: (cur === 't' ? '✓ ' : '') + '📌 Oben am Bildschirm fixieren', fn: () => setPin('t') },
    { label: (cur === 'b' ? '✓ ' : '') + '📌 Unten am Bildschirm fixieren', fn: () => setPin('b') },
    { label: (cur === '' ? '✓ ' : '') + 'Scrollt mit der Seite', fn: () => setPin('') },
  ]);
};
$('btnMedia').onclick = $('btnMedia2').onclick = () => $('fileInput').click();
$('fileInput').addEventListener('change', async () => {
  const files = [...$('fileInput').files];
  $('fileInput').value = '';
  if (files.length) await handleFiles(files, null);
});
// Zufallsschnitt platzieren: vorhandenen Clip-Ordner der Seite wählen oder einen Ordner hochladen
const clipDirInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
clipDirInput.setAttribute('webkitdirectory', '');
document.body.appendChild(clipDirInput);
clipDirInput.addEventListener('change', async () => {
  const files = [...clipDirInput.files].filter(f => /\.(mp4|webm)$/i.test(f.name));
  clipDirInput.value = '';
  if (!files.length) return setStatus('Im Ordner sind keine MP4/WebM-Clips', 'err');
  const dir = (files[0].webkitRelativePath || 'clips/').split('/')[0];
  let n = 0;
  for (const f of files) {
    setStatus(`Lade Clip ${++n}/${files.length} …`, '', true);
    try { await api(`/api/clip-upload?id=${encodeURIComponent(page.id)}&dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }); }
    catch (e) { setStatus(e.message, 'err'); }
  }
  const d = (await api('/api/clipdirs?id=' + encodeURIComponent(page.id))).dirs.find(x => x.dir.toLowerCase() === dir.replace(/[^a-z0-9\-_]/gi, '_').replace(/_+/g, '_').toLowerCase());
  if (d) placeRandom(d);
});
function placeRandom(d) {
  const ar = (d.w / d.h) || 16 / 9;
  let w = LW() * (L.mobile ? 0.86 : 0.45), h = w / ar;
  const c = viewCenter();
  pushUndo();
  L.items.push({ id: newId(), type: 'random', dir: d.dir, clips: d.clips, ...(d.poster ? { poster: d.poster } : {}),
    x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w: Math.round(w), h: Math.round(h) });
  setTool('select');
  renderItems(); select(L.items.length - 1); markDirty();
  setStatus(`Zufallsschnitt aus ${d.clips.length} Clips platziert`, 'ok');
}
$('btnRandom').onclick = async e => {
  const r = e.currentTarget.getBoundingClientRect();
  let dirs = [];
  try { dirs = (await api('/api/clipdirs?id=' + encodeURIComponent(page.id))).dirs; } catch {}
  showMenu(r.left, r.bottom + 4, [
    ...dirs.map(d => ({ label: `🎲 ${d.dir}  ·  ${d.clips.length} Clips`, fn: () => placeRandom(d) })),
    ...(dirs.length ? ['-'] : []),
    { label: '📁 Ordner mit Clips hochladen…', fn: () => clipDirInput.click() },
  ]);
};
$('btnVideoUrl').onclick = () => {
  const url = prompt('Video-URL (MP4, z. B. von Cloudflare R2 oder Bunny):', 'https://');
  if (!url || !/^https?:\/\/.+/i.test(url)) return;
  placeMedia(url.trim(), 'video', { w: 1920, h: 1080 }, null);
};
// Drag & Drop auf die Fläche
let dragDepth = 0;
const isMediaDrag = e => [...e.dataTransfer.types].some(t => t === 'Files' || t === 'application/x-media');
pageView.addEventListener('dragenter', e => { if (isMediaDrag(e)) { dragDepth++; body.classList.add('dragging-files'); } });
pageView.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; body.classList.remove('dragging-files'); } });
pageView.addEventListener('dragover', e => { if (isMediaDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
pageView.addEventListener('drop', e => {
  if (!isMediaDrag(e)) return;
  e.preventDefault();
  dragDepth = 0; body.classList.remove('dragging-files');
  const at = toPage(e.clientX, e.clientY);
  const lib = e.dataTransfer.getData('application/x-media');
  if (lib !== '') return placeFromLibrary(media[Number(lib)], at);
  const all = [...e.dataTransfer.files];
  const fontFiles = all.filter(isFontFile);
  const files = all.filter(f => !isFontFile(f));
  if (fontFiles.length) uploadFonts(fontFiles);
  if (files.length) handleFiles(files, at);
});

// Video-Umwandlung beobachten
let jobs = [], jobTimer = null;
const watching = new Set();
async function pollJobs() {
  clearTimeout(jobTimer);
  try { jobs = (await api('/api/jobs')).jobs; } catch { return; }
  let finished = false;
  for (const id of [...watching]) {
    const j = jobs.find(x => x.id === id);
    if (!j || j.status === 'fertig' || j.status === 'fehler') {
      watching.delete(id); finished = true;
      if (!j) continue;
      if (j.status === 'fehler') setStatus(`Video ${j.name}: ${j.error}`, 'err', true);
      else if (j.warn) setStatus(j.warn, 'err', true);
      else setStatus(`Video ${j.name} fertig ✓`, 'ok');
    }
  }
  if (finished && page && view === 'page') { renderItems(); await refreshMedia(); }
  else { markProcessing(); renderMedia(); }
  if (jobs.some(j => j.status === 'läuft' || j.status === 'wartet')) jobTimer = setTimeout(pollJobs, 1000);
}
function markProcessing() {
  if (!page) return;
  const names = new Set(jobs.filter(j => j.page === page.id && (j.status === 'läuft' || j.status === 'wartet')).map(j => j.name));
  L.items.forEach((it, i) => { if (it.type === 'video') itemEl(i)?.classList.toggle('processing', names.has(it.src)); });
}

// ---------- Schriften ----------
const WEIGHT_NAMES = { 100: 'Hauchdünn', 200: 'Extraleicht', 300: 'Leicht', 400: 'Normal', 500: 'Medium', 600: 'Halbfett', 700: 'Fett', 800: 'Extrafett', 900: 'Schwarz' };
const isFontFile = f => /\.(ttf|otf|woff2?|zip)$/i.test(f.name);
const fontFamilies = () => [...new Set(fonts.map(f => f.family))];
function weightsFor(fam) {
  const fs = fonts.filter(f => f.family === fam);
  if (!fs.length) return [300, 400, 500, 600, 700, 800]; // Systemschrift
  const set = new Set();
  for (const f of fs) {
    if (f.variable) for (let w = 100; w <= 900; w += 100) { if (w >= f.wmin && w <= f.wmax) set.add(w); }
    else set.add(f.weight);
  }
  return [...set].sort((a, b) => a - b);
}
function famSummary(fam) {
  const fs = fonts.filter(f => f.family === fam);
  if (fs.some(f => f.variable)) return 'variabel ' + Math.min(...fs.map(f => f.wmin)) + '–' + Math.max(...fs.map(f => f.wmax)) + (fs.some(f => f.style === 'italic') ? ' + kursiv' : '');
  return fs.length + (fs.length === 1 ? ' Schnitt' : ' Schnitte');
}
function fontsSection() {
  const fams = fontFamilies();
  return `<div class="sec"><h4>Schriften</h4>
    ${fams.map(f => `<div class="style-row"><span style="font-family:${esc(JSON.stringify(f))},sans-serif;font-size:15px">${esc(f)}</span><small class="note" style="margin:0">${esc(famSummary(f))}</small><button data-act="fontDel" data-fam="${esc(f)}" class="danger" title="Schrift entfernen">×</button></div>`).join('') || '<div class="note">Noch keine eigenen Schriften – es gibt Sans, Serif & Mono.</div>'}
    <div class="btns" style="margin-top:6px"><button data-act="fontAdd">＋ Schrift hinzufügen</button></div>
    <div class="note">Oder Schriftdatei / ZIP (z. B. von Google Fonts) einfach auf den Editor ziehen. Achte darauf, dass die Lizenz die Nutzung im Web erlaubt.</div>
  </div>`;
}
function applyFonts(list) {
  fonts = list;
  $('fontFaces').textContent = fontFaceCSS(fonts, '/');
  if (page && view === 'page') { renderItems(); renderInspector(); }
  document.fonts.ready.then(() => { if (page && view === 'page') { measureTexts(); renderHandles(); } });
}
function reportFonts(r) {
  if (r.added.length) setStatus(`Schrift hinzugefügt: ${r.added.join(', ')}`, 'ok');
  else setStatus(r.skipped.length ? `Nichts Neues: ${r.skipped.slice(0, 3).join(', ')}` : 'Keine Schrift gefunden', 'err');
}
async function uploadFonts(files) {
  for (const f of files) {
    setStatus(`Lade Schrift ${f.name} …`, '', true);
    try {
      const r = await api('/api/font?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
      applyFonts(r.fonts); reportFonts(r);
    } catch (e) { setStatus(e.message, 'err'); }
  }
}
const fontInput = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.ttf,.otf,.woff,.woff2,.zip', hidden: true });
document.body.appendChild(fontInput);
fontInput.addEventListener('change', () => { const fs = [...fontInput.files]; fontInput.value = ''; if (fs.length) uploadFonts(fs); });
// Menü: Datei wählen oder direkt eine auf dem Mac installierte Schrift übernehmen
async function fontAddMenu(x, y) {
  let fams = [];
  try { fams = (await api('/api/system-fonts')).families.filter(f => !f.imported); } catch {}
  showMenu(x, y, [
    { label: '📁 Schriftdatei oder ZIP wählen…', fn: () => fontInput.click() },
    ...(fams.length ? ['-', { label: 'Auf deinem Mac installiert:', fn: () => {}, disabled: true },
      ...fams.map(f => ({ label: `＋ ${f.family}  ·  ${f.variable ? 'variabel' : f.count + (f.count === 1 ? ' Schnitt' : ' Schnitte')}`, font: f.family, fn: async () => {
        setStatus(`Übernehme ${f.family} …`, '', true);
        try { const r = await postJSON('/api/font-import', { family: f.family }); applyFonts(r.fonts); reportFonts(r); }
        catch (e) { setStatus(e.message, 'err'); }
      } }))] : []),
  ]);
}

// ---------- Inspector (rechte Leiste) ----------
const optionList = (arr, cur) => arr.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
function incomingLinks(id) {
  const out = [];
  for (const p of allPages.values()) if (p.id !== id && p.items.some(it => it.link === id)) out.push(p);
  return out;
}
function renderInspector() {
  if (view === 'graph') return graphPanel();
  if (!page) return;
  const it = sel >= 0 ? L.items[sel] : null;
  insp.innerHTML = multi.length ? multiPanel() : it ? itemPanel(it) : lassoSel.length ? lassoPanel() : pagePanel();
}
function mobileSection() {
  const pd = mobilePending();
  return `<div class="sec mobile-sec"><h4>📱 Handy-Layout</h4>
    ${pd.items.length ? `<div class="note"><b>Neu am Desktop – noch nicht auf dem Handy:</b></div><div class="linklist">${pd.items.map(b => `<a data-act="mPlace" data-id="${esc(b.id)}">＋ ${esc(itemLabel(b))}</a>`).join('')}</div>` : ''}
    ${pd.strokes.length ? `<div class="btns" style="margin:6px 0"><button data-act="mAdopt">✎ ${pd.strokes.length} neue Striche vom Desktop übernehmen</button></div>` : ''}
    ${pd.hidden.length ? `<div class="note" style="margin-top:8px">Nur am Desktop (ausgeblendet):</div><div class="linklist">${pd.hidden.map(b => `<a data-act="mPlace" data-id="${esc(b.id)}">↺ ${esc(itemLabel(b))}</a>`).join('')}</div>` : ''}
    ${!pd.items.length && !pd.strokes.length ? '<div class="note">Alles vom Desktop ist eingeplant.</div>' : ''}
    <div class="btns" style="margin-top:8px"><button data-act="mAuto">↻ Automatisch neu anordnen</button></div>
    <div class="note">Position, Größe, Ausschnitt & Reihenfolge gelten nur fürs Handy. Text, Stil & Links sind geteilt. 🗑 blendet nur auf dem Handy aus. Neu Gemaltes & neu Platziertes hier gibt es nur auf dem Handy.</div>
  </div>`;
}
function multiPanel() {
  const objs = multiIdx().map(i => L.items[i]);
  const pins = new Set(objs.map(o => o.pin || ''));
  const same = pins.size === 1 ? [...pins][0] : null;
  const pinBtn = (v, t) => `<button data-act="pin" data-v="${v}" class="${same === v ? 'active' : ''}">${t}</button>`;
  return `<div class="sec"><h4>${objs.length} Objekte ausgewählt</h4>
    <div class="btns layer-btns">
      <button data-act="layer" data-d="-inf" title="Ganz nach hinten (⌘⇧[)">⤓</button>
      <button data-act="layer" data-d="-1" title="Eine Ebene zurück (⌘[)">↓ zurück</button>
      <button data-act="layer" data-d="1" title="Eine Ebene vor (⌘])">↑ vor</button>
      <button data-act="layer" data-d="inf" title="Ganz nach vorne (⌘⇧])">⤒</button>
    </div><div class="btns" style="margin-top:6px">
      <button data-act="dup" title="Duplizieren (⌘D)">⧉ Duplizieren</button>
      <button data-act="del" class="danger" title="${L.mobile ? 'Nur auf dem Handy ausblenden' : 'Löschen'} (Entf)">🗑 ${L.mobile ? 'Ausblenden' : 'Löschen'}</button></div></div>
  <div class="sec"><h4>📌 Beim Scrollen</h4><div class="seg">${pinBtn('', 'scrollt mit')}${pinBtn('t', 'oben fixiert')}${pinBtn('b', 'unten fixiert')}</div>
    ${same === null ? '<div class="note">Gemischt – ein Klick stellt alle gleich ein.</div>' : ''}</div>
  <div class="note">⇧-Klick: hinzufügen / entfernen · Ziehen: alle zusammen bewegen · Pfeiltasten: verschieben · ⌘A: alles · Esc: aufheben</div>`;
}
function lassoPanel() {
  return `<div class="sec"><h4>Handschrift-Auswahl · ${lassoSel.length} ${lassoSel.length === 1 ? 'Strich' : 'Striche'}</h4>
    <div class="btns"><button data-act="group" class="primary">▣ Als Objekt gruppieren (⌘G)</button></div>
    <div class="note">Macht aus der Auswahl ein festes Objekt: verschieben, skalieren, Ebenen, fixieren & verlinken wie ein Foto. Später mit „In Striche auflösen" wieder bearbeitbar.</div>
    <div class="btns"><button data-act="lassoDel" class="danger">🗑 Auswahl löschen</button></div>
    <div class="note">Auswahl ziehen = verschieben · Ecken = skalieren · Esc = aufheben</div></div>`;
}
function pagePanel() {
  const isIndex = page.id === 'index';
  const inc = incomingLinks(page.id);
  const screens = (pageH(L) / SCREEN).toFixed(1).replace('.', ',');
  return `${L.mobile ? mobileSection() : ''}
  <div class="sec"><h4>${isIndex ? '★ Startseite' : 'Projektseite'}</h4>
    <div class="row"><label>Titel</label><input type="text" data-page="title" value="${esc(page.title)}"></div>
    ${isIndex ? `<div class="row"><label>Website-Name</label><input type="text" data-site="title" value="${esc(site.title)}"></div>` : `
    <div class="row"><label>Adresse</label><span style="flex:1;overflow:hidden;text-overflow:ellipsis">/${esc(page.id)}.html</span><button data-act="renamePage">ändern</button></div>
    <div class="row"><label>Zurück-Knopf</label><button data-act="toggleBack" class="toggle${page.back ? ' active' : ''}">${page.back ? 'an' : 'aus'}</button></div>`}
    <div class="row"><label>Hintergrund</label><input type="color" data-page="bg" value="${esc(page.bg || BG)}"><button data-act="bgReset">Standard</button></div>
  </div>
  <div class="sec"><h4>Fläche · ${screens} Bildschirme hoch</h4>
    <div class="btns"><button data-act="extTop">▲ + oben</button><button data-act="extBottom">▼ + unten</button></div>
    <div class="btns" style="margin-top:6px"><button data-act="trimTop">Leerraum oben kürzen</button><button data-act="trimBottom">… unten</button></div>
    <div class="note">Neues kommt nach oben: „▲ Fläche oben erweitern" über der Seite klicken oder ziehen.</div>
  </div>
  ${isIndex ? '' : `<div class="sec"><h4>Verlinkt von</h4><div class="linklist">${inc.length ? inc.map(p => `<a data-act="open" data-id="${esc(p.id)}">← ${esc(p.title || p.id)}</a>`).join('') : '<div class="note">Noch nichts verlinkt hierher. Element auf einer anderen Seite wählen → „Link".</div>'}</div></div>`}
  ${fontsSection()}
  <div class="sec"><h4>Textstile</h4>
    ${site.styles.map(s => `<div class="style-row"><span>${esc(s.name)}</span><button data-act="styleRename" data-id="${esc(s.id)}">umbenennen</button><button data-act="styleDelete" data-id="${esc(s.id)}" class="danger">×</button></div>`).join('') || '<div class="note">Noch keine Stile.</div>'}
    <div class="note">Stile legst du an, indem du eine Textbox gestaltest und „Als neuen Stil speichern" wählst.</div>
  </div>
  ${isIndex ? '' : '<div class="sec"><button class="danger wide" data-act="deletePage">Seite löschen</button></div>'}
  <div class="note">⇧-Klick Mehrfachauswahl · ⌘A alles · ⌘G Handschrift gruppieren · M Desktop/Handy · V Auswählen · B Pinsel · E Radierer · L Lasso · T Text · K Zuschneiden · ⌘D Duplizieren · Leertaste+Ziehen = schieben · ⌘+Scroll = Zoom · G Übersicht</div>`;
}
const isUrl = v => /^https?:\/\//i.test(v || '');
function linkSection(it) {
  const opts = [['', '— kein Link —'], ...pages.filter(p => p.id !== page.id).map(p => [p.id, (p.id === 'index' ? '★ ' : '→ ') + (p.title || p.id)]),
    ...(isUrl(it.link) ? [[it.link, '🌐 ' + it.link.replace(/^https?:\/\//i, '').replace(/\/$/, '')]] : []),
    ['__new', '＋ Neue Projektseite…'], ['__url', '🌐 Externe Webseite…']];
  return `<div class="sec"><h4>🔗 Link</h4>
    <div class="row"><select data-change="link" style="flex:1">${optionList(opts, it.link || '')}</select></div>
    ${it.link ? `<div class="btns"><button data-act="openLink">${isUrl(it.link) ? 'Webseite öffnen ↗' : 'Seite öffnen →'}</button></div>${isUrl(it.link) ? '<div class="note">Öffnet sich live in einem neuen Tab.</div>' : ''}`
      : '<div class="note">Macht das Element klickbar – zu einer (neuen) Projektseite oder einer externen Webseite.</div>'}
  </div>`;
}
function itemPanel(it) {
  const label = { image: 'Foto', video: 'Video', text: 'Textbox', draw: 'Handschrift-Objekt', random: 'Zufallsschnitt' }[it.type] || 'Element';
  let h = `<div class="sec"><h4>${label} · Ebene ${sel + 1} von ${L.items.length}</h4>
    <div class="btns layer-btns">
      <button data-act="layer" data-d="-inf" title="Ganz nach hinten (⌘⇧[)">⤓</button>
      <button data-act="layer" data-d="-1" title="Eine Ebene zurück (⌘[)">↓ zurück</button>
      <button data-act="layer" data-d="1" title="Eine Ebene vor (⌘])">↑ vor</button>
      <button data-act="layer" data-d="inf" title="Ganz nach vorne (⌘⇧])">⤒</button>
    </div><div class="btns" style="margin-top:6px">
      <button data-act="dup" title="Duplizieren (⌘D)">⧉ Duplizieren</button><button data-act="del" class="danger" title="${L.mobile ? 'Nur auf dem Handy ausblenden (Entf)' : 'Entfernen (Entf)'}">🗑</button></div>${L.mobile ? `<div class="note">📱 ${page.items.some(b => b.id === it.id) ? 'Platz & Größe nur fürs Handy · Inhalt geteilt' : 'Nur auf dem Handy'}</div>` : ''}</div>`;
  h += `<div class="sec"><h4>📌 Beim Scrollen</h4><div class="seg">
      <button data-act="pin" data-v="" class="${!it.pin ? 'active' : ''}">scrollt mit</button>
      <button data-act="pin" data-v="t" class="${it.pin === 't' ? 'active' : ''}">oben fixiert</button>
      <button data-act="pin" data-v="b" class="${it.pin === 'b' ? 'active' : ''}">unten fixiert</button></div>
      <div class="note">${it.pin ? `Bleibt am Bildschirm stehen (Abstand zur ${it.pin === 't' ? 'Oberkante' : 'Unterkante'}). Mit den Ebenen-Knöpfen oben legst du fest, was davor oder dahinter liegt.${L.mobile ? '' : ' Fürs Handy separat einstellbar.'}` : 'Fixierte Elemente bleiben stehen, während die Seite darunter scrollt – z. B. Logo oder Kontakt.'}</div></div>`;
  if (it.type === 'text') h += textPanel(it);
  else if (it.type === 'random') {
    h += `<div class="sec"><h4>🎲 Zufallsschnitt</h4>
      <div class="note">${(it.clips || []).length} Clips aus dem Ordner „${esc(it.dir)}". Jeder Clip läuft 0,7–4 s, in zufälliger Reihenfolge – live bei jedem Besuch neu. Spielt nur, solange er im Bild ist (stumm).</div>
      <div class="btns"><button data-act="rcReload">↻ Clips neu einlesen</button></div></div>`;
  } else if (it.type === 'draw') {
    h += `<div class="sec"><h4>Handschrift</h4><div class="btns"><button data-act="ungroup">✎ In Striche auflösen (⌘⇧G)</button></div>
      <div class="note">Zum Weitermalen oder Radieren auflösen, danach mit dem Lasso wieder gruppieren.</div></div>`;
  } else {
    h += `<div class="sec"><h4>Ausschnitt</h4><div class="btns"><button data-act="crop" class="${cropState ? 'toggle active' : ''}">✂ Zuschneiden (K)</button>${it.crop ? '<button data-act="uncrop">ganzes Bild</button>' : ''}</div></div>`;
    if (it.type === 'video') {
      h += `<div class="sec"><h4>Wiedergabe</h4><div class="seg">
        <button data-act="mode" data-v="loop" class="${!['player', 'scene'].includes(it.mode) ? 'active' : ''}">Loop · stumm</button>
        <button data-act="mode" data-v="scene" class="${it.mode === 'scene' ? 'active' : ''}">Szene · Ton</button>
        <button data-act="mode" data-v="player" class="${it.mode === 'player' ? 'active' : ''}">Player</button></div>
        <div class="note">${{
          player: 'Besucher starten das Video selbst (mit Ton & Steuerung).',
          scene: 'Startet, sobald es ganz im Bild ist, pausiert, wenn es weg ist. Der Ton blendet mit ein und aus; Klick aufs Video = Ton an/aus. (Browser geben Ton erst nach dem ersten Klick/Tippen auf der Seite frei – bis dahin läuft es stumm.)',
        }[it.mode] || 'Läuft automatisch, stumm, in Schleife – wie ein bewegtes Foto.'}${it.link && it.mode && it.mode !== 'loop' ? ' Mit Link wird es als Loop gezeigt.' : ''}</div></div>`;
    } else {
      h += `<div class="sec"><h4>Beschreibung (Alt-Text)</h4><div class="row"><input type="text" data-item="alt" value="${esc(it.alt || '')}" placeholder="für Screenreader & Google" style="flex:1"></div></div>`;
    }
  }
  h += linkSection(it);
  return h;
}
function textPanel(it) {
  const st = styleOf(it, site), ov = it.over || {};
  const base = site.styles.find(s => s.id === it.style);
  const lab = (k, t) => `<label class="${k in ov ? 'ov' : ''}" title="${k in ov ? 'weicht vom Stil ab' : ''}">${t}</label>`;
  const fontsOpts = [...Object.keys(SYSTEM_FONTS).map(f => [f, f]), ...fontFamilies().map(f => [f, f])];
  if (!fontsOpts.some(([v]) => v === st.font)) fontsOpts.push([st.font, st.font + ' (fehlt)']);
  const avail = weightsFor(st.font);
  const weights = avail.map(w => [w, `${WEIGHT_NAMES[w] || ''} ${w}`]);
  if (!avail.includes(Number(st.weight))) weights.push([st.weight, `${st.weight} (künstlich)`]);
  const hasOv = Object.keys(ov).length > 0;
  return `<div class="sec"><h4>Textstil</h4>
    <div class="row"><select data-change="style" style="flex:1">${optionList([['', '— ohne Stil —'], ...site.styles.map(s => [s.id, s.name])], it.style || '')}</select></div>
    <div class="row">${lab('font', 'Schrift')}<select data-tp="font">${optionList(fontsOpts, st.font)}</select><button data-act="fontAdd" title="Schrift hinzufügen">＋</button></div>
    <div class="row">${lab('size', L.mobile ? 'Größe 📱' : 'Größe')}<input type="number" data-tp="size" min="4" max="2000" step="1" value="${st.size}"></div>
    <div class="row">${lab('weight', 'Stärke')}<select data-tp="weight">${optionList(weights, st.weight)}</select></div>
    <div class="row">${lab('color', 'Farbe')}<input type="color" data-tp="color" value="${esc(st.color)}"></div>
    <div class="row">${lab('lh', 'Zeilenhöhe')}<input type="number" data-tp="lh" min="0.5" max="4" step="0.05" value="${st.lh}"></div>
    <div class="row">${lab('ls', 'Laufweite')}<input type="number" data-tp="ls" min="-0.2" max="1" step="0.01" value="${st.ls}"></div>
    <div class="row">${lab('align', 'Ausrichtung')}<div class="seg" style="flex:1">${[['left', '⟸'], ['center', '≡'], ['right', '⟹'], ['justify', '☰']].map(([v, t]) => `<button data-act="tpSet" data-k="align" data-v="${v}" class="${st.align === v ? 'active' : ''}">${t}</button>`).join('')}</div></div>
    <div class="row">${lab(ov.italic !== undefined ? 'italic' : 'upper', 'Form')}
      <button data-act="tpToggle" data-k="italic" class="toggle${st.italic ? ' active' : ''}"><i>kursiv</i></button>
      <button data-act="tpToggle" data-k="upper" class="toggle${st.upper ? ' active' : ''}">VERSAL</button></div>
    <div class="row">${lab('bg', 'Hintergrund')}<input type="color" data-tp="bg" value="${esc(st.bg || '#ffffff')}"><button data-act="tpSet" data-k="bg" data-v="">${st.bg ? 'entfernen' : 'keiner'}</button></div>
    <div class="row">${lab('pad', 'Innenabstand')}<input type="number" data-tp="pad" min="0" max="400" step="2" value="${st.pad || 0}"></div>
    <div class="btns" style="margin-top:8px">
      ${base && hasOv ? `<button data-act="styleUpdate" title="Änderungen in den Stil übernehmen – alle Textboxen mit diesem Stil ändern sich">Stil „${esc(base.name)}" aktualisieren</button>` : ''}
      <button data-act="styleNew">Als neuen Stil speichern…</button>
      ${hasOv ? '<button data-act="styleReset">Abweichungen zurücksetzen</button>' : ''}
    </div>
    <div class="note">Doppelklick auf die Textbox = schreiben. ● = weicht vom Stil ab.</div>
  </div>`;
}
function graphPanel() {
  insp.innerHTML = `<div class="sec"><h4>Übersicht</h4>
    <div class="note">Alle Seiten nebeneinander. Linien zeigen Links von einem Element zur Projektseite.</div>
    <div class="linklist">${pages.map(p => `<a data-act="open" data-id="${esc(p.id)}">${p.id === 'index' ? '★' : '→'} ${esc(p.title || p.id)}</a>`).join('')}</div>
    <div class="btns" style="margin-top:10px"><button data-act="newPage">＋ Neue Seite</button></div></div>`;
}
function setTextProp(k, v) {
  const it = L.items[sel]; if (!it || it.type !== 'text') return;
  pushUndo('tp:' + k + sel);
  it.over = { ...(it.over || {}) };
  if (k === 'bg' && v === '') { const base = styleOf({ ...it, over: {} }, site); if (base.bg) it.over.bg = ''; else delete it.over.bg; }
  else it.over[k] = v;
  rerenderItem(sel); markDirty();
}
insp.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.tp) {
    const k = t.dataset.tp;
    const v = t.type === 'number' ? Number(t.value) : (k === 'weight' ? Number(t.value) : t.value);
    if (t.type === 'number' && !Number.isFinite(v)) return;
    setTextProp(k, v);
  } else if (t.dataset.page) {
    pushUndo('page:' + t.dataset.page);
    page[t.dataset.page] = t.value;
    if (t.dataset.page === 'title') { const s = pages.find(p => p.id === page.id); if (s) s.title = t.value; updatePageSelect(); }
    if (t.dataset.page === 'bg') layout();
    markDirty();
  } else if (t.dataset.site) {
    site[t.dataset.site] = t.value; saveSite();
  } else if (t.dataset.item) {
    pushUndo('item:' + t.dataset.item + sel);
    L.items[sel][t.dataset.item] = t.value; markDirty();
  }
});
insp.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.tp) renderInspector();
  if (t.dataset.change === 'link') await setLink(t.value);
  if (t.dataset.change === 'style') {
    const it = L.items[sel];
    pushUndo();
    if (t.value) { it.style = t.value; lastStyle = t.value; } else delete it.style;
    delete it.over;
    rerenderItem(sel); renderInspector(); markDirty();
  }
});
insp.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT') return;
  const it = sel >= 0 && page ? L.items[sel] : null;
  switch (b.dataset.act) {
    case 'front': return reorder(true);
    case 'back': return reorder(false);
    case 'dup': return duplicateItem();
    case 'del': return deleteItem();
    case 'crop': return toggleCrop();
    case 'group': return groupLasso();
    case 'ungroup': return ungroupDraw();
    case 'lassoDel': deleteLassoSel(); return renderInspector();
    case 'uncrop': {
      pushUndo();
      const c = it.crop; it.x -= c.x * it.w / c.w; it.y -= c.y * it.h / c.h; it.w /= c.w; it.h /= c.h;
      for (const k of ['x', 'y', 'w', 'h']) it[k] = Math.round(it[k]);
      delete it.crop; renderItems(); renderInspector(); return markDirty();
    }
    case 'pin': return setPin(b.dataset.v);
    case 'layer': return moveLayer({ inf: Infinity, '-inf': -Infinity }[b.dataset.d] ?? Number(b.dataset.d));
    case 'mode': pushUndo(); it.mode = b.dataset.v; rerenderItem(sel); renderInspector(); return markDirty();
    case 'openLink': return isUrl(it.link) ? window.open(it.link, '_blank', 'noopener') : openPage(it.link);
    case 'rcReload': {
      const d = (await api('/api/clipdirs?id=' + encodeURIComponent(page.id))).dirs.find(x => x.dir === it.dir);
      if (!d) return setStatus(`Ordner „${it.dir}" nicht gefunden`, 'err');
      pushUndo(); it.clips = d.clips; if (d.poster) it.poster = d.poster;
      rerenderItem(sel); renderInspector(); markDirty();
      return setStatus(`${d.clips.length} Clips eingelesen`, 'ok');
    }
    case 'open': return openPage(b.dataset.id);
    case 'tpSet': setTextProp(b.dataset.k, b.dataset.v); return renderInspector();
    case 'tpToggle': setTextProp(b.dataset.k, !styleOf(it, site)[b.dataset.k]); return renderInspector();
    case 'styleNew': {
      const name = prompt('Name des neuen Textstils:', '');
      if (!name) return;
      let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stil', n = 2;
      while (site.styles.some(s => s.id === id)) id = `${id.replace(/-\d+$/, '')}-${n++}`;
      const props = styleOf(it, site);
      site.styles.push({ id, name, props });
      pushUndo(); it.style = id; delete it.over; lastStyle = id;
      saveSite(); rerenderItem(sel); renderInspector(); return markDirty();
    }
    case 'styleUpdate': {
      const s = site.styles.find(x => x.id === it.style); if (!s) return;
      s.props = { ...s.props, ...it.over };
      pushUndo(); delete it.over;
      saveSite(); renderItems(); renderInspector(); setStatus(`Stil „${s.name}" aktualisiert`, 'ok'); return markDirty();
    }
    case 'styleReset': pushUndo(); delete it.over; rerenderItem(sel); renderInspector(); return markDirty();
    case 'styleRename': {
      const s = site.styles.find(x => x.id === b.dataset.id);
      const name = s && prompt('Neuer Name für den Stil:', s.name);
      if (name) { s.name = name; saveSite(); renderInspector(); }
      return;
    }
    case 'styleDelete': {
      const s = site.styles.find(x => x.id === b.dataset.id);
      if (!s || !confirm(`Stil „${s.name}" löschen? Textboxen mit diesem Stil fallen auf die Standardschrift zurück.`)) return;
      site.styles = site.styles.filter(x => x !== s); saveSite(); renderItems(); renderInspector(); return;
    }
    case 'extTop': return extend('top');
    case 'extBottom': return extend('bottom');
    case 'trimTop': return trim('top');
    case 'trimBottom': return trim('bottom');
    case 'bgReset': pushUndo(); page.bg = ''; layout(); renderInspector(); return markDirty();
    case 'toggleBack': page.back = !page.back; renderInspector(); return markDirty();
    case 'renamePage': return renamePage(page.id);
    case 'deletePage': return deletePage(page.id);
    case 'newPage': return newPage();
    case 'fontAdd': { const r = b.getBoundingClientRect(); return fontAddMenu(r.left - 120, r.bottom + 4); }
    case 'fontDel': {
      const fam = b.dataset.fam;
      const used = site.styles.filter(st => st.props.font === fam).map(st => st.name);
      if (!confirm(`Schrift „${fam}" entfernen?${used.length ? `\nBenutzt von den Stilen: ${used.join(', ')} – diese fallen auf die Standardschrift zurück.` : ''}`)) return;
      const r = await postJSON('/api/font-delete', { family: fam });
      return applyFonts(r.fonts);
    }
    case 'mPlace': return placeOnMobile(b.dataset.id);
    case 'mAdopt': return adoptStrokes();
    case 'mAuto':
      if (!confirm('Handy-Layout dieser Seite komplett neu vorschlagen? Deine Handy-Anordnung und Handy-Striche werden ersetzt.')) return;
      pushUndo(); return autoMobile();
  }
});
async function setLink(val) {
  const it = L.items[sel]; if (!it) return;
  if (val === '__url') {
    const url = prompt('Adresse der Webseite:', isUrl(it.link) ? it.link : 'https://');
    if (!url || !isUrl(url.trim())) { if (url) setStatus('Bitte eine vollständige Adresse mit https:// eingeben', 'err'); return renderInspector(); }
    val = url.trim();
  }
  if (val === '__new') {
    const suggestion = it.type === 'text' ? it.text.split('\n')[0].slice(0, 40) : (it.src || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
    const title = prompt('Name der neuen Projektseite:', suggestion);
    if (!title) return renderInspector();
    const np = await createPage(title, graphPosNear(page.id));
    if (!np) return renderInspector();
    val = np.id;
  }
  pushUndo();
  if (val) it.link = val; else delete it.link;
  rerenderItem(sel); renderInspector(); markDirty();
  if (val) setStatus('Verlinkt – in der Übersicht als Linie sichtbar', 'ok');
}

// ---------- Seiten verwalten ----------
function updatePageSelect() {
  $('pageSelect').innerHTML = pages.map(p => `<option value="${esc(p.id)}"${page && view === 'page' && p.id === page.id ? ' selected' : ''}>${p.id === 'index' ? '★ ' : ''}${esc(p.title || p.id)}</option>`).join('') +
    (view === 'graph' ? '<option value="" selected>— Seite öffnen —</option>' : '');
}
$('pageSelect').addEventListener('change', e => { if (e.target.value) openPage(e.target.value); });
function graphPosNear(id) {
  const g = site.graph[id] || { x: 0, y: 0 };
  const n = Object.values(site.graph).filter(p => p.x > g.x + 200 && Math.abs(p.y - g.y) < 3000).length;
  return { x: g.x + 520, y: g.y + n * 300 };
}
async function createPage(title, pos) {
  await flushSite();
  try {
    const r = await postJSON('/api/pages', { title, pos });
    pages = r.pages; site.graph = r.site.graph;
    allPages.set(r.page.id, r.page);
    updatePageSelect();
    return r.page;
  } catch (e) { setStatus(e.message, 'err'); return null; }
}
async function newPage(pos) {
  const title = prompt('Name der neuen Seite:', '');
  if (!title) return;
  const np = await createPage(title, pos || (page ? graphPosNear(page.id) : { x: 520, y: 0 }));
  if (!np) return;
  if (view === 'graph') { renderGraph(); renderInspector(); } else openPage(np.id);
}
async function renamePage(id) {
  if (id === 'index') return;
  const p = pages.find(x => x.id === id);
  const nid = prompt('Neue Adresse (nur a–z, 0–9, -):', id);
  if (!nid || nid === id) return;
  if (page && dirty) await save();
  await flushSite();
  try {
    const r = await postJSON('/api/rename', { id, newId: nid });
    pages = r.pages; site.graph = r.site.graph;
    await loadAll();
    if (view === 'graph') { renderGraph(); renderInspector(); updatePageSelect(); }
    else await openPage(page.id === id ? r.id : page.id, { noSave: true });
    setStatus(`Umbenannt in /${r.id}.html – Links wurden angepasst`, 'ok');
  } catch (e) { setStatus(e.message, 'err'); }
  void p;
}
async function deletePage(id) {
  if (id === 'index') return;
  const p = pages.find(x => x.id === id);
  if (!confirm(`Seite „${p?.title || id}" mit allen Medien löschen? Links dorthin werden entfernt.`)) return;
  if (page && dirty && page.id !== id) await save();
  await flushSite();
  try {
    const r = await api('/api/page?id=' + encodeURIComponent(id), { method: 'DELETE' });
    pages = r.pages; site.graph = r.site.graph;
    allPages.delete(id);
    await loadAll();
    if (view === 'graph') { renderGraph(); renderInspector(); updatePageSelect(); }
    else await openPage(page.id === id ? 'index' : page.id, { noSave: true });
  } catch (e) { setStatus(e.message, 'err'); }
}
$('btnNewPage').onclick = () => newPage();

async function openPage(id, { noSave = false } = {}) {
  if (editing) commitText();
  if (cropState) exitCrop(true);
  if (page && dirty && !noSave) await save();
  let r;
  try { r = await api('/api/page?id=' + encodeURIComponent(id)); }
  catch (e) { setStatus(e.message, 'err'); if (id !== 'index') return openPage('index', { noSave: true }); return; }
  page = r.page; media = r.media;
  sel = -1; undoStack = []; redoStack = []; updateHistory(); dirty = false;
  const idsAdded = ensureIds(page);
  allPages.set(page.id, page);
  setView('page');
  history.replaceState(null, '', '#seite=' + encodeURIComponent(page.id));
  if (mode === 'mobile' && !page.m) await autoMobile();
  else enterLayout();
  if (idsAdded) markDirty();
  updatePageSelect();
  pollJobs();
}
// aktive Ansicht (Desktop/Handy) frisch aufbauen
function enterLayout() {
  L = mode === 'mobile' && page.m ? buildMobileL() : page;
  sel = -1; multi = []; lasso = null; lassoSel = []; selBox = null;
  for (const t of tiles.values()) t.cv.remove();
  tiles.clear(); dirtyTiles.clear();
  ensureTiles(); layout(); renderItems(); renderOverlay();
  renderInspector(); renderMedia(); updateMobileBadge();
  scroller.scrollTop = 0;
}
$('previewLink').addEventListener('click', e => {
  if (dirty) save();
  if (mode !== 'mobile') { $('previewLink').href = `/preview/${encodeURIComponent(page.id)}.html`; return; }
  e.preventDefault(); // Handy-Vorschau in schmalem Fenster
  setTimeout(() => window.open(`/preview/${encodeURIComponent(page.id)}.html?ansicht=handy`, 'handyvorschau', 'width=410,height=860'), dirty ? 400 : 0);
});

// ---------- Handy-Modus ----------
// Ansicht für das Handy: Elemente = Kopien (Inhalt vom Desktop + eigener Platz), Striche = eigene Handy-Striche.
// Änderungen landen über syncBack() wieder in page.items (Inhalt) bzw. page.m.place (Geometrie).
function buildMobileL() {
  const m = page.m;
  const byId = new Map([...page.items, ...m.own].map(it => [it.id, it]));
  const items = m.place.filter(e => byId.has(e.ref)).map(e => mergeEntry(byId.get(e.ref), e));
  return {
    mobile: true, id: page.id, width: MW, items,
    get strokes() { return m.strokes; }, set strokes(v) { m.strokes = v; },
    get top() { return m.top; }, set top(v) { m.top = v; },
    get bottom() { return m.bottom; }, set bottom(v) { m.bottom = v; },
    get ink() { return m.ink; }, set ink(v) { m.ink = v; },
  };
}
const GEO = ['x', 'y', 'w', 'h', 'crop', 'pin'];
function syncBack() {
  if (!L || !L.mobile || !page.m) return;
  const m = page.m;
  const base = new Map([...page.items, ...m.own].map(it => [it.id, it]));
  const used = new Set();
  m.place = L.items.map(v => {
    if (!v.id) v.id = newId();
    let b = base.get(v.id);
    if (!b) { b = { id: v.id }; m.own.push(b); base.set(v.id, b); } // neu im Handy-Modus = nur fürs Handy
    used.add(v.id);
    const origSize = b.over?.size;
    for (const k of Object.keys(b)) if (!GEO.includes(k) && k !== 'id' && k !== 'over' && !(k in v)) delete b[k];
    for (const [k, val] of Object.entries(v)) if (!GEO.includes(k) && k !== 'over') b[k] = val;
    const e = { ref: v.id, x: v.x, y: v.y, w: v.w, h: v.h };
    if (v.crop) e.crop = v.crop;
    if (v.pin) e.pin = v.pin;
    // Textstil: alles geteilt – nur die Schriftgröße darf aufs Handy abweichen
    const o = { ...(v.over || {}) };
    const vs = o.size; delete o.size;
    if (origSize != null) o.size = origSize;
    if (Object.keys(o).length) b.over = o; else delete b.over;
    if (v.type === 'text' && vs != null && vs !== styleOf(b, site).size) e.size = vs;
    return e;
  });
  m.own = m.own.filter(o => used.has(o.id));
  m.hide = m.hide.filter(id => !used.has(id));
}
// Strich hängt am nächstgelegenen Element (wandert mit dessen Handy-Platz mit)
function strokeTransform(s, pairs, fallback) {
  const bb = sbox(s);
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  let best = null, bd = Infinity;
  for (const pr of pairs) {
    const b = pr.b, h = b.h || 60;
    const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w)), dy = Math.max(b.y - cy, 0, cy - (b.y + h));
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = pr; }
  }
  if (best && bd < 700) return { k: best.e.w / best.b.w, ox: best.b.x, oy: best.b.y, nx: best.e.x, ny: best.e.y, e: best.e };
  return fallback;
}
function copyStroke(s, T) {
  return { id: newId(), src: s.id, tool: s.tool, size: Math.max(1, s.size * T.k),
    points: s.points.map(p => ({ x: Math.round((T.nx + (p.x - T.ox) * T.k) * 10) / 10, y: Math.round((T.ny + (p.y - T.oy) * T.k) * 10) / 10, p: p.p })) };
}
const M_MARGIN = 70;
function mobileEntryFor(b, y) {
  const CW = MW - 2 * M_MARGIN;
  if (b.pin) { // fixierte Elemente proportional (etwas größer) übernehmen, bleiben fixiert
    const k = MW / W * 1.6, w = Math.min(CW, b.w * k), h = b.h * (w / b.w);
    return { ref: b.id, pin: b.pin, x: Math.round(clamp(b.x * k, 20, MW - w - 20)), y: Math.round(b.y * k), w: Math.round(w), h: Math.round(h) };
  }
  if (b.type === 'text') return { ref: b.id, x: M_MARGIN, y, w: CW, h: b.h || 60 };
  let w = CW, h = w * b.h / b.w;
  if (h > MW * 1.3) { h = MW * 1.3; w = h * b.w / b.h; }
  const e = { ref: b.id, x: Math.round((MW - w) / 2), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  if (b.crop) e.crop = b.crop;
  return e;
}
// Automatischer Vorschlag: alles in Desktop-Reihenfolge (oben→unten) untereinander, Striche wandern mit
async function autoMobile() {
  const order = [...page.items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const m = { top: 0, bottom: SCREEN, place: [], own: [], strokes: [], ink: page.m?.ink || [], hide: [], skip: [] };
  page.m = m;
  const pairs = [];
  let y = M_MARGIN + 40;
  for (const b of order) { const e = mobileEntryFor(b, y); m.place.push(e); if (!b.pin) { pairs.push({ b, e }); y += e.h + 60; } }
  const fallback = { k: MW / W, ox: 0, oy: page.top, nx: 0, ny: 0 };
  const att = new Map(); // ref -> Handy-Striche
  for (const s of page.strokes) {
    if (!s.points.length) continue;
    const T = strokeTransform(s, pairs.filter(pr => !pr.b.pin), fallback);
    const c = copyStroke(s, T);
    // nicht über den Handy-Rand hinausragen lassen
    const bb = sbox(c), over = bb.maxX - MW, under = -bb.minX;
    const dx = over > 0 ? -Math.min(over + 20, Math.max(0, bb.minX)) : under > 0 ? under + 20 : 0;
    if (dx) c.points = c.points.map(p => ({ ...p, x: p.x + dx }));
    m.strokes.push(c);
    if (T.e) { if (!att.has(T.e.ref)) att.set(T.e.ref, []); att.get(T.e.ref).push(c); }
  }
  enterLayout(); // rendert -> Texthöhen sind jetzt gemessen
  // neu stapeln mit echten Höhen; Abstände wie am Desktop (große Lücke = großer Abstand)
  y = M_MARGIN + 40;
  let prevBottom = null;
  const baseOf = new Map(page.items.map(b => [b.id, b]));
  L.items.forEach(v => {
    const b = baseOf.get(v.id);
    if (!b || v.pin) return;
    if (prevBottom != null) y += b.y - prevBottom > 400 ? 180 : 60;
    const dy = y - v.y;
    v.y = Math.round(y);
    for (const c of att.get(v.id) || []) c.points = c.points.map(p => ({ ...p, y: p.y + dy }));
    y += v.h;
    prevBottom = Math.max(prevBottom ?? -Infinity, b.y + (b.h || 60));
  });
  m.bottom = Math.max(SCREEN, Math.round(y + M_MARGIN + 200));
  syncBack();
  enterLayout();
  redrawAllTiles();
  markDirty();
  setStatus('Handy-Layout vorgeschlagen – jetzt frei umbauen', 'ok');
}
// Was am Desktop dazukam und aufs Handy noch nicht platziert ist
function mobilePending() {
  if (!page.m) return { items: [], hidden: [], strokes: [] };
  syncBack(); // ausstehende Handy-Änderungen zuerst übernehmen
  const placed = new Set(page.m.place.map(e => e.ref));
  const hide = new Set(page.m.hide);
  const copied = new Set([...page.m.strokes.map(s => s.src), ...page.m.skip]);
  return {
    items: page.items.filter(b => !placed.has(b.id) && !hide.has(b.id)),
    hidden: page.items.filter(b => hide.has(b.id) && !placed.has(b.id)),
    strokes: page.strokes.filter(s => s.points.length && !copied.has(s.id)),
  };
}
function updateMobileBadge() {
  const n = page && page.m ? mobilePending().items.length + (mobilePending().strokes.length ? 1 : 0) : 0;
  $('mBadge').textContent = n ? n : '';
  $('mBadge').hidden = !n;
}
function placeOnMobile(id) {
  const b = page.items.find(x => x.id === id); if (!b) return;
  pushUndo();
  const c = viewCenter();
  const v = mergeEntry(b, mobileEntryFor(b, 0));
  if (!v.pin) v.y = Math.round(c.y - v.h / 2);
  L.items.push(v);
  renderItems(); select(L.items.length - 1); markDirty(); updateMobileBadge();
}
function adoptStrokes() {
  const pend = mobilePending().strokes; if (!pend.length) return;
  pushUndo();
  const byId = new Map(page.items.map(b => [b.id, b]));
  const pairs = L.items.filter(v => byId.has(v.id) && !v.pin && !byId.get(v.id).pin).map(v => ({ b: byId.get(v.id), e: v }));
  const c = viewCenter();
  const fallback = { k: MW / W, ox: 0, oy: page.top, nx: 0, ny: c.y - SCREEN * MW / W / 2 };
  for (const s of pend) L.strokes.push(copyStroke(s, strokeTransform(s, pairs, fallback)));
  redrawAllTiles(); markDirty(); renderInspector(); updateMobileBadge();
  setStatus(`${pend.length} Striche übernommen – mit dem Lasso zurechtrücken`, 'ok');
}
function setModeUI(md) {
  mode = md;
  body.dataset.mode = md;
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('active', b.dataset.mode === md);
}
async function setMode(md) {
  if (md === mode || !page) return;
  if (editing) commitText();
  if (cropState) exitCrop(true);
  if (dirty) await save();
  setModeUI(md);
  if (view !== 'page') setView('page');
  if (md === 'mobile' && !page.m) await autoMobile();
  else enterLayout();
}
document.querySelectorAll('#modeSeg button').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
const itemLabel = b => (b.type === 'text' ? '„' + (b.text || '').split('\n')[0].slice(0, 28) + '"' : (b.type === 'video' ? '▶ ' : '🖼 ') + String(b.src || '').split('/').pop().slice(0, 28));

// ---------- Übersicht (Node-Ansicht) ----------
const NODE_W = 320;
let gz = 0.55, gx = 80, gy = 80, fitted = false, gdrag = null;
function setView(v) {
  view = v;
  body.dataset.view = v;
  pageView.hidden = v !== 'page';
  graphView.hidden = v !== 'graph';
  $('btnGraph').classList.toggle('active', v === 'graph');
}
async function loadAll() {
  const r = await api('/api/all');
  allPages = new Map(r.pages.map(p => [p.id, p]));
  if (page && view === 'page') allPages.set(page.id, page);
}
async function showGraph() {
  if (editing) commitText();
  if (cropState) exitCrop(true);
  if (page && dirty) await save();
  await flushSite();
  setView('graph');
  await loadAll();
  site.graph = (await api('/api/boot')).site.graph;
  renderGraph(); renderInspector(); updatePageSelect();
  history.replaceState(null, '', '#uebersicht');
  if (!fitted) { fitted = true; requestAnimationFrame(fitGraph); }
}
$('btnGraph').onclick = () => (view === 'graph' ? (page ? openPage(page.id) : openPage('index')) : showGraph());
function ensurePositions() {
  let changed = false, i = 0;
  if (!site.graph.index) { site.graph.index = { x: 0, y: 0 }; changed = true; }
  for (const p of allPages.values()) {
    if (site.graph[p.id]) continue;
    site.graph[p.id] = { x: 520 * (1 + (i % 3)), y: 420 * Math.floor(i / 3) };
    i++; changed = true;
  }
  if (changed) saveSite();
}
function applyWorld() { world.style.transform = `translate(${gx}px, ${gy}px) scale(${gz})`; }
function renderGraph() {
  ensurePositions();
  nodesEl.innerHTML = [...allPages.values()].map(p => {
    const g = site.graph[p.id];
    const opt = { media: edMedia, link: null, thumb: true, v: p.updated, k: NODE_W / W };
    return `<div class="node${page && p.id === page.id ? ' current' : ''}" data-id="${esc(p.id)}" style="left:${g.x}px;top:${g.y}px;width:${NODE_W}px">
      <div class="node-head">${p.id === 'index' ? '★ ' : ''}${esc(p.title || p.id)}<small>${p.id === 'index' ? 'Startseite' : '/' + esc(p.id)}</small></div>
      <div class="node-thumb">${pageHTML(p, site, opt)}</div></div>`;
  }).join('');
  drawWires(); applyWorld();
}
function drawWires() {
  const k = NODE_W / W;
  const head = nodesEl.querySelector('.node-head');
  const headH = head ? head.offsetHeight : 34;
  let h = '';
  for (const p of allPages.values()) {
    const g = site.graph[p.id]; if (!g) continue;
    for (const it of p.items) {
      if (!it.link || it.link === p.id || !allPages.has(it.link)) continue;
      const t = site.graph[it.link]; if (!t) continue;
      const ih = it.h || 60;
      const iy = it.pin ? p.top + pinTopY(it, p) : it.y;
      const sx = g.x + clamp(it.x + it.w, 0, W) * k;
      const sy = g.y + headH + clamp(iy + ih / 2 - p.top, 0, pageH(p)) * k;
      const tx = t.x - 2, ty = t.y + headH / 2;
      const dx = Math.max(70, Math.abs(tx - sx) * 0.5);
      h += `<path d="M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}" marker-end="url(#arrow)"/><circle cx="${sx}" cy="${sy}" r="5"/>`;
    }
  }
  wireG.innerHTML = h;
}
function fitGraph() {
  const ns = [...nodesEl.children]; if (!ns.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of ns) {
    const x = n.offsetLeft, y = n.offsetTop;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + n.offsetWidth); maxY = Math.max(maxY, y + Math.min(n.offsetHeight, 1400));
  }
  const r = graphView.getBoundingClientRect(), m = 70;
  gz = clamp(Math.min((r.width - 2 * m) / (maxX - minX), (r.height - 2 * m - 40) / (maxY - minY)), 0.08, 1.2);
  gx = m - minX * gz + Math.max(0, (r.width - 2 * m - (maxX - minX) * gz) / 2);
  gy = m - minY * gz;
  applyWorld();
}
$('gFit').onclick = fitGraph;
$('gNew').onclick = () => {
  const r = graphView.getBoundingClientRect();
  newPage({ x: Math.round((r.width / 2 - gx) / gz), y: Math.round((r.height / 2 - gy) / gz) });
};
graphView.addEventListener('pointerdown', e => {
  hideMenu();
  if (e.button !== 0 || e.target.closest('.graph-bar')) return;
  const node = e.target.closest('.node');
  if (node) {
    const id = node.dataset.id, g = site.graph[id];
    gdrag = { type: 'node', id, el: node, sx: e.clientX, sy: e.clientY, ox: g.x, oy: g.y, moved: false };
  } else {
    gdrag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: gx, oy: gy };
    graphView.classList.add('panning');
  }
  capture(graphView, e);
});
graphView.addEventListener('pointermove', e => {
  if (!gdrag) return;
  const dx = e.clientX - gdrag.sx, dy = e.clientY - gdrag.sy;
  if (gdrag.type === 'pan') { gx = gdrag.ox + dx; gy = gdrag.oy + dy; applyWorld(); return; }
  if (!gdrag.moved && Math.hypot(dx, dy) < 3) return;
  gdrag.moved = true;
  const g = site.graph[gdrag.id];
  g.x = Math.round(gdrag.ox + dx / gz); g.y = Math.round(gdrag.oy + dy / gz);
  gdrag.el.style.left = g.x + 'px'; gdrag.el.style.top = g.y + 'px';
  drawWires();
});
graphView.addEventListener('pointerup', () => {
  if (gdrag?.type === 'node' && gdrag.moved) saveSite();
  gdrag = null; graphView.classList.remove('panning');
});
graphView.addEventListener('dblclick', e => {
  const node = e.target.closest('.node');
  if (node) openPage(node.dataset.id);
});
graphView.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = graphView.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const nz = clamp(gz * Math.exp(-e.deltaY * 0.01), 0.06, 2.5);
    gx = cx - (cx - gx) / gz * nz; gy = cy - (cy - gy) / gz * nz; gz = nz;
  } else { gx -= e.deltaX; gy -= e.deltaY; }
  applyWorld();
}, { passive: false });
graphView.addEventListener('contextmenu', e => {
  e.preventDefault();
  const node = e.target.closest('.node');
  if (node) {
    const id = node.dataset.id;
    showMenu(e.clientX, e.clientY, [
      { label: 'Öffnen', fn: () => openPage(id) },
      { label: 'Vorschau ↗', fn: () => window.open(`/preview/${encodeURIComponent(id)}.html`, '_blank') },
      ...(id === 'index' ? [] : ['-', { label: 'Adresse ändern…', fn: () => renamePage(id) }, { label: 'Seite löschen', danger: true, fn: () => deletePage(id) }]),
    ]);
  } else {
    const r = graphView.getBoundingClientRect();
    const pos = { x: Math.round((e.clientX - r.left - gx) / gz), y: Math.round((e.clientY - r.top - gy) / gz) };
    showMenu(e.clientX, e.clientY, [{ label: '＋ Neue Seite hier', fn: () => newPage(pos) }, { label: '⤢ Alles zeigen', fn: fitGraph }]);
  }
});

// ---------- Kontextmenü ----------
function showMenu(x, y, entries) {
  menu.innerHTML = entries.map((en, i) => (en === '-' ? '<div class="divider"></div>'
    : en.disabled ? `<div class="menu-head">${esc(en.label)}</div>`
    : `<button data-i="${i}" class="${en.danger ? 'danger' : ''}"${en.font ? ` style="font-family:${esc(JSON.stringify(en.font))},sans-serif"` : ''}>${esc(en.label)}</button>`)).join('');
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menu.onclick = e => { const b = e.target.closest('button'); if (!b) return; hideMenu(); entries[Number(b.dataset.i)].fn(); };
}
function hideMenu() { menu.hidden = true; }
window.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) hideMenu(); }, true);
const onItemCtx = e => {
  const el = e.target.closest('.it'); if (!el || editing) return;
  e.preventDefault();
  if (multi.includes(L.items[Number(el.dataset.i)])) {
    return showMenu(e.clientX, e.clientY, [
      ...(multiIdx().some(i => !L.items[i].pin) ? [{ label: '📌 Alle oben fixieren', fn: () => setPin('t') }, { label: '📌 Alle unten fixieren', fn: () => setPin('b') }] : []),
      ...(multiIdx().some(i => L.items[i].pin) ? [{ label: '📌 Fixierung bei allen lösen', fn: () => setPin('') }] : []),
      '-',
      { label: '⤒ Ganz nach vorne', fn: () => moveLayer(Infinity) },
      { label: '↑ Eine Ebene vor', fn: () => moveLayer(1) },
      { label: '↓ Eine Ebene zurück', fn: () => moveLayer(-1) },
      { label: '⤓ Ganz nach hinten', fn: () => moveLayer(-Infinity) },
      { label: '⧉ Duplizieren', fn: duplicateItem },
      '-',
      { label: `${multi.length} Objekte ${L.mobile ? 'ausblenden' : 'löschen'}`, danger: true, fn: deleteItem },
    ]);
  }
  setTool('select');
  select(Number(el.dataset.i));
  const it = L.items[sel];
  showMenu(e.clientX, e.clientY, [
    ...(it.type === 'text' ? [{ label: 'Text bearbeiten', fn: () => startText(sel) }]
      : it.type === 'draw' ? [{ label: '✎ In Striche auflösen', fn: ungroupDraw }]
      : [{ label: '✂ Zuschneiden', fn: enterCrop }]),
    { label: '🔗 Neue Projektseite verlinken…', fn: () => setLink('__new') },
    { label: '🌐 Mit Webseite verlinken…', fn: () => setLink('__url') },
    ...(it.link ? [{ label: 'Verlinkte Seite öffnen →', fn: () => openPage(it.link) }, { label: 'Link entfernen', fn: () => setLink('') }] : []),
    '-',
    ...(it.pin ? [{ label: '📌 Fixierung lösen (scrollt mit)', fn: () => setPin('') }]
      : [{ label: '📌 Oben am Bildschirm fixieren', fn: () => setPin('t') }, { label: '📌 Unten am Bildschirm fixieren', fn: () => setPin('b') }]),
    '-',
    { label: '⤒ Ganz nach vorne', fn: () => moveLayer(Infinity) },
    { label: '↑ Eine Ebene vor', fn: () => moveLayer(1) },
    { label: '↓ Eine Ebene zurück', fn: () => moveLayer(-1) },
    { label: '⤓ Ganz nach hinten', fn: () => moveLayer(-Infinity) },
    { label: '⧉ Duplizieren', fn: duplicateItem },
    '-',
    { label: 'Entfernen', danger: true, fn: deleteItem },
  ]);
};
itemsEl.addEventListener('contextmenu', onItemCtx);

// ---------- Veröffentlichen ----------
async function publish() {
  const btn = $('publish');
  btn.disabled = true;
  try {
    if (editing) commitText();
    await save(); await flushSite();
    setStatus('Veröffentliche…', '', true);
    const r = await postJSON('/api/publish', {}).catch(e => ({ ok: false, error: e.message }));
    if (r.ok) setStatus(r.message, 'ok');
    else { setStatus('Veröffentlichen fehlgeschlagen', 'err'); alert('Veröffentlichen fehlgeschlagen:\n\n' + r.error); }
  } finally { btn.disabled = false; }
}
$('publish').onclick = publish;
$('save').onclick = () => { if (editing) commitText(); save(); flushSite(); };
$('undo').onclick = undo;
$('redo').onclick = redo;

// ---------- Tastatur ----------
window.addEventListener('keydown', e => {
  const t = e.target;
  const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); $('save').click(); return; }
  if (mod && e.shiftKey && k === 'p') { e.preventDefault(); publish(); return; }
  if (typing) { if (e.key === 'Escape' && t.isContentEditable) t.blur(); return; }
  if (view === 'graph') { if (k === 'g' && !mod) $('btnGraph').click(); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateItem(); return; }
  if (mod && k === 'a') { e.preventDefault(); setTool('select'); return setSelection([...L.items]); }
  if (mod && k === 'g') { e.preventDefault(); return e.shiftKey ? ungroupDraw() : groupLasso(); }
  if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
    e.preventDefault();
    const up = e.code === 'BracketRight';
    return moveLayer(e.shiftKey ? (up ? Infinity : -Infinity) : (up ? 1 : -1));
  }
  if (mod && k === '0') { e.preventDefault(); setZoom(1); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom(zoom * 1.25); return; }
  if (mod && k === '-') { e.preventDefault(); setZoom(zoom / 1.25); return; }
  if (mod) return;
  if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; body.classList.add('space-pan'); } return; }
  const toolKeys = { v: 'select', b: 'brush', e: 'eraser', l: 'lasso', t: 'text' };
  if (toolKeys[k]) return setTool(toolKeys[k]);
  if (k === 'g') return showGraph();
  if (k === 'm') return setMode(mode === 'mobile' ? 'desktop' : 'mobile');
  if (k === 'k') return toggleCrop();
  if (k === 'f' && targets().length) return setPin({ '': 't', t: 'b', b: '' }[L.items[targets()[0]].pin || '']);
  if (k === '[') return setBrush(brushSize / 1.2);
  if (k === ']') return setBrush(brushSize * 1.2);
  if (e.key === 'Enter') {
    if (cropState) return exitCrop(true);
    if (sel >= 0 && L.items[sel].type === 'text') { e.preventDefault(); return startText(sel); }
  }
  if (e.key === 'Escape') {
    if (cropState) return exitCrop(false);
    if (lassoSel.length) return clearLasso();
    if (sel >= 0 || multi.length) return select(-1);
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (deleteLassoSel()) return;
    return deleteItem();
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && targets().length) {
    e.preventDefault();
    const f = e.shiftKey ? 40 : 4;
    nudge(arrows[e.key][0] * f, arrows[e.key][1] * f);
  }
});
window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; body.classList.remove('space-pan'); } });
window.addEventListener('blur', () => { spaceDown = false; body.classList.remove('space-pan'); });

// ---------- Start ----------
async function boot() {
  const b = await api('/api/boot');
  site = b.site; pages = b.pages; fonts = b.fonts;
  $('fontFaces').textContent = fontFaceCSS(fonts, '/');
  if (!b.ffmpeg) setStatus('Hinweis: ffmpeg fehlt – Videos nur als MP4 möglich', 'err');
  if (!site.styles.some(s => s.id === lastStyle)) lastStyle = site.styles[0]?.id || '';
  await loadAll();
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'uebersicht') { await openPage('index'); showGraph(); }
  else await openPage(h.startsWith('seite=') ? h.slice(6) : 'index');
}
boot().catch(e => setStatus('Start fehlgeschlagen: ' + e.message, 'err', true));

// Fehler sichtbar machen statt still zu scheitern
window.addEventListener('error', e => setStatus('Fehler: ' + e.message, 'err', true));
window.addEventListener('unhandledrejection', e => setStatus('Fehler: ' + (e.reason?.message || e.reason), 'err', true));

// Dateien, die neben der Fläche fallen gelassen werden: Schriften übernehmen, sonst nichts tun
// (verhindert, dass Firefox die Datei öffnet und den Editor verlässt)
window.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  if (e.defaultPrevented && pageView.contains(e.target)) return;
  const fontFiles = [...e.dataTransfer.files].filter(isFontFile);
  if (fontFiles.length) uploadFonts(fontFiles);
  else setStatus('Fotos & Videos bitte auf die Fläche ziehen');
});

$('lassoGroup').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); groupLasso(); });
