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
    powerup: 'powerup.png', planet: 'planet.png', galaxy: 'galaxy.jpg', nebula: 'nebula.jpg', explosion: 'explosion.jpg',
  };

  const loadImage = (name, file) => new Promise(res => {
    const im = new Image();
    im.onload = () => res([name, im]);
    im.onerror = () => res([name, null]);
    im.src = 'assets/' + file;
  });

  // ------------------------------------------------------------------ Eingabe

  class Input {
    constructor() {
      this.keys = new Set();
      this.hit = new Set();
      this.padPrev = [];
      const block = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
      addEventListener('keydown', e => {
        if (block.includes(e.code)) e.preventDefault();
        if (!e.repeat) this.hit.add(e.code);
        this.keys.add(e.code);
      });
      addEventListener('keyup', e => this.keys.delete(e.code));
      addEventListener('blur', () => this.keys.clear());
      canvas.addEventListener('pointerdown', () => this.hit.add('Click'));
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
      let start = h('Enter') || h('NumpadEnter') || h('Space') || h('Click');
      let prev = h('ArrowLeft') || h('KeyA'), next = h('ArrowRight') || h('KeyD');

      const pad = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p) : null;
      if (pad) {
        const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
        const edge = i => b(i) && !this.padPrev[i];
        const dz = v => (Math.abs(v) < 0.2 ? 0 : v);
        x += dz(pad.axes[0] || 0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
        y += dz(pad.axes[1] || 0) + (b(13) ? 1 : 0) - (b(12) ? 1 : 0);
        fire = fire || b(0) || b(7);
        focus = focus || b(4) || b(6);
        hyper = hyper || edge(1) || edge(5);
        drone = drone || edge(2) || edge(3);
        pause = pause || edge(9);
        start = start || edge(0) || edge(9);
        prev = prev || edge(14);
        next = next || edge(15);
        this.padPrev = pad.buttons.map(bt => bt.pressed);
      }
      if (h('KeyF')) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
      this.hit.clear();
      return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), fire, focus, hyper, drone, pause, start, prev, next };
    }
  }

  // ------------------------------------------------------------------ Ablauf

  const input = new Input();
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
    renderer = new Renderer(canvas, images);
    requestAnimationFrame(loop);

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
      status = 'PRESS ENTER / FIRE';
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
    game = new Game(level, audio, { god: params.get('god') === '1', autoFire: params.get('auto') === '1' });
    const from = Number(params.get('at')) || 0;
    audio.play(buffer, from > 0 ? from : -2);
    if (from > 0) game.seek(from);
    mode = 'play';
  }

  function finish() {
    mode = 'results';
    hi = Math.max(hi, Math.floor(game.score));
    try { localStorage.setItem(hiKey(), String(hi)); } catch (e) { /* kein Speicher */ }
  }

  function loop(now) {
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    const inp = input.poll();
    let songT = 0, beat = 0;
    if (game && mode !== 'title') {
      songT = audio.songTime(now);
      beat = level.map.beatOf(songT);
    }

    if (mode === 'title') {
      if (inp.start && level) start();
      else if (songs.length > 1 && (inp.prev || inp.next)) selectSong(songIdx + (inp.next ? 1 : -1));
    } else if (mode === 'play') {
      if (inp.pause) { mode = 'paused'; audio.pause(); }
      else {
        game.update(dt, inp, songT);
        if (game.over && !game.overAt) { game.overAt = now; audio.fadeOut(2.5); }
        if ((game.over && now - game.overAt > 2500) || songT > level.duration + 0.5) finish();
      }
    } else if (mode === 'paused') {
      if (inp.pause || inp.start) { audio.resume(); mode = 'play'; }
    } else if (mode === 'results') {
      if (inp.start) { audio.stop(); game = null; mode = 'title'; }
    }

    const st = { mode, songT, beat, levels: audio.ctx ? audio.levels() : [0, 0, 0], songName: song ? song.name : '' };
    renderer.frame(dt, mode === 'title' || mode === 'loading' ? null : game, st);
    if (mode === 'title' || mode === 'loading') {
      renderer.title({ ...st, status, subtitle, ready: !!level, pick: songs.length > 1, hi });
    }
    if (mode === 'paused') renderer.paused();
    if (mode === 'results') renderer.results(game, { hi });
    requestAnimationFrame(loop);
  }

  boot();
})();
