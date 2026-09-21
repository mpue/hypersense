// Level aus dem Song: Wellen auf Takt-Einsen, Gegnerschüsse auf den Noten, Boss beim stärksten Drop.
//
// Grundlage ist die Analyse aus Rhytmicker (analysis.js): Beat-Raster (map), Noten auf Beats/Achteln
// mit Stärke, Lautheit pro Frame, Drops und das Boss-Fenster.
(function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function build(A) {
    const map = A.grid;
    const chart = Analysis.makeChart(A, map, 'normal');
    const rng = mulberry32(Math.round(map.bpm * 1000) + 77);
    const fr = A.fr;

    const barLoud = b => {
      const f0 = Math.round(map.timeOf(b) * fr), f1 = Math.round(map.timeOf(b + 4) * fr);
      let s = 0, k = 0;
      for (let f = Math.max(0, f0); f < Math.min(A.loud.length, f1); f++) { s += A.loud[f]; k++; }
      return k ? s / k : 0;
    };

    // Boss: 8 Takte ab dem stärksten Drop (wie in Rhytmicker), mindestens aber 6 Takte lang
    const boss = chart.boss ? { b0: chart.boss.b0, b1: map.beatOf(chart.boss.t1), t0: chart.boss.t0, t1: chart.boss.t1 } : null;
    const inBoss = b => boss && b >= boss.b0 - 8 && b < boss.b1 + 4;
    const dropBeats = chart.drops.map(t => Math.round(map.beatOf(t)));
    const isDrop = b => dropBeats.some(d => Math.abs(d - b) < 0.5);

    // Wellen alle 2 Takte, ab ~3 s, bis 4 Takte vor Songende
    const waves = [];
    const lastBeat = map.beatOf(A.duration) - 16;
    let firstBar = map.downbeat;
    while (map.timeOf(firstBar) < 3) firstBar += 4;
    let lastGate = -Infinity, lastRocks = -Infinity, n = 0;
    for (let b = firstBar; b < lastBeat; b += 8) {
      if (inBoss(b)) continue;
      const loud = Math.max(barLoud(b), barLoud(b + 4));
      const drop = isDrop(b) || isDrop(b + 4);
      let type;
      if (drop) type = 'swarm';
      else if (loud < 0.22) type = b - lastRocks >= 16 ? 'rocks' : null;
      else if (loud < 0.5) type = ['line', 'line', 'fighters', 'rocks'][Math.floor(rng() * 4)];
      else if (loud > 0.62 && b - lastGate >= 48 && n > 3) type = 'gate';
      else type = ['line', 'vee', 'fighters', 'vee', 'line'][Math.floor(rng() * 5)];
      if (type === 'rocks' && b - lastRocks < 16) type = 'line';
      if (!type) continue;
      if (type === 'gate') lastGate = b;
      if (type === 'rocks') lastRocks = b;
      waves.push({ b: isDrop(b + 4) && !isDrop(b) ? b + 4 : b, type, loud, seed: Math.floor(rng() * 1e9), drop });
      n++;
    }
    if (boss) waves.push({ b: boss.b0, type: 'boss', loud: 1, seed: 1, drop: true });
    waves.sort((a, b) => a.b - b.b);

    // Noten: alles, worauf Gegner feuern dürfen. strong = Spike/Downbeat in der Chart
    const notes = chart.notes
      .filter(nt => nt.t > 2)
      .map(nt => ({ t: nt.t, b: nt.beatIdx, strong: nt.type === 'spike' || nt.isDown, down: nt.isDown }));

    return {
      map, bpm: map.bpm, duration: A.duration, downbeat: map.downbeat,
      waves, notes, boss, drops: chart.drops, dropBeats,
      loudAt: t => A.loud[Math.round(t * fr)] || 0,
    };
  }

  window.Level = { build, mulberry32 };
})();
