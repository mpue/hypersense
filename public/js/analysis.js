// Song-Analyse: Onset-Erkennung, Tempo/Beat-Raster und Chart-Generierung.
(function () {
  'use strict';

  const SR = 22050;   // Analyse-Samplerate
  const HOP = 256;    // ~11.6 ms pro Frame

  const tick = () => new Promise(r => setTimeout(r, 0));

  // Rendert den Song gefiltert in drei Bänder: Bass (Kick), Mitten (Snare/Vocals), Höhen (Hats).
  async function renderBands(buffer) {
    const ctx = new OfflineAudioContext(3, Math.ceil(buffer.duration * SR), SR);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const merger = ctx.createChannelMerger(3);
    const filt = (type, f, q) => {
      const b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q;
      return b;
    };
    const low1 = filt('lowpass', 140, 0.8), low2 = filt('lowpass', 140, 0.8);
    const mid = filt('bandpass', 1800, 0.6);
    const high = filt('highpass', 7000, 0.7);
    src.connect(low1); low1.connect(low2); low2.connect(merger, 0, 0);
    src.connect(mid); mid.connect(merger, 0, 1);
    src.connect(high); high.connect(merger, 0, 2);
    merger.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    return [0, 1, 2].map(c => out.getChannelData(c));
  }

  // Energie-Hüllkurve pro Frame und positiver Anstieg (Spectral-Flux-Näherung).
  function bandFlux(data, nFrames) {
    const env = new Float32Array(nFrames);
    const rms = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      let s = 0;
      const o = f * HOP;
      for (let i = 0; i < HOP; i++) { const v = data[o + i]; s += v * v; }
      rms[f] = Math.sqrt(s / HOP);
      env[f] = Math.log(1 + 200 * rms[f]);
    }
    const flux = new Float32Array(nFrames);
    let mean = 0;
    for (let f = 1; f < nFrames; f++) {
      flux[f] = Math.max(0, env[f] - env[f - 1]);
      mean += flux[f];
    }
    mean = mean / nFrames + 1e-9;
    for (let f = 0; f < nFrames; f++) flux[f] /= mean;
    return { flux, rms };
  }

  function movingAverage(arr, radius) {
    const n = arr.length, out = new Float32Array(n);
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - radius), b = Math.min(n, i + radius + 1);
      out[i] = (pre[b] - pre[a]) / (b - a);
    }
    return out;
  }

  function gaussSmooth(arr, sigma) {
    const r = Math.ceil(sigma * 3), k = [];
    let ks = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sigma) ** 2); k.push(v); ks += v; }
    const n = arr.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) { const x = i + j; if (x >= 0 && x < n) s += arr[x] * k[j + r]; }
      out[i] = s / ks;
    }
    return out;
  }

  function sampleAt(arr, x) {
    const i = Math.floor(x), f = x - i;
    if (i < 0 || i + 1 >= arr.length) return 0;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  }

  // Grobe Tempo-Schätzung per Autokorrelation mit Kammfilter über Vielfache der Periode.
  function coarseTempo(odf, fr) {
    const n = odf.length;
    const minLag = Math.floor(60 * fr / 200);
    const maxLag = Math.ceil(60 * fr / 70) * 4 + 2;
    const ac = new Float32Array(maxLag + 2);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += odf[i] * odf[i + lag];
      ac[lag] = s / (n - lag);
    }
    let best = -1, bestBpm = 120;
    for (let bpm = 70; bpm <= 190; bpm += 0.25) {
      const lag = 60 * fr / bpm;
      const w = Math.exp(-0.5 * (Math.log2(bpm / 125) / 1.0) ** 2);
      const s = (sampleAt(ac, lag) + 0.5 * sampleAt(ac, 2 * lag) + 0.25 * sampleAt(ac, 4 * lag)) * w;
      if (s > best) { best = s; bestBpm = bpm; }
    }
    return bestBpm;
  }

  // Dynamic-Programming-Beat-Tracking (Ellis 2007): folgt Tempoänderungen im Song.
  function trackBeats(odfS, fr, bpm) {
    const n = odfS.length, P = 60 * fr / bpm;
    let sq = 0;
    for (let i = 0; i < n; i++) sq += odfS[i] * odfS[i];
    const sd = Math.sqrt(sq / n) || 1;
    const lo = Math.round(P / 2), hi = Math.round(P * 2);
    const pen = new Float32Array(hi + 1);
    for (let d = lo; d <= hi; d++) pen[d] = 200 * Math.log(d / P) ** 2;

    const C = new Float32Array(n), back = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      let best = 0, arg = -1;
      for (let d = lo; d <= hi && t - d >= 0; d++) {
        const v = C[t - d] - pen[d];
        if (v > best) { best = v; arg = t - d; }
      }
      C[t] = odfS[t] / sd + best;
      back[t] = arg;
    }
    let end = n - 1;
    for (let i = Math.max(0, n - hi); i < n; i++) if (C[i] > C[end]) end = i;
    const frames = [];
    for (let f = end; f >= 0; f = back[f]) frames.push(f);
    frames.reverse();

    // Lokale lineare Regression über ±4 Beats: glättet Frame-Raster-Jitter, folgt aber dem Tempo
    const raw = frames.map(f => f / fr);
    const beats = raw.map((_, i) => {
      const a = Math.max(0, i - 4), b = Math.min(raw.length - 1, i + 4);
      let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
      for (let j = a; j <= b; j++) { sx += j; sy += raw[j]; sxx += j * j; sxy += j * raw[j]; k++; }
      const slope = (k * sxy - sx * sy) / (k * sxx - sx * sx);
      return (sy - slope * sx) / k + slope * i;
    });

    // Raster bis an Anfang und Ende des Songs verlängern
    const duration = n / fr;
    const p0 = beats[1] - beats[0], p1 = beats[beats.length - 1] - beats[beats.length - 2];
    while (beats[0] > 0) beats.unshift(beats[0] - p0);
    while (beats[beats.length - 1] < duration + p1) beats.push(beats[beats.length - 1] + p1);
    return beats;
  }

  // Beat-Map: Umrechnung zwischen Songzeit und (gebrochenem) Beat-Index bei variablem Tempo.
  class BeatMap {
    constructor(beats, downbeat) {
      this.beats = beats;
      this.downbeat = downbeat;
      const d = [];
      for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
      const s = d.slice().sort((a, b) => a - b);
      this.beat = s[Math.floor(s.length / 2)];
      this.bpm = 60 / this.beat;
      // Tempo-Spanne über 8-Beat-Fenster (ohne Ausreißer)
      const loc = [];
      for (let i = 0; i + 8 < beats.length; i += 4) loc.push(480 / (beats[i + 8] - beats[i]));
      loc.sort((a, b) => a - b);
      this.bpmMin = loc[Math.floor(loc.length * 0.05)] || this.bpm;
      this.bpmMax = loc[Math.floor(loc.length * 0.95)] || this.bpm;
    }
    timeOf(b) {
      const B = this.beats, n = B.length, i = Math.floor(b);
      if (i < 0) return B[0] + b * (B[1] - B[0]);
      if (i >= n - 1) return B[n - 1] + (b - (n - 1)) * (B[n - 1] - B[n - 2]);
      return B[i] + (b - i) * (B[i + 1] - B[i]);
    }
    beatOf(t) {
      const B = this.beats, n = B.length;
      if (t < B[0]) return (t - B[0]) / (B[1] - B[0]);
      if (t >= B[n - 1]) return n - 1 + (t - B[n - 1]) / (B[n - 1] - B[n - 2]);
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
      return lo + (t - B[lo]) / (B[lo + 1] - B[lo]);
    }
    beatDurAt(t) {
      const i = Math.max(0, Math.min(this.beats.length - 2, Math.floor(this.beatOf(t))));
      return this.beats[i + 1] - this.beats[i];
    }
    isDown(b) { return ((Math.round(b) - this.downbeat) % 4 + 4) % 4 === 0; }
  }

  // Welcher der 4 Beats ist die "Eins"? -> Beat mit der stärksten Bass-Energie.
  function makeMap(A, beats) {
    const sums = [0, 0, 0, 0];
    beats.forEach((t, i) => { sums[i % 4] += sampleAt(A.lowS, t * A.fr); });
    return new BeatMap(beats, sums.indexOf(Math.max(...sums)));
  }

  // Tempo verdoppeln (Achtel werden zu Beats) oder halbieren (stärkere Hälfte behalten).
  function rescale(A, map, factor) {
    const B = map.beats;
    let out = [];
    if (factor > 1) {
      for (let i = 0; i < B.length; i++) { out.push(B[i]); if (i + 1 < B.length) out.push((B[i] + B[i + 1]) / 2); }
    } else {
      const score = par => B.reduce((s, t, i) => s + (i % 2 === par ? sampleAt(A.odfS, t * A.fr) : 0), 0);
      const par = score(0) >= score(1) ? 0 : 1;
      out = B.filter((_, i) => i % 2 === par);
    }
    return makeMap(A, out);
  }

  async function analyze(buffer, onStep) {
    const step = async msg => { if (onStep) onStep(msg); await tick(); };

    await step('Filtering frequency bands…');
    const bands = await renderBands(buffer);
    const nFrames = Math.floor(bands[0].length / HOP) - 1;
    const fr = SR / HOP;

    await step('Detecting onsets…');
    const [L, M, H] = bands.map(b => bandFlux(b, nFrames));
    const odfRaw = new Float32Array(nFrames);
    const loudRaw = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      odfRaw[f] = 1.0 * L.flux[f] + 0.7 * M.flux[f] + 0.4 * H.flux[f];
      loudRaw[f] = L.rms[f] + M.rms[f] + H.rms[f];
    }
    // Adaptiver Schwellwert: nur was lokal heraussticht, zählt als Onset.
    const localMean = movingAverage(odfRaw, Math.round(fr * 0.5));
    const odf = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) odf[f] = Math.max(0, odfRaw[f] - localMean[f]);
    const odfS = gaussSmooth(odf, 1.5);
    const lowS = gaussSmooth(L.flux, 1.5);

    // Lautheit über ~2 s geglättet, auf das 95. Perzentil normiert.
    const loudS = movingAverage(loudRaw, Math.round(fr * 1.0));
    const sorted = Array.from(loudS).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
    const loud = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) loud[f] = Math.min(1.2, loudS[f] / p95);

    await step('Estimating tempo…');
    let bpm = coarseTempo(odfS, fr);
    if (bpm < 80) bpm *= 2;
    if (bpm > 185) bpm /= 2;

    await step('Tracking beats…');
    // Hüllkurve des Songs (für die Wellenform-Darstellung), leicht geglättet und auf das 98. Perzentil normiert
    const envS = gaussSmooth(loudRaw, 1.2);
    const envSorted = Array.from(envS).sort((a, b) => a - b);
    const p98 = envSorted[Math.floor(envSorted.length * 0.98)] || 1;
    const env = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) env[f] = Math.min(1.2, envS[f] / p98);

    const A = { fr, duration: buffer.duration, odf, odfS, lowS, loud, env };
    A.grid = makeMap(A, trackBeats(odfS, fr, bpm));
    return A;
  }

  // ---------- Chart-Generierung ----------

  const DIFF = {
    easy:   { seed: 1, thresh: 1.25, eighths: false, eighthLoud: 9,    minGap: 1,   fillGap: 4, ceilProb: 0.15, spikeRatio: 0.5, action: 0.5 },
    normal: { seed: 2, thresh: 1.1,  eighths: true,  eighthLoud: 0.65, minGap: 1,   fillGap: 4, ceilProb: 0.3,  spikeRatio: 0.6, action: 1 },
    hard:   { seed: 3, thresh: 0.95, eighths: true,  eighthLoud: 0.35, minGap: 0.5, fillGap: 3, ceilProb: 0.4,  spikeRatio: 0.7, action: 1.4 },
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeChart(A, grid, difficulty) {
    const D = DIFF[difficulty] || DIFF.normal;
    const map = grid, downbeat = map.downbeat, beat = map.beat, fr = A.fr;
    const rng = mulberry32(Math.round(map.bpm * 100) * 7 + D.seed);
    const mod4 = b => ((b - downbeat) % 4 + 4) % 4;

    // Kandidaten auf dem Achtel-Raster sammeln
    const startT = 2.5;
    const g0 = Math.ceil(map.beatOf(startT) * 2);
    const g1 = Math.floor(map.beatOf(A.duration - 1.5) * 2);
    const raw = [];
    for (let g = g0; g <= g1; g++) {
      const t = map.timeOf(g / 2), f = Math.round(t * fr);
      let s = 0;
      for (let d = -2; d <= 2; d++) { const v = A.odf[f + d] || 0; if (v > s) s = v; }
      raw.push({ g, t, s, loud: A.loud[f] || 0 });
    }
    for (let i = 0; i < raw.length; i++) {
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - 16); j <= Math.min(raw.length - 1, i + 16); j++) { sum += raw[j].s; c++; }
      const r = raw[i];
      r.rel = r.s / (sum / c + 1e-6);
      r.onBeat = r.g % 2 === 0;
      r.beatIdx = r.g / 2;
      r.isDown = r.onBeat && mod4(r.beatIdx) === 0;
      r.score = r.rel * (r.onBeat ? (r.isDown ? 1.35 : 1.15) : 0.85) * (0.35 + 0.65 * Math.min(1, r.loud));
    }

    // Gierige Auswahl: stärkste Onsets zuerst, Mindestabstand einhalten
    const cands = raw
      .filter(r => r.loud > 0.12 && r.score >= D.thresh && (r.onBeat || D.eighths))
      .sort((a, b) => b.score - a.score);
    const taken = new Map();
    const minD = Math.round(D.minGap * 2);
    for (const c of cands) {
      let ok = true;
      for (let d = 1; d < Math.max(minD, 2) && ok; d++) {
        for (const n of [taken.get(c.g - d), taken.get(c.g + d)]) {
          if (!n) continue;
          const eighthOk = d === 1 && D.eighths && c.loud > D.eighthLoud && n.loud > D.eighthLoud;
          if (d < minD && !eighthOk) ok = false;
          if (d === 1 && !D.eighths) ok = false;
        }
      }
      if (ok) taken.set(c.g, c);
    }
    let picked = [...taken.values()].sort((a, b) => a.g - b.g);

    // Spikes für die stärksten Onsets, Orbs (reine Takt-Noten) für den Rest
    const scores = picked.map(p => p.score).sort((a, b) => b - a);
    const cut = scores[Math.floor(scores.length * D.spikeRatio)] ?? 0;
    const notes = picked.map(p => ({
      t: p.t, beatIdx: p.beatIdx, isDown: p.isDown,
      type: (p.score >= cut || p.isDown) ? 'spike' : 'orb',
    }));

    // Lange Lücken bei laufender Musik mit Orbs auf jedem zweiten Beat füllen – der Puls reißt nie ab
    const filled = [];
    let prevBeat = Math.ceil(map.beatOf(startT)) - 2;
    for (const n of [...notes, { beatIdx: Infinity }]) {
      if (n.beatIdx - prevBeat > D.fillGap) {
        const end = Math.min(n.beatIdx, g1 / 2);
        for (let b = Math.ceil(prevBeat + 2); b <= end - 2; b++) {
          if (mod4(b) % 2 !== 0) continue;
          const t = map.timeOf(b);
          if (t < startT) continue;
          if ((A.loud[Math.round(t * fr)] || 0) < 0.25) continue;
          filled.push({ t, beatIdx: b, isDown: mod4(b) === 0, type: 'orb' });
        }
      }
      if (n.beatIdx !== Infinity) filled.push(n);
      prevBeat = n.beatIdx;
    }
    filled.sort((a, b) => a.t - b.t);
    // Lücken-Füller dürfen nicht zu nah an echten Noten liegen
    const final = [];
    for (const n of filled) {
      const last = final[final.length - 1];
      if (last && n.beatIdx - last.beatIdx < 0.5 - 1e-6) continue;
      final.push(n);
    }

    // Sprungdauer = halber lokaler Beat, damit Achtel-Folgen spielbar bleiben
    const beatLen = bi => map.timeOf(bi + 1) - map.timeOf(bi);
    for (const n of final) n.J = beatLen(n.beatIdx) * 0.5;
    const loudAt = t => A.loud[Math.round(t * fr)] || 0;

    // Drops: Takte, in denen die Lautheit gegenüber den zwei Takten davor deutlich anspringt
    const barLoud = bi => {
      const f0 = Math.round(map.timeOf(bi) * fr), f1 = Math.round(map.timeOf(bi + 4) * fr);
      let sum = 0, k = 0;
      for (let f = Math.max(0, f0); f < Math.min(A.loud.length, f1); f++) { sum += A.loud[f]; k++; }
      return k ? sum / k : 0;
    };
    const dropInfo = [];
    let lastDrop = -Infinity;
    for (let bi = downbeat + 8; map.timeOf(bi + 4) < A.duration - 2; bi += 4) {
      const now = barLoud(bi), before = (barLoud(bi - 8) + barLoud(bi - 4)) / 2;
      if (now > 0.7 && now - before > 0.2 && bi - lastDrop >= 32 && map.timeOf(bi) > 8) {
        dropInfo.push({ t: map.timeOf(bi), b: bi, strength: now - before });
        lastDrop = bi;
      }
    }
    const drops = dropInfo.map(d => d.t);

    // ---------- Action ----------
    // Endgegner "Bass-Kern": 8 Takte ab dem stärksten Drop
    let boss = null;
    if (dropInfo.length) {
      const big = dropInfo.reduce((x, d) => (d.strength > x.strength ? d : x));
      const end = Math.min(map.timeOf(big.b + 32), A.duration - 2);
      if (end - big.t > 8) boss = { t0: big.t, t1: end, b0: big.b };
    }
    const inBoss = t => !!boss && t >= boss.t0 - 0.01 && t <= boss.t1;

    // Schwerkraft-Umkehr: zweite Hälfte der 8 Takte nach jedem anderen Drop
    const flips = [];
    for (const d of dropInfo) {
      if (boss && d.b === boss.b0) continue;
      const t0 = map.timeOf(d.b + 16), t1 = map.timeOf(d.b + 32);
      if (t1 < A.duration - 2) flips.push({ t0, t1 });
    }

    // ---------- Ebenen: Treppen aus Blöcken ----------
    // Jede Note einer Folge springt eine Ebene höher oder tiefer; oben liegen weiter Spikes und Orbs.
    // Die Stufenkante liegt kurz vor der Landung (85 % der Sprungdauer) – so reicht auch ein ungenauer Sprung.
    const LEVEL = 0.75;               // Höhe einer Ebene in Sprunghöhen
    const terrain = [];
    let lastTerrain = -Infinity;
    for (let i = 0; i < final.length; i++) {
      const n = final[i];
      if (!Number.isInteger(n.beatIdx) || n.t < 8 || inBoss(n.t) || n.beatIdx - lastTerrain < 12) continue;
      if (loudAt(n.t) < 0.35 || rng() > 0.2 * D.action) continue;
      const seq = [n];
      for (let j = i + 1; j < final.length && seq.length < 10; j++) {
        const m = final[j];
        if (m.beatIdx - seq[seq.length - 1].beatIdx < 1 - 1e-6 || m.beatIdx - n.beatIdx > 14 || inBoss(m.t)) break;
        seq.push(m);
      }
      if (seq.length < 4) continue;
      const K = seq.length, maxLv = K >= 6 && rng() < 0.65 ? 2 : 1, pyramid = rng() < 0.6;
      // Pyramide: rauf – oben laufen – runter; sonst: rauf und am Ende in die Tiefe springen
      const lv = seq.map((_, k) => (k === K - 1 ? 0 : pyramid ? Math.min(maxLv, k + 1, K - 1 - k) : Math.min(maxLv, k + 1)));
      let prevLv = 0;
      seq.forEach((m, k) => {
        m.onTerrain = true;
        m.fromLv = prevLv;
        m.toLv = lv[k];
        if (lv[k] !== prevLv) m.type = 'step';     // Stufen-Sprung: kein Hindernis, nur Absprung
        prevLv = lv[k];
      });
      const edge = m => m.t + 0.85 * m.J;
      for (let k = 0; k < K - 1; k++) {
        if (lv[k] > 0) terrain.push({ t0: edge(seq[k]), t1: edge(seq[k + 1]), h: lv[k] * LEVEL });
      }
      lastTerrain = seq[K - 1].beatIdx;
      i = final.indexOf(seq[K - 1]);
    }
    // Aneinandergrenzende Blöcke gleicher Höhe zusammenfassen
    terrain.sort((x, y) => x.t0 - y.t0);
    for (let k = terrain.length - 1; k > 0; k--) {
      const a0 = terrain[k - 1], b0 = terrain[k];
      if (Math.abs(a0.t1 - b0.t0) < 1e-6 && a0.h === b0.h) { a0.t1 = b0.t1; terrain.splice(k, 1); }
    }

    // Gleitschienen, Doppelsprung-Türme und Bass-Geschosse
    const extra = [];
    let lastSpecial = -Infinity, lastShot = -Infinity;
    for (let i = 0; i + 1 < final.length; i++) {
      const n = final[i], gap = final[i + 1].beatIdx - n.beatIdx, loud = loudAt(n.t);
      if (inBoss(n.t)) { if (n.type === 'orb') n.type = 'shot'; continue; }
      if (n.onTerrain) continue;
      const onBeat = Number.isInteger(n.beatIdx), free = n.beatIdx - lastSpecial >= 8 && n.t > 6;
      // Eine Gleitschiene darf einfache Orbs der nächsten 3 Beats "überfahren" – sie gehen in der Schiene auf
      let railEnd = i + 1;
      while (railEnd < final.length && final[railEnd].beatIdx < n.beatIdx + 3 &&
             final[railEnd].type === 'orb' && !final[railEnd].power && !final[railEnd].onTerrain) railEnd++;
      const railGap = railEnd < final.length ? final[railEnd].beatIdx - n.beatIdx : 0;
      if (free && onBeat && railGap >= 3 && loud > 0.45 && rng() < 0.35 * D.action) {
        // Gleitschiene: auf dem Beat drücken, halten, auf dem Ziel-Beat loslassen – darunter Spikes
        final.splice(i + 1, railEnd - i - 1);
        const len = Math.min(3, Math.floor(railGap - 1));
        n.type = 'hold';
        n.holdEnd = map.timeOf(n.beatIdx + len);
        n.rail = [];
        for (let k = 0.5; k <= len - 0.5 + 1e-6; k += 0.5) n.rail.push(map.timeOf(n.beatIdx + k));
        lastSpecial = n.beatIdx;
      } else if (free && onBeat && gap >= 2.5 && loud > 0.4 && rng() < 0.3 * D.action) {
        // Sprungfeder -> Luft-Orb im höchsten Punkt (Achtel) -> hoher Spike-Turm
        n.type = 'launch';
        n.J = beatLen(n.beatIdx);
        extra.push({
          t: map.timeOf(n.beatIdx + 0.5), beatIdx: n.beatIdx + 0.5, isDown: false, type: 'air',
          J: beatLen(n.beatIdx) * 0.9, towerT: map.timeOf(n.beatIdx + 0.85),
        });
        lastSpecial = n.beatIdx;
      } else if (n.type === 'orb' && loud > 0.55 && n.beatIdx - lastShot >= 4 && rng() < 0.22 * D.action) {
        n.type = 'shot';
        lastShot = n.beatIdx;
      }
    }
    if (boss) {
      // Der Bass-Kern soll ordentlich feuern: mindestens 8 Geschosse
      const inside = final.filter(n => inBoss(n.t));
      let shots = inside.filter(n => n.type === 'shot').length;
      for (let k = 0; k < inside.length && shots < 8; k += 2) {
        if (inside[k].type === 'spike') { inside[k].type = 'shot'; shots++; }
      }
    }
    final.push(...extra);
    final.sort((x, y) => x.t - y.t);

    // Decken in Pausen: hier darf man NICHT springen (nicht an Schienen, Sprungfedern oder beim Endgegner)
    const special = n => n.type === 'hold' || n.type === 'launch' || n.type === 'air';
    const ceilings = [];
    for (let i = 0; i + 1 < final.length; i++) {
      const x = final[i], y = final[i + 1];
      const gapBeats = y.beatIdx - x.beatIdx;
      if (special(x) || special(y) || x.onTerrain || y.onTerrain || inBoss(x.t) || gapBeats < 2.25 || rng() > D.ceilProb) continue;
      const lb = x.J * 2;
      const t0 = x.t + x.J + lb * 0.25, t1 = y.t - lb * 0.5;
      if (t1 - t0 >= lb * 0.99) ceilings.push({ t0, t1 });
    }

    // Checkpoints alle 8 Takte (für den Übungsmodus)
    const checkpoints = [];
    for (let b = downbeat + 32; map.timeOf(b) < A.duration - 6; b += 32) checkpoints.push(map.timeOf(b));

    // Power-ups: ungefähr jede 20. Note trägt eins (bevorzugt Orbs)
    const POWERS = [['recruit', 30], ['shield', 20], ['heart', 15], ['double', 20], ['groove', 15]];
    const pickPower = () => {
      let r = rng() * 100;
      for (const [type, w] of POWERS) { if ((r -= w) < 0) return type; }
      return 'recruit';
    };
    for (let i = 10 + Math.floor(rng() * 8); i < final.length; i += 14 + Math.floor(rng() * 12)) {
      const j = final[i].type === 'spike' && final[i + 1] && final[i + 1].type === 'orb' ? i + 1 : i;
      final[j].power = pickPower();
    }

    final.forEach((n, i) => { n.id = i; });
    return { map, bpm: map.bpm, beat, downbeat, notes: final, ceilings, checkpoints, drops, boss, flips, terrain, duration: A.duration,
      env: A.env, envFr: A.fr };
  }

  window.Analysis = { analyze, rescale, makeChart };
})();
