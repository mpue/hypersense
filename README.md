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

| Taste | Gamepad (Xbox / PlayStation) | |
|---|---|---|
| Pfeile / WASD | linker Stick (analog) / D-Pad | fliegen |
| Shift | LB / LT (L1 / L2) | langsam fliegen |
| Leertaste / J / Z | A / RT (✕ / R2) | Feuer (halten) |
| X / K | B / RB (○ / R1) | HYPER-Strahl (wenn die HYPER-Leiste voll ist) |
| C / L | X (□) | Drohnen-Modus A (vorn) / B (Flanke) |
| P / Esc | Menu / View (Options / Share) | Pause |
| Enter | A (✕) | Menüs: bestätigen, starten, kaufen |
| Esc | B (○) | Menüs: zurück |
| I | Y (△) | Incubator (Titel und Ergebnis) |
| ← / → | D-Pad / Stick / LB RB | Song wählen |
| F | | Vollbild |

Gamepads im Standard-Layout werden automatisch erkannt. Der Browser meldet ein Pad erst nach dem ersten
Tastendruck. Aktiv ist das Pad, auf dem zuletzt gedrückt wurde. Menü-Richtungen wiederholen sich beim Halten.
Treffer, Tod, HYPER, Schildtreffer und große Explosionen lassen den Controller vibrieren, wenn er das kann.
Wird das Pad im Spiel getrennt, pausiert das Spiel. Die Tasten-Hinweise im Spiel wechseln automatisch zwischen
Tastatur, Gamepad und Touch.

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

- **Hüllenenergie:** Treffer ziehen Energie ab, bei 0 ist ein Leben verloren.
  - Kugel etwa ⅓, große Kugel 45 %, Nadel ¼
  - Rumpf-Berührung 40 % (dabei wirst du aus der Wand geschubst), Laserstrahl 60 %
  - Rammen von Kanonenfutter 40 %, das Futter platzt dabei
  - Nach einem Treffer bist du kurz unverwundbar, der Schild fängt Treffer vorher ab.
  - E-Kapseln heilen 40 % und fallen häufiger, wenn die Energie knapp ist. Nach dem Wiedereinstieg ist die
    Energie voll.
  - Unter 26 % ertönt ein Warnton.
- **HUD** wie im Zielbild:
  - links die **ENERGY**-Leiste des Schiffs (grün, gelb, rot, blinkt, wenn es knapp wird) mit dem
    Waffenbuchstaben (A–E), darüber eine schmale HYPER-Leiste
  - rechts die Drohnen-Energie mit dem Drohnen-Modus
  - in der Mitte Punkte, Song, Leben und Multiplikator
  - unter dem Schiff eine kleine Energieleiste nach Treffern und bei knapper Energie
- **Drohne:** Sie fliegt mit, feuert mit und fängt feindliche Geschosse ab, was Energie kostet.
  Bei 0 fällt sie aus und lädt sich wieder auf.
- **HYPER:** Die Ladung kommt aus Abschüssen. Dann schmilzt ein Takt lang ein Strahl alles in seiner Bahn,
  und der Spieler ist unverwundbar.
- **Rang (Schwierigkeit):** Er setzt sich zu gut einem Drittel aus dem Songfortschritt und zum Rest aus der
  aktuellen Ausrüstung zusammen und gleitet sanft zwischen 0 und 1. Mit steigendem Rang werden Gegner zäher
  (bis etwa 2,5-fache HP) und ihre Geschosse schneller. Es feuern mehr Schützen pro Note, die Muster werden
  dichter (Fächer, Nadel-Salven, 8er-Kreuz), und ab mittlerem Rang feuern Wracks auf der nächsten Achtel
  zurück. Ein Tod kostet 2 Waffenstufen, eine Raketenstufe und den Schild, danach wird das Spiel wieder
  gnädiger. F3 zeigt den aktuellen Rang.
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

