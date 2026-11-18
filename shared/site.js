// Live-Seite: Video-Verhalten. (ES-Modul)
import { randomCut } from './randomcut.mjs';

// · Zufallsschnitt: schneidet live zufällig, solange er (fast) im Bild ist
(function () {
  var els = document.querySelectorAll('.it-random[data-clips]');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach(function (el) { randomCut(el).start(); }); return; }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { var rc = randomCut(e.target); if (e.isIntersecting) rc.start(); else rc.stop(); });
  }, { rootMargin: '150px 0px' });
  els.forEach(function (el) { io.observe(el); });
  // schon weit vorher (1200 px) mit dem Vorladen der ersten Clips beginnen
  var warmIo = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { randomCut(e.target).warm(); warmIo.unobserve(e.target); } });
  }, { rootMargin: '1200px 0px' });
  els.forEach(function (el) { warmIo.observe(el); });
})();

// Live-Seite: Video-Verhalten.
// · data-loop  (Loop · stumm): spielt nur, solange es sichtbar ist.
// · data-scene (Szene · mit Ton): startet, sobald es das erste Mal GANZ im Bild ist; pausiert, wenn es ganz weg ist.
//   Der Ton blendet mit der Sichtbarkeit ein und aus. Klick aufs Video = Ton an/aus.
//   Browser erlauben Ton erst nach einer Interaktion (Klick/Tippen/Taste) -> bis dahin läuft es stumm,
//   ab der ersten Interaktion kommt der Ton automatisch dazu.
(function () {
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('video[data-loop],video[data-scene]').forEach(function (v) { v.muted = true; v.autoplay = true; v.loop = true; v.play && v.play(); });
    return;
  }
  // --- Loop-Videos ---
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      else v.pause();
    });
  }, { rootMargin: '200px 0px' });
  document.querySelectorAll('video[data-loop]').forEach(function (v) { v.muted = true; io.observe(v); });

  // --- Szenen-Videos ---
  var scenes = [].slice.call(document.querySelectorAll('video[data-scene]'));
  if (!scenes.length) return;
  var activated = false, actx = null;
  var S = new Map();
  // iOS: video.volume ist schreibgeschützt -> dort über Web Audio (GainNode) blenden
  var probe = document.createElement('video'); probe.volume = 0.5;
  var needGain = probe.volume !== 0.5 && !!(window.AudioContext || window.webkitAudioContext);

  function wrap(v) { return v.parentElement; }
  function icon(v) { var s = S.get(v); wrap(v).classList.toggle('muted', v.muted || s.userMuted); }
  function level(v, target) {
    var s = S.get(v); s.target = target;
    if (s.gain) { s.gain.gain.setTargetAtTime(target, actx.currentTime, 0.25); return; }
    if (!s.raf) s.raf = requestAnimationFrame(function step() {
      var d = s.target - v.volume;
      if (Math.abs(d) < 0.01) { v.volume = s.target; s.raf = 0; return; }
      v.volume = Math.max(0, Math.min(1, v.volume + d * 0.12)); // weiches Ein-/Ausblenden (~0,5 s)
      s.raf = requestAnimationFrame(step);
    });
  }
  function soundOn(v) {
    var s = S.get(v);
    if (s.userMuted || !s.started) return;
    if (needGain && !s.gain && actx) {
      try { var src = actx.createMediaElementSource(v); s.gain = actx.createGain(); s.gain.gain.value = 0; src.connect(s.gain).connect(actx.destination); } catch (e) {}
    }
    v.muted = false;
    icon(v);
  }
  function play(v) { var p = v.play(); if (p && p.catch) p.catch(function () { v.muted = true; icon(v); v.play().catch(function () {}); }); }
  function update(v) {
    var s = S.get(v);
    if (!s.started) {
      if (s.ratio < s.full) return;
      s.started = true;
      if (!s.gain) v.volume = 0;
      v.muted = !activated || s.userMuted;
      icon(v);
      play(v);
    }
    clearTimeout(s.pauseT);
    if (s.ratio <= 0) { level(v, 0); s.pauseT = setTimeout(function () { v.pause(); }, 400); return; }
    if (v.paused) play(v);
    level(v, Math.min(1, s.ratio / s.full));
  }
  var steps = []; for (var i = 0; i <= 40; i++) steps.push(i / 40);
  var sio = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var v = e.target, s = S.get(v);
      // „ganz im Bild" – bei Videos, die höher als der Bildschirm sind: so viel, wie überhaupt draufpasst
      var vh = e.rootBounds ? e.rootBounds.height : innerHeight;
      s.full = Math.min(0.97, 0.97 * vh / Math.max(1, e.boundingClientRect.height));
      s.ratio = e.intersectionRatio;
      update(v);
    });
  }, { threshold: steps });
  scenes.forEach(function (v) {
    S.set(v, { started: false, userMuted: false, ratio: 0, full: 0.97, target: 0 });
    v.muted = true; v.loop = false;
    icon(v);
    wrap(v).addEventListener('click', function (ev) {
      ev.preventDefault();
      var s = S.get(v);
      activate();
      s.userMuted = !(s.userMuted || v.muted) ? true : false;
      if (s.userMuted) { v.muted = true; } else { soundOn(v); if (!s.started) { s.full = 0; update(v); } else level(v, Math.min(1, s.ratio / s.full)); }
      icon(v);
    });
    sio.observe(v);
  });
  // erste Interaktion irgendwo auf der Seite -> Ton freischalten
  function activate() {
    if (activated) return;
    activated = true;
    if (needGain) { var C = window.AudioContext || window.webkitAudioContext; actx = new C(); }
    scenes.forEach(function (v) { if (S.get(v).started) { soundOn(v); update(v); } });
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { addEventListener(t, activate, { capture: true, passive: true }); });
})();
