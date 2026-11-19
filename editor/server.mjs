// Lokaler Editor-Server für Portfolio 2.0.
// Pure Node (keine npm-Abhängigkeiten) -> läuft sofort per Doppelklick auf Portfolio-Editor.app.
import http from 'node:http';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { paths, readSite, normalizeSite, listPageIds, readPage, listMedia, listFonts, IMG_EXT, VID_EXT, isMediaFile } from '../shared/store.mjs';
import { renderDocument } from '../shared/document.mjs';
import { fontInfo, toWoff, unzip } from '../shared/fontinfo.mjs';
import { fontFileInfo, listVariants, VAR_DIR, VAR_WIDTHS, VAR_SRC, readGalleryUi, GAL_ROLES } from '../shared/store.mjs';
import os from 'node:os';
import { normalizePage, SCREEN } from '../shared/render.mjs';

const pexec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const P = paths(ROOT);
const EDITOR_PUBLIC = path.join(__dirname, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4466;
const GIT_MAX = 95 * 1024 * 1024; // GitHub lehnt Dateien > 100 MB ab
const ENV = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const IMG_IN = new Set([...IMG_EXT, '.heic', '.heif', '.tif', '.tiff']);
const VID_IN = new Set([...VID_EXT, '.mov', '.m4v', '.mkv', '.avi', '.mxf']);

// ---------- Helfer ----------
const newVer = () => Date.now().toString(36);
function safeId(id) {
  return String(id || '').toLowerCase().trim()
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]))
    .replace(/[^a-z0-9\-_ ]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
function safeBase(name) {
  return path.basename(name || '', path.extname(name || '')).replace(/[^a-z0-9\-_]/gi, '_').replace(/_+/g, '_').slice(0, 60) || 'datei';
}
function within(base, ...parts) {
  const p = path.resolve(base, ...parts);
  if (p !== base && !p.startsWith(base + path.sep)) return null;
  return p;
}
const pageDir = id => (id ? within(P.pages, id) : null);
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function uniqueName(dir, base, ext) {
  let n = `${base}${ext}`, i = 1;
  while (await exists(path.join(dir, n))) n = `${base}-${i++}${ext}`;
  return n;
}
async function readBody(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); }
async function readJson(req) { const b = (await readBody(req)).toString('utf8'); return b ? JSON.parse(b) : {}; }
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');

// Dateien mit Range-Unterstützung (für <video>-Spulen)
async function serveFile(req, res, fp) {
  let st;
  try { st = await fs.stat(fp); if (!st.isFile()) throw 0; } catch { return send(res, 404, 'Not found'); }
  const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Number(range[2]) : st.size - 1;
    if (!range[1] && range[2]) { start = st.size - Number(range[2]); end = st.size - 1; }
    if (start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
    return createReadStream(fp, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(fp).pipe(res);
}

// ---------- Seiten ----------
async function writePage(page) {
  const dir = pageDir(page.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'page.json'), JSON.stringify(page), 'utf8');
}
async function writeSite(site) {
  await fs.mkdir(P.content, { recursive: true });
  await fs.writeFile(P.siteFile, JSON.stringify(normalizeSite(site), null, 2), 'utf8');
}
async function ensureIndex() {
  const dir = pageDir('index');
  if (!(await exists(path.join(dir, 'page.json')))) await writePage(normalizePage({}, 'index'));
  if (!(await exists(P.siteFile))) await writeSite({});
}
// Links in allen Seiten umschreiben (Umbenennen) oder entfernen (Löschen, to=null)
async function relink(from, to) {
  for (const id of await listPageIds(P)) {
    const pg = await readPage(P, id);
    let ch = false;
    for (const it of pg.items) if (it.link === from) { if (to) it.link = to; else delete it.link; ch = true; }
    if (ch) await writePage(pg);
  }
}
async function summaries() {
  const out = [];
  for (const id of await listPageIds(P)) { const p = await readPage(P, id); out.push({ id, title: p.title }); }
  return out;
}

// ---------- Medien-Verarbeitung ----------
async function have(cmd) { try { await pexec(cmd, ['-version'], { env: ENV }); return true; } catch { return false; } }
let FFMPEG = null;
async function ffmpegOk() { if (FFMPEG === null) FFMPEG = (await have('ffmpeg')) && (await have('ffprobe')); return FFMPEG; }

async function probe(file) {
  const { stdout } = await pexec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { env: ENV, maxBuffer: 8e6 });
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
  let w = v.width || 1920, h = v.height || 1080;
  let rot = Number(v.tags?.rotate || 0);
  for (const sd of v.side_data_list || []) if (sd.rotation != null) rot = Number(sd.rotation);
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  return { w, h, codec: v.codec_name, pix: v.pix_fmt, duration: Number(j.format?.duration || v.duration || 0), size: Number(j.format?.size || 0) };
}

