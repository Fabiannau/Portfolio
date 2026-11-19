// Komplettes HTML-Dokument einer Seite – identisch für Build (dist/) und Editor-Vorschau (/preview/).
import { esc, pageHTML, mobileView, BG, MOBILE_MAX } from './render.mjs';
import { AI_META } from './aiprotect.mjs';

const FMT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };
export function fontFaceCSS(fonts, prefix = '') {
  return fonts.map(f => {
    const ext = f.file.slice(f.file.lastIndexOf('.')).toLowerCase();
    const weight = f.variable ? `${f.wmin || 100} ${f.wmax || 900}` : (f.weight || 400);
    return `@font-face{font-family:"${String(f.family).replace(/["\\<>]/g, '')}";src:url("${prefix}fonts/${encodeURIComponent(f.file)}") format("${FMT[ext] || 'woff2'}");` +
      `font-weight:${weight};font-style:${f.style === 'italic' ? 'italic' : 'normal'};font-display:swap}`;
  }).join('\n');
}

export const pageFile = id => (id === 'index' ? 'index.html' : `${encodeURIComponent(id)}.html`);

// Galerie-Symbole: Größe wie Handschrift auf der Seite (Einheiten -> Bildschirmbreite), mit Mindest-/Höchstgröße
function galleryCSS(ui) {
  if (!ui) return '';
  const cls = { prev: '.lb .lb-prev', next: '.lb .lb-next', close: '.lb .lb-x' };
  return Object.entries(ui).filter(([r]) => cls[r]).map(([r, g]) =>
    `${cls[r]}{font-size:0;opacity:1;background:url("ui/gal-${r}.png?v=${encodeURIComponent(g.v || '')}") center/contain no-repeat;` +
    `width:clamp(34px,calc(${+g.w} * var(--vwn,19.2) * 100px / 2560),110px);height:auto;aspect-ratio:${+g.w}/${+g.h}}`).join('\n');
}

export function renderDocument(page, site, fonts, ids, variants = null, galleryUi = null) {
  const known = new Set(ids);
  const opt = {
    variants: variants ? (pid, src) => variants.get(src) : null,
    media: (pid, f) => `media/${encodeURIComponent(pid)}/${encodeURIComponent(f)}`,
    protectEmail: true,
    link: id => (/^https?:\/\//i.test(id) ? id : known.has(id) ? pageFile(id) : null), // Seite oder externe Webseite
    v: page.updated,
  };
  // Mit Handy-Layout: beide Fassungen ausliefern, CSS zeigt die passende (Videos spielt nur die sichtbare, s. site.js)
  const mv = mobileView(page);
  const body = mv
    ? pageHTML({ ...page, items: page.items }, site, opt, 'pg-d') + pageHTML(mv, site, opt, 'pg-m')
    : pageHTML(page, site, opt);
  // Impressum muss von jeder Seite aus erreichbar sein -> Link am Seitenende
  const legal = known.has('impressum') && page.id !== 'impressum'
    ? `<footer class="legal"><a href="${pageFile('impressum')}">Impressum &amp; Datenschutz</a></footer>` : '';
  const title = page.id === 'index' ? site.title : `${page.title} – ${site.title}`;
  const bg = page.bg || BG;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${page.id === 'impressum' ? AI_META.replace('noai, noimageai', 'noindex, noai, noimageai') : AI_META}
<title>${esc(title)}</title>
<link rel="stylesheet" href="site.css">
<script>(function(){var d=document.documentElement;if(/[?&]ansicht=handy/.test(location.search))d.classList.add('force-m');
function v(){d.style.setProperty('--vwn',d.clientWidth/100)}v();addEventListener('resize',v);if(window.ResizeObserver)new ResizeObserver(v).observe(d)})()</script>
<style>
${fontFaceCSS(fonts)}
html,body{margin:0;background:${esc(bg)}}
${galleryCSS(galleryUi)}
.legal{padding:28px 16px 34px;text-align:center;font:13px/1.4 -apple-system,system-ui,sans-serif}
.legal a{color:#141311;opacity:.55;text-decoration:none}.legal a:hover{opacity:1;text-decoration:underline}
.pg-m{display:none}
@media (max-width:${MOBILE_MAX}px){.pg-d{display:none}.pg-m{display:block}}
html.force-m .pg-d{display:none}html.force-m .pg-m{display:block}
</style>
</head>
<body>
<main>${body}</main>
${legal}
<script type="module" src="site.js"></script>
</body>
</html>
`;
}
