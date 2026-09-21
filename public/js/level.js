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

    // ---------- Wellen: in lauten Passagen jeden Takt, sonst alle zwei Takte
    const waves = [];
    let lastGate = -1e9, lastRocks = -1e9, lastCarrier = -1e9, lastWorm = -1e9, n = 0, b = firstBar;
    while (b < endBeat) {
      const loud = loudOf(b, 4);
      const step = loud > 0.5 ? 4 : 8;
      if (!inBoss(b)) {
        let type = null;
        const corr = inCorridor(b);
        if (nearDrop(b, 4)) type = 'swarm';
        else if (nearDrop(b, 16)) type = pick(rng, ['darts', 'worm', 'vee']);
        else if (corr) type = pick(rng, ['turrets', 'turrets', 'darts', 'line', 'mines', 'worm']);
        else if (loud < 0.22) type = b - lastRocks >= 16 ? 'rocks' : (rng() < 0.5 ? 'mines' : null);
        else if (loud > 0.6 && b - lastCarrier >= 64 && n > 6) type = 'carrier';
        else if (loud > 0.6 && b - lastGate >= 48 && n > 4) type = 'gate';
        else if (loud < 0.45) type = pick(rng, ['line', 'fighters', 'darts', 'splitter', 'mines', 'rocks']);
        else type = pick(rng, ['line', 'vee', 'fighters', 'darts', 'worm', 'splitter', 'vee']);
        if (type === 'worm' && b - lastWorm < 16) type = 'darts';
        // nie zwei V-Formationen direkt hintereinander
        if (type === 'vee' && waves.length && waves[waves.length - 1].type === 'vee' && b - waves[waves.length - 1].b < 12) type = 'fighters';
        if (type === 'rocks' && b - lastRocks < 16) type = 'line';
        if (type) {
          if (type === 'gate') lastGate = b;
          if (type === 'rocks') lastRocks = b;
          if (type === 'carrier') lastCarrier = b;
          if (type === 'worm') lastWorm = b;
          waves.push({ b, type, loud, seed: Math.floor(rng() * 1e9), corr });
          n++;
        }
      }
      b += step;
    }
    if (boss) waves.push({ b: boss.b0, type: 'boss', loud: 1, seed: 1 });
    waves.sort((x, y) => x.b - y.b);

    // Noten: alles, worauf Gegner feuern dürfen. strong = Spike/Downbeat in der Chart
    const notes = chart.notes
      .filter(nt => nt.t > 2)
      .map(nt => ({ t: nt.t, b: nt.beatIdx, strong: nt.type === 'spike' || nt.isDown, down: nt.isDown }));

    return {
      map, bpm: map.bpm, duration: A.duration, downbeat: map.downbeat,
      waves, notes, boss, drops: chart.drops, dropBeats, corridors, terrain, hullAt,
      PX_PER_BEAT, FLOOR_Y,
      scrollAt: beat => beat * PX_PER_BEAT,
      loudAt: t => A.loud[Math.round(t * fr)] || 0,
    };
  }

  window.Level = { build, mulberry32, PX_PER_BEAT, FLOOR_Y };
})();
