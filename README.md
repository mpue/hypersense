# Hypersense

Horizontaler Shoot'em up im Browser, im Geist von Armalyte. Die **Gegner spielen im Takt der Musik**:
Sie treten auf Takt-Einsen auf, feuern nur auf den Noten des Songs, ihre Laser-Tore zünden auf der Eins,
und ihre Klänge liegen sample-genau auf dem Beat. Sie sind also Teil der Musik. Der **Spieler** ist
davon unabhängig: Bewegung, Feuerrate und seine Klänge kümmern sich nicht um den Takt.

Die Spielmechanik ist an SKYSTRIKE angelehnt (Godot-Port von `shmup.lua`), die Song-Analyse stammt aus
Rhytmicker (`public/js/analysis.js`, unverändert übernommen).

## Starten

Node.js ≥ 18, keine Abhängigkeiten:

```bash
node server.js
```

Dann <http://localhost:5180> öffnen. Die Songs liegen in `music/`. Ohne Angabe nimmt das Spiel den ersten,
mit `?song=Name` einen bestimmten.

## Steuerung

| Taste | Gamepad | |
|---|---|---|
| Pfeile / WASD | Stick, D-Pad | fliegen |
| Shift | LB / LT | langsam fliegen |
| Leertaste / J / Z | A / RT | Feuer (halten) |
| X / K | B / RB | HYPER-Strahl (wenn die linke Leiste voll ist) |
| C / L | X / Y | Drohnen-Modus A (vorn) / B (Flanke) |
| P / Esc | Start | Pause |
| F | | Vollbild |

## Spielprinzip

- **HUD** wie im Zielbild: Links die HYPER-Ladung mit dem Waffenbuchstaben (A–D), rechts die
  Drohnen-Energie mit dem Drohnen-Modus. In der Mitte stehen Punkte, Song, Leben und Multiplikator.
- **Drohne:** Sie fliegt mit, feuert mit und fängt feindliche Geschosse ab, was Energie kostet.
  Bei 0 fällt sie aus und lädt sich wieder auf.
- **HYPER:** Die Ladung kommt aus Abschüssen. Dann schmilzt ein Takt lang ein Strahl alles in seiner Bahn,
  und der Spieler ist unverwundbar.
- **SYNC:** Ein Abschuss innerhalb von ±50 ms um einen Beat zählt doppelt und lädt HYPER doppelt.
- **Kette:** Abschüsse ohne Pause von mehr als 4 Beats erhöhen den Multiplikator (bis ×8).
- **Kapseln:** Sie fallen aus orangen Gegnern und kommen immer, wenn eine Kette komplett abgeschossen ist.
  Jede hebt die Waffe eine Stufe, auf D gibt es stattdessen Punkte und HYPER-Ladung.
- Ein Song ist eine Stage. Auf den stärksten Drop folgt der Boss, der **Bass-Kern**: Er feuert Ringe auf
  den Takt-Einsen, Fächer auf betonten Noten und Zwillingsschüsse auf den übrigen.

### Wie der Takt die Gegner steuert (`public/js/level.js`, `public/js/game.js`)

- `Analysis.analyze` liefert das Beat-Raster (auch bei Tempowechseln), Lautheit und Drops.
  `Analysis.makeChart` wählt daraus die Noten.
- `Level.build` legt alle 2 Takte eine Welle auf die Eins. Die Art hängt von der Lautheit ab:
  Kette, V-Formation, Jäger, Asteroiden, Laser-Tor. Drops bekommen einen Schwarm, der stärkste Drop
  den Boss.
- Gegnerbahnen sind Funktionen des Beats seit ihrem Auftritt. Formationen versetzen sich auf jeder Eins,
  alle Gegner pumpen auf jedem Beat.
- Für jede Note wird 120 ms vorher ein Schütze gewählt. Sein Kern lädt sichtbar auf, der Klang wird auf den
  exakten Songzeitpunkt terminiert (`AudioEngine.atSong`), und der Schuss fällt, wenn die Note erklingt.
- Explosionen erscheinen sofort, ihr Klang kommt auf der nächsten Sechzehntel.

## Test-Schalter

`?at=90` (ab Songsekunde 90), `?god=1` (unverwundbar), `?auto=1` (Dauerfeuer), z. B.
<http://localhost:5180/?at=150&god=1&auto=1> für den Boss.

## Grafiken

Alle Sprites und Hintergründe kommen aus dem lokalen ComfyUI (Krea-2 Turbo):

```bash
python tools/gen_assets.py            # rendert alle Motive in 2 Varianten nach art/raw/
python tools/gen_assets.py boss       # nur einzelne
python tools/contact.py               # Kontaktbogen art/contact.png zum Auswählen
python tools/key_assets.py            # gewählte Varianten -> public/assets/
```

Welche Variante genommen wird, steht oben in `tools/key_assets.py`. Sprites werden auf Greenscreen gerendert
und freigestellt. Nebel, Galaxie und Explosion werden auf Schwarz gerendert und additiv gezeichnet,
der Planet bekommt eine Scheibenmaske.

## Projektstruktur

```
server.js              statischer Server + /api/songs
public/js/analysis.js  Song-Analyse (aus Rhytmicker)
public/js/level.js     Level aus der Analyse
public/js/audio.js     Wiedergabe, Song-Uhr, Effekte (Gegner terminiert, Spieler sofort)
public/js/game.js      Spiellogik
public/js/render.js    Darstellung und HUD
public/js/main.js      Laden, Eingabe, Ablauf
public/assets/         Sprites
tools/                 Asset-Pipeline (ComfyUI)
music/                 Songs
```
