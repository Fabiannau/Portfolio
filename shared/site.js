// Live-Seite: Video-Verhalten. (ES-Modul)
import { randomCut } from './randomcut.mjs';

// · Galerie: Klick auf ein verbundenes Bild -> Großansicht mit Karussell über alle Bilder derselben Galerie
(function () {
  if (!document.querySelector('[data-gal]')) return;
  var lb = null, list = [], idx = 0, img = null, counter = null, viaHistory = false;
  // passende Bildquelle: die responsiven Fassungen mit sizes=100vw (scharf auf jedem Bildschirm)
  function sourceOf(el) {
    var s = el.querySelector('source'), i = el.querySelector('img');
    return { srcset: (s && s.getAttribute('srcset')) || (i && i.getAttribute('srcset')) || '', src: i ? i.getAttribute('src') : '', alt: i ? i.alt : '' };
  }
  function visibleGroup(id) { // Reihenfolge = Anordnung auf der sichtbaren Fassung (Desktop oder Handy)
    return [].slice.call(document.querySelectorAll('div.it[data-gal="' + id + '"]'))
      .filter(function (el) { return el.offsetParent !== null || getComputedStyle(el).position === 'fixed'; })
      .map(function (el) { var r = el.getBoundingClientRect(); return { el: el, t: r.top + scrollY, l: r.left }; })
      .sort(function (a, b) { return Math.abs(a.t - b.t) > 40 ? a.t - b.t : a.l - b.l; })
      .map(function (o) { return o.el; });
  }
  function make(i) {
    var s = sourceOf(list[i]), im = new Image();
    if (s.srcset) { im.srcset = s.srcset; im.sizes = '100vw'; }
    im.src = s.src; im.alt = s.alt; im.decoding = 'async';
    return im;
  }
  function show(i, dir) {
    idx = (i + list.length) % list.length;
    var next = make(idx);
    var stage = lb.querySelector('.lb-stage');
    if (img) { var old = img; old.classList.add('out'); setTimeout(function () { old.remove(); }, 200); }
    next.style.position = 'absolute'; next.classList.add('out');
    if (dir) next.style.transform = 'translateX(' + (dir * 24) + 'px)';
    stage.appendChild(next); img = next;
    requestAnimationFrame(function () { requestAnimationFrame(function () { next.classList.remove('out'); next.style.transform = ''; }); });
    counter.textContent = list.length > 1 ? (idx + 1) + ' / ' + list.length : '';
    [idx + 1, idx - 1].forEach(function (j) { if (list.length > 1) make((j + list.length) % list.length); }); // Nachbarn vorladen
  }
  function open(el) {
    list = visibleGroup(el.dataset.gal);
    if (!list.length) return;
    lb = document.createElement('div');
    lb.className = 'lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'Großansicht');
    lb.innerHTML = '<div class="lb-stage"></div><button class="lb-x" aria-label="Schließen">×</button>' +
      (list.length > 1 ? '<button class="lb-prev" aria-label="Vorheriges Bild">‹</button><button class="lb-next" aria-label="Nächstes Bild">›</button>' : '') +
      '<div class="lb-n" aria-live="polite"></div>';
    counter = lb.querySelector('.lb-n');
    document.body.appendChild(lb);
    document.documentElement.style.overflow = 'hidden';
    img = null; show(list.indexOf(el), 0);
    requestAnimationFrame(function () { lb.classList.add('on'); });
    lb.querySelector('.lb-x').focus();
    lb.addEventListener('click', function (e) {
      if (e.target.closest('.lb-next')) return show(idx + 1, 1);
      if (e.target.closest('.lb-prev')) return show(idx - 1, -1);
      if (e.target.closest('.lb-x') || e.target === lb || e.target.classList.contains('lb-stage')) return close();
    });
    var x0 = null; // Wischen
    lb.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    lb.addEventListener('pointerup', function (e) {
      if (x0 === null) return; var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 50 && list.length > 1) show(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });
    history.pushState({ lb: 1 }, ''); viaHistory = true; // Zurück-Geste schließt die Großansicht
  }
  function close(fromPop) {
    if (!lb) return;
    var el = lb; lb = null; img = null;
    el.classList.remove('on'); setTimeout(function () { el.remove(); }, 250);
    document.documentElement.style.overflow = '';
    if (!fromPop && viaHistory) { viaHistory = false; history.back(); }
  }
  addEventListener('popstate', function () { if (lb) { viaHistory = false; close(true); } });
  addEventListener('keydown', function (e) {
    if (!lb) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && list.length > 1) show(idx + 1, 1);
    else if (e.key === 'ArrowLeft' && list.length > 1) show(idx - 1, -1);
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('div.it[data-gal]');
    if (el && !lb) { e.preventDefault(); open(el); }
  });
})();

// · E-Mail-Adressen entschlüsseln (stehen verschlüsselt im HTML, damit Adress-Sammler sie nicht finden)
document.querySelectorAll('.em[data-em]').forEach(function (el) {
  var addr = el.dataset.em.split('.').map(function (n) { return String.fromCharCode(n - 3); }).join('');
  if (el.closest('a')) { el.textContent = addr; return; }
  var a = document.createElement('a'); a.href = 'mailto:' + addr; a.textContent = addr; a.style.color = 'inherit';
  el.replaceWith(a);
});

// · Links zurück: zeigt ein Link auf genau die Seite, von der man gekommen ist, verhält er sich wie „Zurück"
//   im Browser -> man landet an derselben Stelle, von der aus man geklickt hat (Scrollposition bleibt erhalten).
(function () {
  var from = '';
  try { if (document.referrer && new URL(document.referrer).origin === location.origin) from = document.referrer.split('#')[0]; } catch (_) {}
  if (!from) return;
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (a.href.split('#')[0] === from && history.length > 1) { e.preventDefault(); history.back(); }
  });
})();

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
