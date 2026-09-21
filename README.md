# Hypersense

Horizontaler Shoot'em up im Browser, im Geist von Armalyte. Die **Gegner spielen im Takt der Musik**:
Sie treten auf Takt-Einsen auf, feuern nur auf den Noten des Songs, ihre Laser-Tore zünden auf der Eins,
und ihre Klänge liegen sample-genau auf dem Beat. Sie sind also Teil der Musik. Der **Spieler** ist
davon unabhängig: Bewegung, Feuerrate und seine Klänge kümmern sich nicht um den Takt.

Die Spielmechanik ist an SKYSTRIKE angelehnt (Godot-Port von `shmup.lua`), die Song-Analyse stammt aus
Rhytmicker (`public/js/analysis.js`, unverändert übernommen).

## Starten mit Docker Compose

```bash
git clone https://github.com/mpue/hypersense.git
cd hypersense
docker compose up -d --build
```

Dann <http://localhost:5180> öffnen. Die Songs liegen in `./music` und werden schreibgeschützt in den Container
gehängt. Weitere Songs (.mp3/.ogg/.wav/.m4a/.flac) einfach dort ablegen, sie erscheinen nach einem Neuladen der
Seite in der Songliste, ohne Neustart des Containers.

Port oder Musikordner ändern: `.env.example` nach `.env` kopieren und anpassen:

```dotenv
HYPERSENSE_PORT=8080
MUSIC_PATH=/pfad/zu/meiner/musik
```

Nützlich: `docker compose logs -f` (Log), `docker compose down` (stoppen). Der Container läuft als
unprivilegierter Nutzer, hat einen Healthcheck (`/healthz`) und startet automatisch neu.

## Starten ohne Docker

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

### Handy / Touch (Querformat)

Im selben WLAN `http://<IP-des-Rechners>:5180` im Handy-Browser öffnen. Beim ersten Tippen schaltet das
Spiel den Ton frei, geht in den Vollbildmodus und sperrt das Querformat (Android). Unter Windows muss die
Firewall eingehende Verbindungen auf Port 5180 für Node erlauben.

- **Fliegen:** irgendwo mit einem Finger ziehen. Das Schiff folgt der Fingerbewegung relativ und bleibt
  sichtbar, Dauerfeuer ist automatisch an.
- **HYPER** (großer Knopf mit Ladering) und **DRONE** (Modus A/B) rechts unten, **Pause** oben rechts.
- **Titel:** linken oder rechten Rand antippen, um den Song zu wählen; in der Mitte tippen startet.
- **Hochformat:** Das Spiel pausiert und zeigt einen Dreh-Hinweis.
- Touch-Geräte rechnen intern mit 1280×720 statt 1920×1080 (`?res=1` erzwingt volle Auflösung).

## Spielprinzip

- **HUD** wie im Zielbild: Links die HYPER-Ladung mit dem Waffenbuchstaben (A–D), rechts die
  Drohnen-Energie mit dem Drohnen-Modus. In der Mitte stehen Punkte, Song, Leben und Multiplikator.
- **Drohne:** Sie fliegt mit, feuert mit und fängt feindliche Geschosse ab, was Energie kostet.
  Bei 0 fällt sie aus und lädt sich wieder auf.
- **HYPER:** Die Ladung kommt aus Abschüssen. Dann schmilzt ein Takt lang ein Strahl alles in seiner Bahn,
  und der Spieler ist unverwundbar.
- **SYNC:** Ein Abschuss innerhalb von ±50 ms um einen Beat zählt doppelt und lädt HYPER doppelt.
- **Kette:** Abschüsse ohne Pause von mehr als 4 Beats erhöhen den Multiplikator (bis ×8).
- **Waffenstufen A–E:**
  - A: Zwillingsbolzen
  - B: dazu ein Fächer
  - C: dazu ein Plasma-Speer, der 3 Gegner durchschlägt
  - D: dazu ein breiter Fächer
  - E: alles als Plasma, noch breiter

  Treffer blitzen und sprühen Funken, das Schiff hat Rückstoß. Beim Tod sinken Waffe und Raketen
  um eine Stufe.