Die Wellen laufen auf zwei getrennten Spuren, damit kein Durcheinander entsteht:

- **Formationen:** Kanonenfutter aus blauen Drohnen und Jägern. Es kommt eine Formation zur Zeit, alle 2 Takte
  auf der Eins. Die Mitglieder sterben nach 2 Treffern, feuern kaum und werden mit dem Rang nicht zäher, nur
  zahlreicher. Figuren (alle im Takt bewegt):
  - Schlange: Kette auf einer Sinusbahn
  - V-Keil: schwenkt auf jeder Eins
  - Ring: dreht sich pro Beat eine Stufe weiter
  - Zange: zwei Reihen von oben und unten laufen zur Mitte
  - Wand: senkrechte Säule, die auf jedem Beat gemeinsam hüpft
  - Looping: Überschlag in der Bildmitte
  - Diagonale
  - Jäger-Keil im Sturzflug
  - Doppel-Schlange auf Drops
- **Schwere Gegner:** höchstens alle 4 Takte einer, versetzt zwischen die Formationen. Von ihnen kommt
  der Großteil des Feuers, und sie werden mit dem Rang zäher.

| Schwerer Gegner | Verhalten |
|---|---|
| Orange Kampfdrohnen | fliegen zu zweit oder dritt ein, halten drei Takte und feuern Fächer |
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

### HyperCoins und Incubator

- **Münzen:** Getötete Gegner verstreuen HyperCoins. Kanonenfutter gibt gelegentlich eine, schwere Gegner
  mehrere, der Boss einen Regen. SYNC-Abschüsse geben eine extra, komplett abgeschossene Formationen einen
  kleinen Regen. Die Münzen treiben mit der Welt und werden im Magnetradius eingesammelt.
- **Gutschrift:** Am Laufende wandern die gesammelten Münzen auf das Konto, auch bei Game Over. Das Konto wird
  im Browser gespeichert (`localStorage`).
- **Incubator:** im Titel mit **I**, per Klick oder Touch auf den Knopf, auch vom Ergebnisbildschirm aus.
  Dort gibt es dauerhafte Upgrades mit steigenden Preisen:

  | Upgrade | Wirkung | Stufen |
  |---|---|---|
  | Firepower | +10 % Schaden für Schüsse und Raketen | 5 |
  | Start Weapon | Start mit Waffe B/C, nach einem Tod nie darunter | 2 |
  | Reinforced Hull | +25 % Hüllenenergie | 3 |
  | Armor Plating | Start und Wiedereinstieg mit 1/2 Schild-Treffern | 2 |
  | Extra Ship | +1 Leben | 2 |
  | Drone Core | Drohne hält mehr aus und lädt schneller | 3 |
  | Hyper Capacitor | HYPER lädt 25 % schneller | 3 |
  | Magnet | größerer Einsammelradius für Münzen und Kapseln | 3 |
  | Engine | +8 % Tempo | 3 |
  | Missile Tube | Start mit einem Raketenrohr | 1 |

  Ein kompletter Lauf bringt einem guten Spieler etwa 500–700 Münzen, alles zusammen kostet rund 4.200.
  Der Rang berücksichtigt die Ausrüstung, das Spiel bleibt also auch voll ausgebaut fordernd.
  Test-Schalter: `?coins=5000` gibt Münzen dazu.

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

Welche Samples genommen werden, steht oben in `tools/make_sfx.py`. Dasselbe Skript übernimmt auch die eigenen
Sounds aus `sounds/` unverändert:

| Datei | Wofür |
|---|---|
| `shiedl_pickup.mp3` | Schild-Kapsel eingesammelt |
| `energy_pickup.mp3` | Energie-Kapsel eingesammelt |
| `missile_pickup.mp3` | Raketen-Kapsel eingesammelt |
| `warning_energy.mp3` | Warnung bei knapper Energie (wiederholt im Abstand seiner Länge) |

Mischung (`public/js/audio.js`):

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
