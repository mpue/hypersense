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

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = x => { const c = clamp(x, 0, 1); return c * c * (3 - 2 * c); };
  const easeOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  // Bewegung, die nur im ersten Beat jedes Takts passiert: 0,1,2,… in Stufen
  const barStep = u => Math.floor(u / 4) + smooth((u % 4));

  // rx/ry = Trefferellipse, h = Zeichenhöhe
  const KINDS = {
    blue:    { hp: 3,   rx: 34,  ry: 34, score: 100,   sprite: 'enemy_blue',    h: 84,  shoots: true, cool: 2,   size: 1 },
    orange:  { hp: 7,   rx: 40,  ry: 40, score: 250,   sprite: 'enemy_orange',  h: 96,  shoots: true, cool: 1.5, size: 1, drop: 0.3 },
    fighter: { hp: 4,   rx: 50,  ry: 22, score: 200,   sprite: 'enemy_fighter', h: 62,  shoots: true, cool: 2,   size: 1 },
    rock:    { hp: 12,  rx: 52,  ry: 52, score: 150,   sprite: 'asteroid',      h: 120, shoots: false, size: 1.5 },
    cannon:  { hp: 45,  rx: 130, ry: 28, score: 800,   sprite: 'cannon',        h: 70,  shoots: false, size: 1.5, flip: true },
    boss:    { hp: 520, rx: 300, ry: 120, score: 20000, sprite: 'boss',         h: 440, shoots: true, cool: 0, size: 3 },
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
      this.weapon = 1;               // 1..4  (A..D)
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
    }

    // Beim Einstieg mitten im Song (Test-Schalter): vergangene Wellen und Noten überspringen
    seek(songT) {
      const beat = this.L.map.beatOf(songT);
      while (this.waveIdx < this.L.waves.length && this.L.waves[this.waveIdx].b < beat) this.waveIdx++;
      while (this.noteIdx < this.L.notes.length && this.L.notes[this.noteIdx].t < songT) this.noteIdx++;
    }

    get mult() { return Math.min(8, 1 + Math.floor(this.chain / 8)); }
    get hyperOn() { return this.songT < this.hyperEnd; }

    // ------------------------------------------------------------------ Hauptschritt

    update(dt, input, songT) {
      const map = this.L.map;
      this.songT = songT;
      this.beat = map.beatOf(songT);
      this.time += dt;

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
          const n = 5, cy = 300 + r() * 360;
          for (let i = 0; i < n; i++) {
            const tx = 1180 + Math.abs(i - 2) * 120, ty = cy + (i - 2) * 125;
            this.addEnemy(i === 2 ? 'orange' : (r() < 0.5 ? 'orange' : 'blue'), w.b + Math.abs(i - 2) * 0.25, (e, u) => {
              e.x = tx + (W + 150 - tx) * (1 - easeOut(u / 2)) - (u > 16 ? (u - 16) ** 2 * 45 : 0);
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

    // ------------------------------------------------------------------ Schüsse auf Noten

    planNote(n) {
      const loud = this.L.loudAt(n.t);
      let count = n.strong ? 2 : 1;
      if (loud < 0.3) count = n.strong ? 1 : 0;
      const cands = this.enemies.filter(e => e.active && !e.dead && e.k.shoots && e.kind !== 'boss' &&
        e.x < W - 80 && e.x > 180 && n.b - e.lastShotB >= e.k.cool);
      let any = false;
      for (let i = 0; i < count && cands.length; i++) {
        const e = cands.splice(Math.floor(this.rng() * cands.length), 1)[0];
        e.lastShotB = n.b;
        e.nextShotT = n.t;
        this.planned.push({ t: n.t, e, pattern: e.kind === 'orange' && n.strong ? 'spread3' : 'aim' });
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
      this.bullets.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: kind === 'big' ? 16 : 11, kind, t: 0 });
    }

    fire(e, pattern) {
      const sp = this.bulletSpeed();
      const mx = e.x - e.k.rx * 0.6, my = e.y;
      const a = this.aim(mx, my);
      switch (pattern) {
        case 'aim': this.shoot(mx, my, a, sp); break;
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
        if (e.x < -250 || e.x > W + 900 || e.gone) { e.dead = true; e.escaped = true; }
        // Zusammenstoß mit dem Spieler
        const p = this.player;
        if (p.alive && p.inv <= 0 && !this.hyperOn && this.inside(e, p.x, p.y, 6)) this.killPlayer();
      }
      this.enemies = this.enemies.filter(e => !e.dead);
      if (this.bossRef && this.bossRef.dead) this.bossRef = null;
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

    hurt(e, dmg, x, y) {
      e.hp -= dmg;
      e.flash = 0.05;
      if (e.hp <= 0) this.killEnemy(e);
      else if (x !== undefined && Math.random() < 0.3) this.addFx({ type: 'spark', x, y, vx: 200 + Math.random() * 200, vy: (Math.random() - 0.5) * 300, life: 0.25, size: 3, color: '#bfe8ff' });
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
      const pts = e.k.score * this.mult * (sync ? 2 : 1);
      this.score += pts;
      this.charge = Math.min(1, this.charge + (e.kind === 'boss' ? 1 : 0.035 * big * (sync ? 2 : 1)));
      this.popups.push({ x: e.x, y: e.y - 30, text: (sync ? 'SYNC ' : '') + pts, t: 0, sync });

      // Explosion: Bild sofort, Klang auf der nächsten Sechzehntel
      const q = Math.ceil(this.beat * 4 + 0.05) / 4;
      if (q !== this.lastBoomQ || big > 1) {
        this.lastBoomQ = q;
        this.audio.enemyBoom(map.timeOf(q), big);
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
      if (e.kind === 'cannon') this.shake = Math.max(this.shake, 10);

      // Beute: Orange lassen manchmal eine Kapsel fallen, eine komplett abgeschossene Kette immer
      let drop = e.k.drop && this.rng() < e.k.drop;
      if (e.group) { e.group.left--; if (e.group.left === 0) drop = true; }
      if (drop) this.items.push({ x: e.x, y: e.y, t: 0 });
    }

    explode(x, y, size, delay = 0) {
      this.addFx({ type: 'boom', x, y, life: 0.55 + 0.2 * size, size: 110 * size, delay, rot: Math.random() * 6 });
      const n = Math.round(10 * size);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = (150 + Math.random() * 450) * Math.sqrt(size);
        this.addFx({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.4,
          size: 2 + Math.random() * 3, color: Math.random() < 0.5 ? '#ffd27a' : '#ff7a3c', delay });
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

      // Feuer
      p.fire -= dt;
      if ((input.fire || this.opts.autoFire) && p.fire <= 0) {
        p.fire = 1 / FIRE_RATE;
        this.volley();
      }
    }

    volley() {
      const p = this.player, d = this.drone, w = this.weapon;
      const bolt = (x, y, deg, dmg, big = false) => {
        const a = deg * Math.PI / 180;
        this.shots.push({ x, y, vx: Math.cos(a) * SHOT_SPEED, vy: Math.sin(a) * SHOT_SPEED, dmg, big });
      };
      bolt(p.x + 60, p.y - 9, 0, 1, w >= 4);
      bolt(p.x + 60, p.y + 9, 0, 1, w >= 4);
      if (w >= 2) { bolt(p.x + 50, p.y - 4, -5, 1); bolt(p.x + 50, p.y + 4, 5, 1); }
      if (w >= 3) { bolt(p.x + 40, p.y - 4, -12, 0.8); bolt(p.x + 40, p.y + 4, 12, 0.8); }
      if (this.droneOnline) {
        if (this.droneMode === 0) bolt(d.x + 30, d.y, 0, 1, w >= 4);
        else { bolt(d.x + 20, d.y, -30, 0.8); bolt(d.x + 20, d.y, 30, 0.8); }
      }
      this.muzzle = 0.05;
      this.audio.playerShot();
    }

    killPlayer() {
      const p = this.player;
      if (this.opts.god) { p.inv = 0.5; this.shake = 8; return; }
      p.alive = false;
      p.respawn = 1.6;
      this.explode(p.x, p.y, 1.8);
      this.flash = 0.5;
      this.shake = 22;
      this.audio.playerDie();
      this.audio.muffle(true);
      this.weapon = Math.max(1, this.weapon - 1);
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
        for (const e of this.enemies) {
          if (!e.active || e.dead || e.x > W + 40) continue;
          if (this.inside(e, s.x, s.y, s.big ? 10 : 4)) {
            this.hurt(e, s.dmg * (s.big ? 1.5 : 1), s.x, s.y);
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
        if (this.droneOnline && p.alive && Math.hypot(b.x - d.x, b.y - d.y) < 30 + b.r) {
          b.dead = true;
          this.droneE -= 0.2;
          this.audio.droneBlock();
          this.addFx({ type: 'muzzle', x: b.x, y: b.y, life: 0.15, size: 40, color: '#6fd0ff' });
          if (this.droneE <= 0) { this.droneE = 0; this.droneOnline = false; this.explode(d.x, d.y, 0.6); }
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
        it.x -= 110 * dt;
        it.y += Math.sin(it.t * 3) * 40 * dt;
        if (it.x < -60) it.dead = true;
        if (p.alive && Math.hypot(it.x - p.x, it.y - p.y) < 55) {
          it.dead = true;
          this.audio.powerup();
          if (this.weapon < 4) {
            this.weapon++;
            this.popups.push({ x: it.x, y: it.y - 30, text: 'WEAPON ' + 'ABCD'[this.weapon - 1], t: 0, sync: true });
          } else {
            this.score += 2000 * this.mult;
            this.charge = Math.min(1, this.charge + 0.25);
            this.popups.push({ x: it.x, y: it.y - 30, text: '2000', t: 0 });
          }
        }
      }
      this.items = this.items.filter(i => !i.dead);
    }

    stepFx(dt) {
      for (const f of this.fx) {
        if (f.delay > 0) { f.delay -= dt; continue; }
        f.t += dt;
        if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96; f.vy *= 0.96; }
      }
      this.fx = this.fx.filter(f => f.t < f.life);
      for (const p of this.popups) p.t += dt;
      this.popups = this.popups.filter(p => p.t < 1);
      this.muzzle = Math.max(0, (this.muzzle || 0) - dt);
    }
  }

  window.Game = Game;
  window.GameConst = { W, H, KINDS };
})();
