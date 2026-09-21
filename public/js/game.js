// Hypersense – Spiellogik.
//
// Zwei Uhren:
//   * Die Gegner leben in SONGZEIT. Ihre Bahnen sind Funktionen des Beats seit ihrem Auftritt, sie feuern
//     nur auf Noten des Songs, Laser-Tore zünden auf Takt-Einsen. Ihre Klänge werden auf den exakten
//     Songzeitpunkt terminiert (Vorausschau LOOK), Explosionen auf die nächste Sechzehntel.
//   * Der Spieler lebt in ECHTZEIT (dt): Bewegung, Feuerrate und Klänge kümmern sich nicht um den Takt.
(function () {
  'use strict';

  const W = 1920, H = 1080;
  const BOUNDS = { x0: 70, x1: 1480, y0: 60, y1: 900 };
  const LOOK = 0.12;                 // s Vorausschau für terminierte Gegner-Klänge
  const PLAYER_R = 9;                // Trefferzone = Cockpit
  const SHOT_SPEED = 1900;
  const FIRE_RATE = 11;
  const RAPID_RATE = 18;             // Schuss/s mit Power-up R
  const MAX_WEAPON = 5;              // A..E

  // Power-ups: Buchstabe, Name, Farbe der Kapsel
  const POWERS = {
    W: { name: 'WEAPON UP', color: '#5ad8ff', label: 'W' },
    S: { name: 'SHIELD', color: '#7f95ff', label: 'S' },
    E: { name: 'ENERGY', color: '#6dff8a', label: 'E' },
    M: { name: 'MISSILES', color: '#ff6a4a', label: 'M' },
    R: { name: 'RAPID FIRE', color: '#ffd24a', label: 'R' },
    X: { name: 'SCORE x2', color: '#d86bff', label: '2x' },
    L: { name: '1UP', color: '#fff3b0', label: '1UP' },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = x => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };
  const easeOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  // Bewegung, die nur im ersten Beat jedes Takts passiert: 0,1,2,… in Stufen
  const barStep = u => Math.floor(u / 4) + smooth((u % 4));

  // rx/ry = Trefferellipse, h = Zeichenhöhe
  const KINDS = {
    blue:    { hp: 3,   rx: 34,  ry: 34, score: 100,   sprite: 'enemy_blue',    h: 84,  shoots: true, cool: 2,   size: 1 },
    orange:  { hp: 7,   rx: 40,  ry: 40, score: 250,   sprite: 'enemy_orange',  h: 96,  shoots: true, cool: 1.5, size: 1.3, drop: 0.3 },
    fighter: { hp: 4,   rx: 50,  ry: 22, score: 200,   sprite: 'enemy_fighter', h: 62,  shoots: true, cool: 2,   size: 1, drop: 0.1 },
    rock:    { hp: 12,  rx: 52,  ry: 52, score: 150,   sprite: 'asteroid',      h: 120, shoots: false, size: 1.5, drop: 0.15 },
    cannon:  { hp: 45,  rx: 130, ry: 28, score: 800,   sprite: 'cannon',        h: 70,  shoots: false, size: 1.5, flip: true, drop: 1 },
    boss:    { hp: 520, rx: 300, ry: 120, score: 20000, sprite: 'boss',         h: 440, shoots: true, cool: 0, size: 3 },
    turret:  { hp: 6,   rx: 36,  ry: 30, score: 300,   sprite: 'turret',        h: 74,  shoots: true, cool: 1.5, size: 1.2, drop: 0.25 },
    dart:    { hp: 2,   rx: 34,  ry: 14, score: 150,   sprite: 'dart',          h: 34,  shoots: false, size: 1 },
    mine:    { hp: 4,   rx: 32,  ry: 32, score: 200,   sprite: 'mine',          h: 72,  shoots: false, size: 1.2 },
    carrier: { hp: 80,  rx: 180, ry: 70, score: 3000,  sprite: 'carrier',       h: 210, shoots: true, cool: 1, size: 2.6, drop: 1 },
    wormhead:{ hp: 12,  rx: 42,  ry: 36, score: 500,   sprite: 'worm_head',     h: 92,  shoots: true, cool: 1, size: 1.3, drop: 1 },
    wormseg: { hp: 4,   rx: 30,  ry: 30, score: 80,    sprite: 'worm_segment',  h: 66,  shoots: false, size: 1 },
    splitter:{ hp: 14,  rx: 50,  ry: 50, score: 400,   sprite: 'splitter',      h: 112, shoots: true, cool: 2, size: 1.3, drop: 0.4 },
    shard:   { hp: 1,   rx: 22,  ry: 22, score: 60,    sprite: 'splitter',      h: 44,  shoots: false, size: 0.8 },
  };

  class Game {
    constructor(level, audio, opts = {}) {
      this.L = level;
      this.audio = audio;
      this.opts = opts;
      this.rng = Level.mulberry32(4242);
      this.reset();
    }

    reset() {
      this.score = 0;
      this.lives = 3;
      this.weapon = 1;               // 1..5  (A..E)
      this.shield = 0;               // Treffer, die der Schild noch abfängt (0..3)
      this.missileLvl = 0;           // Raketenrohre 0..3
      this.missiles = [];
      this.missileT = 0;
      this.rapidEnd = -1;            // Songzeit, bis zu der Rapid-Fire läuft
      this.doubleEnd = -1;           // …bzw. doppelte Punkte
      this.volleyN = 0;
      this.sinceDrop = 0;
      this.droneMode = 0;            // 0 = vorn, 1 = Flanke
      this.charge = 0;               // HYPER-Ladung 0..1
      this.droneE = 1;               // Drohnen-Energie 0..1
      this.droneOnline = true;
      this.player = { x: 260, y: 480, alive: true, inv: 2, respawn: 0, tilt: 0, fire: 0 };
      this.drone = { x: 380, y: 480 };
      this.enemies = [];
      this.bullets = [];
      this.shots = [];
      this.items = [];
      this.fx = [];
      this.popups = [];
      this.beams = [];
      this.planned = [];
      this.waveIdx = 0;
      this.noteIdx = 0;
      this.hyperEnd = -1;
      this.chain = 0;
      this.maxChain = 0;
      this.lastKillBeat = -99;
      this.lastBoomQ = -1;
      this.kills = 0;
      this.spawned = 0;
      this.syncKills = 0;
      this.shake = 0;
      this.flash = 0;
      this.banner = null;
      this.over = false;
      this.bossRef = null;
      this.songT = 0;
      this.beat = 0;
      this.time = 0;
      this.scroll = 0;               // Welt-x am linken Bildrand – wächst im Takt
      this.hull = [];
      this.lastBeatInt = null;
    }

    // Rumpf-Module, die gerade im Bild sind (sx = Bildschirm-x)
    visibleHull() {
      const out = [];
      for (const m of this.L.terrain) {
        const sx = m.wx - this.scroll;
        if (sx > W) break;
        if (sx + m.w >= 0) out.push({ ...m, sx });
      }
      return out;
    }

    // Steckt der Punkt (mit Radius r) im Rumpf?
    inHull(x, y, r) {
      const F = this.L.FLOOR_Y;
      for (const m of this.hull) {
        if (x + r < m.sx || x - r > m.sx + m.w) continue;
        if (m.top ? y - r < m.h - 10 : y + r > F - m.h + 12) return true;
      }
      return false;
    }

    // Beim Einstieg mitten im Song (Test-Schalter): vergangene Wellen und Noten überspringen
    seek(songT) {
      const beat = this.L.map.beatOf(songT);
      while (this.waveIdx < this.L.waves.length && this.L.waves[this.waveIdx].b < beat) this.waveIdx++;
      while (this.noteIdx < this.L.notes.length && this.L.notes[this.noteIdx].t < songT) this.noteIdx++;
    }

    get mult() { return Math.min(8, 1 + Math.floor(this.chain / 8)); }
    get hyperOn() { return this.songT < this.hyperEnd; }
    get rapidOn() { return this.songT < this.rapidEnd; }
    get doubleOn() { return this.songT < this.doubleEnd; }

    // ------------------------------------------------------------------ Hauptschritt

    update(dt, input, songT) {
      const map = this.L.map;
      this.songT = songT;
      this.beat = map.beatOf(songT);
      this.time += dt;
      this.scroll = this.L.scrollAt(this.beat);
      this.hull = this.visibleHull();

      // Drops: acht Beats lang blitzt und bebt es auf jedem Schlag
      const bi = Math.floor(this.beat);
      if (bi !== this.lastBeatInt) {
        this.lastBeatInt = bi;
        if (this.L.dropBeats.some(d => bi >= d && bi < d + 8)) {
          this.flash = Math.max(this.flash, 0.28);
          this.shake = Math.max(this.shake, 7);
        }
      }

      // Wellen 4 Beats vor ihrem Einsatz anlegen – die Gegner warten außerhalb, bis ihr Beat kommt
      while (this.waveIdx < this.L.waves.length && this.L.waves[this.waveIdx].b - 4 <= this.beat) {
        this.spawnWave(this.L.waves[this.waveIdx++]);
      }

      // Noten vorausplanen: Schütze wählen, Klang auf die Note terminieren
      while (this.noteIdx < this.L.notes.length && this.L.notes[this.noteIdx].t <= songT + LOOK) {
        this.planNote(this.L.notes[this.noteIdx++]);
      }
      // …und abfeuern, sobald die Note erklingt
      for (let i = this.planned.length - 1; i >= 0; i--) {
        const p = this.planned[i];
        if (songT >= p.t) { this.planned.splice(i, 1); if (!p.e.dead) this.fire(p.e, p.pattern); }
      }

      this.stepEnemies(dt);
      this.stepBeams();
      this.stepPlayer(dt, input);
      this.stepShots(dt);
      this.stepMissiles(dt);
      this.stepBullets(dt);
      this.stepItems(dt);
      this.stepFx(dt);

      if (this.beat - this.lastKillBeat > 4) this.chain = 0;
      this.shake = Math.max(0, this.shake - dt * 30);
      this.flash = Math.max(0, this.flash - dt * 2.5);
      if (this.banner && songT > this.banner.t1) this.banner = null;
    }

    // ------------------------------------------------------------------ Wellen

    addEnemy(kind, b0, path, extra = {}) {
      const k = KINDS[kind];
      const e = Object.assign({ kind, k, hp: k.hp, maxHp: k.hp, b0, path, x: W + 400, y: -400,
        active: false, dead: false, flash: 0, lastShotB: -99, nextShotT: -1, rot: 0, gone: false }, extra);
      this.enemies.push(e);
      this.spawned++;
      return e;
    }

    spawnWave(w) {
      const r = Level.mulberry32(w.seed), map = this.L.map;
      const hard = clamp(this.songT / this.L.duration, 0, 1);
      switch (w.type) {
        case 'line': {
          const n = 6 + (w.loud > 0.5 ? 2 : 0), step = w.loud > 0.55 ? 0.5 : 1;
          const y0 = 200 + r() * 500, amp = 80 + r() * 90, sp = 190 + 40 * hard;
          for (let i = 0; i < n; i++) {
            this.addEnemy('blue', w.b + i * step, (e, u) => {
              e.x = W + 60 - u * sp;
              e.y = y0 + amp * Math.sin(u * Math.PI / 2);
            }, { group: w });
          }
          w.left = n;
          break;
        }
        case 'swarm': {
          for (const [y0, ph] of [[250, 0], [710, Math.PI]]) {
            for (let i = 0; i < 8; i++) {
              this.addEnemy('blue', w.b + i * 0.5, (e, u) => {
                e.x = W + 60 - u * 230;
                e.y = y0 + 110 * Math.sin(u * Math.PI / 2 + ph);
              }, { group: w });
            }
          }
          w.left = 16;
          for (const y of [380, 580]) {
            this.addEnemy('orange', w.b + 4, (e, u) => {
              e.x = W + 120 - (W + 120 - 1350) * easeOut(u / 2) - (u > 12 ? (u - 12) ** 2 * 50 : 0);
              e.y = y + 90 * Math.sin(barStep(u) * Math.PI / 2);
            });
          }
          break;
        }
        case 'vee': {
          // in lauten Passagen (neue Welle jeden Takt) kürzer halten, damit sich Formationen nicht stapeln
          const n = 5, cy = 300 + r() * 360, hold = w.loud > 0.5 ? 8 : 16;
          for (let i = 0; i < n; i++) {
            const tx = 1180 + Math.abs(i - 2) * 120, ty = cy + (i - 2) * 125;
            this.addEnemy(i === 2 ? 'orange' : (r() < 0.5 ? 'orange' : 'blue'), w.b + Math.abs(i - 2) * 0.25, (e, u) => {
              e.x = tx + (W + 150 - tx) * (1 - easeOut(u / 2)) - (u > hold ? (u - hold) ** 2 * 45 : 0);
              e.y = clamp(ty + 90 * Math.sin(barStep(u) * Math.PI / 2), 80, 880);
            });
          }
          break;
        }
        case 'fighters': {
          const n = 4 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) {
            const top = i % 2 === 0, y0 = top ? 130 : 850, dy = (top ? 1 : -1) * (250 + r() * 150);
            this.addEnemy('fighter', w.b + i, (e, u) => {
              e.x = W + 80 - u * (300 + 40 * hard);
              e.y = y0 + dy * smooth((u - 1) / 3);
              e.rot = -(top ? 1 : -1) * 0.35 * Math.sin(Math.PI * clamp((u - 1) / 3, 0, 1));
            });
          }
          break;
        }
        case 'rocks': {
          for (let i = 0; i < 5; i++) {
            const y0 = 120 + r() * 740, sp = 80 + r() * 70, sc = 0.7 + r() * 0.7, spin = (r() - 0.5) * 1.2;
            const e = this.addEnemy('rock', w.b + i * 2, (e, u) => {
              e.x = W + 100 - u * sp;
              e.y = y0 + 30 * Math.sin(u * 0.3);
              e.rot = u * spin;
            }, { scale: sc });
            e.hp = e.maxHp = Math.round(12 * sc * sc);
          }
          break;
        }
        case 'gate': {
          // Zwei Kanonen rechts: sie peilen den Spieler einen Takt vorher an, warnen einen Beat lang
          // und feuern auf der Eins einen Strahl quer über den Schirm
          const fires = [[w.b + 4, w.b + 12, w.b + 20], [w.b + 8, w.b + 16, w.b + 24]];
          [260, 720].forEach((y0, side) => {
            this.addEnemy('cannon', w.b, (e, u) => {
              e.x = W - 200 + 400 * (1 - easeOut(u / 3)) + (u > 27 ? (u - 27) ** 2 * 40 : 0);
              const nb = e.fires.find(f => f > this.beat - 0.5);
              if (nb !== undefined && this.beat > nb - 2 && this.beat < nb - 1) {
                if (e.aimFrom === undefined) { e.aimFrom = e.y; e.aimTo = side ? clamp(this.player.y, 470, 880) : clamp(this.player.y, 90, 500); }
                e.y = e.aimFrom + (e.aimTo - e.aimFrom) * smooth(this.beat - (nb - 2));
              } else e.aimFrom = undefined;
              if (u > 34) e.gone = true;
            }, { fires: fires[side], planned: new Set(), y: y0 });
          });
          break;
        }
        case 'darts': {
          // Staffel, die auf jedem Beat einen Satz auf den Spieler macht
          const n = 4 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) {
            const y0 = 150 + (i + 0.5) * (700 / n);
            this.addEnemy('dart', w.b + i * 0.5, this.dartPath(W + 60, y0, 1500 - (i % 2) * 90));
          }
          break;
        }
        case 'mines': {
          // Minen hängen fest in der Welt (scrollen mit) und zerplatzen auf einer Eins in einen Kugelring
          const n = 3 + Math.floor(r() * 3), PX = this.L.PX_PER_BEAT;
          for (let i = 0; i < n; i++) {
            const wx = this.L.scrollAt(w.b + i * 3) + W + 80, y0 = 170 + r() * 620;
            const reach = (wx - 1250) / PX;                           // Beat, an dem sie x=1250 erreicht
            const boomB = Math.ceil((reach + 3 - map.downbeat) / 4) * 4 + map.downbeat;
            this.addEnemy('mine', w.b - 4, (e, u) => {
              e.x = e.wx - this.scroll;
              e.y = y0 + 22 * Math.sin(u * Math.PI / 2);
              e.rot = u * 0.4;
            }, { wx, boomB });
          }
          break;
        }
        case 'turrets': {
          // Geschütztürme auf dem Rumpf, abwechselnd Decke und Boden
          const n = 3 + Math.floor(r() * 3), F = this.L.FLOOR_Y;
          for (let i = 0; i < n; i++) {
            const wx = this.L.scrollAt(w.b + i * 2.5) + W + 60;
            let top = i % 2 === 0, h = this.L.hullAt(wx, top);
            if (!h) { top = !top; h = this.L.hullAt(wx, top); }
            if (!h) continue;
            const y = top ? h + 22 : F - h - 22;
            this.addEnemy('turret', w.b - 4, e => { e.x = e.wx - this.scroll; }, { wx, y, flipY: top });
          }
          break;
        }
        case 'worm': {
          // Serpent: Kopf und Segmente auf derselben Bahn, jedes Segment eine Achtel später
          const y0 = 260 + r() * 440, amp = 150 + r() * 80, sp = 210, segs = 10;
          const path = (e, u) => {
            e.x = W + 80 - u * sp;
            e.y = y0 + amp * Math.sin(u * Math.PI / 4);
            const dy = amp * Math.PI / 4 * Math.cos(u * Math.PI / 4);
            e.rot = Math.atan2(dy, sp) * -1;
          };
          const g = { left: segs + 1 };
          for (let i = segs; i >= 1; i--) this.addEnemy('wormseg', w.b + i * 0.3, path, { group: g, seg: i });
          this.addEnemy('wormhead', w.b, path, { group: g });
          break;
        }
        case 'splitter': {
          const n = 2 + Math.floor(r() * 2);
          for (let i = 0; i < n; i++) {
            const y0 = 220 + r() * 560;
            this.addEnemy('splitter', w.b + i * 2, (e, u) => {
              e.x = W + 100 - u * 125;
              e.y = y0 + 60 * Math.sin(barStep(u) * Math.PI / 2);
              e.rot = u * 0.3;
            });
          }
          break;
        }
        case 'carrier': {
          // Träger: fährt ein, hält vier Takte und spuckt alle zwei Beats einen Dart aus
          const y0 = 300 + r() * 360;
          this.addEnemy('carrier', w.b, (e, u) => {
            e.x = 1560 + 520 * (1 - easeOut(u / 4)) - (u > 20 ? (u - 20) ** 2 * 30 : 0);
            e.y = y0 + 120 * Math.sin(barStep(u) * Math.PI / 2);
            while (u >= e.nextSpawn && e.nextSpawn <= 18) {
              const side = (e.nextSpawn / 2) % 2 ? -1 : 1;
              this.addEnemy('dart', e.b0 + e.nextSpawn, this.dartPath(e.x - 150, e.y + side * 50, e.x - 320));
              e.nextSpawn += 2;
            }
          }, { nextSpawn: 4 });
          break;
        }
        case 'boss': {
          const L = this.L, span = L.boss ? L.boss.b1 - L.boss.b0 : 32;
          this.banner = { text: 'WARNING', sub: 'BASS CORE APPROACHING', t0: this.songT, t1: map.timeOf(w.b) };
          this.audio.bossAlarm(map.timeOf(w.b - 4));
          this.bossRef = this.addEnemy('boss', w.b, (e, u) => {
            e.x = 1480 + 700 * (1 - easeOut(u / 4)) + (u > span ? (u - span) ** 2 * 30 : 0);
            e.y = 470 + 170 * Math.sin(u * Math.PI / 8);
            if (u > span + 8) e.gone = true;
          });
          break;
        }
      }
    }

    // Dart: fliegt auf holdX ein, macht dann auf jedem Beat einen Satz (erste 40 % des Beats) auf den
    // Spieler zu, nach sechs Sätzen schießt er links aus dem Bild
    dartPath(x0, y0, holdX) {
      return (e, u) => {
        if (u < 1.5) { e.x = x0 + (holdX - x0) * easeOut(u / 1.5); e.y = y0; return; }
        const k = Math.floor(u - 1.5), f = u - 1.5 - k;
        if (e.k0 !== k) {
          e.k0 = k; e.fx = e.x; e.fy = e.y;
          if (k >= 6) { e.tx = e.x - 1400; e.ty = e.y; }
          else {
            const dx = this.player.x - e.x, dy = this.player.y - e.y, d = Math.hypot(dx, dy) || 1, s = Math.min(d, 300);
            e.tx = e.x + dx / d * s; e.ty = e.y + dy / d * s;
          }
          e.rot = Math.atan2(e.ty - e.fy, e.tx - e.fx) - Math.PI;
          e.dash = this.time;
        }
        const q = easeOut(f / 0.4);
        e.x = e.fx + (e.tx - e.fx) * q;
        e.y = e.fy + (e.ty - e.fy) * q;
      };
    }

    // ------------------------------------------------------------------ Schüsse auf Noten

    planNote(n) {
      const loud = this.L.loudAt(n.t);
      let count = n.strong ? 3 : 2;
      if (loud < 0.3) count = n.strong ? 1 : 0;
      else if (loud < 0.5) count--;
      const cands = this.enemies.filter(e => e.active && !e.dead && e.k.shoots && e.kind !== 'boss' &&
        e.x < W - 80 && e.x > 180 && n.b - e.lastShotB >= e.k.cool);
      let any = false;
      for (let i = 0; i < count && cands.length; i++) {
        const e = cands.splice(Math.floor(this.rng() * cands.length), 1)[0];
        e.lastShotB = n.b;
        e.nextShotT = n.t;
        let pattern = 'aim';
        if (e.kind === 'turret') pattern = 'needle';
        else if (e.kind === 'carrier') pattern = n.strong ? 'spread5' : 'twinC';
        else if (e.kind === 'splitter') pattern = n.strong ? 'cross' : 'aim';
        else if ((e.kind === 'orange' || e.kind === 'wormhead') && n.strong) pattern = 'spread3';
        this.planned.push({ t: n.t, e, pattern });
        any = true;
      }
      const boss = this.bossRef;
      if (boss && !boss.dead && boss.active && n.b - boss.b0 >= 4 && n.b < boss.b0 + (this.L.boss ? this.L.boss.b1 - this.L.boss.b0 : 32)) {
        boss.nextShotT = n.t;
        this.planned.push({ t: n.t, e: boss, pattern: n.down ? 'ring' : n.strong ? 'spread5' : 'twin' });
        any = true;
      }
      if (any) this.audio.enemyShot(n.t, n.strong);
    }

    bulletSpeed() {
      return 400 + 140 * this.L.loudAt(this.songT) + 120 * clamp(this.songT / this.L.duration, 0, 1);
    }

    aim(x, y) {
      return Math.atan2(this.player.y - y, this.player.x - x);
    }

    shoot(x, y, ang, sp, kind = 'orb') {
      const r = kind === 'big' ? 16 : kind === 'needle' ? 8 : 11;
      this.bullets.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r, kind, t: 0 });
    }

    fire(e, pattern) {
      const sp = this.bulletSpeed();
      let mx = e.x - e.k.rx * 0.6, my = e.y;
      if (e.kind === 'turret') { mx = e.x - 18; my = e.y + (e.flipY ? 16 : -16); }
      const a = this.aim(mx, my);
      switch (pattern) {
        case 'aim': this.shoot(mx, my, a, sp); break;
        case 'needle': this.shoot(mx, my, a, sp * 1.5, 'needle'); this.shoot(mx, my, a, sp * 1.25, 'needle'); break;
        case 'cross': for (let k = 0; k < 4; k++) this.shoot(e.x, e.y, this.beat * 0.5 + k * Math.PI / 2, sp * 0.8); break;
        case 'twinC':
          for (const dy of [-55, 55]) this.shoot(e.x - 170, e.y + dy, this.aim(e.x - 170, e.y + dy), sp);
          break;
        case 'spread3': for (let k = -1; k <= 1; k++) this.shoot(mx, my, a + k * 0.2, sp); break;
        case 'spread5': for (let k = -2; k <= 2; k++) this.shoot(mx, my, a + k * 0.16, sp * 1.05); break;
        case 'twin':
          for (const dy of [-95, 95]) this.shoot(e.x - 160, e.y + dy, this.aim(e.x - 160, e.y + dy), sp);
          break;
        case 'ring': {
          const n = 18, off = this.beat * 0.37;
          for (let k = 0; k < n; k++) this.shoot(e.x - 60, e.y, off + k * Math.PI * 2 / n, sp * 0.7, 'big');
          break;
        }
      }
      this.addFx({ type: 'muzzle', x: mx, y: my, life: 0.12, size: pattern === 'ring' ? 90 : 40,
        color: e.kind === 'orange' ? '#ff9a3c' : e.kind === 'boss' ? '#ff5ad2' : '#b36bff' });
    }

    // ------------------------------------------------------------------ Gegner

    stepEnemies(dt) {
      for (const e of this.enemies) {
        const u = this.beat - e.b0;
        if (u < 0 || e.dead) continue;
        e.active = true;
        e.path(e, u, dt);
        e.flash = Math.max(0, e.flash - dt);
        if (e.kind === 'cannon') this.planGateBeams(e);
        if (e.kind === 'mine') this.stepMine(e);
        if (e.dead) continue;
        if (e.x < -250 || e.x > W + 2400 || e.gone) { e.dead = true; e.escaped = true; continue; }
        // Zusammenstoß mit dem Spieler
        const p = this.player;
        if (p.alive && p.inv <= 0 && !this.hyperOn && this.inside(e, p.x, p.y, 6)) this.killPlayer();
      }
      this.enemies = this.enemies.filter(e => !e.dead);
      if (this.bossRef && this.bossRef.dead) this.bossRef = null;
    }

    // Mine: Klang auf ihre Eins terminieren, dort platzt sie in einen Ring aus 12 Kugeln
    stepMine(e) {
      const map = this.L.map;
      // Noch nicht (weit genug) im Bild: auf die nächste Eins verschieben
      while (!e.boomPlanned && e.x > W - 160 && map.timeOf(e.boomB) < this.songT + LOOK + 0.1) e.boomB += 4;
      const tb = map.timeOf(e.boomB);
      e.boomT = tb;
      if (!e.boomPlanned && e.x > W - 160) return;
      if (!e.boomPlanned && tb <= this.songT + LOOK) {
        e.boomPlanned = true;
        this.audio.enemyShot(tb, true);
        this.audio.enemyBoom(tb, 1);
      }
      if (this.songT >= tb && e.boomPlanned) {
        e.dead = true;
        const sp = this.bulletSpeed() * 0.75;
        for (let k = 0; k < 12; k++) this.shoot(e.x, e.y, k * Math.PI / 6 + e.rot, sp);
        this.explode(e.x, e.y, 0.9);
        this.addFx({ type: 'ring', x: e.x, y: e.y, life: 0.4, size: 160, color: '255,90,210' });
      }
    }

    planGateBeams(e) {
      const map = this.L.map;
      for (const fb of e.fires) {
        if (e.planned.has(fb)) continue;
        const tWarn = map.timeOf(fb - 1);
        if (tWarn > this.songT + LOOK) continue;
        e.planned.add(fb);
        const tFire = map.timeOf(fb);
        this.beams.push({ e, tWarn, tFire, tEnd: map.timeOf(fb + 0.5), y: null });
        this.audio.beamWarn(tWarn);
        this.audio.beamFire(tFire, map.timeOf(fb + 0.5) - tFire);
      }
    }

    stepBeams() {
      const p = this.player;
      for (const bm of this.beams) {
        if (bm.e.dead) { bm.dead = true; continue; }
        if (this.songT >= bm.tEnd) { bm.dead = true; continue; }
        bm.x = bm.e.x - 150;
        if (this.songT >= bm.tFire) {
          if (bm.y === null) { bm.y = bm.e.y; this.shake = Math.max(this.shake, 8); }
          if (p.alive && p.inv <= 0 && !this.hyperOn && Math.abs(p.y - bm.y) < 26 && p.x < bm.x) this.killPlayer();
        } else bm.yWarn = bm.e.y;
      }
      this.beams = this.beams.filter(b => !b.dead);
    }

    inside(e, x, y, extra) {
      const s = e.scale || 1;
      const dx = (x - e.x) / (e.k.rx * s + extra), dy = (y - e.y) / (e.k.ry * s + extra);
      return dx * dx + dy * dy < 1;
    }

    hurt(e, dmg, x, y, heavy = false) {
      e.hp -= dmg;
      if (e.hp <= 0) { this.killEnemy(e); return; }
      // Treffer-Blitz nur kurz und höchstens alle 0,12 s – sonst ist ein Gegner unter Dauerfeuer nur noch weiß
      if (this.time - (e.lastFlash || -1) > (e.k.size >= 1.5 ? 0.3 : 0.12)) { e.flash = 0.035; e.lastFlash = this.time; }
      if (x === undefined || this.time - (e.lastHitFx || -1) < 0.06) return;
      e.lastHitFx = this.time;
      // Einschlag: kleiner Lichtblitz und Funken, die vom Gegner wegspritzen
      this.addFx({ type: 'muzzle', x, y, life: 0.07, size: heavy ? 34 : 18, color: '#6fd0ff' });
      const n = heavy ? 4 : 1;
      for (let i = 0; i < n; i++) {
        this.addFx({ type: 'spark', x, y, vx: -120 - Math.random() * 380, vy: (Math.random() - 0.5) * 420, life: 0.2 + Math.random() * 0.15, size: 2.5, color: heavy ? '#ffffff' : '#bfe8ff' });
      }
    }

    // Kapsel fallen lassen – der Typ richtet sich danach, was dem Spieler gerade fehlt
    dropItem(x, y) {
      const opts = [
        ['W', this.weapon < MAX_WEAPON ? 4 : 0.8],
        ['S', this.shield === 0 ? 3 : 0.8],
        ['E', this.droneE < 0.5 || this.charge < 0.5 ? 2.5 : 1],
        ['M', this.missileLvl < 3 ? 2.5 : 0.5],
        ['R', this.rapidOn ? 0.3 : 1.5],
        ['X', this.doubleOn ? 0.3 : 1],
        ['L', this.lives < 3 ? 0.4 : 0.15],
      ];
      let r = this.rng() * opts.reduce((s, o) => s + o[1], 0), type = 'W';
      for (const [t, w] of opts) { if ((r -= w) < 0) { type = t; break; } }
      this.items.push({ x, y, t: 0, type });
    }

    killEnemy(e) {
      if (e.dead) return;
      e.dead = true;
      const map = this.L.map, big = e.k.size;
      this.kills++;
      // Im Takt getroffen? ±50 ms um einen Beat -> SYNC, doppelte Punkte
      const sync = Math.abs(this.songT - map.timeOf(Math.round(this.beat))) < 0.05;
      if (sync) this.syncKills++;
      this.chain++;
      this.maxChain = Math.max(this.maxChain, this.chain);
      this.lastKillBeat = this.beat;
      const pts = e.k.score * this.mult * (sync ? 2 : 1) * (this.doubleOn ? 2 : 1);
      this.score += pts;
      this.charge = Math.min(1, this.charge + (e.kind === 'boss' ? 1 : 0.035 * big * (sync ? 2 : 1)));
      this.popups.push({ x: e.x, y: e.y - 30, text: (sync ? 'SYNC ' : '') + pts, t: 0, sync });

      // Explosion: Bild sofort, Klang auf der nächsten Sechzehntel
      const q = Math.ceil(this.beat * 4 + 0.05) / 4;
      // Kleine Explosionen höchstens eine pro Sechzehntel, größere immer (der Boss hat seinen eigenen Klang)
      if (e.kind !== 'boss' && (q !== this.lastBoomQ || big > 1)) {
        this.lastBoomQ = q;
        this.audio.enemyBoom(map.timeOf(q), big * (e.scale || 1), e.kind === 'rock');
      }
      this.explode(e.x, e.y, big * (e.scale || 1));
      if (e.kind === 'boss') {
        this.audio.bossDown(map.timeOf(Math.ceil(this.beat)));
        for (let i = 0; i < 14; i++) this.explode(e.x + (Math.random() - 0.5) * 520, e.y + (Math.random() - 0.5) * 240, 1.4, i * 0.07);
        this.flash = 1;
        this.shake = 30;
        this.bullets.length = 0;
        this.banner = { text: 'BASS CORE DOWN', sub: '', t0: this.songT, t1: this.songT + 3 };
      }
      if (e.kind === 'cannon' || e.kind === 'carrier') this.shake = Math.max(this.shake, 14);
      if (e.kind === 'splitter') {
        // Zerfällt in fünf Scherben, die auseinanderfliegen und dann nach links abdriften
        const b0 = this.beat, x0 = e.x, y0 = e.y;
        for (let k = 0; k < 5; k++) {
          const a = k * Math.PI * 2 / 5 + e.rot;
          this.addEnemy('shard', b0, (s, u) => {
            const out = 170 * easeOut(u / 1.2);
            s.x = x0 + Math.cos(a) * out - Math.max(0, u - 1) * 260;
            s.y = y0 + Math.sin(a) * out;
            s.rot = u * 3;
          });
        }
      }

      // Beute: Orange lassen manchmal eine Kapsel fallen, eine komplett abgeschossene Kette immer
      let drop = (e.k.drop && this.rng() < e.k.drop) || this.rng() < 0.04;
      if (e.group) { e.group.left--; if (e.group.left === 0) drop = true; }
      // spätestens alle 15 Abschüsse eine Kapsel
      if (drop) this.sinceDrop = 0;
      else if (++this.sinceDrop >= 15) { drop = true; this.sinceDrop = 0; }
      if (drop) this.dropItem(e.x, e.y);
    }

    explode(x, y, size, delay = 0) {
      this.addFx({ type: 'boom', x, y, life: 0.55 + 0.2 * size, size: 110 * size, delay, rot: Math.random() * 6 });
      const n = Math.round(10 * size);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (150 + Math.random() * 450) * Math.sqrt(size);
        this.addFx({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.4,
          size: 2 + Math.random() * 3, color: Math.random() < 0.5 ? '#ffd27a' : '#ff7a3c', delay });
      }
      if (size >= 1.2) {
        this.addFx({ type: 'ring', x, y, life: 0.35 + 0.1 * size, size: 120 * size, delay, color: '255,200,140' });
        const m = Math.round(4 * size);
        for (let i = 0; i < m; i++) {
          const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 280;
          this.addFx({ type: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8 + Math.random() * 0.6,
            size: 6 + Math.random() * 10 * Math.sqrt(size), rot: Math.random() * 6, spin: (Math.random() - 0.5) * 12, delay });
        }
      }
      this.shake = Math.max(this.shake, 3 * size);
    }

    addFx(f) {
      f.t = 0;
      this.fx.push(f);
    }

    // ------------------------------------------------------------------ Spieler

    stepPlayer(dt, input) {
      const p = this.player, d = this.drone;
      p.inv = Math.max(0, p.inv - dt);
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0 && !this.over) {
          p.alive = true;
          p.x = -80; p.y = 480; p.inv = 2.5; p.entering = 0.6;
          this.audio.muffle(false);
        }
        return;
      }
      if (p.entering > 0) {
        p.entering -= dt;
        p.x += (260 - p.x) * Math.min(1, dt * 8);
      } else {
        const sp = input.focus ? 330 : 640;
        let ix = input.x, iy = input.y;
        const len = Math.hypot(ix, iy);
        if (len > 1) { ix /= len; iy /= len; }
        p.x = clamp(p.x + ix * sp * dt, BOUNDS.x0, BOUNDS.x1);
        p.y = clamp(p.y + iy * sp * dt, BOUNDS.y0, BOUNDS.y1);
        p.tilt += (iy - p.tilt) * Math.min(1, dt * 10);
        if (p.inv <= 0 && !this.hyperOn && this.inHull(p.x, p.y, 14)) { this.killPlayer(); if (!p.alive) return; }
      }

      // Drohne
      const tx = this.droneMode === 0 ? p.x + 125 : p.x - 20, ty = this.droneMode === 0 ? p.y : p.y + (Math.sin(this.time * 3) * 95);
      d.x += (tx - d.x) * Math.min(1, dt * 12);
      d.y += (ty - d.y) * Math.min(1, dt * 12);
      if (this.droneOnline) this.droneE = Math.min(1, this.droneE + dt * 0.04);
      else {
        this.droneE = Math.min(1, this.droneE + dt * 0.2);
        if (this.droneE >= 1) this.droneOnline = true;
      }
      if (input.drone) { this.droneMode = 1 - this.droneMode; this.audio.droneToggle(); }

      // HYPER: ein Takt lang ein Strahl, der alles in seiner Bahn schmilzt
      if (input.hyper && this.charge >= 1 && !this.hyperOn) {
        const map = this.L.map;
        this.hyperEnd = map.timeOf(this.beat + 4);
        this.charge = 0;
        this.flash = 0.6;
        this.shake = 14;
        this.audio.hyper();
      }
      if (this.hyperOn) {
        for (const e of this.enemies) {
          if (e.active && !e.dead && e.x > p.x && Math.abs(e.y - p.y) < 60 + e.k.ry * (e.scale || 1)) this.hurt(e, 70 * dt);
        }
        this.bullets = this.bullets.filter(b => !(b.x > p.x - 20 && Math.abs(b.y - p.y) < 70));
      }

      // Feuer (Rapid-Fire: schneller), Raketen im eigenen Takt
      const firing = input.fire || this.opts.autoFire;
      p.fire -= dt;
      if (firing && p.fire <= 0) {
        p.fire = 1 / (this.rapidOn ? RAPID_RATE : FIRE_RATE);
        this.volley();
      }
      p.recoil = Math.max(0, (p.recoil || 0) - dt * 12);
      this.missileT -= dt;
      if (firing && this.missileLvl > 0 && this.missileT <= 0) {
        this.missileT = this.rapidOn ? 0.38 : 0.55;
        for (let k = 0; k < this.missileLvl; k++) {
          const side = k % 2 ? 1 : -1;
          this.missiles.push({ x: p.x - 10, y: p.y + side * (18 + 10 * k), vx: 80, vy: side * (240 + 60 * k), t: 0, target: null, smoke: 0 });
        }
        this.audio.missile();
      }
    }

    // Waffenstufen:  A Zwilling · B + Fächer · C + Plasma-Speer (durchschlägt 3 Gegner)
    //                D + breiter Fächer · E alles als Plasma, noch breiter
    volley() {
      const p = this.player, d = this.drone, w = this.weapon;
      const plasma = w >= 5 ? 'plasma' : 'bolt';
      const shot = (x, y, deg, dmg, kind = plasma, pierce = 0) => {
        const a = deg * Math.PI / 180, sp = kind === 'lance' ? 2600 : SHOT_SPEED;
        this.shots.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, kind, pierce, hit: pierce ? new Set() : null });
      };
      shot(p.x + 60, p.y - 10, 0, 1.3);
      shot(p.x + 60, p.y + 10, 0, 1.3);
      if (w >= 2) { shot(p.x + 50, p.y - 4, -6, 1.1); shot(p.x + 50, p.y + 4, 6, 1.1); }
      if (w >= 3 && this.volleyN % 2 === 0) shot(p.x + 80, p.y, 0, 3, 'lance', 3);
      if (w >= 4) { shot(p.x + 40, p.y - 4, -14, 1); shot(p.x + 40, p.y + 4, 14, 1); }
      if (w >= 5) { shot(p.x + 30, p.y - 6, -24, 1); shot(p.x + 30, p.y + 6, 24, 1); }
      if (this.droneOnline) {
        if (this.droneMode === 0) shot(d.x + 30, d.y, 0, 1.3);
        else { shot(d.x + 20, d.y, -30, 1); shot(d.x + 20, d.y, 30, 1); }
      }
      this.volleyN++;
      this.muzzle = 0.06;
      p.recoil = 1;
      this.audio.playerShot(w);
    }

    // Zielsuchraketen: erst seitlich ausstoßen, dann auf das nächste Ziel einschwenken
    pickTarget(m) {
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (!e.active || e.dead || e.x > W - 30 || e.x < 0) continue;
        const d = Math.hypot(e.x - m.x, e.y - m.y) + (e.targeted ? 400 : 0);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) best.targeted = true;
      return best;
    }

    stepMissiles(dt) {
      for (const m of this.missiles) {
        m.t += dt;
        if (!m.target || m.target.dead) m.target = this.pickTarget(m);
        let a = Math.atan2(m.vy, m.vx);
        if (m.t > 0.12) {
          const want = m.target ? Math.atan2(m.target.y - m.y, m.target.x - m.x) : 0;
          let da = want - a;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          a += clamp(da, -9 * dt, 9 * dt);
        }
        const sp = Math.min(1500, 350 + m.t * 2600);
        m.vx = Math.cos(a) * sp; m.vy = Math.sin(a) * sp;
        m.x += m.vx * dt; m.y += m.vy * dt;
        m.smoke -= dt;
        if (m.smoke <= 0) { m.smoke = 0.025; this.addFx({ type: 'muzzle', x: m.x, y: m.y, life: 0.25, size: 14, color: '#ff9a3c' }); }
        if (m.t > 3 || m.x > W + 60 || m.x < -60 || m.y < -60 || m.y > H + 60 || (this.hull.length && this.inHull(m.x, m.y, 0))) { m.dead = true; continue; }
        for (const e of this.enemies) {
          if (!e.active || e.dead || !this.inside(e, m.x, m.y, 8)) continue;
          m.dead = true;
          this.hurt(e, 4, m.x, m.y, true);
          // Flächenschaden
          for (const o of this.enemies) if (o !== e && o.active && !o.dead && Math.hypot(o.x - m.x, o.y - m.y) < 90) this.hurt(o, 1.5);
          this.addFx({ type: 'boom', x: m.x, y: m.y, life: 0.35, size: 55, rot: Math.random() * 6 });
          this.addFx({ type: 'ring', x: m.x, y: m.y, life: 0.25, size: 80, color: '255,180,110' });
          break;
        }
      }
      this.missiles = this.missiles.filter(m => !m.dead);
    }

    killPlayer() {
      const p = this.player;
      // Schild fängt den Treffer ab
      if (this.shield > 0) {
        this.shield--;
        p.inv = 1;
        this.shake = Math.max(this.shake, 10);
        this.flash = Math.max(this.flash, 0.2);
        this.addFx({ type: 'ring', x: p.x, y: p.y, life: 0.4, size: 220, color: '127,149,255' });
        this.bullets = this.bullets.filter(b => Math.hypot(b.x - p.x, b.y - p.y) > 220);
        if (this.inHull(p.x, p.y, 14)) p.y += p.y < 480 ? 140 : -140;   // aus dem Rumpf schubsen
        this.popups.push({ x: p.x, y: p.y - 50, text: this.shield ? 'SHIELD ' + this.shield : 'SHIELD DOWN', t: 0 });
        this.audio.shieldHit();
        return;
      }
      if (this.opts.god) { p.inv = 0.5; this.shake = 8; return; }
      p.alive = false;
      p.respawn = 1.6;
      this.explode(p.x, p.y, 1.8);
      this.flash = 0.5;
      this.shake = 22;
      this.audio.playerDie();
      this.audio.muffle(true);
      this.weapon = Math.max(1, this.weapon - 1);
      this.missileLvl = Math.max(0, this.missileLvl - 1);
      this.rapidEnd = this.doubleEnd = -1;
      this.missiles.length = 0;
      this.chain = 0;
      this.lives--;
      if (this.lives < 0) { this.lives = 0; this.over = true; }
    }

    // ------------------------------------------------------------------ Geschosse

    stepShots(dt) {
      for (const s of this.shots) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x > W + 40 || s.y < -40 || s.y > H + 40) { s.dead = true; continue; }
        if (this.hull.length && this.inHull(s.x, s.y, 0)) {
          s.dead = true;
          this.addFx({ type: 'spark', x: s.x, y: s.y, vx: -150 - Math.random() * 200, vy: (Math.random() - 0.5) * 300, life: 0.2, size: 3, color: '#bfe8ff' });
          continue;
        }
        const heavy = s.kind !== 'bolt';
        for (const e of this.enemies) {
          if (!e.active || e.dead || e.x > W + 40) continue;
          if (s.hit && s.hit.has(e)) continue;
          if (this.inside(e, s.x, s.y, heavy ? 12 : 5)) {
            this.hurt(e, s.dmg * (s.kind === 'plasma' ? 1.4 : 1), s.x, s.y, heavy);
            // Plasma-Speer fliegt weiter, bis er genug Gegner durchschlagen hat
            if (s.hit) { s.hit.add(e); if (--s.pierce >= 0) continue; }
            s.dead = true;
            break;
          }
        }
      }
      this.shots = this.shots.filter(s => !s.dead);
    }

    stepBullets(dt) {
      const p = this.player, d = this.drone;
      for (const b of this.bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.t += dt;
        if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) { b.dead = true; continue; }
        if (this.hull.length && b.t > 0.1 && this.inHull(b.x, b.y, 0)) { b.dead = true; continue; }
        if (this.droneOnline && p.alive && Math.hypot(b.x - d.x, b.y - d.y) < 30 + b.r) {
          b.dead = true;
          this.droneE -= 0.2;
          this.audio.droneBlock();
          this.addFx({ type: 'muzzle', x: b.x, y: b.y, life: 0.15, size: 40, color: '#6fd0ff' });
          if (this.droneE <= 0) { this.droneE = 0; this.droneOnline = false; this.explode(d.x, d.y, 0.6); this.audio.droneLost(); }
          continue;
        }
        if (p.alive && p.inv <= 0 && !this.hyperOn && Math.hypot(b.x - p.x, b.y - p.y) < PLAYER_R + b.r * 0.7) {
          b.dead = true;
          this.killPlayer();
        }
      }
      this.bullets = this.bullets.filter(b => !b.dead);
    }

    stepItems(dt) {
      const p = this.player;
      for (const it of this.items) {
        it.t += dt;
        const dx = p.x - it.x, dy = p.y - it.y, dist = Math.hypot(dx, dy);
        if (p.alive && dist < 220 && dist > 1) {
          // Magnet: in der Nähe fliegt die Kapsel zum Schiff
          const pull = 900 * (1 - dist / 220) * dt;
          it.x += dx / dist * pull; it.y += dy / dist * pull;
        } else {
          it.x -= 110 * dt;
          it.y += Math.sin(it.t * 3) * 40 * dt;
        }
        if (it.x < -60) it.dead = true;
        if (p.alive && Math.hypot(it.x - p.x, it.y - p.y) < 60) {
          it.dead = true;
          this.collect(it);
        }
      }
      this.items = this.items.filter(i => !i.dead);
    }

    collect(it) {
      const map = this.L.map, eightBars = () => map.timeOf(this.beat + 32);
      let text = POWERS[it.type].name, bonus = false;
      switch (it.type) {
        case 'W':
          if (this.weapon < MAX_WEAPON) { this.weapon++; text = 'WEAPON ' + 'ABCDE'[this.weapon - 1]; } else bonus = true;
          break;
        case 'S': this.shield = 3; break;
        case 'E':
          this.droneE = 1; this.droneOnline = true;
          this.charge = Math.min(1, this.charge + 0.4);
          break;
        case 'M':
          if (this.missileLvl < 3) { this.missileLvl++; text = 'MISSILES ' + 'I'.repeat(this.missileLvl); } else bonus = true;
          break;
        case 'R': this.rapidEnd = eightBars(); break;
        case 'X': this.doubleEnd = eightBars(); break;
        case 'L': this.lives = Math.min(9, this.lives + 1); break;
      }
      if (bonus) { this.score += 5000 * this.mult; text = '5000'; }
      this.popups.push({ x: it.x, y: it.y - 40, text, t: 0, sync: true, color: POWERS[it.type].color });
      this.addFx({ type: 'ring', x: it.x, y: it.y, life: 0.35, size: 110, color: '160,230,255' });
      this.audio.powerup(it.type);
    }

    stepFx(dt) {
      for (const f of this.fx) {
        if (f.delay > 0) { f.delay -= dt; continue; }
        f.t += dt;
        if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96; f.vy *= 0.96; }
        if (f.spin) f.rot += f.spin * dt;
      }
      this.fx = this.fx.filter(f => f.t < f.life);
      for (const p of this.popups) p.t += dt;
      this.popups = this.popups.filter(p => p.t < 1);
      this.muzzle = Math.max(0, (this.muzzle || 0) - dt);
    }
  }

  window.Game = Game;
  window.GameConst = { W, H, KINDS, POWERS };
})();