const jobs = new Map(); // id -> {id,page,name,status,progress,error,warn}
let jobSeq = 0;
let queue = Promise.resolve();
function enqueue(fn) { queue = queue.then(fn, fn); return queue; }

async function makePoster(src, dir, base, duration) {
  const poster = `${base}.poster.jpg`;
  const t = String(Math.min(1, (duration || 2) / 3).toFixed(2));
  try {
    await pexec('ffmpeg', ['-y', '-v', 'error', '-ss', t, '-i', src, '-frames:v', '1', '-vf', "scale='min(1920,iw)':-2", '-q:v', '3', path.join(dir, poster)], { env: ENV });
    return poster;
  } catch { return null; }
}

// Hochwertige Web-Version: H.264 High, CRF 20 (visuell nahezu verlustfrei), max. 2560 px lange Kante, Faststart
function transcode(job, src, out, duration) {
  return new Promise((resolve, reject) => {
    const scale = "scale='if(gte(iw,ih),min(2560,iw),-2)':'if(gte(iw,ih),-2,min(2560,ih))'";
    const args = ['-y', '-v', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-vf', scale,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out];
    const ff = spawn('ffmpeg', args, { env: ENV });
    let err = '';
    ff.stdout.on('data', d => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && duration) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / duration);
    });
    ff.stderr.on('data', d => { err += d; });
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg Fehler ${code}`))));
  });
}

// Zu groß für GitHub? -> Zwei-Pass auf Zielgröße (~88 MB): ffmpeg analysiert erst das ganze Video und
// verteilt die Datenmenge dann gezielt auf schwierige Stellen -> beste Qualität bei fester Größe.
const TARGET_BYTES = 88 * 1024 * 1024;
function runFF(job, args, duration, from, to) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', args[args.length - 1]], { env: ENV });
    let err = '';
    ff.stdout.on('data', d => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && duration) job.progress = Math.min(0.99, from + (to - from) * Number(m[1]) / 1e6 / duration);
    });
    ff.stderr.on('data', d => { err += d; });
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg Fehler ${code}`))));
  });
}
async function transcodeToSize(job, src, out, duration, dir) {
  const audioK = 160;
  const videoK = Math.max(300, Math.floor(TARGET_BYTES * 8 / duration / 1000 * 0.985 - audioK));
  const scale = "scale='if(gte(iw,ih),min(2560,iw),-2)':'if(gte(iw,ih),-2,min(2560,ih))'";
  const log = path.join(dir, `.pass-${job.id}`);
  const common = ['-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-b:v', `${videoK}k`, '-maxrate', `${videoK * 2}k`, '-bufsize', `${videoK * 4}k`,
    '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-vf', scale, '-passlogfile', log];
  job.status = 'läuft'; job.note = 'verkleinert auf ~88 MB';
  try {
    await runFF(job, ['-y', '-v', 'error', '-i', src, '-map', '0:v:0', ...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null'], duration, 0.5, 0.75);
    await runFF(job, ['-y', '-v', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', ...common, '-pass', '2',
      '-c:a', 'aac', '-b:a', `${audioK}k`, '-movflags', '+faststart', out], duration, 0.75, 0.99);
  } finally {
    for (const f of await fs.readdir(dir)) if (f.startsWith(`.pass-${job.id}`)) await fs.rm(path.join(dir, f), { force: true });
  }
}

async function handleUpload(req, res, id, rawName) {
  const dir = pageDir(id);
  if (!dir || !(await exists(dir))) return sendJson(res, 400, { error: 'Seite nicht gefunden' });
  const ext = path.extname(rawName || '').toLowerCase();
  const kind = IMG_IN.has(ext) ? 'image' : VID_IN.has(ext) ? 'video' : null;
  if (!kind) return sendJson(res, 400, { error: `Dateityp ${ext || '?'} wird nicht unterstützt` });
  const base = safeBase(rawName);
  const odir = path.join(dir, '_originals');
  await fs.mkdir(odir, { recursive: true });
  const orig = path.join(odir, await uniqueName(odir, base, ext));
  await pipeline(req, createWriteStream(orig));

  if (kind === 'image') {
    const webOk = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'].includes(ext);
    let w = 0, h = 0;
    try {
      const { stdout } = await pexec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', orig], { env: ENV });
      w = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1] || 0); h = Number(/pixelHeight: (\d+)/.exec(stdout)?.[1] || 0);
    } catch {}
    const big = Math.max(w, h) > 3200;
    const keepAsIs = ['.gif', '.svg', '.webp', '.avif'].includes(ext) || (webOk && !big);
    let name;
    if (keepAsIs) {
      name = await uniqueName(dir, base, ext === '.jpeg' ? '.jpg' : ext);
      await fs.rename(orig, path.join(dir, name)); // kleine Web-Formate: direkt übernehmen
    } else {
      // zu groß oder HEIC/TIFF -> mit macOS-„sips" auf max. 3200 px / JPEG Q88 (PNG bleibt PNG)
      const outExt = ext === '.png' ? '.png' : '.jpg';
      name = await uniqueName(dir, base, outExt);
      const args = outExt === '.jpg' ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88'] : ['-s', 'format', 'png'];
      if (big) args.push('-Z', '3200');
      try { await pexec('sips', [...args, orig, '--out', path.join(dir, name)], { env: ENV }); }
      catch (e) {
        if (!webOk) return sendJson(res, 400, { error: 'Bild konnte nicht umgewandelt werden (sips).' });
        await fs.copyFile(orig, path.join(dir, name));
      }
      if (big) { const s = 3200 / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    }
    ensureVariants(id); // kleinere Fassungen im Hintergrund erzeugen
    return sendJson(res, 200, { ok: true, kind, name, w, h });
  }

  // Video
  if (!(await ffmpegOk())) {
    if (!VID_EXT.has(ext)) return sendJson(res, 400, { error: 'ffmpeg fehlt – nur MP4/WebM möglich (brew install ffmpeg).' });
    const name = await uniqueName(dir, base, ext);
    await fs.rename(orig, path.join(dir, name));
    return sendJson(res, 200, { ok: true, kind, name, w: 1920, h: 1080 });
  }
  let info;
  try { info = await probe(orig); } catch { return sendJson(res, 400, { error: 'Video nicht lesbar (ffprobe).' }); }
  const name = await uniqueName(dir, base, '.mp4');
  const nbase = path.basename(name, '.mp4');
  const direct = ext === '.mp4' && info.codec === 'h264' && info.pix === 'yuv420p' && info.size < GIT_MAX && Math.max(info.w, info.h) <= 3840;
  const job = { id: String(++jobSeq), page: id, name, status: 'wartet', progress: 0, error: null, warn: null };
  jobs.set(job.id, job);
  const poster = `${nbase}.poster.jpg`;
  enqueue(async () => {
    job.status = 'läuft';
    try {
      const out = path.join(dir, name);
      if (direct) {
        await fs.rename(orig, out); // schon web-tauglich: nichts neu komprimieren
      } else {
        const tmp = path.join(dir, `${nbase}.part.mp4`);
        await transcode(job, orig, tmp, info.duration);
        if ((await fs.stat(tmp)).size > GIT_MAX && info.duration > 0) {
          job.progress = 0.5;
          await transcodeToSize(job, orig, tmp, info.duration, dir); // zweiter Anlauf mit Zielgröße
        }
        await fs.rename(tmp, out);
      }
      await makePoster(out, dir, nbase, info.duration);
      const st = await fs.stat(out);
      if (st.size > GIT_MAX) job.warn = `Datei ist ${Math.round(st.size / 1048576)} MB – GitHub erlaubt max. 100 MB pro Datei. Video kürzen oder extern hosten.`;
      job.progress = 1; job.status = 'fertig';
    } catch (e) {
      job.status = 'fehler'; job.error = String(e.message || e).slice(0, 300);
    }
  });
  return sendJson(res, 200, { ok: true, kind, name, w: info.w, h: info.h, poster, job: job.id, direct });
}

// ---------- Schriften ----------
const FONT_IN = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const SYS_FONT_DIRS = [path.join(os.homedir(), 'Library', 'Fonts'), '/Library/Fonts'];
const fontKey = i => `${i.family}|${i.variable ? 'var' : i.weight}|${i.style}`;
// entries: [{name, data}] -> Schriften übernehmen (TTF/OTF werden zu WOFF), Doppeltes überspringen
async function addFonts(entries) {
  await fs.mkdir(P.fonts, { recursive: true });
  const existing = await listFonts(P);
  const have = new Set(existing.map(fontKey));
  const added = [], skipped = [], cands = [];
  for (const e of entries) {
    const base = path.basename(e.name);
    if (base.startsWith('.') || e.name.includes('__MACOSX')) continue;
    const ext = path.extname(base).toLowerCase();
    if (!FONT_IN.has(ext)) continue;
    const info = fontInfo(e.data);
    if (!info) { skipped.push(`${base} (nicht lesbar)`); continue; }
    cands.push({ base, ext, data: e.data, info });
  }
  // Google-Fonts-ZIPs enthalten variable UND statische Dateien -> variable genügt
  const varKeys = new Set([...existing, ...cands.map(c => c.info)].filter(i => i.variable).map(i => `${i.family}|${i.style}`));
  for (const c of cands) {
    if (!c.info.variable && varKeys.has(`${c.info.family}|${c.info.style}`)) continue;
    const key = fontKey(c.info);
    if (have.has(key)) { skipped.push(`${c.info.family} ${c.info.sub} (schon da)`); continue; }
    have.add(key);
    let data = c.data, ext = c.ext;
    if (ext === '.ttf' || ext === '.otf') {
      try { const w = toWoff(c.data); if (w && fontInfo(w)) { data = w; ext = '.woff'; } } catch {}
    }
    const name = await uniqueName(P.fonts, safeBase(c.base), ext);
    await fs.writeFile(path.join(P.fonts, name), data);
    added.push(`${c.info.family} ${c.info.variable ? '(variabel' + (c.info.style === 'italic' ? ', kursiv)' : ')') : c.info.sub}`);
  }
  return { added, skipped };
}
async function systemFontFiles() {
  const out = [];
  for (const dir of SYS_FONT_DIRS) {
    let files = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!FONT_IN.has(path.extname(f).toLowerCase())) continue;
      const fp = path.join(dir, f);
      const info = await fontFileInfo(fp).catch(() => null);
      if (info) out.push({ fp, info });
    }
  }
  return out;
}

