// Zufallsschnitt – nach dem Prinzip von „Random Edits / Erleben" (Desktop/Random-Edits-Kindlab):
// zwei übereinanderliegende <video> wechseln sich ab; jeder Clip läuft ab seinem Anfang 0,7–4 s.
//
// Effizienz:
// · Clips werden VORAUS geladen (immer AHEAD Stück) – als Blob in den Speicher, schon bevor der Schnitt ins Bild
//   scrollt (warm()). Ein Schnitt muss so nie auf das Netz warten; einmal geladene Clips werden wiederverwendet.
// · Reihenfolge per „Kartenstapel" (Shuffle-Bag): zufällig, aber jeder Clip erst wieder, wenn alle dran waren –
//   so ist vorher bekannt, welche Clips als Nächstes kommen, und genau die werden geladen.
// Genutzt von der Live-Seite (site.js) und vom Editor.
const SEG_MIN = 0.7, SEG_MAX = 4.0, AHEAD = 3;

// seitenweiter Speicher: Clip-URL -> Promise<Blob-URL>; `ready` = schon komplett geladene Clips
const blobs = new Map(), ready = new Map();
function fetchClip(url) {
  if (!blobs.has(url)) {
    blobs.set(url, fetch(url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then(b => { const u = URL.createObjectURL(b); ready.set(url, u); return u; })
      .catch(e => { blobs.delete(url); throw e; }));
  }
  return blobs.get(url);
}

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
  function topUp() { // Warteschlange auffüllen und die nächsten AHEAD Clips laden
    while (queue.length < AHEAD && clips.length) { if (!bag.length) refill(); queue.push(bag.pop()); }
    queue.forEach(u => fetchClip(u).catch(() => {}));
  }

  // auf ein Media-Event warten; Fehler ODER Zeitüberschreitung -> anderer Clip
  const once = (v, ev, ms = 8000) => new Promise((res, rej) => {
    const ok = () => { off(); res(); }, bad = () => { off(); rej(new Error('video')); };
    const to = setTimeout(bad, ms);
    const off = () => { clearTimeout(to); v.removeEventListener(ev, ok); v.removeEventListener('error', bad); };
    v.addEventListener(ev, ok); v.addEventListener('error', bad);
  });

  async function prepare(my) {
    const v = vids[1 - active];
    for (let tries = 0; tries < 8 && my === session && playing; tries++) {
      topUp();
      const url = queue.shift();
      topUp(); // sofort den nächsten nachladen
      try {
        // schon im Speicher -> sofort; sonst direkt streamen (spielt ab den ersten Daten), Vorladen läuft weiter
        const src = ready.get(url) || url;
        if (v.src !== new URL(src, location.href).href) v.src = src;
        v.currentTime = 0;
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
  // schon vorladen, bevor der Schnitt sichtbar ist
  function warm() { if (clips.length) topUp(); }
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
