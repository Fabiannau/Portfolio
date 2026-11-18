// Statischer Build: content/ -> dist/ (reines Node, keine Abhängigkeiten).
// Aufruf: node build.mjs   (läuft auch in der GitHub-Action)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, readSite, listPageIds, readPage, listFonts, isMediaFile, listVariants } from './shared/store.mjs';
import { renderDocument, pageFile } from './shared/document.mjs';
import { robotsTxt, aiTxt, tdmrepJson } from './shared/aiprotect.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const P = paths(ROOT);
const DIST = path.join(ROOT, 'dist');

const site = await readSite(P);
const ids = await listPageIds(P);
const fonts = await listFonts(P);

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, 'media'), { recursive: true });

for (const id of ids) {
  const page = await readPage(P, id);
  await fs.writeFile(path.join(DIST, decodeURIComponent(pageFile(id))), renderDocument(page, site, fonts, ids, await listVariants(P, id)));
  const src = path.join(P.pages, id), dst = path.join(DIST, 'media', id);
  await fs.mkdir(dst, { recursive: true });
  const keepInk = new Set((page.ink || []).map(k => `ink_${k}.png`));
  for (const k of page.m?.ink || []) keepInk.add(`mink_${k}.png`);
  for (const f of await fs.readdir(src, { withFileTypes: true })) {
    if (f.isDirectory() && !/^[._]/.test(f.name)) { // Clip-Ordner (Zufallsschnitt)
      await fs.mkdir(path.join(dst, f.name), { recursive: true });
      for (const g of await fs.readdir(path.join(src, f.name))) {
        if (/\.(mp4|webm|jpg|jpeg|png|webp|avif)$/i.test(g)) await fs.copyFile(path.join(src, f.name, g), path.join(dst, f.name, g));
      }
      continue;
    }
    if (!f.isFile()) continue;
    const isPoster = f.name.endsWith('.poster.jpg') || /^draw_[a-z0-9]+\.png$/.test(f.name);
    if (isMediaFile(f.name) || isPoster || keepInk.has(f.name)) {
      await fs.copyFile(path.join(src, f.name), path.join(dst, f.name));
    }
  }
}
await fs.copyFile(path.join(ROOT, 'shared', 'site.css'), path.join(DIST, 'site.css'));
await fs.copyFile(path.join(ROOT, 'shared', 'site.js'), path.join(DIST, 'site.js'));
await fs.copyFile(path.join(ROOT, 'shared', 'randomcut.mjs'), path.join(DIST, 'randomcut.mjs'));
if (fonts.length) {
  await fs.mkdir(path.join(DIST, 'fonts'), { recursive: true });
  for (const f of fonts) await fs.copyFile(path.join(P.fonts, f.file), path.join(DIST, 'fonts', f.file));
}
await fs.writeFile(path.join(DIST, '.nojekyll'), '');
// Nutzungsvorbehalt gegen KI-Training (maschinenlesbar)
await fs.writeFile(path.join(DIST, 'robots.txt'), robotsTxt());
await fs.writeFile(path.join(DIST, 'ai.txt'), aiTxt());
await fs.mkdir(path.join(DIST, '.well-known'), { recursive: true });
await fs.writeFile(path.join(DIST, '.well-known', 'tdmrep.json'), tdmrepJson());
console.log(`Build fertig: ${ids.length} Seite(n) -> dist/`);
