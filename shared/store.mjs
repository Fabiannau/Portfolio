// Dateizugriff auf content/ – gemeinsam für Editor-Server und Build (identische Logik).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_STYLES, normalizePage } from './render.mjs';
import { fontInfo } from './fontinfo.mjs';

export const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg']);
export const VID_EXT = new Set(['.mp4', '.webm']);
export const FONT_EXT = new Set(['.woff2', '.woff', '.ttf', '.otf']);

export function paths(root) {
  const content = path.join(root, 'content');
  return {
    root, content,
    pages: path.join(content, 'pages'),
    fonts: path.join(content, 'fonts'),
    siteFile: path.join(content, 'site.json'),
  };
}

export function normalizeSite(s = {}) {
  return {
    title: typeof s.title === 'string' && s.title ? s.title : 'Portfolio',
    styles: Array.isArray(s.styles) ? s.styles : DEFAULT_STYLES.map(x => ({ ...x, props: { ...x.props } })),
    graph: s.graph && typeof s.graph === 'object' ? s.graph : {},
  };
}
export async function readSite(P) {
  try { return normalizeSite(JSON.parse(await fs.readFile(P.siteFile, 'utf8'))); }
  catch { return normalizeSite({}); }
}

export async function listPageIds(P) {
  await fs.mkdir(P.pages, { recursive: true });
  const e = await fs.readdir(P.pages, { withFileTypes: true });
  return e.filter(d => d.isDirectory() && !/^[._]/.test(d.name)).map(d => d.name)
    .sort((a, b) => (a === 'index' ? -1 : b === 'index' ? 1 : a.localeCompare(b)));
}
export async function readPage(P, id) {
  try { return normalizePage(JSON.parse(await fs.readFile(path.join(P.pages, id, 'page.json'), 'utf8')), id); }
  catch { return normalizePage({}, id); }
}

// Dateien einer Seite, die als Medien gelten (keine Zeichen-Kacheln, Poster, Zwischendateien)
export function isMediaFile(name) {
  const ext = path.extname(name).toLowerCase();
  if (name === 'page.json' || name.startsWith('.') || /^m?ink_-?\d+\.png$/.test(name) || /^draw_[a-z0-9]+\.png$/.test(name)) return false;
  if (name.includes('.part.') || name.endsWith('.poster.jpg')) return false;
  return IMG_EXT.has(ext) || VID_EXT.has(ext);
}
export async function listMedia(P, id) {
  const dir = path.join(P.pages, id);
  let files = [];
  try { files = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const names = new Set(files.map(f => f.name));
  const out = [];
  for (const f of files) {
    if (!f.isFile() || !isMediaFile(f.name)) continue;
    const ext = path.extname(f.name).toLowerCase();
    const kind = VID_EXT.has(ext) ? 'video' : 'image';
    const posterName = path.basename(f.name, ext) + '.poster.jpg';
    const st = await fs.stat(path.join(dir, f.name));
    out.push({ name: f.name, kind, size: st.size, poster: kind === 'video' && names.has(posterName) ? posterName : null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Schriften: Name/Stärke/Kursiv werden aus der Datei gelesen (Fallback: Dateiname). Cache nach Änderungszeit.
const fontCache = new Map();
export async function fontFileInfo(fp) {
  const st = await fs.stat(fp);
  const c = fontCache.get(fp);
  if (c && c.mtime === st.mtimeMs) return c.info;
  let info = null;
  try { info = fontInfo(await fs.readFile(fp)); } catch {}
  fontCache.set(fp, { mtime: st.mtimeMs, info });
  return info;
}
export async function listFonts(P) {
  let files = [];
  try { files = await fs.readdir(P.fonts); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!FONT_EXT.has(path.extname(f).toLowerCase())) continue;
    const info = await fontFileInfo(path.join(P.fonts, f));
    out.push(info ? { file: f, ...info } : { file: f, family: path.basename(f, path.extname(f)), sub: 'Regular', weight: 400, style: 'normal', variable: false, wmin: 400, wmax: 400 });
  }
  return out.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style));
}
