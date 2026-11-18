// Zufallsschnitt – nach dem Prinzip von „Random Edits / Erleben" (Desktop/Random-Edits-Kindlab):
// zwei übereinanderliegende <video> wechseln sich ab. Während eins läuft, lädt das andere schon den nächsten
// zufälligen Clip. Jeder Clip läuft ab seinem Anfang (Keyframe -> startet sofort, kein Spulen) für 0,7–4 s.
// Genutzt von der Live-Seite (site.js) und vom Editor.
const SEG_MIN = 0.7, SEG_MAX = 4.0;

export function randomCut(wrap) {
  if (wrap._rc) return wrap._rc;
  let clips = [];
  try { clips = JSON.parse(wrap.dataset.clips || '[]'); } catch {}
  const vids = [...wrap.querySelectorAll('video.rc')];
  let active = 0, playing = false, session = 0, timer = 0, prepared = null, last = -1;

  // auf ein Media-Event warten; Fehler ODER Zeitüberschreitung -> anderer Clip
  const once = (v, ev, ms = 6000) => new Promise((res, rej) => {
    const ok = () => { off(); res(); }, bad = () => { off(); rej(new Error('video')); };
    const to = setTimeout(bad, ms);
    const off = () => { clearTimeout(to); v.removeEventListener(ev, ok); v.removeEventListener('error', bad); };
    v.addEventListener(ev, ok); v.addEventListener('error', bad);
  });
  // Puffer des alten Clips freigeben (manche Browser behalten ihn sonst)
  const release = v => { v.removeAttribute('src'); v.load(); };

  async function cue(v, src) {
    release(v);
    v.src = src;
    if (v.readyState < 3) await once(v, 'canplay');
    return Math.min(SEG_MIN + Math.random() * (SEG_MAX - SEG_MIN), v.duration || SEG_MAX);
  }
  async function prepare(my) {
    const v = vids[1 - active];
    for (let tries = 0; tries < 8 && my === session && playing; tries++) {
      let i = Math.floor(Math.random() * clips.length);
      if (clips.length > 1 && i === last) i = (i + 1) % clips.length; // nicht zweimal derselbe hintereinander
      try {
        const len = await cue(v, clips[i]);
        if (my !== session) return;
        last = i; prepared = { v, len };
        return;
      } catch { release(v); }
    }
  }
  async function cut(my) {
    if (my !== session || !playing) return;
    if (!wrap.isConnected) return stop(); // Element wurde entfernt (Editor)
    if (!prepared) { timer = setTimeout(() => cut(my), 120); return; }
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
  return (wrap._rc = { start, stop });
}
