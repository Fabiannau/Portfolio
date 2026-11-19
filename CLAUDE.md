# CLAUDE.md — Portfolio 2.0

Kontext & Konventionen. (Sprache des Nutzers: **Deutsch**.) Nachfolger von `~/Desktop/Photowebsite`
(dortige Systeme übernommen: Tinten-Pinsel, Stiftdruck, Lasso, Zuschneiden, One-Click-Publish).

## Was das ist
Komplettes Portfolio (Fotos, **Videos**, **Text**), handgemalt komponiert.
- **Landingpage** = EINE lange Seite, füllt den Bildschirm links→rechts, wächst in der Höhe.
  Neues kommt **nach oben** → Fläche wird oben erweitert (`page.top` wird kleiner, Koordinaten bleiben stabil).
- **Projektseiten**: jedes Element (Foto/Video/Text) kann per **Quicklink** auf eine (neue, leere) Seite zeigen.
- **Übersicht** (Figma/Node-Stil): alle Seiten nebeneinander, Links als Linien.

## Starten
- **`Portfolio-Editor.app`** doppelklicken → startet `editor/server.mjs` (Port **4466**, Log `/tmp/portfolio-editor.log`)
  und öffnet **Firefox** (Stiftdruck! Safari/WebKit liefert keinen Wacom-Druck).
- Editor `http://127.0.0.1:4466/` · Vorschau exakt wie live: `/preview/` · `npm run editor` geht auch.
- **Keine npm-Abhängigkeiten.** Build: `node build.mjs` → `dist/` (kein Astro mehr; gleicher Renderer wie Vorschau).
- Nach Änderungen an `server.mjs`/`shared/*.mjs` (serverseitig) Server neu starten: `pkill -f Portfoliowebsite2.0/editor/server.mjs`.

## Datenmodell
```
content/site.json            { title, styles:[{id,name,props}], graph:{<pageId>:{x,y}} }
content/fonts/*.woff|woff2…  eigene Schriften → automatisch @font-face (Name/Stärke/Kursiv aus der Datei gelesen). DSGVO-freundlich.
content/pages/<id>/
  page.json                  QUELLE DER WAHRHEIT { id,title,bg,back,top,bottom,items[],strokes[],ink[],updated }
  <medien>.jpg|png|mp4…      optimierte Web-Versionen (werden veröffentlicht)
  <video>.poster.jpg         Standbild (ffmpeg)
  ink_<k>.png                gerenderte Tinte, Kachel k deckt y ∈ [k·1280, (k+1)·1280) (k darf negativ sein)
  _originals/                hochgeladene Originale (gitignored, nur lokal)
```
- Breite immer **2560 Einheiten** (`W`), Höhe = `bottom − top`. `top` darf **negativ** sein (nach oben erweitert).
  Deshalb ändern sich beim Erweitern keine Koordinaten → Tinten-Textur (koordinaten-deterministisch) bleibt stabil.
- Items: `{type:'image'|'video'|'text', x,y,w,h, link?, crop?}` · Video: `src, poster, mode:'loop'|'player'`
  (`src` darf absolute URL sein → extern gehostet) · Text: `text, style?, over?` (Abweichungen vom Stil). Text-`h` wird gemessen.
- Textstil effektiv = `TEXT_DEFAULT ← styles[style].props ← over`. Größen in Einheiten → CSS `calc(n * 100cqw / 2560)`
  (`.pg` ist `container-type:inline-size`) → skaliert mit Bildschirmbreite.
- `index` = Startseite (nicht umbenenn-/löschbar). Umbenennen/Löschen passt Links in allen Seiten + `graph` an.

## Handy-Version (Knopf „🖥 Desktop | 📱 Handy", Taste M)
- Pro Seite optional `page.m` = eigenes Handy-Layout, Breite **1080 Einheiten** (`MW`), eigene `top/bottom`.
  `m.place = [{ref,x,y,w,h,crop?,size?}]` (Reihenfolge = Ebenen) · `m.own` = Elemente nur fürs Handy ·
  `m.strokes` = eigene Handy-Striche (Kopien, `src` = Desktop-Strich-ID) · `m.ink` → `mink_<k>.png` ·
  `m.hide` = am Handy ausgeblendete Desktop-Elemente · `m.skip` = bewusst gelöschte Strich-Quellen.
