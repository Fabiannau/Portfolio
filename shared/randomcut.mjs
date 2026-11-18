// Zufallsschnitt – nach dem Prinzip von „Random Edits / Erleben" (Desktop/Random-Edits-Kindlab):
// zwei übereinanderliegende <video> wechseln sich ab; jeder Clip läuft ab seinem Anfang 0,7–4 s.
//
// Effizienz (gemessen gegen eine gedrosselte Leitung, s. CLAUDE.md):
// · Reihenfolge per „Kartenstapel" (Shuffle-Bag): zufällig, aber jeder Clip erst wieder, wenn alle dran waren –
//   so ist vorher bekannt, welche Clips als Nächstes kommen.
// · Diese Clips werden im Hintergrund VORGELADEN – NACHEINANDER (nie mehrere gleichzeitig, sonst klauen sie dem
//   sichtbaren Clip die Bandbreite), mit niedriger Priorität, als Blob im Speicher (wiederverwendbar).
// · Ist ein Clip schon im Speicher -> sofort. Lädt er gerade -> darauf warten (kein Doppel-Download).
//   Ist er noch gar nicht dran (z. B. der allererste) -> direkt streamen; solange pausiert das Vorladen.
// Genutzt von der Live-Seite (site.js) und vom Editor.
const SEG_MIN = 0.7, SEG_MAX = 4.0, AHEAD = 3;

// ---- seitenweiter Vorlade-Speicher ----
const blobs = new Map();  // Clip-URL -> Promise<Blob-URL>
const ready = new Map();  // Clip-URL -> Blob-URL (fertig)
const pending = [];       // Warteschlange fürs Vorladen
let fetching = false, hold = 0;
function fetchClip(url) {
  if (!blobs.has(url)) {
    let opt; try { opt = { priority: 'low' }; } catch { opt = undefined; }
    blobs.set(url, fetch(url, opt)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(b => { const u = URL.createObjectURL(b); ready.set(url, u); return u; })
      .catch(e => { blobs.delete(url); throw e; }));
  }
  return blobs.get(url);
}
function pump() { // immer nur EIN Vorlade-Download gleichzeitig; pausiert, solange ein Clip streamt
  if (fetching || hold > 0) return;
  const url = pending.shift();
  if (!url) return;
  if (blobs.has(url)) return pump();
  fetching = true;
  fetchClip(url).catch(() => {}).finally(() => { fetching = false; pump(); });
}
function want(url) { if (!blobs.has(url) && !pending.includes(url)) { pending.push(url); pump(); } }

export function randomCut(wrap) {
  if (wrap._rc) return wrap._rc;
  let clips = [];
  try { clips = JSON.parse(wrap.dataset.clips || '[]'); } catch {}
  const vids = [...wrap.querySelectorAll('video.rc')];
  let active = 0, playing = false, session = 0, timer = 0, prepared = null, last = '';
  let bag = [];
  const queue = []; // die nächsten Clips (in dieser Reihenfolge werden sie gezeigt)

  function refill() {
    bag = clips.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    if (bag.length > 1 && bag[bag.length - 1] === last) bag.unshift(bag.pop()); // nicht zweimal derselbe hintereinander
  }
  function topUp(skipFirst) { // Warteschlange auffüllen; die nächsten Clips vormerken
    while (queue.length < AHEAD && clips.length) { if (!bag.length) refill(); queue.push(bag.pop()); }
    queue.slice(skipFirst ? 1 : 0).forEach(want);
  }

  // auf ein Media-Event warten; Fehler ODER Zeitüberschreitung -> anderer Clip
  const once = (v, ev, ms = 8000) => new Promise((res, rej) => {
    const ok = () => { off(); res(); }, bad = () => { off(); rej(new Error('video')); };
    const to = setTimeout(bad, ms);
    const off = () => { clearTimeout(to); v.removeEventListener(ev, ok); v.removeEventListener('error', bad); };
    v.addEventListener(ev, ok); v.addEventListener('error', bad);
  });
  const abs = s => new URL(s, location.href).href;

  async function prepare(my) {
    const v = vids[1 - active];
    for (let tries = 0; tries < 8 && my === session && playing; tries++) {
      topUp(true);
      const url = queue.shift();
      topUp(false);
      try {
        let src = ready.get(url);
        let streaming = false;
        if (!src && blobs.has(url)) src = await fetchClip(url); // lädt gerade vor -> abwarten, nicht doppelt laden
        if (!src) { src = url; streaming = true; }               // noch nicht dran -> direkt streamen
        if (my !== session) return;
        if (v.src !== abs(src)) v.src = src;
        v.currentTime = 0;
        if (streaming) { // Vorladen pausieren, bis der Clip durchgeladen ist
          hold++;
          let released = false;
          const release = () => { if (!released) { released = true; hold--; pump(); } };
          v.addEventListener('canplaythrough', release, { once: true });
          setTimeout(release, 4000);
        }
        if (v.readyState < 3) await once(v, 'canplay');
        if (my !== session) return;
        last = url;
        prepared = { v, len: Math.min(SEG_MIN + Math.random() * (SEG_MAX - SEG_MIN), v.duration || SEG_MAX) };
        return;
      } catch { /* Clip nicht ladbar -> nächster */ }
    }
  }
  async function cut(my) {
    if (my !== session || !playing) return;
    if (!wrap.isConnected) return stop(); // Element wurde entfernt (Editor)
    if (!prepared) { timer = setTimeout(() => cut(my), 80); return; }
    const { v, len } = prepared;
    prepared = null;
    v.muted = true;
    try { await v.play(); } catch {}
    if (my !== session) return;
    const old = vids[active];
    v.classList.add('front');
    if (old !== v) { old.classList.remove('front'); old.pause(); }
    active = vids.indexOf(v);
    wrap.classList.add('rc-on');
    timer = setTimeout(() => cut(my), len * 1000);
    prepare(my);
  }
  // schon vorladen, bevor der Schnitt sichtbar ist (nur die Clips NACH dem ersten – der erste streamt dann sofort)
  function warm() { if (clips.length) topUp(true); }
  function start() {
    if (playing || !clips.length || vids.length < 2) return;
    playing = true;
    const my = ++session;
    prepare(my).then(() => cut(my));
  }
  function stop() {
    playing = false; session++;
    clearTimeout(timer); prepared = null;
    vids.forEach(v => v.pause());
  }
  return (wrap._rc = { start, stop, warm });
}
