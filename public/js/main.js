// Hypersense – Laden, Song-Analyse, Eingabe, Spielablauf.
//
// Test-Schalter in der URL:
//   ?at=90       Spiel ab Songsekunde 90 starten
//   ?god=1       unverwundbar
//   ?auto=1      Dauerfeuer
//   ?song=Name   anderen Song aus music/ wählen
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game');
  const audio = new AudioEngine();

  const IMAGES = {
    player: 'player.png', drone: 'drone.png', enemy_blue: 'enemy_blue.png', enemy_orange: 'enemy_orange.png',
    enemy_fighter: 'enemy_fighter.png', cannon: 'cannon.png', boss: 'boss.png', asteroid: 'asteroid.png',
    powerup: 'powerup.png', turret: 'turret.png', dart: 'dart.png', mine: 'mine.png', carrier: 'carrier.png',
    worm_head: 'worm_head.png', worm_segment: 'worm_segment.png', splitter: 'splitter.png',
    hull1: 'hull1.png', hull2: 'hull2.png', hull3: 'hull3.png', hull4: 'hull4.png',
    hulltex1: 'hulltex1.jpg', hulltex2: 'hulltex2.jpg', coin: 'coin.png', incubator: 'incubator.jpg', planet: 'planet.png', galaxy: 'galaxy.jpg', nebula: 'nebula.jpg', explosion: 'explosion.jpg',
  };

  const loadImage = (name, file) => new Promise(res => {
    const im = new Image();
    im.onload = () => res([name, im]);
    im.onerror = () => res([name, null]);
    im.src = 'assets/' + file;
  });

  // ------------------------------------------------------------------ Gamepad
  // Standard-Layout (Xbox / PlayStation):
  //   0 A/✕  1 B/○  2 X/□  3 Y/△  4 LB/L1  5 RB/R1  6 LT/L2  7 RT/R2  8 View/Share  9 Menu/Options
  //   12–15 D-Pad hoch/runter/links/rechts, Achsen 0/1 linker Stick
  // Aktiv ist das Pad, auf dem zuletzt etwas passiert ist.

  class Pad {
    constructor() {
      this.index = null;
      this.prev = [];
      this.held = {};                 // Menü-Richtungen: seit wann gehalten, wann zuletzt ausgelöst
      this.note = null;               // Einblendung bei Verbinden/Trennen
      this.lost = false;              // aktives Pad im Spiel getrennt -> Pause
      const short = id => id.replace(/\(.*?\)/g, '').trim().slice(0, 40);
      addEventListener('gamepadconnected', e => { this.note = { text: 'GAMEPAD CONNECTED', sub: short(e.gamepad.id), t: 3 }; });
      addEventListener('gamepaddisconnected', e => {
        if (e.gamepad.index === this.index) { this.index = null; this.lost = true; }
        this.note = { text: 'GAMEPAD DISCONNECTED', sub: '', t: 3 };
      });
    }

    current() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p || !p.connected) continue;
        if (p.buttons.some(b => b.pressed) || p.axes.some(a => Math.abs(a) > 0.5)) {
          if (this.index !== p.index) { this.index = p.index; this.prev = []; }   // der erste Druck zählt
          break;
        }
      }
      const p = this.index !== null ? pads[this.index] : null;
      return p && p.connected ? p : null;
    }

    // Menü-Richtung mit Wiederholung beim Halten (erst nach 0,35 s, dann alle 0,11 s)
    repeat(name, down, now) {
      const h = this.held[name];
      if (!down) { delete this.held[name]; return false; }
      if (!h) { this.held[name] = { since: now, last: now }; return true; }
      if (now - h.since > 350 && now - h.last > 110) { h.last = now; return true; }
      return false;
    }

    rumble(strong, weak, ms) {
      const p = this.index !== null && navigator.getGamepads ? navigator.getGamepads()[this.index] : null;
      const va = p && p.vibrationActuator;
      if (va && va.playEffect) va.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ Eingabe

  class Input {
    constructor() {
      this.keys = new Set();
      this.hit = new Set();
      this.pad = new Pad();
      this.device = 'keyboard';        // 'keyboard' | 'gamepad' | 'touch' – für die Tasten-Hinweise
      const block = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F3'];
      addEventListener('keydown', e => {
        if (block.includes(e.code)) e.preventDefault();
        if (!e.repeat) this.hit.add(e.code);
        this.keys.add(e.code);
        this.device = 'keyboard';
      });
      addEventListener('keyup', e => this.keys.delete(e.code));
      addEventListener('blur', () => this.keys.clear());

      // Touch: ein Finger zieht das Schiff relativ (es bleibt unter dem Daumen sichtbar),
      // weitere Finger drücken die Knöpfe. Im Menü zählt ein Tippen mit seiner Position.
      this.touch = false;              // wird mit dem ersten Finger aktiv
      this.moveId = null;
      this.last = null;
      this.finger = null;
      this.drag = { x: 0, y: 0 };
      this.tap = null;
      this.getMode = () => 'title';
      this.onGesture = null;
      canvas.addEventListener('pointerdown', e => this.down(e));
      canvas.addEventListener('pointermove', e => this.move(e));
      for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, e => this.up(e));
    }

    // Bildschirm- in Spielkoordinaten (das 16:9-Bild ist per Letterbox eingepasst)
    toGame(e) {
      const r = canvas.getBoundingClientRect(), s = Math.min(r.width / 1920, r.height / 1080);
      return { x: (e.clientX - r.left - (r.width - 1920 * s) / 2) / s, y: (e.clientY - r.top - (r.height - 1080 * s) / 2) / s };
    }

    down(e) {
      if (this.onGesture) this.onGesture(e);          // Ton im Gesten-Handler freischalten (iOS verlangt das)
      const p = this.toGame(e);
      this.device = e.pointerType === 'mouse' ? 'keyboard' : 'touch';
      // In Menüs zählt ein Tippen/Klick mit seiner Position (Knöpfe, Liste, Song-Pfeile)
      if (this.getMode() !== 'play') { this.tap = p; if (e.pointerType !== 'mouse') this.touch = true; return; }
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      this.touch = true;
      const T = Renderer.TOUCH, on = b => Math.hypot(p.x - b.x, p.y - b.y) < b.r + 24;
      if (on(T.hyper)) { this.hit.add('TouchHyper'); return; }
      if (on(T.drone)) { this.hit.add('TouchDrone'); return; }
      if (on(T.pause)) { this.hit.add('Escape'); return; }
      if (this.moveId === null) {
        this.moveId = e.pointerId;
        this.last = this.finger = p;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      }
    }

    move(e) {
      if (e.pointerId !== this.moveId) return;
      const p = this.toGame(e);
      this.drag.x += p.x - this.last.x;
      this.drag.y += p.y - this.last.y;
      this.last = this.finger = p;
    }

    up(e) {
      if (e.pointerId === this.moveId) { this.moveId = null; this.finger = null; }
    }

    poll() {
      const k = c => this.keys.has(c), h = c => this.hit.has(c);
      let x = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0);
      let y = (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0);
      let fire = k('Space') || k('KeyJ') || k('KeyZ');
      let focus = k('ShiftLeft') || k('ShiftRight');
      let hyper = h('KeyX') || h('KeyK');
      let drone = h('KeyC') || h('KeyL');
      let pause = h('Escape') || h('KeyP');
      let start = h('Enter') || h('NumpadEnter') || h('Space');
      let prev = h('ArrowLeft') || h('KeyA'), next = h('ArrowRight') || h('KeyD');
      let up = h('ArrowUp') || h('KeyW'), down = h('ArrowDown') || h('KeyS');
      let back = h('Escape') || h('Backspace'), inc = h('KeyI');
      const stats = h('F3'), quality = h('KeyG');

      const pad = this.pad.current();
      if (pad) {
        const P = this.pad, now = performance.now();
        const b = i => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
        const edge = i => b(i) && !P.prev[i];
        // Kreisförmige Totzone, danach analog (halb gedrückt = halbes Tempo)
        const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0, len = Math.hypot(ax, ay);
        const sc = len < 0.2 ? 0 : Math.min(1, (len - 0.2) / 0.75) / len;
        x += ax * sc + (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
        y += ay * sc + (b(13) ? 1 : 0) - (b(12) ? 1 : 0);
        // Spiel
        fire = fire || b(0) || b(7);
        focus = focus || b(4) || b(6);
        hyper = hyper || edge(1) || edge(5);
        drone = drone || edge(2);
        pause = pause || edge(9) || edge(8);
        // Menüs: A bestätigt, B zurück, Y Incubator, D-Pad/Stick navigieren, LB/RB Song wechseln
        start = start || edge(0);
        back = back || edge(1);
        inc = inc || edge(3);
        up = up || P.repeat('up', b(12) || ay < -0.6, now);
        down = down || P.repeat('down', b(13) || ay > 0.6, now);
        prev = prev || P.repeat('left', b(14) || ax < -0.6, now) || edge(4);
        next = next || P.repeat('right', b(15) || ax > 0.6, now) || edge(5);
        if (pad.buttons.some(bt => bt.pressed) || len > 0.3) this.device = 'gamepad';
        P.prev = pad.buttons.map((bt, i) => b(i));
      }
      if (h('KeyF')) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
      // Touch: Dauerfeuer, Knöpfe, Zieh-Strecke (leicht verstärkt, damit kurze Wege reichen)
      hyper = hyper || h('TouchHyper');
      drone = drone || h('TouchDrone');
      if (this.touch) fire = true;
      const dragX = this.drag.x * 1.3, dragY = this.drag.y * 1.3;
      this.drag.x = this.drag.y = 0;
      const tap = this.tap;
      this.tap = null;
      this.hit.clear();
      return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), fire, focus, hyper, drone, pause, start, prev, next, stats, quality,
        up, down, back, inc, dragX, dragY, tap, touch: this.touch, finger: this.finger, device: this.device };
    }
  }

  // ------------------------------------------------------------------ Ablauf

  const input = new Input();
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  input.getMode = () => mode;
  // Erstes Tippen: Ton freischalten, auf dem Handy Vollbild und Querformat sperren
  input.onGesture = e => {
    audio.ensure();
    audio.resume();
    if (e.pointerType !== 'mouse' && !document.fullscreenElement && mode !== 'play') {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' })
          .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
          .catch(() => {});
      }
    }
  };
  let renderer = null, level = null, buffer = null, game = null, song = null;
  let mode = 'loading', status = 'LOADING…', subtitle = '', last = performance.now();
  let songs = [], songIdx = 0, loadToken = 0, hi = 0;
  const cache = new Map();          // Song-URL -> { buffer, level }
  const DEFAULT_SONG = 'lighspeed';

  const hiKey = () => 'hypersense.hi.' + (song ? song.name : '');
  const readHi = () => { try { return Number(localStorage.getItem(hiKey())) || 0; } catch (e) { return 0; } };

  async function boot() {
    const images = Object.fromEntries(await Promise.all(Object.entries(IMAGES).map(([n, f]) => loadImage(n, f))));
    try { await document.fonts.load('700 40px Orbitron'); } catch (e) { /* Ersatzschrift */ }
    // Handys rechnen intern mit 1280×720 statt 1920×1080 (?res= zum Übersteuern)
    renderer = new Renderer(canvas, images, Number(params.get('res')) || (touchDevice ? 2 / 3 : 1));
    applyQuality();
    requestAnimationFrame(loop);
    audio.loadSamples();

    songs = await fetch('api/songs').then(r => r.json()).catch(() => []);
    if (!songs.length) { status = 'NO SONG IN music/'; return; }
    const want = (params.get('song') || DEFAULT_SONG).toLowerCase();
    const i = songs.findIndex(s => s.name.toLowerCase() === want);
    mode = 'title';
    selectSong(i < 0 ? 0 : i);
  }

  // Song wählen: laden, dekodieren und analysieren (einmal pro Song, danach aus dem Cache)
  async function selectSong(i) {
    songIdx = (i + songs.length) % songs.length;
    song = songs[songIdx];
    const token = ++loadToken;
    level = null;
    buffer = null;
    subtitle = song.name.toUpperCase();
    hi = readHi();
    try {
      let entry = cache.get(song.url);
      if (!entry) {
        status = 'LOADING SONG…';
        const data = await fetch(song.url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
        const buf = await audio.decode(data);
        const A = await Analysis.analyze(buf, msg => { if (token === loadToken) status = msg.toUpperCase(); });
        entry = { buffer: buf, level: Level.build(A) };
        cache.set(song.url, entry);
      }
      if (token !== loadToken) return;
      buffer = entry.buffer;
      level = entry.level;
      subtitle = `${song.name.toUpperCase()}  ·  ${Math.round(level.bpm)} BPM`;
      status = touchDevice ? 'TAP TO START' : 'PRESS ENTER / FIRE';
      window.HS = { get game() { return game; }, level, audio };
    } catch (err) {
      console.error(err);
      if (token === loadToken) status = 'ERROR: ' + err.message;
    }
  }

  function start() {
    audio.ensure();
    audio.resume();
    audio.muffle(false, 0.01);
    game = new Game(level, audio, {
      god: params.get('god') === '1', autoFire: params.get('auto') === '1', stats: save.stats(),
      rumble: (s, w, ms) => { if (input.device === 'gamepad') input.pad.rumble(s, w, ms); },
    });
    const from = Number(params.get('at')) || 0;
    audio.play(buffer, from > 0 ? from : -2);
    if (from > 0) game.seek(from);
    mode = 'play';
  }

  function finish() {
    mode = 'results';
    hi = Math.max(hi, Math.floor(game.score));
    try { localStorage.setItem(hiKey(), String(hi)); } catch (e) { /* kein Speicher */ }
    save.bank(game.runCoins);          // auch bei Game Over: gesammelt ist gesammelt
  }

  // ------------------------------------------------------------------ Incubator
  // HyperCoins aus den Läufen gegen dauerhafte Upgrades tauschen. ?coins=N gibt für Tests Münzen dazu.
  const save = new Meta.Save();
  if (params.get('coins')) save.coins += Number(params.get('coins')) || 0;
  const inc = { save, sel: 0, msg: '', msgT: 0, msgOk: true, flash: 0, touch: false, from: 'title' };

  function openIncubator() {
    inc.from = mode;
    inc.msgT = 0;
    mode = 'incubator';
    audio.menuMove();
  }

  function buySelected() {
    const u = Meta.UPGRADES[inc.sel], price = save.priceOf(u);
    if (save.buy(u)) {
      audio.buy();
      inc.flash = 1;
      inc.msg = `${u.name}  LEVEL ${save.level(u.id)}`;
      inc.msgOk = true;
    } else {
      audio.deny();
      inc.msg = price === null ? 'ALREADY MAXED' : 'NOT ENOUGH HYPERCOINS';
      inc.msgOk = false;
    }
    inc.msgT = 1.8;
  }

  function stepIncubator(inp, dt) {
    inc.touch = inp.touch || touchDevice;
    inc.msgT = Math.max(0, inc.msgT - dt);
    inc.flash = Math.max(0, inc.flash - dt * 2);
    const n = Meta.UPGRADES.length, I = Renderer.INC;
    if (inp.tap) {
      const t = inp.tap, b = I.back;
      if (t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h) inp.back = true;
      else if (t.x >= I.x0 && t.x <= I.x0 + I.w && t.y >= I.y0 && t.y < I.y0 + n * I.rowH) {
        const row = Math.floor((t.y - I.y0) / I.rowH);
        if (row === inc.sel) buySelected(); else { inc.sel = row; audio.menuMove(); }
      }
    }
    if (inp.up) { inc.sel = (inc.sel + n - 1) % n; audio.menuMove(); }
    if (inp.down) { inc.sel = (inc.sel + 1) % n; audio.menuMove(); }
    if (inp.start) buySelected();
    if (inp.back || inp.pause || inp.inc) {
      if (inc.from === 'results') { audio.stop(); game = null; }
      mode = 'title';
    }
  }

  // ------------------------------------------------------------------ Leistung
  // Grafik: 'auto' schaltet bei anhaltend langsamen Frames selbst auf 'low'. G wechselt, F3 zeigt Messwerte.
  const perf = { show: params.get('stats') === '1', gaps: [], cpu: [], mode: 'auto', slow: 0, note: '', noteT: 0 };
  try { perf.mode = localStorage.getItem('hypersense.quality') || 'auto'; } catch (e) { /* kein Speicher */ }

  function applyQuality() {
    if (perf.mode !== 'auto') renderer.quality = perf.mode;
  }

  function trackPerf(gap, cpu, inp) {
    perf.gaps.push(gap); perf.cpu.push(cpu);
    if (perf.gaps.length > 120) { perf.gaps.shift(); perf.cpu.shift(); }
    if (inp.stats) perf.show = !perf.show;
    if (inp.quality) {
      perf.mode = { auto: 'high', high: 'low', low: 'auto' }[perf.mode];
      if (perf.mode === 'auto') renderer.quality = 'high';
      applyQuality();
      try { localStorage.setItem('hypersense.quality', perf.mode); } catch (e) { /* kein Speicher */ }
      perf.note = 'GRAPHICS: ' + perf.mode.toUpperCase(); perf.noteT = 2;
    }
    // Auto: 2 s lang im Schnitt über 21 ms pro Frame (unter ~48 fps) -> sparsam
    // Verdeckter Tab oder einzelne lange Aussetzer (> 100 ms) sagen nichts über die Grafiklast
    if (perf.mode === 'auto' && renderer.quality === 'high' && mode === 'play' && !document.hidden && gap < 100) {
      perf.slow = gap > 21 ? perf.slow + gap / 1000 : Math.max(0, perf.slow - gap / 2000);
      if (perf.slow > 2) { renderer.quality = 'low'; perf.note = 'GRAPHICS: AUTO -> LOW'; perf.noteT = 3; }
    }
  }

  function drawPerf(dt) {
    const c = renderer.c;
    perf.noteT = Math.max(0, perf.noteT - dt);
    if (perf.noteT > 0) renderer.glowText(perf.note, '600 26px "Orbitron", sans-serif', '#9dff8a', '', 0, 1900, 50, 'right');
    if (!perf.show || !perf.gaps.length) return;
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const g = avg(perf.gaps), worst = Math.max(...perf.gaps), slowN = perf.gaps.filter(x => x > 20).length;
    const lines = [
      `FPS ${(1000 / g).toFixed(0)}   FRAME ${g.toFixed(1)} ms   WORST ${worst.toFixed(1)} ms   >20ms ${slowN}/120`,
      `JS ${avg(perf.cpu).toFixed(2)} ms   GFX ${perf.mode.toUpperCase()} (${renderer.quality})`,
      game ? `ENEMIES ${game.enemies.length}   BULLETS ${game.bullets.length}   FX ${game.fx.length}   RANK ${game.rank.toFixed(2)}` : '',
    ];
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(10, 10, 760, 96);
    c.fillStyle = '#9dff8a';
    c.font = '16px monospace';
    c.textAlign = 'left';
    lines.forEach((l, i) => c.fillText(l, 22, 36 + i * 26));
  }

  function loop(now) {
    const gap = now - last;
    const dt = Math.min(1 / 30, Math.max(0, gap / 1000));
    last = now;
    const cpu0 = performance.now();
    const inp = input.poll();
    let songT = 0, beat = 0;
    if (game && mode !== 'title') {
      songT = audio.songTime(now);
      beat = level.map.beatOf(songT);
    }

    // Tippen/Klicken im Titel: Incubator-Knopf, linker/rechter Rand wählt den Song, sonst Start bzw. weiter
    if (inp.tap && mode !== 'incubator') {
      const b = Renderer.INC.titleBtn, t = inp.tap;
      if (mode === 'title' && t.x >= b.x && t.x <= b.x + b.w && t.y >= b.y && t.y <= b.y + b.h) inp.inc = true;
      else if (mode === 'title' && songs.length > 1 && (t.x < 560 || t.x > 1360)) {
        if (t.x < 560) inp.prev = true; else inp.next = true;
      } else inp.start = true;
    }
    const portrait = (inp.touch || touchDevice) && innerHeight > innerWidth;

    if (mode === 'incubator') stepIncubator(inp, dt);
    else if (mode === 'title') {
      if (inp.inc) openIncubator();
      else if (inp.start && level) start();
      else if (songs.length > 1 && (inp.prev || inp.next)) selectSong(songIdx + (inp.next ? 1 : -1));
    } else if (mode === 'play') {
      // Pause auch, wenn das Gamepad mitten im Spiel getrennt wird
      if (inp.pause || portrait || input.pad.lost) { mode = 'paused'; audio.pause(); input.pad.lost = false; }
      else {
        game.update(dt, inp, songT);
        if (game.over && !game.overAt) { game.overAt = now; audio.fadeOut(2.5); }
        if ((game.over && now - game.overAt > 2500) || songT > level.duration + 0.5) finish();
      }
    } else if (mode === 'paused') {
      if ((inp.pause || inp.start) && !portrait) { audio.resume(); mode = 'play'; }
    } else if (mode === 'results') {
      if (inp.inc) openIncubator();
      else if (inp.start) { audio.stop(); game = null; mode = 'title'; }
    }

    const st = { mode, songT, beat, levels: audio.ctx ? audio.levels() : [0, 0, 0], songName: song ? song.name : '',
      finger: inp.finger, touch: inp.touch || touchDevice };
    renderer.device = inp.device === 'keyboard' && touchDevice ? 'touch' : inp.device;   // für die Tasten-Hinweise
    inc.device = renderer.device;
    if (mode === 'incubator') renderer.incubator(inc, dt);
    else {
      renderer.frame(dt, mode === 'title' || mode === 'loading' ? null : game, st);
      if (mode === 'title' || mode === 'loading') {
        renderer.title({ ...st, status, subtitle, ready: !!level, pick: songs.length > 1, hi, bank: save.coins });
      }
      if (mode === 'play' && inp.touch) renderer.touchUI(game, st);
      if (mode === 'paused') renderer.paused();
      if (mode === 'results') renderer.results(game, { hi, bank: save.coins, touch: st.touch });
    }
    if (portrait) renderer.rotateHint();
    // Einblendung beim Verbinden/Trennen eines Gamepads
    const note = input.pad.note;
    if (note && (note.t -= dt) > 0) {
      renderer.c.globalAlpha = Math.min(1, note.t * 2);
      renderer.glowText(note.text, '700 30px "Orbitron", sans-serif', '#dff6ff', '#3fb4ff', 12, 960, 130);
      if (note.sub) renderer.glowText(note.sub, '400 20px "Orbitron", sans-serif', 'rgba(205,239,255,0.8)', '', 0, 960, 165);
      renderer.c.globalAlpha = 1;
    }
    trackPerf(gap, performance.now() - cpu0, inp);
    drawPerf(dt);
    requestAnimationFrame(loop);
  }

  boot();
})();
