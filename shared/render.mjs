// Gemeinsamer Renderer – wird vom Editor (Browser), der Vorschau und dem Build (Node) genutzt.
// Erzeugt reines HTML aus den Seitendaten -> Editor, Vorschau und Live-Seite sehen identisch aus.

export const W = 2560;      // logische Breite jeder Seite (füllt den Bildschirm links→rechts)
export const MW = 1080;     // logische Breite der Handy-Ansicht
export const TILE = 1280;   // Höhe einer Zeichen-Kachel (ink_<k>.png deckt y ∈ [k·TILE, (k+1)·TILE))
export const SCREEN = 1440; // „ein Bildschirm" in Seiteneinheiten (16:9 bei 2560 Breite)
export const BG = '#f8f7f4';
export const MOBILE_MAX = 760; // bis zu dieser Fensterbreite (px) zeigt die Live-Seite das Handy-Layout
export const INK = '#141311';

export const SYSTEM_FONTS = {
  Sans: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
  Serif: '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif',
  Mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export const TEXT_DEFAULT = {
  font: 'Sans', size: 44, weight: 400, color: '#141311', lh: 1.35, ls: 0,
  align: 'left', italic: false, upper: false, bg: '', pad: 0,
};

export const DEFAULT_STYLES = [
  { id: 'titel', name: 'Titel', props: { size: 150, weight: 600, lh: 1.05, ls: -0.01 } },
  { id: 'text', name: 'Fließtext', props: { size: 40, lh: 1.45 } },
  { id: 'label', name: 'Label', props: { size: 26, weight: 500, upper: true, ls: 0.08 } },
];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function normalizePage(p = {}, id) {
  id = id ?? p.id;
  const top = num(p.top, 0);
  let bottom = num(p.bottom, id === 'index' ? SCREEN * 2 : SCREEN);
  if (bottom <= top + 100) bottom = top + SCREEN;
  return {
    id,
    title: p.title ?? (id === 'index' ? 'Startseite' : id),
    bg: p.bg || '',
    back: p.back !== false,
    top, bottom,
    items: Array.isArray(p.items) ? p.items : [],
    strokes: Array.isArray(p.strokes) ? p.strokes : [],
    ink: Array.isArray(p.ink) ? p.ink : [],
    m: normalizeMobile(p.m),
    updated: p.updated || '',
  };
}
// Handy-Layout: place = [{ref,x,y,w,h,crop?,rot?,size?}] (Reihenfolge = Ebenen), own = Elemente nur fürs Handy,
// strokes = eigene Handy-Striche (Kopien mit src = Desktop-Strich-ID), hide/skip = bewusst ausgeblendete IDs.
function normalizeMobile(m) {
  if (!m || typeof m !== 'object') return null;
  const top = num(m.top, 0);
  let bottom = num(m.bottom, SCREEN * 2);
  if (bottom <= top + 100) bottom = top + SCREEN;
  const arr = v => (Array.isArray(v) ? v : []);
  return { top, bottom, place: arr(m.place), own: arr(m.own), strokes: arr(m.strokes), ink: arr(m.ink), hide: arr(m.hide), skip: arr(m.skip) };
}
export const newId = () => Math.random().toString(36).slice(2, 10);
// fehlende IDs ergänzen (Elemente & Striche brauchen stabile IDs für das Handy-Layout). true = etwas ergänzt
export function ensureIds(p) {
  let ch = false;
  for (const it of p.items) if (!it.id) { it.id = newId(); ch = true; }
  for (const s of p.strokes) if (!s.id) { s.id = newId(); ch = true; }
  return ch;
}
// Element mit seinem Handy-Platz zusammenführen (Inhalt geteilt, Geometrie eigen)
export function mergeEntry(b, e) {
  const it = { ...b, x: e.x, y: e.y, w: e.w, h: e.h };
  if (e.pin) it.pin = e.pin; else delete it.pin;
  if (e.crop) it.crop = e.crop; else delete it.crop;
  if (e.rot) it.rot = e.rot; else delete it.rot;
  if (e.size != null) it.over = { ...(b.over || {}), size: e.size };
  return it;
}
// „Ansicht" einer Seite für das Handy (gleiche Form wie eine Seite, aber width = MW)
export function mobileView(p) {
  const m = p.m;
  if (!m) return null;
  const byId = new Map([...p.items, ...m.own].map(it => [it.id, it]));
  const items = m.place.filter(e => byId.has(e.ref)).map(e => mergeEntry(byId.get(e.ref), e));
  return { id: p.id, bg: p.bg, width: MW, top: m.top, bottom: m.bottom, items, ink: m.ink, inkPrefix: 'mink_' };
}

export const pageH = p => p.bottom - p.top;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function color(c, d = '') {
  c = String(c || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(c) || /^rgba?\([\d\s.,%]+\)$/i.test(c) ? c : d;
}

// effektiver Textstil = Standard ← gespeicherter Stil ← Überschreibungen der Box
export function styleOf(it, site) {
  const base = (site?.styles || []).find(s => s.id === it.style);
  return { ...TEXT_DEFAULT, ...(base ? base.props : {}), ...(it.over || {}) };
}
export function fontStack(f) {
  return SYSTEM_FONTS[f] || `"${String(f).replace(/["\\<>]/g, '')}", ${SYSTEM_FONTS.Sans}`;
}
// Text wird in festen Seiten-Einheiten gesetzt (1 Einheit = 1px im ungezoomten Raum) und dann als Ganzes per
// transform: scale(var(--k)) auf die Bildschirmbreite gebracht. So bricht er bei JEDER Zoomstufe gleich um
// (vorher: Schrift in vw -> Rundung -> Wörter sprangen zwischen den Zeilen hin und her).
const u = n => `${num(+n, 0)}px`;
export function textCss(st, pw = W) {
  const align = ['left', 'center', 'right', 'justify'].includes(st.align) ? st.align : 'left';
  let c = `font-family:${fontStack(st.font)};font-size:${u(st.size)};font-weight:${num(+st.weight, 400)};` +
    `color:${color(st.color, TEXT_DEFAULT.color)};line-height:${num(+st.lh, 1.3)};letter-spacing:${num(+st.ls, 0)}em;text-align:${align};`;
  if (st.italic) c += 'font-style:italic;';
  if (st.upper) c += 'text-transform:uppercase;';
  if (color(st.bg)) c += `background:${color(st.bg)};`;
  if (+st.pad) c += `padding:${u(st.pad)};`;
  return c;
}

// Beschnitt: crop {x,y,w,h} = sichtbarer Ausschnitt als Bruchteile des Originals
export function cropInner(it) {
  const c = it.crop;
  if (!c) return 'width:100%;height:100%;left:0;top:0';
  return `width:${100 / c.w}%;height:${100 / c.h}%;left:${-c.x / c.w * 100}%;top:${-c.y / c.h * 100}%`;
}

// Position in Prozent der Seite (Live-Seite)
export const pageW = p => p.width || W;
export function posPct(it, p) {
  const H = pageH(p), PW = pageW(p);
  let s = `left:${it.x / PW * 100}%;top:${(it.y - p.top) / H * 100}%;width:${it.w / PW * 100}%;`;
  if (it.type !== 'text') s += `height:${it.h / H * 100}%;`;
  return s;
}
// Position über CSS-Variablen --s (px pro Einheit) und --top (Editor: kein Neu-Rendern beim Zoomen/Erweitern)
export function posVarParts(it) {
  if (it.pin) { // fixiert: relativ zum sichtbaren Bildschirm (Editor: Pin-Ebene)
    return {
      left: `calc(var(--pinLeft) + var(--s) * ${it.x} * 1px)`,
      top: it.pin === 't' ? `calc(var(--pinTop) + var(--s) * ${it.y} * 1px)` : '',
      bottom: it.pin === 'b' ? `calc(var(--pinBottom) + var(--s) * ${it.y} * 1px)` : '',
      width: `calc(var(--s) * ${it.w} * 1px)`,
      height: it.type === 'text' ? '' : `calc(var(--s) * ${it.h} * 1px)`,
    };
  }
  return {
    left: `calc(var(--s) * ${it.x} * 1px)`,
    top: `calc(var(--s) * (${it.y} - var(--top)) * 1px)`,
    width: `calc(var(--s) * ${it.w} * 1px)`,
    height: it.type === 'text' ? '' : `calc(var(--s) * ${it.h} * 1px)`,
  };
}
export function posVar(it) {
  const q = posVarParts(it);
  return `left:${q.left};` + (q.top ? `top:${q.top};` : '') + (q.bottom ? `bottom:${q.bottom};` : '') +
    `width:${q.width};` + (q.height ? `height:${q.height};` : '');
}
// Fixierte Elemente (it.pin = 't' oben | 'b' unten): y = Abstand zur Ober- bzw. Unterkante des Bildschirms
export function posPinLive(it, p) {
  const PW = pageW(p), cq = n => `calc(${n} * var(--u))`;
  let s = `left:${it.x / PW * 100}%;width:${it.w / PW * 100}%;` + (it.pin === 'b' ? `bottom:${cq(it.y)};` : `top:${cq(it.y)};`);
  if (it.type !== 'text') s += `height:${cq(it.h)};`;
  return s;
}
// angenommene Bildschirmhöhe (Einheiten) für Vorschaubilder: Desktop 16:9, Handy ~9:19,5
export const screenH = p => (pageW(p) === MW ? Math.round(MW * 2.1) : SCREEN);
export function pinTopY(it, p) { return it.pin === 'b' ? screenH(p) - it.y - (it.h || 60) : it.y; }

const isUrl = s => /^https?:\/\//i.test(String(s || ''));
export function mediaUrl(opt, pid, file) { return isUrl(file) ? file : opt.media(pid, file); }

// opt: { media(pageId,file)->url, link(pageId)->href|null, pos?(it)->css, editor?, thumb?, v? }
export function itemHTML(it, i, p, site, opt) {
  const pos = (opt.pos ? opt.pos(it)
    : !it.pin ? posPct(it, p)
    : opt.thumb ? posPct({ ...it, y: p.top + pinTopY(it, p) }, p) // Vorschaubild: Stand beim Seitenanfang
    : posPinLive(it, p)) + `z-index:${i + 1};` // eine gemeinsame Ebenen-Reihenfolge für alle Elemente
    + (+it.rot ? `--r:${num(+it.rot, 0)}deg;` : ''); // Drehung um die Mitte (site.css)
  const href = it.link && opt.link ? opt.link(it.link) : null;
  const tag = href ? 'a' : 'div';
  const cls = `it it-${esc(it.type)}${it.link ? ' has-link' : ''}${it.pin && !opt.thumb ? ' pinned' : ''}`;
  const ext = /^https?:\/\//i.test(href || '');
  const gal = it.gal && it.type === 'image' ? ` data-gal="${esc(it.gal)}"` : ''; // Galerie (Großansicht + Karussell)
  const head = `<${tag} class="${cls}" data-i="${i}"${gal}${href ? ` href="${esc(href)}"` : ''}${ext ? ' target="_blank" rel="noopener"' : ''}`;
  if (it.type === 'text') {
    let body = esc(it.text);
    // E-Mail-Adressen vor Adress-Sammlern verbergen: verschlüsselt im HTML, site.js macht daraus einen Link
    if (opt.protectEmail) body = body.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (m, a, b) =>
      `<span class="em" data-em="${[...m].map(c => c.charCodeAt(0) + 3).join('.')}">${a} [at] ${b.replace(/\./g, ' [punkt] ')}</span>`);
    const lang = ['de', 'en'].includes(it.lang) ? ` lang="${it.lang}"` : ''; // Sprache: Rechtschreibung, Silbentrennung, Screenreader
    return `${head} style="${esc(pos)}"><div class="tx"${lang} style="${esc(`width:${num(+it.w, 600)}px;` + textCss(styleOf(it, site), pageW(p)))}">${body}</div></${tag}>`;
  }
  // Zufallsschnitt: Clips aus einem Unterordner, live zufällig geschnitten (randomcut.mjs)
  if (it.type === 'random') {
    const dirUrl = mediaUrl(opt, p.id, it.dir || '');
    const poster = it.poster ? `${dirUrl}/${encodeURIComponent(it.poster)}` : '';
    if (opt.thumb || opt.editor) return `${head} style="${esc(pos)}">${poster ? `<img class="rc-poster" src="${esc(poster)}" alt="">` : ''}</${tag}>`;
    const clips = (it.clips || []).map(c => `${dirUrl}/${encodeURIComponent(c)}`);
    return `${head} style="${esc(pos)}" data-clips="${esc(JSON.stringify(clips))}">` +
      (poster ? `<img class="rc-poster" src="${esc(poster)}" alt="${esc(it.alt || '')}" loading="lazy">` : '') +
      `<video class="rc" muted playsinline preload="auto"></video><video class="rc" muted playsinline preload="auto"></video></${tag}>`;
  }
  // Handschrift-Objekt: im Editor Canvas (live gezeichnet), sonst das gespeicherte PNG
  if (it.type === 'draw') {
    if (opt.editor) return `${head} style="${esc(pos)}"><canvas class="draw-cv"></canvas></${tag}>`;
    const src = opt.media(p.id, `draw_${it.id}.png`) + (it.v ? `?v=${encodeURIComponent(it.v)}` : '');
    return `${head} style="${esc(pos)}"><img src="${esc(src)}" alt="${esc(it.alt || '')}" loading="lazy" decoding="async" style="width:100%;height:100%;left:0;top:0"></${tag}>`;
  }
  const inner = esc(cropInner(it));
  if (it.type === 'video') {
    const src = esc(mediaUrl(opt, p.id, it.src));
    const poster = it.poster ? ` poster="${esc(mediaUrl(opt, p.id, it.poster))}"` : '';
    let v;
    if ((opt.thumb || opt.editor) && it.poster) v = `<img src="${esc(mediaUrl(opt, p.id, it.poster))}" alt="" style="${inner}">`;
    else if (opt.thumb || opt.editor) v = `<video src="${src}#t=0.5" muted playsinline preload="metadata" style="${inner}"></video>`;
    else if (it.mode === 'scene' && !opt.editor && !href) {
      // Szene: startet, sobald ganz im Bild; Ton blendet mit der Sichtbarkeit ein/aus; Klick = Ton an/aus (site.js)
      v = `<video src="${src}"${poster} playsinline preload="metadata" data-scene style="${inner}"></video>` +
        `<button class="snd" type="button" aria-label="Ton an/aus"></button>`;
    }
    else if (it.mode !== 'player' || href) {
      v = `<video src="${src}"${poster} muted loop playsinline preload="metadata" data-loop style="${inner}"></video>`;
    } else {
      v = `<video src="${src}"${poster} controls playsinline preload="metadata" style="${inner}"></video>`;
    }
    return `${head} style="${esc(pos)}">${v}</${tag}>`;
  }
  // image
  const src = esc(mediaUrl(opt, p.id, it.src));
  const img = `<img src="${src}" alt="${esc(it.alt || '')}" loading="lazy" decoding="async" style="${inner}">`;
  const vars = opt.variants ? opt.variants(p.id, it.src) : null;
  if (!vars || !vars.length) return `${head} style="${esc(pos)}">${img}</${tag}>`;
  // angezeigte Breite = Anteil an der Seitenbreite (bei Ausschnitt entsprechend größer) -> exakte „sizes"
  const vw = Math.min(400, it.w / pageW(p) / (it.crop ? it.crop.w : 1) * 100);
  const dir = opt.media(p.id, 'resp');
  const srcset = vars.map(v => `${v.orig ? mediaUrl(opt, p.id, it.src) : `${dir}/${encodeURIComponent(v.name)}`} ${v.w}w`).join(', ');
  const sizes = `${vw.toFixed(2)}vw`;
  if (vars[0].type === 'image/jpeg') { // JPEG-Fassungen: direkt im <img>
    return `${head} style="${esc(pos)}"><img src="${src}" srcset="${esc(srcset)}" sizes="${sizes}" alt="${esc(it.alt || '')}" loading="lazy" decoding="async" style="${inner}"></${tag}>`;
  }
  return `${head} style="${esc(pos)}"><picture><source type="image/webp" srcset="${esc(srcset)}" sizes="${sizes}">${img}</picture></${tag}>`;
}

export function inkHTML(p, opt) {
  const H = pageH(p);
  return (p.ink || []).map(k => {
    const src = opt.media(p.id, `${p.inkPrefix || 'ink_'}${k}.png`) + (opt.v ? `?v=${encodeURIComponent(opt.v)}` : '');
    return `<img class="ink" alt="" loading="lazy" src="${esc(src)}" style="top:${(k * TILE - p.top) / H * 100}%;height:${TILE / H * 100}%">`;
  }).join('');
}

// Fixierte Elemente liegen MIT in .pg (position:fixed) -> eine Ebenen-Reihenfolge für alles.
// Darum darf .pg weder transform noch containment haben (würde position:fixed einfangen).
export function pageHTML(p, site, opt, cls = '') {
  const items = p.items.map((it, i) => itemHTML(it, i, p, site, opt)).join('');
  const bg = color(p.bg, BG);
  // --k = Bildschirm-px pro Seiten-Einheit (ohne Einheit, für transform), --u = dasselbe als Länge
  const k = opt.k || `calc(var(--vwn, 19.2) * ${100 / pageW(p)})`;
  return `<div class="pg${cls ? ' ' + cls : ''}" style="aspect-ratio:${pageW(p)}/${pageH(p)};background:${bg};--k:${k};--u:calc(var(--k) * 1px)">${items}<div class="ink-layer">${inkHTML(p, opt)}</div></div>`;
}
