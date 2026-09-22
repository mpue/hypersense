// Level aus dem Song: Wellen auf Takt-Einsen, Gegnerschüsse auf den Noten, Boss beim stärksten Drop.
//
// Grundlage ist die Analyse aus Rhytmicker (analysis.js): Beat-Raster (map), Noten auf Beats/Achteln
// mit Stärke, Lautheit pro Frame, Drops und das Boss-Fenster.
//
// Die Welt scrollt im Takt: PX_PER_BEAT Pixel pro Beat. In ruhigeren Abschnitten fliegt man durch
// Korridore einer Raumstation (Rumpf-Module oben und unten, Geschütztürme darauf).
(function () {
  'use strict';

  const W = 1920;
  const PX_PER_BEAT = 110;
  const FLOOR_Y = 935;                // Unterkante der Spielfläche (darunter liegt das HUD)

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const pick = (rng, list) => list[Math.floor(rng() * list.length)];

  function build(A) {
    const map = A.grid;
    const chart = Analysis.makeChart(A, map, 'hard');
    const rng = mulberry32(Math.round(map.bpm * 1000) + 77);
    const fr = A.fr;

    const loudOf = (b, beats) => {
      const f0 = Math.round(map.timeOf(b) * fr), f1 = Math.round(map.timeOf(b + beats) * fr);
      let s = 0, k = 0;
      for (let f = Math.max(0, f0); f < Math.min(A.loud.length, f1); f++) { s += A.loud[f]; k++; }
      return k ? s / k : 0;
    };

    const boss = chart.boss ? { b0: chart.boss.b0, b1: map.beatOf(chart.boss.t1), t0: chart.boss.t0, t1: chart.boss.t1 } : null;
    const inBoss = b => boss && b >= boss.b0 - 8 && b < boss.b1 + 4;
    const dropBeats = chart.drops.map(t => Math.round(map.beatOf(t)));
    const nearDrop = (b, span) => dropBeats.some(d => b >= d - 2 && b < d + span);
    const endBeat = map.beatOf(A.duration) - 12;

    let firstBar = map.downbeat;
    while (map.timeOf(firstBar) < 3) firstBar += 4;

    // ---------- Korridore: 8-Takt-Blöcke mittlerer Lautheit, nicht an Drops oder beim Boss
    const corridors = [];
    for (let b = firstBar + 32; b + 32 < endBeat; b += 32) {
      const l = loudOf(b, 32);
      if (l < 0.22 || l > 0.62 || inBoss(b) || inBoss(b + 32) || nearDrop(b, 32) || nearDrop(b + 16, 16)) continue;
      const last = corridors[corridors.length - 1];
      if (last && last.b1 === b) last.b1 = b + 32; else corridors.push({ b0: b, b1: b + 32 });
    }
    // Rumpf-Module entlang der Welt-x-Achse; ein Korridor beginnt am rechten Rand, wenn sein Beat kommt
    const terrain = [];
    for (const c of corridors) {
      for (const top of [true, false]) {
        let wx = c.b0 * PX_PER_BEAT + W;
        const end = c.b1 * PX_PER_BEAT + W;
        let h = 130;
        while (wx < end) {
          h = Math.max(100, Math.min(215, h + (rng() - 0.5) * 110));
          const w = 380 + Math.floor(rng() * 3) * 120;
          terrain.push({ wx, w, h: Math.round(h), top, v: Math.floor(rng() * 4) });
          wx += w;
        }
      }
    }
    terrain.sort((a, b) => a.wx - b.wx);
    const inCorridor = b => corridors.some(c => b >= c.b0 && b < c.b1 - 4);
    // Höhe des Rumpfs an Welt-x (0 = keiner)
    const hullAt = (wx, top) => {
      for (const m of terrain) if (m.top === top && wx >= m.wx && wx < m.wx + m.w) return m.h;
      return 0;
    };

    // ---------- Wellen auf zwei getrennten Spuren, damit kein Durcheinander entsteht:
    //   Formationen – Kanonenfutter in klaren Figuren, eine zur Zeit, alle 2 Takte auf der Eins
    //   Schwere     – einzelne gefährliche Gegner, höchstens alle 4 Takte, versetzt dazwischen
    const waves = [];
    const seed = () => Math.floor(rng() * 1e9);
    const FORM_QUIET = ['snake', 'diag', 'wall', 'vee'];
    const FORM_LOUD = ['snake', 'vee', 'ring', 'pincer', 'wall', 'loop', 'squad', 'diag'];
    let lastForm = null;
    for (let b = firstBar; b < endBeat; b += 8) {
      if (inBoss(b)) continue;
      const loud = loudOf(b, 8);
      let type;
      if (nearDrop(b, 4)) type = 'swarm';
      else {
        const pool = (loud < 0.4 ? FORM_QUIET : FORM_LOUD).filter(t => t !== lastForm);
        type = pick(rng, pool);
      }
      lastForm = type;
      waves.push({ b, type, loud, seed: seed(), corr: inCorridor(b), form: true });
    }
    let lastGate = -1e9, lastCarrier = -1e9, lastWorm = -1e9, lastRocks = -1e9, n = 0;
    for (let b = firstBar + 4; b < endBeat; b += 16) {
      if (inBoss(b) || inBoss(b + 8)) continue;
      const loud = loudOf(b, 16), corr = inCorridor(b);
      let type = null;
      if (corr) type = rng() < 0.7 ? 'turrets' : 'mines';
      else if (loud < 0.22) type = b - lastRocks >= 32 ? 'rocks' : 'mines';
      else if (loud > 0.6 && b - lastCarrier >= 96 && n > 3) type = 'carrier';
      else if (loud > 0.55 && b - lastGate >= 80 && n > 2) type = 'gate';
      else if (loud > 0.45 && b - lastWorm >= 48) type = 'worm';
      else type = pick(rng, loud < 0.4 ? ['orange', 'splitter', 'mines', 'darts'] : ['orange', 'splitter', 'darts', 'orange']);
      if (type === 'gate') lastGate = b;
      if (type === 'carrier') lastCarrier = b;
      if (type === 'worm') lastWorm = b;
      if (type === 'rocks') lastRocks = b;
      waves.push({ b, type, loud, seed: seed(), corr, form: false });
      n++;
    }
    if (boss) waves.push({ b: boss.b0, type: 'boss', loud: 1, seed: 1 });
    waves.sort((x, y) => x.b - y.b);

    // Noten: alles, worauf Gegner feuern dürfen. strong = Spike/Downbeat in der Chart
    const notes = chart.notes
      .filter(nt => nt.t > 2)
      .map(nt => ({ t: nt.t, b: nt.beatIdx, strong: nt.type === 'spike' || nt.isDown, down: nt.isDown }));

    const scenery = buildScenery();

    // ---------- Kulissen (reine Optik, eigener Zufall – Wellen und Rumpf bleiben unverändert).
    // Der Song wird in 8-Takt-Blöcke geteilt, jeder bekommt ein Bild passend zu seiner Stimmung:
    //   Korridor  – im Inneren der Station (Hangarwand dahinter, zeichnet render.js)
    //   Drop/laut – Großkampfschiffe ziehen vorbei, bei Drops ganze Flotten mit Gefecht
    //   ruhig     – Megatürme wachsen aus der Tiefe, dazu ferne Ringstationen und Werften
    // Jedes Stück: t0 (Songzeit, zu der es den Bildrand erreicht), x0, v (Bildschirm-px/s), par (Tiefe).
    function buildScenery() {
      const r = mulberry32(Math.round(map.bpm * 1000) + 9001);
      const world = PX_PER_BEAT * map.bpm / 60;               // Welt-Scrollen in px/s
      const out = [];
      const T = b => map.timeOf(b);
      // Ferne Megabauten: nacheinander, nie zwei zugleich
      let nextFar = T(firstBar);
      let farKind = r() < 0.5 ? 'station' : 'shipyard';
      while (nextFar < A.duration - 20) {
        const par = 0.13, st = farKind === 'station', h = st ? 640 + r() * 160 : 330 + r() * 80;
        const w = h * (st ? 1 : 3.7), v = -world * par;
        out.push({ kind: farKind, t0: nextFar, x0: W + 40, v, par, h, w, y: st ? 60 + r() * 90 : 110 + r() * 160, flip: r() < 0.5 });
        nextFar += (W + w + 40) / -v + 6 + r() * 20;
        farKind = st ? 'shipyard' : 'station';
      }
      for (let b = firstBar; b + 8 < endBeat; b += 32) {
        if (inBoss(b) || inBoss(b + 16) || inCorridor(b + 8)) continue;
        const loud = loudOf(b, 32), drop = nearDrop(b, 32) || nearDrop(b + 16, 16), t = T(b);
        if (drop || loud > 0.42) {
          // Feindliche Großkampfschiffe (Bug links) kommen von rechts, verbündete Kreuzer überholen von links
          const n = drop ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const par = 0.22 + r() * 0.2, ally = drop && i === n - 1;
            const h = (ally ? 170 : 230) + r() * 120 + par * 200, w = h * 3.9, y = 120 + r() * 520;
            if (ally) out.push({ kind: 'cruiser', t0: t + 2 + i * 3, x0: -w - 20, v: world * (0.55 + r() * 0.25), par, h, w, y, flip: true, ally: true });
            else out.push({ kind: 'dread', v0: Math.floor(r() * 4), t0: t + i * 12 * 60 / map.bpm, x0: W + 20, v: -world * par - 40 - r() * 50, par, h, w, y });
          }
        } else {
          // Stadt aus Megatürmen, von unten (selten auch von oben hängend)
          const n = 2 + Math.floor(r() * 3);
          for (let i = 0; i < n; i++) {
            const par = 0.34 + r() * 0.22, top = r() < 0.25, h = 720 + r() * 380, w = h * 0.26;
            out.push({ kind: 'spire', v0: Math.floor(r() * 3), t0: t + i * (1.5 + r() * 3), x0: W + 20, v: -world * par, par, h, w,
              y: top ? -h * (0.25 + r() * 0.2) : FLOOR_Y + 140 - h * (0.55 + r() * 0.3), top });
          }
        }
      }
      for (const s of out) s.t1 = s.t0 + (s.v < 0 ? (s.x0 + s.w) / -s.v : (W - s.x0) / s.v);   // wieder draußen
      return out.sort((a, b) => a.par - b.par);
    }

    return {
      map, bpm: map.bpm, duration: A.duration, downbeat: map.downbeat,
      waves, notes, boss, drops: chart.drops, dropBeats, corridors, terrain, hullAt, scenery,
      PX_PER_BEAT, FLOOR_Y,
      scrollAt: beat => beat * PX_PER_BEAT,
      loudAt: t => A.loud[Math.round(t * fr)] || 0,
    };
  }

  window.Level = { build, mulberry32, PX_PER_BEAT, FLOOR_Y };
})();
