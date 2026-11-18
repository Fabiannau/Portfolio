// Schriftdateien verstehen (pure Node): Name, Stärke, Kursiv, variable Achsen auslesen,
// TTF/OTF -> WOFF umwandeln, ZIP-Archive (z. B. Google-Fonts-Download) entpacken.
import zlib from 'node:zlib';

const tagOf = (b, o) => b.toString('latin1', o, o + 4);

// WOFF2: bekannte Tabellen-Tags (Index 0–62 laut Spezifikation)
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat',
  'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

// sfnt-Tabellenverzeichnis lesen -> [{tag, checksum, data}]
function sfntTables(buf, base = 0) {
  const n = buf.readUInt16BE(base + 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 16;
    const off = buf.readUInt32BE(o + 8), len = buf.readUInt32BE(o + 12);
    out.push({ tag: tagOf(buf, o), checksum: buf.readUInt32BE(o + 4), data: buf.subarray(off, off + len) });
  }
  return out;
}
function woffTables(buf) {
  const n = buf.readUInt16BE(12);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const off = buf.readUInt32BE(o + 4), comp = buf.readUInt32BE(o + 8), orig = buf.readUInt32BE(o + 12);
    const raw = buf.subarray(off, off + comp);
    out.push({ tag: tagOf(buf, o), data: comp < orig ? zlib.inflateSync(raw) : raw });
  }
  return out;
}
function woff2Tables(buf) {
  const n = buf.readUInt16BE(12);
  const compLen = buf.readUInt32BE(20);
  if (tagOf(buf, 4) === 'ttcf') return null; // Sammlungen nicht unterstützt
  let p = 48;
  const b128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const c = buf[p++]; v = v * 128 + (c & 0x7f); if (!(c & 0x80)) return v; } throw new Error('woff2'); };
  const dir = [];
  for (let i = 0; i < n; i++) {
    const flags = buf[p++];
    let tag;
    if ((flags & 63) === 63) { tag = tagOf(buf, p); p += 4; } else tag = WOFF2_TAGS[flags & 63];
    const ver = (flags >> 6) & 3;
    const orig = b128();
    const transformed = tag === 'glyf' || tag === 'loca' ? ver === 0 : ver !== 0;
    const len = transformed ? b128() : orig;
    dir.push({ tag, len });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(p, p + compLen));
  let o = 0;
  return dir.map(d => { const t = { tag: d.tag, data: data.subarray(o, o + d.len) }; o += d.len; return t; });
}
export function readTables(buf) {
  const sig = tagOf(buf, 0);
  if (sig === 'wOFF') return woffTables(buf);
  if (sig === 'wOF2') return woff2Tables(buf);
  if (sig === 'ttcf') return sfntTables(buf, buf.readUInt32BE(12)); // erste Schrift einer Sammlung
  if (sig === 'OTTO' || sig === 'true' || buf.readUInt32BE(0) === 0x00010000) return sfntTables(buf);
  return null;
}

function nameStrings(t) {
  const count = t.readUInt16BE(2), strOff = t.readUInt16BE(4);
  const found = {};
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12;
    const plat = t.readUInt16BE(o), lang = t.readUInt16BE(o + 4), id = t.readUInt16BE(o + 6);
    const len = t.readUInt16BE(o + 8), off = t.readUInt16BE(o + 10);
    if (![1, 2, 4, 16, 17].includes(id)) continue;
    const raw = t.subarray(strOff + off, strOff + off + len);
    let s;
    if (plat === 3 || plat === 0) { s = ''; for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode(raw.readUInt16BE(k)); }
    else if (plat === 1) s = raw.toString('latin1');
    else continue;
    const score = (plat === 3 ? 2 : 1) + (lang === 0x409 || lang === 0 ? 2 : 0);
    if (!found[id] || found[id].score < score) found[id] = { s: s.trim(), score };
  }
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.s]));
}

// -> {family, sub, weight, style, variable, wmin, wmax} oder null
export function fontInfo(buf) {
  let tables;
  try { tables = readTables(buf); } catch { return null; }
  if (!tables) return null;
  const T = Object.fromEntries(tables.map(t => [t.tag, t.data]));
  if (!T.name) return null;
  const names = nameStrings(T.name);
  const family = (names[16] || names[1] || '').replace(/["\\<>{};]/g, '').trim();
  if (!family || !/^[\p{L}\p{N} ._&'-]+$/u.test(family)) return null;
  const sub = names[17] || names[2] || 'Regular';
  let weight = 400, italic = /italic|oblique/i.test(sub);
  if (T['OS/2'] && T['OS/2'].length >= 64) {
    weight = T['OS/2'].readUInt16BE(4) || 400;
    if (T['OS/2'].readUInt16BE(62) & 1) italic = true;
  }
  if (weight < 100 || weight > 1000) weight = 400;
  let variable = false, wmin = weight, wmax = weight;
  if (T.fvar && T.fvar.length >= 16) {
    const f = T.fvar, axOff = f.readUInt16BE(4), axCount = f.readUInt16BE(8), axSize = f.readUInt16BE(10);
    for (let i = 0; i < axCount; i++) {
      const o = axOff + i * axSize;
      if (tagOf(f, o) === 'wght') { variable = true; wmin = Math.round(f.readInt32BE(o + 4) / 65536); wmax = Math.round(f.readInt32BE(o + 12) / 65536); }
    }
  }
  return { family, sub, weight, style: italic ? 'italic' : 'normal', variable, wmin, wmax };
}

// TTF/OTF -> WOFF 1.0 (zlib je Tabelle). Kleiner und überall unterstützt.
export function toWoff(buf) {
  const sig = tagOf(buf, 0);
  if (!(sig === 'OTTO' || sig === 'true' || buf.readUInt32BE(0) === 0x00010000)) return null;
  const tables = sfntTables(buf).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = tables.length;
  const pad4 = x => (x + 3) & ~3;
  let sfntSize = 12 + 16 * n;
  for (const t of tables) sfntSize += pad4(t.data.length);
  const parts = tables.map(t => {
    const z = zlib.deflateSync(t.data, { level: 9 });
    return { ...t, out: z.length < t.data.length ? z : t.data };
  });
  let off = 44 + 20 * n;
  const head = Buffer.alloc(off);
  head.write('wOFF', 0, 'latin1');
  buf.copy(head, 4, 0, 4); // flavor
  head.writeUInt16BE(n, 12);
  head.writeUInt32BE(sfntSize, 16);
  head.writeUInt16BE(1, 20); // Version 1.0
  const chunks = [head];
  parts.forEach((t, i) => {
    const o = 44 + i * 20;
    head.write(t.tag, o, 'latin1');
    head.writeUInt32BE(off, o + 4);
    head.writeUInt32BE(t.out.length, o + 8);
    head.writeUInt32BE(t.data.length, o + 12);
    head.writeUInt32BE(t.checksum, o + 16);
    chunks.push(t.out);
    const padded = pad4(t.out.length);
    if (padded > t.out.length) chunks.push(Buffer.alloc(padded - t.out.length));
    off += padded;
  });
  const res = Buffer.concat(chunks);
  res.writeUInt32BE(res.length, 8);
  return res;
}

// ZIP entpacken (nur Store/Deflate, reicht für Schrift-Downloads) -> [{name, data}]
export function unzip(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Keine gültige ZIP-Datei');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), comp = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(ds, ds + comp);
    try { out.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : null }); } catch {}
  }
  return out.filter(f => f.data);
}