- **Kapseln (Power-ups):** Welcher Typ fällt, richtet sich nach dem, was gerade fehlt. Kapseln kommen aus
  orangen Gegnern, Türmen, Splittern, Kanonen, Trägern und Serpent-Köpfen. Außerdem fällt immer eine, wenn
  eine Kette komplett abgeschossen ist, und spätestens alle 15 Abschüsse. In der Nähe zieht ein Magnet sie
  zum Schiff.

  | Kapsel | Wirkung |
  |---|---|
  | **W** | Waffe eine Stufe hoch (auf E: 5000 Punkte) |
  | **S** | Schild: fängt 3 Treffer ab, auch eine Rumpf-Berührung |
  | **E** | Energie: Drohne voll, +40 % HYPER |
  | **M** | Zielsuchraketen, bis 3 Rohre, mit Flächenschaden |
  | **R** | Rapid-Fire für 8 Takte |
  | **2x** | doppelte Punkte für 8 Takte |
  | **1UP** | ein Extraleben (selten) |
- Ein Song ist eine Stage. Auf den stärksten Drop folgt der Boss, der **Bass-Kern**: Er feuert Ringe auf
  den Takt-Einsen, Fächer auf betonten Noten und Zwillingsschüsse auf den übrigen.
- **Die Welt scrollt im Takt** (110 Pixel pro Beat). In mittellauten 8-Takt-Blöcken fliegt man durch
  **Korridore einer Raumstation**: Rumpf oben und unten mit wechselnder Höhe, Berührung ist tödlich,
  und Geschütztürme sitzen darauf.

### Gegner

| Gegner | Verhalten |
|---|---|
| Blaue / orange Drohne | Ketten und V-Formationen, die sich auf jeder Eins versetzen |
| Jäger | Sturzflug von oben und unten |
| Dart | macht auf jedem Beat einen Satz auf den Spieler zu |
| Mine | hängt in der Welt, blinkt immer schneller und platzt auf einer Eins in 12 Kugeln |
| Geschützturm | auf dem Stationsrumpf, feuert Nadel-Salven |
| Serpent | Kopf und 10 Segmente auf einer Wellenbahn, der Puls läuft den Körper entlang |
| Splitter | Kristallkugel, feuert ein Kreuz und zerfällt in 5 Scherben |
| Träger | hält vier Takte und spuckt alle zwei Beats einen Dart aus |
| Laser-Tor | zwei Kanonen, die anpeilen, einen Beat warnen und auf der Eins feuern |
| Asteroiden | in ruhigen Passagen |
| Bass-Kern | Boss am stärksten Drop |

In lauten Passagen kommt jeden Takt eine Welle, sonst alle zwei Takte. Auf Drops blitzt und bebt es
acht Beats lang auf jedem Schlag.

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

## Sounds

Die Explosionen stammen aus der Bluezone-Library unter `D:\samples\ExplosionSounds` (BC0214, BC0200):

```bash
python tools/scan_sfx.py D:/samples/ExplosionSounds > art/sfx_scan.tsv   # Länge, Anschlag, Bassanteil messen
python tools/make_sfx.py                                                 # gewählte Samples -> public/sfx/
```

Welche Samples genommen werden, steht oben in `tools/make_sfx.py`. Mischung (`public/js/audio.js`):

- **klein / mittel / groß:** je nach Gegner, reihum und leicht verstimmt. Darüber liegen ein harter
  Anschlag und ein Sub-Stoß (`_punch`).
- **Asteroiden:** zusätzlich eine Geröll-Schicht.
- **Boss:** Ein Whoosh läuft vorher an. Sein Höhepunkt und die Riesenexplosion fallen genau auf den Beat.
- **Mischpult:** Alle Effekte laufen über einen Kompressor mit Aufholverstärkung, am Master sitzt ein Limiter.
  Mittlere und große Explosionen drücken die Musik kurz weg (Ducking).

Die Bluezone-Samples sind lizenziert. Vor einem öffentlichen Push die Lizenz prüfen: Die Weitergabe
einzelner Samples ist bei solchen Libraries meist nicht erlaubt.

## Projektstruktur

```
server.js              statischer Server + /api/songs + /healthz
Dockerfile, docker-compose.yml, .env.example
public/js/analysis.js  Song-Analyse (aus Rhytmicker)
public/js/level.js     Level aus der Analyse
public/js/audio.js     Wiedergabe, Song-Uhr, Effekte (Gegner terminiert, Spieler sofort)
public/js/game.js      Spiellogik
public/js/render.js    Darstellung und HUD
public/js/main.js      Laden, Eingabe, Ablauf
public/assets/         Sprites
public/sfx/            Explosions-Samples (aus tools/make_sfx.py)
tools/                 Asset-Pipeline (ComfyUI)
music/                 Songs
```