- **Geteilt:** Inhalt (Text, Stil, Link, Video-Modus, Alt). **Pro Ansicht:** Position, Größe, Ausschnitt, Reihenfolge,
  Text-Schriftgröße (`size`). Handy-Handschrift ist nach dem Kopieren unabhängig vom Desktop.
- Elemente/Striche brauchen stabile `id`s (`ensureIds()` beim Öffnen).
- Editor: `L` = aktive Ansicht (Desktop: `page`; Handy: `buildMobileL()` mit gemergten Element-Kopien).
  Änderungen gehen über `syncBack()` (in `markDirty()` und `snapshot()`) zurück in `page.items` bzw. `page.m.place`.
  Im Handy-Modus neu angelegte Elemente landen automatisch in `m.own`.
- `autoMobile()`: erster Wechsel/„Automatisch neu anordnen" stapelt alles in Desktop-Reihenfolge, Striche wandern mit dem
  nächsten Element (`strokeTransform`, < 700 Einheiten Abstand). Neues vom Desktop erscheint NICHT automatisch, sondern in
  der Liste „Neu – noch nicht auf dem Handy" (Zähler am Knopf, `mobilePending()`).
- Live: Seiten mit `m` liefern `.pg-d` + `.pg-m`; CSS zeigt bis **760 px** Fensterbreite (`MOBILE_MAX`) das Handy-Layout.
  `?ansicht=handy` erzwingt es (Editor-Vorschau öffnet im Handy-Modus ein schmales Fenster). Loop-Videos haben live kein
  `autoplay` – `site.js` spielt nur sichtbare (IntersectionObserver), so lädt die versteckte Fassung nicht mit.

## Fixierte Elemente & Ebenen
- **Ebenen:** alle Elemente (fixiert oder nicht) teilen EINE Reihenfolge = Array-Index (`z-index: i+1`, in `itemHTML`).
  Handschrift (`.ink-layer`, z 100000) liegt immer über allen Elementen; Zurück-Knopf darüber.
  Editor: `moveLayer(±1 | ±Infinity)` · Knöpfe im Inspector · ⌘] / ⌘[ (mit ⇧ = ganz) · Rechtsklick.
- **Fixieren:** `item.pin = 't' | 'b'` → `.pinned` = `position:fixed`; `y` = Abstand zur Ober-/Unterkante des **Bildschirms**.
  Umschalten: Toolbar „📌 Fixieren", Taste F (aus → oben → unten → aus), Inspector, Rechtsklick. `setPin()` rechnet so um,
  dass das Element optisch an Ort und Stelle bleibt.
- Fixierte Elemente liegen MIT in `.pg` (nur so funktioniert die gemeinsame Ebenen-Reihenfolge). Deshalb darf `.pg`
  **kein** `transform`/`contain`/`container-type` haben (würde `position:fixed` einfangen). Größen daher über `--u`
  (px pro Einheit) statt `cqw`: live `--u = --vw·100/Breite` (`--vw` per Skript aus `clientWidth`, Fallback `1vw`),
  Editor `--u = scale px`, Übersicht `opt.u`.
- Editor: fixierte Elemente sind auch dort `position:fixed`, verankert über `--pinTop/--pinBottom/--pinLeft` an
  `#items`. „Bildschirm" im Editor = `screenRect()` = sichtbarer Teil der WEISSEN Seite (Erweitern-Balken/dunkler Rand
  zählen nicht; Seitenanfang = Oberkante wie live). `updatePinVars()` bei Layout/Scroll; auch Mess-Hilfe, `setPin`, `dragOrig` nutzen es. Auswahlrahmen per
  `getBoundingClientRect`, beim Scrollen nachgeführt. Unten fixierte beim Ziehen intern „von oben" (`dragOrig`).
