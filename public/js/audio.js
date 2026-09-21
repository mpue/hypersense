// Audio-Engine: Wiedergabe, latenzkompensierte Song-Uhr (aus Rhytmicker) und synthetisierte Effekte.
//
// Zwei getrennte Effekt-Busse:
//   enemyBus  – alles, was die Gegner tun. Diese Klänge werden auf Songzeitpunkte terminiert
//               (atSong(t)), sie liegen also sample-genau auf dem Beat und gehören zur Musik.
//   playerBus – der Spieler. Klingt sofort, unabhängig vom Takt.
(function () {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.src = null;
      this.songStart = 0;      // Kontextzeit, zu der Songsekunde 0 erklingt
      this.offsetMs = 0;       // Latenz-Kalibrierung
      this._anchor = null;
      this.samples = {};
      this.sampleMeta = {};
      this._round = {};
    }

    ensure() {
      if (!this.ctx) {
        const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        // Master mit Limiter: große Explosionen dürfen laut sein, aber nicht übersteuern
        this.master = ctx.createGain();
        this.master.gain.value = 0.9;
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -2;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.001;
        this.limiter.release.value = 0.15;
        this.master.connect(this.limiter);
        this.limiter.connect(ctx.destination);

        // Musikpfad: Gain -> Ducking (Explosionen drücken die Musik kurz weg) -> Tiefpass -> Master
        this.musicGain = ctx.createGain();
        this.duckGain = ctx.createGain();
        this.lowpass = ctx.createBiquadFilter();
        this.lowpass.type = 'lowpass';
        this.lowpass.frequency.value = 20000;
        this.musicGain.connect(this.duckGain);
        this.duckGain.connect(this.lowpass);
        this.lowpass.connect(this.master);

        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.3;
        this.musicGain.connect(this.analyser);
        this.freq = new Uint8Array(this.analyser.frequencyBinCount);
        this.bandPeak = [0.05, 0.05, 0.05];
        this.bandFloor = [0, 0, 0];

        // Effekte über einen Kompressor: macht die Explosionen dicht und druckvoll
        this.sfxComp = ctx.createDynamicsCompressor();
        this.sfxComp.threshold.value = -18;
        this.sfxComp.knee.value = 6;
        this.sfxComp.ratio.value = 4;
        this.sfxComp.attack.value = 0.004;   // Anschlag durchlassen
        this.sfxComp.release.value = 0.2;
        this.sfxOut = ctx.createGain();
        this.sfxOut.gain.value = 1.6;        // Aufholverstärkung
        this.sfxComp.connect(this.sfxOut);
        this.sfxOut.connect(this.master);

        this.enemyBus = ctx.createGain();
        this.enemyBus.gain.value = 0.55;
        this.enemyBus.connect(this.sfxComp);
        this.playerBus = ctx.createGain();
        this.playerBus.gain.value = 0.4;
        this.playerBus.connect(this.sfxComp);
        this.noise = this._makeNoise();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    decode(arrayBuffer) {
      return this.ensure().decodeAudioData(arrayBuffer);
    }

    // Explosions-Samples (public/sfx, gebaut von tools/make_sfx.py). Fehlen sie, bleibt es beim Synth.
    async loadSamples(base = 'sfx/') {
      try {
        const meta = await fetch(base + 'sfx.json').then(r => r.json());
        await Promise.all(Object.entries(meta).map(async ([name, m]) => {
          const data = await fetch(base + m.file).then(r => r.arrayBuffer());
          this.samples[name] = await this.decode(data);
          this.sampleMeta[name] = m;
        }));
      } catch (e) {
        console.warn('SFX samples not loaded', e);
      }
    }

    // ---------- Uhr ----------

    _outputTime(perfNow) {
      const ctx = this.ctx;
      const fallback = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      if (ctx.state !== 'running') return fallback;
      if (ctx.getOutputTimestamp) {
        const ts = ctx.getOutputTimestamp();
        const age = perfNow - (ts && ts.performanceTime);
        if (ts && ts.performanceTime > 0 && age > -50 && age < 100) return ts.contextTime + age / 1000;
      }
      return fallback;
    }

    // Geglättete Uhr: läuft mit performance.now(), wird sanft auf die Audio-Uhr nachgeführt.
    outputTime(perfNow = performance.now()) {
      const raw = this._outputTime(perfNow);
      if (!this._anchor || this.ctx.state !== 'running') {
        this._anchor = { ctx: raw, perf: perfNow };
        return raw;
      }
      const est = this._anchor.ctx + (perfNow - this._anchor.perf) / 1000;
      const err = raw - est;
      if (Math.abs(err) > 0.04) { this._anchor = { ctx: raw, perf: perfNow }; return raw; }
      this._anchor.ctx += err * 0.05;
      return est + err * 0.05;
    }

    // Songzeit in Sekunden, wie der Spieler sie gerade hört.
    songTime(perfNow) {
      return this.outputTime(perfNow) - this.songStart - this.offsetMs / 1000;
    }

    // Kontextzeit, zu der Songsekunde t erklingt – dorthin werden Gegner-Klänge gelegt.
    atSong(t) {
      return Math.max(this.ctx.currentTime, this.songStart + t);
    }

    // ---------- Wiedergabe ----------

    play(buffer, fromSec = 0, delay = 0.15) {
      this.stop();
      const ctx = this.ensure();
      const src = this.src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.musicGain);
      this.musicGain.gain.cancelScheduledValues(ctx.currentTime);
      this.musicGain.gain.setValueAtTime(1, ctx.currentTime);
      const startAt = ctx.currentTime + delay;
      if (fromSec >= 0) src.start(startAt, fromSec);
      else src.start(startAt - fromSec, 0);          // negativer Start = Vorlauf vor Songbeginn
      this.songStart = startAt - fromSec;
      this._anchor = null;
      return src;
    }

    stop() {
      if (this.src) {
        try { this.src.stop(); } catch (e) { /* schon gestoppt */ }
        this.src.disconnect();
        this.src = null;
      }
    }

    fadeOut(sec) {
      if (!this.src) return;
      const t = this.ctx.currentTime, g = this.musicGain.gain, src = this.src;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + sec);
      setTimeout(() => { if (this.src === src) this.stop(); }, sec * 1000 + 50);
    }

    // Musik dumpf filtern (Tod, Pause-Übergänge) oder wieder öffnen
    muffle(on, sec = 0.25) {
      if (!this.ctx) return;
      this.lowpass.frequency.setTargetAtTime(on ? 500 : 20000, this.ctx.currentTime, sec);
    }

    pause() { if (this.ctx && this.ctx.state === 'running') return this.ctx.suspend(); }
    resume() { this._anchor = null; if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume(); }

    // Energie in Bass / Mitten / Höhen, 0..1, automatisch auf den Song eingepegelt
    levels() {
      if (!this.analyser || !this.src || this.ctx.state !== 'running') return [0, 0, 0];
      this.analyser.getByteFrequencyData(this.freq);
      const hz = this.ctx.sampleRate / this.analyser.fftSize;
      const bands = [[40, 180], [250, 2500], [3000, 10000]];
      return bands.map(([a, b], k) => {
        const i0 = Math.max(1, Math.round(a / hz)), i1 = Math.round(b / hz);
        let s = 0;
        for (let i = i0; i <= i1; i++) s += this.freq[i];
        const v = s / ((i1 - i0 + 1) * 255);
        const fl = this.bandFloor[k] = v < this.bandFloor[k] ? v : this.bandFloor[k] + (v - this.bandFloor[k]) * 0.01;
        const pk = this.bandPeak[k] = Math.max(v, fl + 0.03, this.bandPeak[k] * 0.998);
        return Math.min(1, Math.max(0, (v - fl) / (pk - fl)));
      });
    }

    // ---------- Bausteine ----------

    _makeNoise() {
      const len = this.ctx.sampleRate;
      const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    _tone(bus, freq, dur, type, vol, when, slideTo) {
      const ctx = this.ctx, t = when ?? ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus);
      o.start(t); o.stop(t + dur + 0.02);
    }

    _noise(bus, dur, freq, vol, when, type = 'bandpass', q = 1.2, sweepTo) {
      const ctx = this.ctx, t = when ?? ctx.currentTime;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = this.noise;
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(bus);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    }

    // Sample abspielen. Liegt "when" schon in der Vergangenheit, wird entsprechend weiter hinten eingestiegen.
    _sample(bus, name, when, gain = 1, rate = 1) {
      const buf = this.samples[name];
      if (!buf) return false;
      const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = buf;
      s.playbackRate.value = rate;
      g.gain.value = gain;
      s.connect(g); g.connect(bus);
      const late = ctx.currentTime - when;
      if (late > 0) { if (late * rate >= buf.duration) return false; s.start(ctx.currentTime, late * rate); }
      else s.start(when);
      return true;
    }

    // Reihum eines von mehreren Varianten-Samples (small1..3), leicht verstimmt gegen Monotonie
    _variant(bus, base, n, when, gain) {
      const i = this._round[base] = ((this._round[base] || 0) + 1) % n;
      return this._sample(bus, base + (i + 1), when, gain, 0.92 + Math.random() * 0.16);
    }

    // Musik kurz wegdrücken – lässt Explosionen größer wirken
    duck(when, depth, dur) {
      const g = this.duckGain.gain, t = Math.max(this.ctx.currentTime, when);
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1 - depth, t, 0.01);
      g.setTargetAtTime(1, t + 0.05, dur / 3);
    }

    // Harter Anschlag + Sub-Stoß, über das Sample gelegt: der "Punch" im Arcade-Sinn
    _punch(bus, when, size) {
      this._noise(bus, 0.05 + 0.03 * size, 2400, 0.35 + 0.1 * size, when, 'highpass', 0.7);
      this._tone(bus, 95 + 20 / size, 0.18 + 0.12 * size, 'sine', 0.55 + 0.15 * size, when, 32);
    }

    // ---------- Gegner (auf Songzeit terminiert) ----------

    // Gegnerschuss auf einer Note. strong = betonte Note (Spike/Downbeat)
    enemyShot(songT, strong) {
      if (!this.ctx) return;
      const t = this.atSong(songT);
      if (strong) {
        this._tone(this.enemyBus, 880, 0.09, 'square', 0.10, t, 220);
        this._noise(this.enemyBus, 0.06, 3500, 0.10, t);
      } else {
        this._tone(this.enemyBus, 1320, 0.05, 'triangle', 0.10, t, 660);
      }
    }
    // Explosion eines Gegners – quantisiert auf die nächste Sechzehntel (der Aufrufer rechnet den Zeitpunkt aus)
    // size: 1 = klein, 1.2–2.4 = mittel, ab 2.5 = groß. rock = Asteroid (mit Geröll-Schicht)
    enemyBoom(songT, size, rock = false) {
      if (!this.ctx) return;
      const t = this.atSong(songT), bus = this.enemyBus;
      let ok;
      if (size < 1.2) ok = this._variant(bus, 'small', 3, t, 0.9);
      else if (size < 2.5) { ok = this._variant(bus, 'medium', 3, t, 1); this.duck(t, 0.25, 0.35); }
      else { ok = this._sample(bus, 'big' + (1 + Math.floor(Math.random() * 2)), t, 1); this.duck(t, 0.45, 0.8); }
      if (rock) this._sample(bus, 'debris', t, 0.7, 0.9 + Math.random() * 0.2);
      if (ok) this._punch(bus, t, Math.min(size, 3));
      else {                                   // ohne Samples: Synth
        this._noise(bus, size > 1 ? 0.7 : 0.28, size > 1 ? 900 : 1600, size > 1 ? 0.55 : 0.32, t, 'lowpass', 0.7, 120);
        this._tone(bus, size > 1 ? 120 : 190, size > 1 ? 0.5 : 0.18, 'sine', size > 1 ? 0.5 : 0.3, t, 40);
      }
    }
    beamWarn(songT) {
      if (!this.ctx) return;
      this._tone(this.enemyBus, 440, 0.12, 'sawtooth', 0.06, this.atSong(songT), 880);
    }
    beamFire(songT, dur) {
      if (!this.ctx) return;
      const t = this.atSong(songT);
      this._noise(this.enemyBus, dur, 2500, 0.28, t, 'bandpass', 3, 600);
      this._tone(this.enemyBus, 110, dur, 'sawtooth', 0.14, t, 55);
    }
    bossAlarm(songT) {
      if (!this.ctx) return;
      const t = this.atSong(songT);
      for (let k = 0; k < 4; k++) this._tone(this.enemyBus, k % 2 ? 440 : 330, 0.2, 'square', 0.12, t + k * 0.22);
    }
    // Der Whoosh läuft vorher an, sein Höhepunkt und die Riesenexplosion fallen genau auf songT
    bossDown(songT) {
      if (!this.ctx) return;
      const t = this.atSong(songT), bus = this.enemyBus;
      const pk = this.sampleMeta.whoosh ? this.sampleMeta.whoosh.peak : 0;
      this._sample(bus, 'whoosh', t - pk, 0.9);
      if (this._sample(bus, 'huge', t, 1.2)) {
        this._sample(bus, 'big1', t + 0.45, 0.7, 0.85);
        this._punch(bus, t, 3);
        this.duck(t, 0.6, 1.8);
      } else {
        this._noise(bus, 2.2, 1200, 0.7, t, 'lowpass', 0.7, 60);
        this._tone(bus, 90, 1.8, 'sine', 0.6, t, 30);
      }
    }

    // ---------- Spieler (sofort) ----------

    // Schuss mit Körper: heller Anriss + kurzer tiefer Stoß, mit der Waffenstufe mehr Druck
    playerShot(level = 1) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._noise(this.playerBus, 0.04, 5000, 0.08 + 0.01 * level, t, 'highpass', 0.7);
      this._tone(this.playerBus, 190 + 10 * level, 0.05, 'square', 0.035 + 0.008 * level, t, 70);
    }
    missile() {
      if (this.ctx) this._noise(this.playerBus, 0.3, 700, 0.14, undefined, 'bandpass', 1.5, 3500);
    }
    shieldHit() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._tone(this.playerBus, 1800, 0.35, 'sine', 0.3, t, 300);
      this._noise(this.playerBus, 0.3, 3000, 0.3, t, 'bandpass', 2, 600);
    }
    playerDie() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      if (this._sample(this.playerBus, 'big2', t, 1.3)) this._punch(this.playerBus, t, 3);
      else this._noise(this.playerBus, 1.1, 1500, 0.8, t, 'lowpass', 0.8, 80);
      this._tone(this.playerBus, 300, 0.9, 'sawtooth', 0.25, t, 40);
      this.duck(t, 0.5, 1.2);
    }
    droneLost() {
      if (this.ctx) this._variant(this.playerBus, 'small', 3, this.ctx.currentTime, 0.9);
    }
    // Jedes Power-up hat seine eigene kleine Tonfolge
    powerup(type = 'W') {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const seq = { W: [0, 4, 7, 12], S: [0, 7, 12, 19], E: [0, 5, 9, 12], M: [12, 7, 12, 19], R: [0, 12, 0, 12, 24],
        X: [0, 3, 7, 10, 15], L: [0, 4, 7, 12, 16, 19, 24] }[type] || [0, 4, 7, 12];
      const wave = type === 'M' || type === 'R' ? 'square' : 'triangle';
      seq.forEach((s, i) => this._tone(this.playerBus, 523 * Math.pow(2, s / 12), 0.12, wave, 0.28, t + i * 0.05));
    }
    hyper() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this._noise(this.playerBus, 1.6, 300, 0.6, t, 'bandpass', 2, 7000);
      this._tone(this.playerBus, 55, 1.6, 'sawtooth', 0.35, t, 110);
    }
    droneToggle() {
      if (this.ctx) this._tone(this.playerBus, 1200, 0.08, 'square', 0.12, undefined, 1800);
    }
    droneBlock() {
      if (this.ctx) this._tone(this.playerBus, 2400, 0.06, 'sine', 0.15, undefined, 1200);
    }
  }

  window.AudioEngine = AudioEngine;
})();