// ---------- Responsive Bildfassungen ----------
// Je Bild kleinere Fassungen in mehreren Breiten. Der Browser lädt live nur die passende.
// Qualität wird PRO BILD gewählt: WebP in steigender Qualität, bis es dem gleich groß verkleinerten Original
// zum Verwechseln ähnlich ist (SSIM ≥ 0,97); schafft WebP das nicht (stark körnige oder schon komprimierte Fotos),
// hochwertiges JPEG (Q90). Entscheidung wird in resp/.settings.json gemerkt.
const SSIM_MIN = 0.97;
let TOOLS = null;
async function toolsOk() {
  if (TOOLS === null) { try { await pexec('cwebp', ['-version'], { env: ENV }); await pexec('dwebp', ['-version'], { env: ENV }); TOOLS = await ffmpegOk(); } catch { TOOLS = false; } }
  return TOOLS;
}
async function ssim(a, b) {
  const r = await pexec('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { env: ENV, maxBuffer: 8e6 }).catch(e => e);
  return Number(/All:([0-9.]+)/.exec(String(r.stderr || ''))?.[1] || 0);
}
async function resizedPng(src, w, w0, out) { // gleiche Verkleinerung für Referenz und Fassung (macOS sips)
  const args = ['-s', 'format', 'png'];
  if (w < w0) args.push('--resampleWidth', String(w));
  await pexec('sips', [...args, src, '--out', out], { env: ENV });
}
async function chooseSettings(src, w0, tmp) {
  const pw = Math.min(1440, w0);
  const ref = path.join(tmp, 'ref.png'), t = path.join(tmp, 't.webp'), tp = path.join(tmp, 't.png');
  await resizedPng(src, pw, w0, ref);
  for (const q of [82, 88, 92, 95]) {
    await pexec('cwebp', ['-quiet', '-mt', '-m', '6', '-sharp_yuv', '-q', String(q), ref, '-o', t], { env: ENV });
    await pexec('dwebp', ['-quiet', t, '-o', tp], { env: ENV });
    const v = await ssim(ref, tp);
    if (v >= SSIM_MIN) return { fmt: 'webp', q, ssim: v };
  }
  return { fmt: 'jpg', q: 90 };
}
let variantQueue = Promise.resolve();
function ensureVariants(id) { variantQueue = variantQueue.then(() => buildVariants(id)).catch(e => console.error('Fassungen', id, e.message)); return variantQueue; }
async function buildVariants(id) {
  if (!(await toolsOk())) return;
  const dir = pageDir(id); if (!dir) return;
  const vdir = path.join(dir, VAR_DIR);
  const files = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter(f => f.isFile() && VAR_SRC.test(f.name) && isMediaFile(f.name)).map(f => f.name);
  const setFile = path.join(vdir, '.settings.json');
  let settings = {};
  try { settings = JSON.parse(await fs.readFile(setFile, 'utf8')); } catch {}
  const want = new Set(['.settings.json']);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'resp-'));
  try {
    for (const f of files) {
      const src = path.join(dir, f);
      let w0 = 0;
      try { const { stdout } = await pexec('sips', ['-g', 'pixelWidth', src], { env: ENV }); w0 = Number(/pixelWidth: (\d+)/.exec(stdout)?.[1] || 0); } catch {}
      if (!w0) continue;
      const mt = (await fs.stat(src)).mtimeMs;
      let st = settings[f];
      if (!st || st.mt !== mt) { st = { ...(await chooseSettings(src, w0, tmp)), mt }; settings[f] = st; }
      const top = Math.min(w0, VAR_WIDTHS[VAR_WIDTHS.length - 1]);
      st.w0 = w0;
      for (const w of [...VAR_WIDTHS.filter(x => x < top), top]) {
        if (st.fmt === 'jpg' && w === w0 && /\.jpe?g$/i.test(f)) continue; // JPEG-Original in Originalbreite = beste Fassung
        const name = `${f}-${w}.${st.fmt}`;
        want.add(name);
        const out = path.join(vdir, name);
        try { if ((await fs.stat(out)).mtimeMs >= mt) continue; } catch {}
        await fs.mkdir(vdir, { recursive: true });
        const png = path.join(tmp, 'w.png');
        await resizedPng(src, w, w0, png);
        if (st.fmt === 'webp') await pexec('cwebp', ['-quiet', '-mt', '-m', '6', '-sharp_yuv', '-q', String(st.q), png, '-o', out + '.part'], { env: ENV });
        else await pexec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(st.q), png, '--out', out + '.part.jpg'], { env: ENV }).then(() => fs.rename(out + '.part.jpg', out + '.part'));
        await fs.rename(out + '.part', out);
      }
    }
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  for (const k of Object.keys(settings)) if (!files.includes(k)) delete settings[k];
  if (files.length) { await fs.mkdir(vdir, { recursive: true }); await fs.writeFile(setFile, JSON.stringify(settings, null, 1)); }
  // Fassungen gelöschter Bilder / alter Formate entfernen
  for (const f of await fs.readdir(vdir).catch(() => [])) if (!want.has(f)) await fs.rm(path.join(vdir, f), { force: true });
}
async function ensureAllVariants() { for (const id of await listPageIds(P)) await ensureVariants(id); }