- Mess-Hilfe: beim Ziehen/Skalieren/Pfeiltasten eines fixierten Objekts zeigt `showPinGuide()` (#pinGuide, position:fixed)
  Bildschirmkante + Maßlinie + Abstand (`y` in px der Entwurfsbreite und % der Breite); verschwindet beim Loslassen.
  Pfeiltasten bei unten fixierten Objekten: `y` zählt von unten → Vorzeichen umgedreht (`nudge`).
- Pro Ansicht: `pin` gehört zur Geometrie (`GEO`) → im Handy-Layout separat. Zuschneiden nur ohne Fixierung.
- Übersicht/Vorschaubilder zeigen fixierte Elemente so, wie sie am Seitenanfang stehen (`pinTopY`).

## Mehrfachauswahl
- ⇧-Klick fügt hinzu/entfernt, ⌘A = alles, Esc = aufheben. Zustand: `sel` (Einzel, mit Anfassern) ODER `multi`
  (Objekt-Referenzen aus `L.items`, ≥ 2, nur Rahmen + Gruppenrahmen, kein Skalieren). `targets()` liefert die Indizes
  beider Fälle – Löschen, Duplizieren, Ebenen (`moveLayer`), Pfeiltasten (`nudge`), Fixieren (`setPin`) arbeiten damit.
- Ziehen eines gewählten Objekts bewegt alle (`drag.mode = 'multi'`, unten fixierte intern „von oben").
- Objekt-Referenzen statt Indizes, weil sich Indizes beim Umsortieren ändern; `applyState`/`enterLayout` leeren `multi`.

## Drehen (`it.rot`, Grad −180…180)
- Runder Griff über der Auswahl (⇧ = 15°-Schritte, rastet bei 0/90/180° leicht ein) oder Inspector „⟳ Drehung"
  (Zahl, ↺/↻ 90°, 0°; wirkt auch auf Mehrfachauswahl, jedes Objekt um seine eigene Mitte).
- Render: `itemHTML` setzt `--r:<deg>` am Element; site.css: `.pg .it{rotate:var(--r,none)}`. Text (`.it-text` hat Höhe 0)
  dreht stattdessen `.tx`: `scale(k) translate(50%,50%) rotate(var(--r)) translate(-50%,-50%)` -> um die Textmitte.
- Editor: Auswahlrahmen/Griffe in Objekt-Richtung (Mitte = Mitte von `getBoundingClientRect`, Maße = w/h·scale);
  Skalieren rechnet den Mausweg in Objekt-Richtung um, die Gegenecke bleibt stehen. Zuschneiden zeigt das Bild kurz gerade.
  „In Striche auflösen" dreht die Striche mit. `rot` ist Geometrie (`GEO`) -> pro Layout (Handy eigen).
- Taste **A** (wie V) = Auswahlwerkzeug.
- Nach Änderungen an `shared/render.mjs` den Server neu starten (Vorschau nutzt das geladene Modul).
- Editor per URL öffnen: `/#seite=<id>` (nicht `/#<id>` -> öffnet sonst die Startseite!). Tests nie auf echten Seiten.

## Handschrift-Objekte (gruppierte Striche)
- Lasso-Auswahl → „▣ Als Objekt" (schwebender Knopf an der Auswahl, Seitenleiste, ⌘G) → `groupLasso()` erzeugt
  `{type:'draw', x,y,w,h, bw,bh, strokes (lokal 0..bw/0..bh), v, up}`. Radierer-Striche, die nach den gewählten
  Strichen darüber liefen, werden ins Objekt KOPIERT (Original bleibt auf der Seite) → Wegradiertes kommt nicht zurück.
- Verhält sich wie ein Foto: verschieben, skalieren (Seitenverhältnis fest), Ebenen, fixieren, verlinken, duplizieren,
  Handy-Layout. Kein Zuschneiden. Doppelklick / ⌘⇧G / „In Striche auflösen" → `ungroupDraw()` (wieder Lasso-Auswahl).
- Editor zeichnet aus den Strichen (`drawRaster`, Cache nach `v`, 2-fache Auflösung von bw×bh, max. 4096 px).
  Beim Speichern wird `draw_<id>.png` hochgeladen, wenn `up !== v` (`POST /api/drawobj`), verwaiste per `/api/draw-clean`.
  Live/Übersicht zeigen das PNG (`?v=` gegen Cache). Duplikat bekommt neue ID → `up` wird gelöscht.
- Gruppieren am Desktop bei vorhandenem Handy-Layout: die Handy-Kopien dieser Striche werden durch das Objekt ersetzt.

## Schriften
- Hinzufügen im Editor: „＋ Schrift hinzufügen" (Seitenleiste „Schriften" oder ＋ neben dem Schrift-Feld einer Textbox)
  → Datei/ZIP wählen ODER eine in `~/Library/Fonts` / `/Library/Fonts` installierte Familie per Klick übernehmen.
  Schriftdateien/ZIPs können auch einfach auf den Editor gezogen werden.
- `shared/fontinfo.mjs` (pure Node): liest `name`/`OS/2`/`fvar` aus TTF/OTF/WOFF/WOFF2 (WOFF2 via Brotli),
  wandelt TTF/OTF → **WOFF** (zlib), entpackt ZIPs. Statische Schnitte werden übersprungen, wenn es für Familie+Stil
  eine variable Datei gibt (Google-Fonts-ZIPs). Doppelte Schnitte werden übersprungen.
- `listFonts()` liefert `{file,family,sub,weight,style,variable,wmin,wmax}`; `fontFaceCSS` setzt `font-weight` (variabel:
  Bereich) und `font-style`. Die Stärke-Auswahl im Editor bietet nur vorhandene Schnitte an.
- API: `POST /api/font?name=` (Datei/ZIP) · `GET /api/system-fonts` · `POST /api/font-import {family}` · `POST /api/font-delete {family}`.

## Dateien
- `shared/render.mjs` – **ein** Renderer (Browser + Node): `itemHTML`, `pageHTML`, `textCss`, `styleOf`, `normalizePage`.
  Live: Positionen in %; Editor: über CSS-Variablen `--s`/`--top` (`posVar`) → Zoom/Erweitern ohne Neu-Rendern.
- `shared/document.mjs` – komplettes HTML einer Seite (Build UND `/preview/`). Dateinamen: `index.html`, `<id>.html`, Medien `media/<id>/…`.
- `shared/store.mjs` – Dateizugriff (Server + Build). `shared/site.css` (Editor + live), `shared/site.js` (Loop-Videos nur sichtbar abspielen).
- `editor/server.mjs` – API: `GET /api/boot|all|page|media|jobs`, `POST /api/page|pages|site|rename|ink|ink-clean|upload|media-delete|publish`, `DELETE /api/page`.
  Range-Requests für Video. `within()` gegen Path-Traversal.
- `editor/public/editor.js` – Editor (ES-Modul). Abschnitte: Undo · Speichern (Autosave 1,5 s, nur geänderte Tinten-Kacheln) ·
  Kacheln · Pinsel (`inkDab`, Stellschrauben `WOBBLE_AMOUNT/SPECK_CHANCE/SPECK_ALPHA`) · Lasso (SVG-Overlay) · Elemente ·
  Text (contenteditable plaintext-only) · Erweitern/Kürzen · Zuschneiden · Medien/Upload/Jobs · Inspector · Seiten · Übersicht.

## Medien-Pipeline (Server)
- **Fotos**: > 3200 px oder HEIC/TIFF → macOS `sips` → JPEG Q88, max. 3200 px. Kleine Web-Formate unverändert.
- **Videos**: ffmpeg → H.264 High, **CRF 20**, preset slow, max. 2560 px lange Kante, AAC 192k, `+faststart`, Poster.
  Bereits web-taugliche MP4 (h264/yuv420p, < 95 MB) werden **nicht** neu komprimiert. Warteschlange, Fortschritt via `/api/jobs`.
- Ergebnis > 95 MB → automatisch zweiter Anlauf `transcodeToSize()`: **Zwei-Pass** auf ~88 MB (Bitrate aus Dauer
  berechnet, Ton 160 kbit/s, `-tune film`). Fortschritt läuft dabei ab 50 % weiter.
- Video-Modi (`it.mode`): `loop` (stumm, Schleife, nur sichtbar) · `scene` (startet, wenn erstmals GANZ im Bild; pausiert,
  wenn ganz weg; Lautstärke folgt der Sichtbarkeit mit weichem Blenden; Klick aufs Video/🔊 = Ton an/aus) · `player`.
  Logik in `shared/site.js` (IntersectionObserver mit 41 Schwellen). Browser erlauben Ton erst nach einer echten
  Interaktion (Klick/Tippen/Taste; Scrollen zählt NICHT) → bis dahin stumm, danach blendet der Ton automatisch ein.
  iOS: `video.volume` ist schreibgeschützt → Blenden dort über Web Audio (GainNode, erst nach Interaktion).
  Im Editor laufen alle Videos stumm im Loop.
- GitHub: **max. 100 MB pro Datei** → Publish bricht mit klarer Meldung ab, wenn eine Datei > 95 MB ist.
  Lange/4K-Videos: extern (Cloudflare R2 / Bunny) hosten und per „＋ Video per URL" einbetten.

## Veröffentlichen — LIVE seit 2026-11-19
- **Live:** https://fabiannausner.de (http und www leiten auf https://fabiannausner.de um)
- **Repo:** `Fabiannau/Portfolio` (GitHub-Konto „Fabiannau"), Branch `main`, Remote `git@github-fabiannau:Fabiannau/Portfolio.git`
  über SSH-Alias `github-fabiannau` (`~/.ssh/id_ed25519_fabiannau`, IdentitiesOnly) – der Standardschlüssel gehört zu FabianN1111!
- Pages-Quelle = **GitHub Actions** (`.github/workflows/deploy.yml` → `node build.mjs` → `dist`). Custom Domain in den
  Repo-Settings (keine CNAME-Datei nötig). DNS bei Strato unverändert.
- Editor-Knopf „⤴ Veröffentlichen" = git add/commit/push → Action baut → live nach ~1–2 Min.
- Die vorherige Seite („Fabian's Website", schlichtes HTML) steckt in der Git-Geschichte (Commit `2d4b5a0`, das Portfolio
  wurde darauf aufgesetzt, kein Force-Push) und liegt zusätzlich in `~/Desktop/Backup-alte-Website-fabiannausner.de-2026-11-19/`.
- Hinweis „Large files detected" beim Push = nur Warnung (> 50 MB); harte Grenze 100 MB pro Datei.

## Effizienz & stabile Darstellung (2026-11-19)
- **Text** wird in festen Seiten-Einheiten gesetzt: `.it-text` (Höhe 0) > `.tx` mit `width: <w>px; font-size: <n>px`
  und `transform: scale(var(--k))`. `--k` = Bildschirm-px pro Einheit (unitless): live `calc(var(--vwn) * 100/Breite)`
  (`--vwn` = clientWidth/100 per Head-Skript, Fallback 19.2), Editor `--k = scale`, Übersicht `opt.k`. `--u = --k·1px`.
  Dadurch identische Zeilenumbrüche & Proportionen bei jedem Zoom (vorher schwankte die Textbreite bis 4,5 %).
  Editor: bearbeitet wird der innere `.tx` (`boxEl()`), Rahmen/Messungen über `rectOf()`; `it.h` = `.tx.offsetHeight`.
  `syncItem()` muss bei Text auch `.tx.style.width` setzen (sonst bricht der Text beim Ziehen nicht um).
- Rechtschreibung: Firefox-eigene Prüfung beim Bearbeiten (`spellcheck = true`), Rechtsklick im bearbeiteten Text
  bleibt beim Firefox-Menü (Vorschläge). `it.lang` = 'de' | 'en' | – (Auto = alle aktivierten Wörterbücher) →
  `lang`-Attribut am `.tx`. Firefox des Nutzers ist englisch → deutsches Wörterbuch als Add-on nötig.
- **Responsive Bilder:** Server erzeugt je JPG/PNG Fassungen in `resp/<datei>-<breite>.(webp|jpg)` (480/960/1440/2048/
  2880, max. Originalbreite) – beim Upload, beim Serverstart und vor jedem Veröffentlichen. Qualität PRO BILD:
  WebP q82→95, bis SSIM ≥ 0,97 gegen das gleich verkleinerte Original; sonst JPEG q90 (körnige / schon komprimierte
  Fotos), dann ist bei JPEG-Originalen das Original selbst die größte Fassung. Merkt sich die Wahl in
  `resp/.settings.json` (wird mit veröffentlicht – Build liest es). Renderer: `<picture><source webp srcset sizes>`
  bzw. `<img srcset>`; `sizes` = exakter vw-Anteil (Item-Breite/Seitenbreite/Crop). Werkzeuge: cwebp/dwebp, sips, ffmpeg.
  GitHub Action erzeugt NICHTS selbst → Fassungen müssen committet sein (Veröffentlichen erledigt das).
  Ergebnis Startseite: 22,6 MB → 0,6 MB (1x) / 1,6 MB (Retina) / 2,7 MB (iPhone 3x).
- Kein Hover-Effekt auf verlinkten Objekten (Nutzerwunsch). KEIN automatischer Zurück-Knopf (Nutzer setzt eigene
  Links). site.js: zeigt ein Link genau auf die Seite aus `document.referrer` (gleiche Website) → `history.back()`,
  damit man an der Stelle landet, von der aus man geklickt hat. (`page.back` wird nicht mehr verwendet.)
- **Editor spielt keine Videos** (auch keinen Zufallsschnitt): Standbild/Poster + kleines ▶. Abgespielt wird in Vorschau/live.

## Galerie (Großansicht + Karussell)
- `item.gal = '<id>'` an Fotos (geteilter Inhalt, gilt auch im Handy-Layout). Editor: ⇧-Mehrfachauswahl →
  „▦ Als Galerie verbinden" (bestehende Galerien werden zusammengeführt); Einzelbild: „Alle auswählen" / „Aus Galerie
  lösen" (eine Galerie aus nur 1 Bild wird aufgelöst). Badge ▦ im Editor.
- Live (site.js): Klick auf `div.it[data-gal]` → `.lb`-Overlay; Reihenfolge = Position in der SICHTBAREN Fassung
  (oben→unten, links→rechts); Bildquelle = responsive srcset mit `sizes=100vw`; Pfeile/Tasten/Wischen/Esc;
  `history.pushState` → Zurück-Geste schließt nur die Großansicht. Bilder mit Link (`a.it`) öffnen keine Großansicht.
- **Galerie-Symbole in Handschrift** (seitenweit): `content/ui/gal-prev|next|close.png` + `gallery.json` {rolle:{w,h,v}}
  (eigene Datei, weil der Editor `site.json` komplett überschreibt). Übernahme im Editor: Handschrift-Objekt wählen →
  „▦ Als Galerie-Symbol verwenden" (`POST /api/gallery-ui`, kopiert `draw_<id>.png`). `document.mjs` → `galleryCSS()`:
  Größe = gezeichnete Breite in Einheiten × Bildschirmbreite/2560, `clamp(34px … 110px)`. Build kopiert `content/ui`.
  Aktuell übernommen von Seite `fromnaturetoculturetonature` (die Vorlagen-Objekte liegen dort unten, y≈4500).
  Handy: Pfeile unten links/rechts.

## Zufallsschnitt (Objekttyp `random`) & externe Links
- Nach dem Prinzip von `~/Desktop/Random-Edits-Kindlab` („Erleben"): `shared/randomcut.mjs` – zwei gestapelte `<video>`,
  eins spielt, das andere lädt den nächsten zufälligen Clip; jeder Clip ab Anfang für 0,7–4 s. Live startet/stoppt
  `site.js` (jetzt ES-Modul!) per IntersectionObserver; der Editor zeigt den Schnitt ebenfalls live (`startRandoms`).
- Item: `{type:'random', dir, clips[], poster}` – Clips liegen in einem UNTERORDNER der Seite
  (`content/pages/<id>/<dir>/`, nur MP4/WebM). Build kopiert Unterordner (außer `_…`/`.…`) mit.
  Editor: „🎲 Zufallsschnitt aus Clip-Ordner" (Medien-Leiste) → vorhandenen Ordner wählen oder Ordner hochladen
  (`POST /api/clip-upload`), Liste über `GET /api/clipdirs`. „↻ Clips neu einlesen" im Inspector.
- Startseite: `index/clipsKurzfilmMitElla/` = 38 Clips aus Random-Edits-Kindlab (`public/media/clipsKurzfilmMitElla`,
  VP9-WebM) → H.264, ohne Ton, erste 4,1 s, **960×540, CRF 25** (Ø 420 KB, 16 MB gesamt; Box live nur ~720 px breit).
- Effizienz (2026-11-19, gemessen mit gedrosselter, GETEILTER Leitung ~300 KB/s inkl. Range, weil Fotos mitkonkurrieren):
  Shuffle-Bag-Reihenfolge; Vorladen als Blob NACHEINANDER (nie parallel, `priority:'low'`), pausiert solange ein
  Clip streamt; ist der nächste Clip nicht fertig → zufällig einen schon geladenen nehmen (nie warten);
  `warm()` (site.js, 1200 px vorher) streamt den ersten Clip schon ins Wartevideo. Ergebnis: 17/17 Schnitte in 40 s,
  Start beim Hineinscrollen 0 ms (vorher 13 Schnitte, ~28 s eingefrorenes Bild, Start 1,8 s).
  Größter verbleibender Bremsklotz der Seite: große Fotos (bis 1,5 MB) → responsive Bildgrößen wären der nächste Schritt.
- `item.link` darf eine externe URL sein (`https://…`) → live `target="_blank" rel="noopener"`; Inspector „🌐 Externe Webseite…".

## Schutz vor KI-Training
- `shared/aiprotect.mjs`: Liste der KI-Trainings-Crawler (`AI_BOTS`). Build schreibt `robots.txt`, `ai.txt`,
  `.well-known/tdmrep.json`; jede Seite bekommt `<meta name="tdm-reservation" content="1">` + `robots noai, noimageai`.
  = maschinenlesbarer Nutzungsvorbehalt nach § 44b Abs. 3 UrhG. Normale Suchmaschinen bleiben erlaubt.
- ACHTUNG: `robots.txt`/`ai.txt`/`.well-known` wirken nur im **Domain-Stamm**. Unter `user.github.io/<repo>/`
  (Projektseite) werden sie ignoriert → eigene Domain nutzen (oder User-Site-Repo). Die Meta-Tags wirken überall.
- Harte Sperre auch gegen regelbrechende Bots: eigene Domain über Cloudflare (Gratis-Plan, „AI-Crawler blockieren").

## Impressum
- Seite `impressum` („Impressum & Datenschutz", inkl. KI-Nutzungsvorbehalt nach § 44b UrhG) mit eigenem Handy-Layout.
  Kurzfassung (2026-11-19) ohne MStV-Zeile; Rechte-Satz muss bleiben (Art. 13 DSGVO). Impressum hat `noindex`
  (Adresse nicht in Suchmaschinen). E-Mail-Adressen in Textboxen werden live verschlüsselt ausgeliefert
  (`opt.protectEmail` in render.mjs → `.em[data-em]`, site.js macht daraus einen mailto-Link).
  `document.mjs` hängt an jede andere Seite unten `<footer class="legal">` mit Link darauf (nur wenn die Seite existiert).

## Gotchas
- Determinismus der Tinte wahren (kein `Math.random` im Pinsel).
- Synthetische PointerEvents: `setPointerCapture` über `capture()` (try/catch).
- Klicks auf `#input` (Zeichen-/Text-Ebene) stoppen die Propagation – sonst hebt der Leer-Klick-Handler die neue Textbox auf.
- Seiten ohne Handy-Layout werden auf Handys proportional verkleinert angezeigt.
