# Anleitung: Fotos zu den Projektseiten hinzufügen

## Schritt 1: Fotos in die Ordner kopieren
Kopiere deine Set-Fotos in die entsprechenden Ordner:
- `img/projekt1/` - für Sitzordnung
- `img/projekt2/` - für Myopia
- `img/projekt3/` - für Mixam
- `img/projekt4/` - für Maxim
- `img/projekt5/` - für Neuer Morgen
- `img/projekt6/` - für Sich (wieder) finden

## Schritt 2: Bildnamen in carousel.js eintragen
Öffne die Datei `carousel.js` und füge die Bildpfade in der `getProjectImages()` Funktion hinzu.

### Beispiel für Projekt 1:
```javascript
'projekt1': [
    'img/projekt1/01-set-aufbau.jpg',
    'img/projekt1/02-dreharbeiten.jpg',
    'img/projekt1/03-behind-scenes.jpg',
    'img/projekt1/04-finale-szene.jpg'
],
```

### Beispiel für Projekt 2:
```javascript
'projekt2': [
    'img/projekt2/01-3d-setup.jpg',
    'img/projekt2/02-riesen-szene.jpg',
    'img/projekt2/03-spezialeffekte.jpg'
],
```

## Schritt 3: Unterstützte Bildformate
- .jpg / .jpeg
- .png
- .webp
- .gif

## Empfohlene Bildgröße
- Mindestens 1920x1080px für beste Qualität
- 16:9 Seitenverhältnis wird automatisch angepasst

## Tipps
- Benenne Bilder mit führenden Nullen: `01-name.jpg`, `02-name.jpg`, etc.
- Verwende aussagekräftige Namen für bessere Organisation
- Die Bilder werden in der Reihenfolge angezeigt, wie sie in der Liste stehen

## Testen
Nach dem Hinzufügen der Bildpfade öffne die entsprechende Projektseite im Browser - das Karussell sollte automatisch die Bilder anzeigen!