// ---------- Veröffentlichen ----------
function git(args) {
  return pexec('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, env: { ...ENV, GIT_TERMINAL_PROMPT: '0' } });
}
async function tooLargeFiles() {
  const out = [];
  for (const id of await listPageIds(P)) {
    const dir = pageDir(id);
    for (const f of await fs.readdir(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      const st = await fs.stat(path.join(dir, f.name));
      if (st.size > GIT_MAX) out.push(`${id}/${f.name} (${Math.round(st.size / 1048576)} MB)`);
    }
  }
  return out;
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = req.method || 'GET';
    const q = k => url.searchParams.get(k);

    if (pathname === '/health') return send(res, 200, 'ok');

    // ---- API ----
    if (pathname.startsWith('/api/')) {
      const route = `${method} ${pathname}`;
      switch (route) {
        case 'GET /api/boot': {
          return sendJson(res, 200, { site: await readSite(P), pages: await summaries(), fonts: await listFonts(P), ffmpeg: await ffmpegOk() });
        }
        case 'GET /api/all': {
          const pages = [];
          for (const id of await listPageIds(P)) pages.push(await readPage(P, id));
          return sendJson(res, 200, { site: await readSite(P), pages });
        }
        case 'POST /api/site': {
          const s = await readJson(req);
          await writeSite(s);
          return sendJson(res, 200, { ok: true });
        }
        case 'GET /api/page': {
          const id = safeId(q('id'));
          const dir = pageDir(id);
          if (!dir || !(await exists(dir))) return sendJson(res, 404, { error: 'Seite nicht gefunden' });
          return sendJson(res, 200, { page: await readPage(P, id), media: await listMedia(P, id) });
        }
        case 'POST /api/page': {
          const id = safeId(q('id'));
          if (!pageDir(id)) return sendJson(res, 400, { error: 'Ungültige Seite' });
          const page = normalizePage(await readJson(req), id);
          page.id = id;
          await writePage(page);
          return sendJson(res, 200, { ok: true });
        }
        case 'GET /api/media': {
          const id = safeId(q('id'));
          return sendJson(res, 200, { media: await listMedia(P, id) });
        }
        case 'POST /api/pages': { // neue Seite
          const b = await readJson(req);
          const base = safeId(b.id || b.title) || 'seite';
          let id = base, n = 2;
          while (await exists(pageDir(id))) id = `${base}-${n++}`;
          const page = normalizePage({ title: b.title || id, bottom: SCREEN }, id);
          await writePage(page);
          if (b.pos) { const site = await readSite(P); site.graph[id] = { x: +b.pos.x || 0, y: +b.pos.y || 0 }; await writeSite(site); }
          return sendJson(res, 200, { ok: true, page, pages: await summaries(), site: await readSite(P) });
        }
        case 'POST /api/rename': {
          const b = await readJson(req);
          const id = safeId(b.id), newId = safeId(b.newId);
          if (!id || !newId || id === 'index') return sendJson(res, 400, { error: 'Diese Seite kann nicht umbenannt werden' });
          if (id !== newId) {
            const from = pageDir(id), to = pageDir(newId);
            if (!(await exists(from))) return sendJson(res, 404, { error: 'Seite nicht gefunden' });
            if (await exists(to)) return sendJson(res, 400, { error: 'Name existiert bereits' });
            await fs.rename(from, to);
            const pg = await readPage(P, newId); pg.id = newId; await writePage(pg);
            await relink(id, newId);
            const site = await readSite(P);
            if (site.graph[id]) { site.graph[newId] = site.graph[id]; delete site.graph[id]; await writeSite(site); }
          }
          return sendJson(res, 200, { ok: true, id: newId, pages: await summaries(), site: await readSite(P) });
        }
        case 'DELETE /api/page': {
          const id = safeId(q('id'));
          if (!id || id === 'index') return sendJson(res, 400, { error: 'Die Startseite kann nicht gelöscht werden' });
          const dir = pageDir(id);
          if (!dir || dir === P.pages) return sendJson(res, 400, { error: 'Ungültige Seite' });
          await fs.rm(dir, { recursive: true, force: true });
          await relink(id, null);
          const site = await readSite(P);
          delete site.graph[id]; await writeSite(site);
          return sendJson(res, 200, { ok: true, pages: await summaries(), site });
        }
        case 'POST /api/ink': { // Zeichen-Kachel (PNG)
          const id = safeId(q('id')), k = parseInt(q('k'), 10);
          const dir = pageDir(id);
          if (!dir || !Number.isFinite(k)) return sendJson(res, 400, { error: 'Ungültig' });
          const pre = q('pre') === 'mink' ? 'mink' : 'ink';
          await fs.writeFile(path.join(dir, `${pre}_${k}.png`), await readBody(req));
          return sendJson(res, 200, { ok: true });
        }
        case 'POST /api/drawobj': { // Handschrift-Objekt als PNG (draw_<itemId>.png)
          const id = safeId(q('id')), item = String(q('item') || '');
          const dir = pageDir(id);
          if (!dir || !/^[a-z0-9]{1,24}$/.test(item)) return sendJson(res, 400, { error: 'Ungültig' });
          await fs.writeFile(path.join(dir, `draw_${item}.png`), await readBody(req));
          return sendJson(res, 200, { ok: true });
        }
        case 'POST /api/draw-clean': { // PNGs nicht mehr existierender Handschrift-Objekte löschen
          const dir = pageDir(safeId(q('id')));
          if (!dir) return sendJson(res, 400, { error: 'Ungültig' });
          const keep = new Set(((await readJson(req)).keep || []).map(k => `draw_${String(k).replace(/[^a-z0-9]/g, '')}.png`));
          for (const f of await fs.readdir(dir)) if (/^draw_[a-z0-9]+\.png$/.test(f) && !keep.has(f)) await fs.rm(path.join(dir, f), { force: true });
          return sendJson(res, 200, { ok: true });
        }
        case 'POST /api/ink-clean': { // nicht mehr benötigte Kacheln löschen
          const id = safeId(q('id'));
          const dir = pageDir(id);
          if (!dir) return sendJson(res, 400, { error: 'Ungültig' });
          const pre = q('pre') === 'mink' ? 'mink' : 'ink';
          const keep = new Set(((await readJson(req)).keep || []).map(k => `${pre}_${parseInt(k, 10)}.png`));
          const re = new RegExp(`^${pre}_-?\\d+\\.png$`);
          for (const f of await fs.readdir(dir)) if (re.test(f) && !keep.has(f)) await fs.rm(path.join(dir, f), { force: true });
          return sendJson(res, 200, { ok: true });
        }
        case 'POST /api/font': { // Schriftdatei oder ZIP
          const name = q('name') || 'schrift';
          const buf = await readBody(req);
          let entries;
          try { entries = path.extname(name).toLowerCase() === '.zip' ? unzip(buf) : [{ name, data: buf }]; }
          catch (e) { return sendJson(res, 400, { error: e.message }); }
          const r = await addFonts(entries);
          if (!r.added.length && !r.skipped.length) return sendJson(res, 400, { error: `${name}: keine Schriftdatei (TTF, OTF, WOFF, WOFF2) gefunden` });
          return sendJson(res, 200, { ok: true, ...r, fonts: await listFonts(P) });
        }
        case 'GET /api/system-fonts': {
          const have = new Set((await listFonts(P)).map(f => f.family));
          const fams = new Map();
          for (const { info } of await systemFontFiles()) {
            const f = fams.get(info.family) || { family: info.family, count: 0, variable: false, imported: have.has(info.family) };
            f.count++; if (info.variable) f.variable = true;
            fams.set(info.family, f);
          }
          return sendJson(res, 200, { families: [...fams.values()].sort((a, b) => a.family.localeCompare(b.family)) });
        }
        case 'POST /api/font-import': {
          const fam = (await readJson(req)).family;
          const files = (await systemFontFiles()).filter(x => x.info.family === fam);
          if (!files.length) return sendJson(res, 404, { error: 'Schrift nicht gefunden' });
          const entries = [];
          for (const x of files) entries.push({ name: path.basename(x.fp), data: await fs.readFile(x.fp) });
          const r = await addFonts(entries);
          return sendJson(res, 200, { ok: true, ...r, fonts: await listFonts(P) });
        }
        case 'POST /api/font-delete': {
          const fam = (await readJson(req)).family;
          for (const f of await listFonts(P)) if (f.family === fam) await fs.rm(path.join(P.fonts, f.file), { force: true });
          return sendJson(res, 200, { ok: true, fonts: await listFonts(P) });
        }
        case 'GET /api/clipdirs': { // Unterordner mit Clips (für den Zufallsschnitt)
          const dir = pageDir(safeId(q('id')));
          if (!dir) return sendJson(res, 400, { error: 'Ungültig' });
          const out = [];
          for (const d of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
            if (!d.isDirectory() || /^[._]/.test(d.name)) continue;
            const sub = path.join(dir, d.name);
            const files = (await fs.readdir(sub)).filter(f => /\.(mp4|webm)$/i.test(f) && !f.startsWith('.')).sort();
            if (!files.length) continue;
            if (!(await exists(path.join(sub, 'poster.jpg'))) && (await ffmpegOk())) await makePoster(path.join(sub, files[0]), sub, 'poster', 2).catch(() => {});
            let w = 1920, h = 1080;
            try { const i = await probe(path.join(sub, files[0])); w = i.w; h = i.h; } catch {}
            out.push({ dir: d.name, clips: files, poster: (await exists(path.join(sub, 'poster.poster.jpg'))) ? 'poster.poster.jpg' : (await exists(path.join(sub, 'poster.jpg'))) ? 'poster.jpg' : null, w, h });
          }
          return sendJson(res, 200, { dirs: out });
        }
        case 'POST /api/clip-upload': { // Clip in einen Unterordner (Ordner-Upload im Editor)
          const dir = pageDir(safeId(q('id')));
          const sub = safeBase(q('dir') || 'clips');
          const name = path.basename(String(q('name') || ''));
          const ext = path.extname(name).toLowerCase();
          if (!dir || !['.mp4', '.webm'].includes(ext)) return sendJson(res, 400, { error: `${name}: nur MP4 oder WebM` });
          await fs.mkdir(path.join(dir, sub), { recursive: true });
          await pipeline(req, createWriteStream(path.join(dir, sub, safeBase(name) + ext)));
          return sendJson(res, 200, { ok: true, dir: sub });
        }
        case 'GET /api/gallery-ui': return sendJson(res, 200, { ui: await readGalleryUi(P) });
        case 'POST /api/gallery-ui': { // Handschrift-Objekt als Galerie-Symbol übernehmen
          const b = await readJson(req);
          const dir = pageDir(safeId(b.page)), role = String(b.role), item = String(b.item || '');
          if (!dir || !GAL_ROLES.includes(role) || !/^[a-z0-9]{1,24}$/.test(item)) return sendJson(res, 400, { error: 'Ungültig' });
          const src = path.join(dir, `draw_${item}.png`);
          if (!(await exists(src))) return sendJson(res, 400, { error: 'Das Objekt ist noch nicht gespeichert – kurz warten und nochmal' });
          const uidir = path.join(P.content, 'ui');
          await fs.mkdir(uidir, { recursive: true });
          await fs.copyFile(src, path.join(uidir, `gal-${role}.png`));
          const ui = await readGalleryUi(P);
          ui[role] = { w: Math.round(+b.w || 100), h: Math.round(+b.h || 100), v: newVer() };
          await fs.writeFile(path.join(uidir, 'gallery.json'), JSON.stringify(ui, null, 2));
          return sendJson(res, 200, { ok: true, ui });
        }
        case 'POST /api/upload':
          return handleUpload(req, res, safeId(q('id')), q('name') || '');
        case 'GET /api/jobs':
          return sendJson(res, 200, { jobs: [...jobs.values()] });
        case 'POST /api/media-delete': {
          const b = await readJson(req);
          const dir = pageDir(safeId(b.id));
          const fp = dir && within(dir, path.basename(String(b.name || '')));
          if (!fp || fp === dir) return sendJson(res, 400, { error: 'Ungültig' });
          await fs.rm(fp, { force: true });
          const ext = path.extname(fp);
          await fs.rm(fp.slice(0, -ext.length) + '.poster.jpg', { force: true });
          return sendJson(res, 200, { ok: true });
        }
        case 'POST /api/publish': {
          try {
            try { await git(['remote', 'get-url', 'origin']); }
            catch { return sendJson(res, 200, { ok: false, error: 'Noch kein GitHub-Repo verbunden (origin fehlt). Siehe CLAUDE.md → „Veröffentlichen".' }); }
            await ensureAllVariants(); // Bildfassungen aktuell?
            const big = await tooLargeFiles();
            if (big.length) return sendJson(res, 200, { ok: false, error: `Zu große Dateien (GitHub max. 100 MB): ${big.join(', ')}` });
            await git(['add', '-A']);
            let changed = true;
            try { await git(['diff', '--cached', '--quiet']); changed = false; } catch { changed = true; }
            if (changed) await git(['commit', '-m', 'Update ' + new Date().toISOString()]);
            const { stdout, stderr } = await git(['push', '-u', 'origin', 'HEAD']);
            const out = (stdout + '\n' + stderr).trim();
            return sendJson(res, 200, { ok: true, message: changed ? 'Veröffentlicht – Seite baut neu (~1 Min.)' : (/up-to-date/i.test(out) ? 'Bereits aktuell' : 'Ausstehendes gepusht') });
          } catch (err) {
            return sendJson(res, 200, { ok: false, error: String((err && (err.stderr || err.message)) || err).slice(0, 400) });
          }
        }
      }
      return sendJson(res, 404, { error: 'Unbekannte API' });
    }

    // ---- Vorschau (exakt wie die Live-Seite) ----
    if (pathname === '/preview' || pathname === '/preview/') { res.writeHead(302, { Location: '/preview/index.html' }); return res.end(); }
    if (pathname.startsWith('/preview/')) {
      const rest = pathname.slice('/preview/'.length);
      if (['site.css', 'site.js', 'randomcut.mjs'].includes(rest)) return serveFile(req, res, path.join(SHARED, rest));
      if (rest.startsWith('media/')) { const fp = within(P.pages, rest.slice(6)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
      if (rest.startsWith('ui/')) { const fp = within(path.join(P.content, 'ui'), rest.slice(3)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
      if (rest.startsWith('fonts/')) { const fp = within(P.fonts, rest.slice(6)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
      if (rest.endsWith('.html')) {
        const id = safeId(rest.slice(0, -5));
        const ids = await listPageIds(P);
        if (!ids.includes(id)) return send(res, 404, 'Seite nicht gefunden');
        return send(res, 200, renderDocument(await readPage(P, id), await readSite(P), await listFonts(P), ids, await listVariants(P, id), await readGalleryUi(P)), 'text/html; charset=utf-8');
      }
      return send(res, 404, 'Not found');
    }

    // ---- statisch ----
    if (pathname === '/' || pathname === '/index.html') return serveFile(req, res, path.join(EDITOR_PUBLIC, 'index.html'));
    if (pathname.startsWith('/editor/')) { const fp = within(EDITOR_PUBLIC, pathname.slice(8)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
    if (pathname.startsWith('/shared/')) { const fp = within(SHARED, pathname.slice(8)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
    if (pathname.startsWith('/media/')) { const fp = within(P.pages, pathname.slice(7)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
    if (pathname.startsWith('/fonts/')) { const fp = within(P.fonts, pathname.slice(7)); return fp ? serveFile(req, res, fp) : send(res, 403, 'Forbidden'); }
    return send(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: String((err && err.message) || err) });
  }
});

await ensureIndex();
ensureAllVariants(); // im Hintergrund: fehlende Bildfassungen erzeugen
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Portfolio-Editor läuft:  http://127.0.0.1:${PORT}/`);
  console.log(`Vorschau:                http://127.0.0.1:${PORT}/preview/`);
});
