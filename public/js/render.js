// Hypersense – Darstellung auf einem 1920×1080-Canvas.
(function () {
  'use strict';

  const W = 1920, H = 1080;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const FONT = '"Orbitron", "Segoe UI", sans-serif';

  // Weich leuchtender Punkt als vorgerendertes Bild (für Geschosse, Mündungsfeuer, Explosionen ohne Sprite)
  function glow(color, r, core = 0.25) {
    const c = document.createElement('canvas');
    c.width = c.height = r * 2;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(core, color);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, r * 2, r * 2);
    return c;
  }

  // Einfarbige Silhouette eines Sprites (Treffer-Blitz, dunkle Vordergrund-Felsen)
  function tinted(img, color, alpha = 1) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  class Renderer {
    constructor(canvas, images) {
      this.cv = canvas;
      // Deckende Zeichenfläche: der Browser muss nichts dahinter durchscheinen lassen
      this.c = canvas.getContext('2d', { alpha: false });
      this.quality = 'high';          // 'low' spart Vollbild-Ebenen und Leuchteffekte
      this.textCache = new Map();
      // Schattierung des Rumpfs zur Tiefe hin, einmal vorgerendert und gestreckt gezeichnet
      this.shade = document.createElement('canvas');
      this.shade.width = 4; this.shade.height = 160;
      {
        const s = this.shade.getContext('2d'), gr = s.createLinearGradient(0, 0, 0, 160);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,8,0.55)');
        s.fillStyle = gr; s.fillRect(0, 0, 4, 160);
      }
      this.img = images;
      this.white = {};
      for (const [k, im] of Object.entries(images)) if (im) this.white[k] = tinted(im, '#ffffff', 0.5);
      this.darkRock = images.asteroid ? tinted(images.asteroid, '#04050a', 0.85) : null;
      this.glows = {
        violet: glow('#b36bff', 32), pink: glow('#ff5ad2', 36), orange: glow('#ff9a3c', 32),
        blue: glow('#5ab8ff', 48), green: glow('#7dff6a', 24), white: glow('#ffffff', 32, 0.5),
        fire: glow('#ff8a2a', 64, 0.15),
      };
      // Dunkler Hof hinter Gegnern: hebt sie vom hellen Schussfeuer ab
      this.halo = document.createElement('canvas');
      this.halo.width = this.halo.height = 64;
      {
        const h = this.halo.getContext('2d'), gr = h.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(0,0,6,0.85)'); gr.addColorStop(0.6, 'rgba(0,0,6,0.5)'); gr.addColorStop(1, 'rgba(0,0,6,0)');
        h.fillStyle = gr; h.fillRect(0, 0, 64, 64);
      }
      const rnd = (a, b) => a + Math.random() * (b - a);
      this.stars = [0.12, 0.3, 0.7].map((sp, l) => Array.from({ length: [260, 140, 60][l] }, () => ({
        x: rnd(0, W), y: rnd(0, H), b: rnd(0.3, 1), sp, s: [1, 1.6, 2.4][l], tw: rnd(0, TAU) })));
      this.decor = Array.from({ length: 5 }, (_, i) => ({ x: rnd(0, W + 800), y: i % 2 ? rnd(990, 1100) : rnd(-90, 20),
        s: rnd(150, 320), rot: rnd(0, TAU), spin: rnd(-0.2, 0.2), sp: rnd(1.4, 2.2) }));
      this.bgX = 0;
      this.warp = 0;
    }

    spr(name, x, y, h, o = {}) {
      const im = this.img[name];
      if (!im) return false;
      const w = h * im.width / im.height, c = this.c;
      c.save();
      c.translate(x, y);
      if (o.rot) c.rotate(o.rot);
      if (o.flip || o.flipY) c.scale(o.flip ? -1 : 1, o.flipY ? -1 : 1);
      if (o.alpha !== undefined) c.globalAlpha = o.alpha;
      if (o.add) c.globalCompositeOperation = 'lighter';
      c.drawImage(im, -w / 2, -h / 2, w, h);
      // Treffer: nur ein heller Schimmer über dem Sprite, Details und Farben bleiben sichtbar
      if (o.flash && this.white[name]) {
        c.globalAlpha = 0.45 * (o.alpha ?? 1);
        c.drawImage(this.white[name], -w / 2, -h / 2, w, h);
      }
      c.restore();
      return true;
    }

    // Leuchtender Text aus dem Cache: shadowBlur ist teuer, also nur einmal pro Text rendern
    glowText(text, font, color, glow, blur, x, y, align = 'center') {
      const key = text + '|' + font + '|' + color + '|' + blur;
      let e = this.textCache.get(key);
      if (!e) {
        if (this.textCache.size > 300) this.textCache.clear();
        const m = document.createElement('canvas').getContext('2d');
        m.font = font;
        const w = Math.ceil(m.measureText(text).width) + blur * 4, size = parseInt(font.match(/(\d+)px/)[1], 10);
        const h = Math.ceil(size * 1.4) + blur * 4;
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, w); cv.height = h;
        const g = cv.getContext('2d');
        g.font = font;
        g.textBaseline = 'alphabetic';
        g.fillStyle = color;
        if (blur) { g.shadowColor = glow; g.shadowBlur = blur; }
        g.fillText(text, blur * 2, blur * 2 + size);
        e = { cv, ox: blur * 2, oy: blur * 2 + size, w: w - blur * 4 };
        this.textCache.set(key, e);
      }
      const ax = align === 'center' ? e.w / 2 : align === 'right' ? e.w : 0;
      this.c.drawImage(e.cv, Math.round(x - ax - e.ox), Math.round(y - e.oy));
    }

    // Rahmen einer HUD-Leiste mit Leuchten, einmal vorgerendert
    gaugeFrame(w) {
      if (this.gf) return this.gf;
      const cv = document.createElement('canvas');
      cv.width = w + 100; cv.height = 120;
      const c = cv.getContext('2d');
      c.translate(60, 10);
      c.strokeStyle = '#8fe0ff';
      c.lineWidth = 3;
      c.shadowColor = '#3fb4ff';
      c.shadowBlur = 12;
      c.beginPath();
      c.moveTo(0, 40); c.lineTo(w - 60, 40); c.lineTo(w - 36, 16); c.lineTo(w, 16); c.lineTo(w, 72);
      c.lineTo(w - 36, 72); c.lineTo(w - 60, 60); c.lineTo(40, 60); c.lineTo(20, 76); c.lineTo(-40, 76);
      c.stroke();
      return (this.gf = cv);
    }

    dot(g, x, y, r, alpha = 1) {
      const c = this.c;
      c.globalAlpha = alpha;
      c.drawImage(g, x - r, y - r, r * 2, r * 2);
      c.globalAlpha = 1;
    }

    // ------------------------------------------------------------------ Bild

    frame(dt, g, st) {
      const c = this.c;
      c.setTransform(1, 0, 0, 1, 0, 0);
      const drop = g && g.L.dropBeats.some(d => st.beat >= d && st.beat < d + 8);
      this.warp += ((drop || st.mode === 'title' ? 1 : 0) - this.warp) * Math.min(1, dt * 2);
      // Hintergrund an das Welt-Scrollen gekoppelt (Pixel pro Beat × Tempo), Parallaxe über die Ebenen
      const world = g ? g.L.PX_PER_BEAT * g.L.bpm / 60 : 250;
      const speed = world * 0.3 * (1 + 3 * this.warp);
      this.bgX += speed * dt;

      if (g && g.shake > 0) c.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
      this.background(dt, speed, st);
      if (g) this.world(g, st);
      c.setTransform(1, 0, 0, 1, 0, 0);
      this.foreground(dt, speed);
      if (g && g.flash > 0) {
        c.fillStyle = `rgba(200,230,255,${g.flash * 0.55})`;
        c.fillRect(0, 0, W, H);
      }
      this.vignette();
      if (g && st.mode !== 'title') this.hud(g, st);
      if (g && g.banner) this.banner(g, st);
    }

    background(dt, speed, st) {
      const c = this.c, lv = st.levels || [0, 0, 0];
      c.fillStyle = '#02030a';
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      // Nebel und Galaxie wandern langsam durchs Bild (additiv auf Schwarz)
      const neb = this.quality === 'high' && this.img.nebula;
      if (neb) {
        const nw = 2600, nh = nw * neb.height / neb.width, span = nw + W;
        const x = W - ((this.bgX * 0.08) % span);
        c.globalAlpha = 0.55 + 0.25 * lv[1];
        c.drawImage(neb, x, H / 2 - nh / 2, nw, nh);
      }
      const gal = this.img.galaxy;
      if (gal) {
        const gw = 900, span = gw + W + 600;
        const x = W + 300 - ((this.bgX * 0.05 + 700) % span);
        c.globalAlpha = 0.85 + 0.15 * lv[0];
        c.drawImage(gal, x, 60, gw, gw * gal.height / gal.width);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      // Gasriese links, groß und fast statisch – der Sturmwirbel bleibt im Bild
      const pl = this.img.planet;
      if (pl) {
        const pw = 1500, x = -330 - ((this.bgX * 0.008) % 2600);
        c.drawImage(pl, x, 60, pw, pw * pl.height / pl.width);
      } else {
        const gr = c.createRadialGradient(-100, 1400, 500, -100, 1400, 1000);
        gr.addColorStop(0, '#0a1a38'); gr.addColorStop(0.92, '#0d2a5e'); gr.addColorStop(1, 'rgba(60,140,255,0)');
        c.fillStyle = gr;
        c.beginPath(); c.arc(-100, 1400, 1000, 0, TAU); c.fill();
      }
      // Sterne, bei Drops als Warp-Streifen
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = '#c8dcff';
      const t = performance.now() / 1000, streak = this.warp, bright = 0.7 + 0.5 * lv[2];
      for (const layer of this.stars) {
        for (const s of layer) {
          s.x -= speed * s.sp * dt;
          if (s.x < -60) { s.x += W + 120; s.y = Math.random() * H; }
          c.globalAlpha = clamp(s.b * (0.6 + 0.4 * Math.sin(t * 2 + s.tw)) * bright, 0, 1);
          c.fillRect(s.x, s.y, s.s + streak * speed * s.sp * 0.08, s.s);
        }
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }

    foreground(dt, speed) {
      if (!this.darkRock || this.quality !== 'high') return;
      const c = this.c;
      for (const d of this.decor) {
        d.x -= speed * d.sp * dt;
        d.rot += d.spin * dt;
        if (d.x < -d.s) { d.x = W + d.s + Math.random() * 1200; d.y = Math.random() < 0.5 ? 990 + Math.random() * 110 : -90 + Math.random() * 110; }
        c.save();
        c.translate(d.x, d.y);
        c.rotate(d.rot);
        c.globalAlpha = 0.9;
        c.drawImage(this.darkRock, -d.s / 2, -d.s / 2, d.s, d.s * this.darkRock.height / this.darkRock.width);
        c.restore();
      }
    }

    vignette() {
      const c = this.c;
      if (this.quality !== 'high') return;
      if (!this.vig) {
        const v = document.createElement('canvas');
        v.width = W; v.height = H;
        const g = v.getContext('2d');
        const gr = g.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(0,0,0,0.6)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        this.vig = v;
      }
      c.drawImage(this.vig, 0, 0);
    }

    // Rumpf der Raumstation. Jedes Modul wird beim ersten Erscheinen einmal fertig gerendert
    // (Textur, Schattierung, Stufenkante, Rohr-Streifen, Leuchtlinie) und danach nur noch als ein
    // Bild gezeichnet. Großflächige Muster-Füllungen pro Frame waren auf der GPU zu teuer.
    hull(g) {
      if (!g.hull.length) return;
      if (!this.hullCache) this.hullCache = new Map();
      const F = g.L.FLOOR_Y, seen = new Set();
      for (const m of g.hull) {
        const key = m.wx + (m.top ? 't' : 'b');
        seen.add(key);
        let b = this.hullCache.get(key);
        if (!b) { b = this.bakeHull(m, F); this.hullCache.set(key, b); }
        this.c.drawImage(b.cv, Math.round(m.sx), b.y0);
      }
      // Module, die links hinausgescrollt sind, vergessen
      if (this.hullCache.size > seen.size + 8) for (const k of this.hullCache.keys()) if (!seen.has(k)) this.hullCache.delete(k);
    }

    bakeHull(m, F) {
      const top = m.top, y0 = top ? 0 : F - m.h - 24, y1 = top ? m.h + 24 : H;
      const cv = document.createElement('canvas');
      cv.width = m.w + 1; cv.height = y1 - y0;
      const c = cv.getContext('2d');
      const edge = top ? m.h - y0 : F - m.h - y0;            // Kante in lokalen Koordinaten
      const b0 = top ? 0 : edge, b1 = top ? edge : cv.height;
      // Textur in Welt-Ausrichtung kacheln (sie scrollt mit dem Modul)
      const tex = this.img['hulltex' + (m.v % 2 + 1)];
      c.save();
      c.beginPath(); c.rect(0, b0, cv.width, b1 - b0); c.clip();
      if (tex) {
        for (let x = -(m.wx % tex.width); x < cv.width; x += tex.width) {
          for (let y = -(y0 % tex.height) - tex.height; y < cv.height; y += tex.height) c.drawImage(tex, x, y);
        }
      } else { c.fillStyle = '#2a3140'; c.fillRect(0, b0, cv.width, b1 - b0); }
      // Schattierung zur Tiefe hin
      if (top) { c.save(); c.translate(0, edge); c.scale(1, -1); c.drawImage(this.shade, 0, 0, cv.width, Math.min(160, edge)); c.restore(); }
      else c.drawImage(this.shade, 0, edge, cv.width, 160);
      // Stufenkante links
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(0, b0, 3, b1 - b0);
      c.restore();
      // Rohr-Streifen auf der Kante
      const im = this.img['hull' + (m.v + 1)] || this.img.hull1;
      if (im) {
        const th = 44, sc = th / im.height, sw = Math.min(im.width, cv.width / sc);
        const src = (m.wx * 0.37) % Math.max(1, im.width - sw);
        c.save();
        c.translate(0, edge);
        if (top) c.scale(1, -1);
        c.drawImage(im, src, 0, sw, im.height, 0, -th / 2, cv.width, th);
        c.restore();
      }
      // Leuchtlinie
      c.fillStyle = 'rgba(90,180,255,0.45)';
      c.fillRect(0, top ? edge + 21 : edge - 23, cv.width, 2);
      return { cv, y0 };
    }

    world(g, st) {
      const c = this.c, beat = st.beat, songT = st.songT;
      const pulse = Math.exp(-(((beat % 1) + 1) % 1) * 5);
      this.hull(g);

      // Laser-Tore: Warnlinie einen Beat lang, dann der Strahl
      for (const bm of g.beams) {
        if (songT < bm.tFire) {
          const k = clamp((songT - bm.tWarn) / (bm.tFire - bm.tWarn), 0, 1);
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = `rgba(90,180,255,${0.15 + 0.5 * k * (0.5 + 0.5 * Math.sin(songT * 60))})`;
          c.fillRect(0, bm.yWarn - 1.5, bm.x, 3);
          c.globalCompositeOperation = 'source-over';
        }
      }

      // Kapseln: je Typ eingefärbt, mit Buchstaben und farbigem Leuchten
      const POW = GameConst.POWERS;
      if (!this.capsules && this.img.powerup) {
        this.capsules = {};
        this.capGlow = {};
        for (const [t, p] of Object.entries(POW)) {
          this.capsules[t] = tinted(this.img.powerup, p.color, 0.5);
          this.capGlow[t] = glow(p.color, 48);
        }
      }
      for (const it of g.items) {
        const pw = POW[it.type] || POW.W, s = 1 + 0.08 * pulse;
        c.globalCompositeOperation = 'lighter';
        this.dot(this.capGlow ? this.capGlow[it.type] : this.glows.blue, it.x, it.y, (50 + 8 * Math.sin(it.t * 8)) * s, 0.7);
        c.globalCompositeOperation = 'source-over';
        const cap = this.capsules && this.capsules[it.type];
        if (cap) {
          c.save();
          c.translate(it.x, it.y);
          c.rotate(Math.sin(it.t * 2) * 0.2);
          const h = 62 * s, w = h * cap.width / cap.height;
          c.drawImage(cap, -w / 2, -h / 2, w, h);
          c.restore();
        } else this.dot(this.glows.blue, it.x, it.y, 34);
        this.glowText(pw.label, `900 ${pw.label.length > 2 ? 18 : 26}px ${FONT}`, '#ffffff', pw.color, 8, it.x, it.y + 10);
      }

      // Spielerschüsse und Raketen VOR den Gegnern zeichnen: die Gegner liegen obenauf und
      // werden vom additiven Leuchten der Schüsse nicht überstrahlt
      c.globalCompositeOperation = 'lighter';
      for (const s of g.shots) {
        const a = Math.atan2(s.vy, s.vx);
        c.save();
        c.translate(s.x, s.y);
        c.rotate(a);
        if (s.kind === 'lance') {
          // Plasma-Speer: langer, heller Strahl mit Glühen
          c.drawImage(this.glows.blue, -90, -18, 130, 36);
          c.fillStyle = 'rgba(140,235,255,0.95)';
          c.fillRect(-80, -5, 110, 10);
          c.fillStyle = '#ffffff';
          c.fillRect(-64, -2, 92, 4);
        } else if (s.kind === 'plasma') {
          c.drawImage(this.glows.green, -34, -14, 56, 28);
          c.fillStyle = 'rgba(160,255,140,0.95)';
          c.fillRect(-32, -4.5, 46, 9);
          c.fillStyle = '#ffffff';
          c.fillRect(-20, -1.5, 32, 3);
        } else {
          c.drawImage(this.glows.green, -30, -9, 44, 18);
          c.fillStyle = 'rgba(125,255,106,0.9)';
          c.fillRect(-32, -3, 44, 6);
          c.fillStyle = '#ffffff';
          c.fillRect(-20, -1, 30, 2);
        }
        c.restore();
      }
      // Raketen: glühender Kopf mit kurzem Körper
      for (const m of g.missiles) {
        const a = Math.atan2(m.vy, m.vx);
        c.save();
        c.translate(m.x, m.y);
        c.rotate(a);
        c.drawImage(this.glows.orange, -26, -12, 40, 24);
        c.fillStyle = '#fff0d0';
        c.fillRect(-10, -2.5, 18, 5);
        c.restore();
      }
      c.globalCompositeOperation = 'source-over';

      // Gegner – pumpen auf jedem Beat
      for (const e of g.enemies) {
        if (!e.active || e.dead) continue;
        // Serpent-Segmente pumpen nacheinander – eine Welle läuft den Körper entlang
        const pl = e.seg ? Math.exp(-((((beat - e.seg * 0.25) % 1) + 1) % 1) * 5) : pulse;
        const big = e.kind === 'boss' || e.kind === 'carrier' || e.kind === 'turret';
        const k = e.k, sc = (e.scale || 1) * (1 + (big ? 0.02 : 0.08) * pl);
        // Dart: rote Spur während des Satzes
        if (e.kind === 'dart' && e.dash !== undefined && g.time - e.dash < 0.25) {
          c.globalCompositeOperation = 'lighter';
          for (let i = 1; i <= 4; i++) this.dot(this.glows.fire, e.x + (e.fx - e.x) * i * 0.2, e.y + (e.fy - e.y) * i * 0.2, 22 - i * 3, 0.5 - i * 0.1);
          c.globalCompositeOperation = 'source-over';
        }
        if (e.kind !== 'boss' && e.kind !== 'cannon') {
          const r = Math.max(k.rx, k.ry) * (e.scale || 1) * 1.5;
          c.drawImage(this.halo, e.x - r, e.y - r, r * 2, r * 2);
        }
        const ok = this.spr(k.sprite, e.x, e.y, k.h * sc, { rot: e.rot, flip: k.flip, flipY: e.flipY, flash: e.flash > 0 });
        if (!ok) {
          c.fillStyle = e.flash > 0 ? '#fff' : { blue: '#5ab8ff', orange: '#ff9a3c', fighter: '#9aa', rock: '#555', cannon: '#79a', boss: '#a4c',
            turret: '#889', dart: '#c33', mine: '#a3a', carrier: '#657', wormhead: '#3a5', wormseg: '#284', splitter: '#96f', shard: '#96f' }[e.kind];
          c.beginPath(); c.ellipse(e.x, e.y, k.rx * (e.scale || 1), k.ry * (e.scale || 1), 0, 0, TAU); c.fill();
        }
        // Kern-Glühen im Takt, Aufladen vor einem Schuss
        c.globalCompositeOperation = 'lighter';
        if (e.kind === 'blue' || e.kind === 'orange') {
          this.dot(e.kind === 'blue' ? this.glows.blue : this.glows.orange, e.x, e.y, 30 + 26 * pulse, 0.6);
        } else if (e.kind === 'wormseg' || e.kind === 'wormhead') {
          this.dot(this.glows.green, e.x, e.y, 20 + 24 * pl, 0.55);
        } else if (e.kind === 'splitter' || e.kind === 'shard') {
          this.dot(this.glows.violet, e.x, e.y, (e.kind === 'shard' ? 16 : 36) + 22 * pulse, 0.7);
        } else if (e.kind === 'mine' && e.boomT !== undefined) {
          // blinkt immer schneller, je näher seine Eins kommt
          const left = e.boomT - songT, rate = left < 1.5 ? 16 : 4;
          if (left < 3 && Math.sin(songT * rate * Math.PI) > 0) this.dot(this.glows.pink, e.x, e.y, 46 + 30 * (1 - clamp(left / 3, 0, 1)), 0.9);
        } else if (e.kind === 'carrier') {
          this.dot(this.glows.violet, e.x - 40, e.y, 70 + 40 * pulse, 0.5);
        }
        const tc = e.nextShotT - songT;
        if (tc > -0.05 && tc < 0.35) {
          const q = 1 - clamp(tc / 0.35, 0, 1);
          const gl = e.kind === 'orange' ? this.glows.orange : e.kind === 'boss' ? this.glows.pink : this.glows.violet;
          this.dot(gl, e.x - k.rx * 0.6, e.y, 10 + 30 * q, q);
        }
        if (e.kind === 'boss') this.dot(this.glows.fire, e.x - 20, e.y + 10, 90 + 50 * pulse, 0.7);
        c.globalCompositeOperation = 'source-over';
      }

      this.drawPlayer(g, st);

      // Gegnergeschosse
      c.globalCompositeOperation = 'lighter';
      for (const b of g.bullets) {
        if (b.kind === 'needle') {
          // Nadel: gestreckt in Flugrichtung, orange-rot
          const a = Math.atan2(b.vy, b.vx);
          c.save();
          c.translate(b.x, b.y);
          c.rotate(a);
          c.drawImage(this.glows.orange, -34, -9, 48, 18);
          c.fillStyle = '#fff4d0';
          c.fillRect(-16, -2, 24, 4);
          c.restore();
          continue;
        }
        const gl = b.kind === 'big' ? this.glows.pink : this.glows.violet;
        this.dot(gl, b.x, b.y, b.r * 2.6);
        this.dot(this.glows.white, b.x, b.y, b.r * 0.9);
      }
      // Effekte
      for (const f of g.fx) {
        if (f.delay > 0) continue;
        const k = f.t / f.life;
        if (f.type === 'boom') {
          const s = f.size * (0.4 + 0.9 * Math.sqrt(k));
          if (!this.spr('explosion', f.x, f.y, s * 2, { rot: f.rot + k * 0.6, alpha: 1 - k, add: true })) {
            this.dot(this.glows.fire, f.x, f.y, s, 1 - k);
          }
        } else if (f.type === 'spark') {
          c.fillStyle = f.color;
          c.globalAlpha = 1 - k;
          c.fillRect(f.x, f.y, f.size * 2, f.size);
          c.globalAlpha = 1;
        } else if (f.type === 'muzzle') {
          this.dot(f.color === '#ff9a3c' ? this.glows.orange : f.color === '#6fd0ff' ? this.glows.blue : f.color === '#ff5ad2' ? this.glows.pink : this.glows.violet,
            f.x, f.y, f.size * (1 - k * 0.5), 1 - k);
        } else if (f.type === 'ring') {
          // Schockwelle
          c.strokeStyle = `rgba(${f.color},${(1 - k) * 0.8})`;
          c.lineWidth = 10 * (1 - k) + 1;
          c.beginPath(); c.arc(f.x, f.y, f.size * easeOut(k), 0, TAU); c.stroke();
        }
      }
      // Trümmer (normal gezeichnet, dunkel mit glühender Kante)
      c.globalCompositeOperation = 'source-over';
      for (const f of g.fx) {
        if (f.type !== 'debris' || f.delay > 0) continue;
        const k = f.t / f.life;
        c.save();
        c.translate(f.x, f.y);
        c.rotate(f.rot);
        c.globalAlpha = 1 - k * k;
        c.fillStyle = '#1b1d24';
        c.strokeStyle = `rgba(255,150,70,${0.9 * (1 - k)})`;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-f.size, -f.size * 0.4); c.lineTo(f.size * 0.6, -f.size * 0.7); c.lineTo(f.size, f.size * 0.3); c.lineTo(-f.size * 0.3, f.size * 0.6);
        c.closePath(); c.fill(); c.stroke();
        c.restore();
      }
      c.globalCompositeOperation = 'lighter';
      // Strahlen der Laser-Tore
      for (const bm of g.beams) {
        if (songT < bm.tFire || bm.y === null) continue;
        const k = clamp((songT - bm.tFire) / (bm.tEnd - bm.tFire), 0, 1);
        const w = 44 * (1 - k * 0.6);
        const gr = c.createLinearGradient(0, bm.y - w, 0, bm.y + w);
        gr.addColorStop(0, 'rgba(60,140,255,0)'); gr.addColorStop(0.5, 'rgba(140,210,255,0.95)'); gr.addColorStop(1, 'rgba(60,140,255,0)');
        c.fillStyle = gr;
        c.fillRect(0, bm.y - w, bm.x, w * 2);
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.fillRect(0, bm.y - 3, bm.x, 6);
        this.dot(this.glows.blue, bm.x, bm.y, 70, 1 - k * 0.5);
      }
      c.globalCompositeOperation = 'source-over';

      // Punkte
      c.textAlign = 'center';
      for (const p of g.popups) {
        c.globalAlpha = 1 - p.t;
        c.font = `700 ${p.sync ? 30 : 22}px ${FONT}`;
        c.fillStyle = p.color || (p.sync ? '#9dff8a' : '#dff6ff');
        c.fillText(p.text, p.x, p.y - p.t * 40);
      }
      c.globalAlpha = 1;

      // Boss-Energie
      const boss = g.bossRef;
      if (boss && boss.active) {
        const k = clamp(boss.hp / boss.maxHp, 0, 1);
        c.fillStyle = 'rgba(20,30,60,0.7)';
        c.fillRect(W / 2 - 400, 30, 800, 14);
        c.fillStyle = '#ff5ad2';
        c.fillRect(W / 2 - 400, 30, 800 * k, 14);
        c.strokeStyle = '#9fe3ff';
        c.strokeRect(W / 2 - 400, 30, 800, 14);
      }
    }

    drawPlayer(g, st) {
      const c = this.c, p = g.player, d = g.drone;
      if (!p.alive) return;
      const blink = p.inv > 0 && Math.floor(p.inv * 12) % 2 === 0;
      // HYPER-Strahl
      if (g.hyperOn) {
        const k = 0.8 + 0.2 * Math.sin(performance.now() / 30);
        c.globalCompositeOperation = 'lighter';
        const gr = c.createLinearGradient(0, p.y - 70, 0, p.y + 70);
        gr.addColorStop(0, 'rgba(90,255,160,0)'); gr.addColorStop(0.5, `rgba(180,255,220,${k})`); gr.addColorStop(1, 'rgba(90,255,160,0)');
        c.fillStyle = gr;
        c.fillRect(p.x + 40, p.y - 70, W, 140);
        c.fillStyle = '#ffffff';
        c.fillRect(p.x + 40, p.y - 8, W, 16);
        c.globalCompositeOperation = 'source-over';
      }
      // Triebwerk
      c.globalCompositeOperation = 'lighter';
      this.dot(this.glows.blue, p.x - 62, p.y + 2, 28 + Math.random() * 10, 0.9);
      if (g.muzzle > 0) this.dot(this.glows.green, p.x + 66, p.y, 30 + 6 * g.weapon, 0.95);
      c.globalCompositeOperation = 'source-over';
      const px = p.x - (p.recoil || 0) * 5;           // Rückstoß
      if (!blink) {
        if (!this.spr('player', px, p.y, 64, { rot: p.tilt * 0.12 })) {
          c.fillStyle = '#e8f0ff';
          c.beginPath(); c.moveTo(px + 60, p.y); c.lineTo(px - 50, p.y - 26); c.lineTo(px - 40, p.y); c.lineTo(px - 50, p.y + 26); c.fill();
        }
      }
      // Schildblase, dünner mit jedem abgefangenen Treffer
      if (g.shield > 0) {
        const r = 62 + 3 * Math.sin(performance.now() / 90);
        c.globalCompositeOperation = 'lighter';
        this.dot(this.glows.blue, p.x, p.y, r + 20, 0.18 + 0.08 * g.shield);
        c.strokeStyle = `rgba(150,170,255,${0.25 + 0.2 * g.shield})`;
        c.lineWidth = 1 + g.shield;
        c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.stroke();
        c.globalCompositeOperation = 'source-over';
      }
      // Drohne
      const on = g.droneOnline;
      c.globalCompositeOperation = 'lighter';
      if (on) this.dot(this.glows.blue, d.x, d.y, 34, 0.5);
      c.globalCompositeOperation = 'source-over';
      if (!this.spr('drone', d.x, d.y, 50, { alpha: on ? 1 : 0.25, rot: g.time * (on ? 0.5 : 0) })) {
        c.fillStyle = on ? '#cfe8ff' : '#345';
        c.beginPath(); c.arc(d.x, d.y, 20, 0, TAU); c.fill();
      }
    }

    // ------------------------------------------------------------------ HUD

    gauge(x, y, w, k, mirror, letter, icon, label, ready) {
      const c = this.c, fr = this.gaugeFrame(w);
      c.save();
      c.translate(x, y);
      if (mirror) c.scale(-1, 1);
      c.drawImage(fr, -60, -10);
      const n = 22, sw = (w - 120) / n;
      c.fillStyle = 'rgba(80,140,190,0.25)';
      for (let i = 0; i < n; i++) if (i / n >= k) c.fillRect(20 + i * sw, 45, sw - 4, 11);
      c.fillStyle = ready ? (Math.floor(performance.now() / 150) % 2 ? '#ffffff' : '#9dff8a') : '#bfeeff';
      for (let i = 0; i < n; i++) if (i / n < k) c.fillRect(20 + i * sw, 45, sw - 4, 11);
      c.restore();
      if (icon) this.spr(icon, x + (mirror ? -1 : 1) * (w - 22), y + 44, 30, { flip: mirror && icon === 'player' });
      this.glowText(letter, `700 52px ${FONT}`, '#dff6ff', '#3fb4ff', 14, x + (mirror ? -1 : 1) * (w + 50), y + 68);
      this.glowText(label, `600 14px ${FONT}`, 'rgba(190,230,255,0.7)', '', 0, x + (mirror ? -1 : 1) * (w / 2 - 20), y + 100);
    }

    // Statuszeile über dem HUD: Schild, Raketen und die Zeit-Power-ups mit Restbalken
    powerRow(g, st, y) {
      const c = this.c, POW = GameConst.POWERS, items = [];
      if (g.shield > 0) items.push({ t: 'SHIELD ' + '|'.repeat(g.shield), col: POW.S.color });
      if (g.missileLvl > 0) items.push({ t: 'MISSILES ' + 'I'.repeat(g.missileLvl), col: POW.M.color });
      const beatLen = 60 / g.L.bpm, span = 32 * beatLen;
      if (g.rapidOn) items.push({ t: 'RAPID', col: POW.R.color, k: (g.rapidEnd - st.songT) / span });
      if (g.doubleOn) items.push({ t: 'SCORE x2', col: POW.X.color, k: (g.doubleEnd - st.songT) / span });
      if (!items.length) return;
      const gap = 230, x0 = W / 2 - (items.length - 1) * gap / 2;
      items.forEach((it, i) => {
        const x = x0 + i * gap;
        this.glowText(it.t, `700 18px ${FONT}`, it.col, it.col, 6, x, y);
        if (it.k !== undefined) {
          c.fillStyle = 'rgba(255,255,255,0.15)';
          c.fillRect(x - 60, y + 8, 120, 3);
          c.fillStyle = it.col;
          c.fillRect(x - 60, y + 8, 120 * clamp(it.k, 0, 1), 3);
        }
      });
    }

    hud(g, st) {
      const c = this.c, y = 950;
      this.gauge(110, y, 440, g.charge, false, 'ABCDE'[g.weapon - 1], 'player', 'HYPER  [X]', g.charge >= 1);
      this.powerRow(g, st, y - 22);
      this.gauge(W - 110, y, 440, g.droneE, true, g.droneMode ? 'B' : 'A', 'drone', 'DRONE  [C]', false);
      this.glowText(String(Math.floor(g.score)).padStart(8, '0'), `700 62px ${FONT}`, '#e8fbff', '#3fb4ff', 16, W / 2, y + 48);
      c.fillStyle = 'rgba(143,224,255,0.8)';
      c.fillRect(W / 2 - 150, y + 63, 300, 2);
      this.glowText(st.songName.toUpperCase(), `600 24px ${FONT}`, '#cdefff', '', 0, W / 2, y + 98);
      // Leben links, Multiplikator rechts
      for (let i = 0; i < g.lives; i++) this.spr('player', W / 2 - 230 - i * 50, y + 90, 22);
      if (!this.img.player) this.glowText('x' + g.lives, `600 24px ${FONT}`, '#cdefff', '', 0, W / 2 - 200, y + 98, 'right');
      this.glowText('x' + g.mult, `600 24px ${FONT}`, g.mult > 1 ? '#9dff8a' : 'rgba(205,239,255,0.5)', '', 0, W / 2 + 200, y + 98, 'left');
      // Songfortschritt
      const k = clamp(st.songT / g.L.duration, 0, 1);
      c.fillStyle = 'rgba(143,224,255,0.25)';
      c.fillRect(W / 2 - 150, y + 110, 300, 3);
      c.fillStyle = '#8fe0ff';
      c.fillRect(W / 2 - 150, y + 110, 300 * k, 3);
    }

    banner(g, st) {
      const c = this.c, b = g.banner;
      const a = clamp(Math.min(st.songT - b.t0, b.t1 - st.songT) * 3, 0, 1);
      const blink = b.text === 'WARNING' ? 0.6 + 0.4 * Math.sin(st.beat * Math.PI * 2) : 1;
      c.globalAlpha = a * blink;
      const warn = b.text === 'WARNING';
      this.glowText(b.text, `900 110px ${FONT}`, warn ? '#ff5a7a' : '#e8fbff', warn ? '#ff2050' : '#3fb4ff', 30, W / 2, H / 2 - 20);
      if (b.sub) this.glowText(b.sub, `600 30px ${FONT}`, warn ? '#ff5a7a' : '#e8fbff', warn ? '#ff2050' : '#3fb4ff', 30, W / 2, H / 2 + 40);
      c.globalAlpha = 1;
    }

    // ------------------------------------------------------------------ Bildschirme

    title(st) {
      const c = this.c;
      c.textAlign = 'center';
      // Logo aus dem Cache, der Bass lässt es über die Deckkraft einer zweiten Lage pulsieren
      this.glowText('HYPERSENSE', `900 150px ${FONT}`, '#e8fbff', '#3fb4ff', 40, W / 2, 400);
      c.globalAlpha = 0.6 * (st.levels ? st.levels[0] : 0);
      this.glowText('HYPERSENSE', `900 150px ${FONT}`, '#e8fbff', '#3fb4ff', 40, W / 2, 400);
      c.globalAlpha = 1;
      this.glowText(st.subtitle, `600 34px ${FONT}`, '#9fe3ff', '', 0, W / 2, 480);
      if (st.pick) {
        const k = 0.5 + 0.5 * Math.sin(performance.now() / 300);
        c.fillStyle = `rgba(159,227,255,${0.5 + 0.5 * k})`;
        for (const s of [-1, 1]) {
          const x = W / 2 + s * 520;
          c.beginPath(); c.moveTo(x + s * 18, 468); c.lineTo(x - s * 6, 452); c.lineTo(x - s * 6, 484); c.fill();
        }
      }
      if (st.hi) {
        c.font = `400 22px ${FONT}`;
        c.fillStyle = 'rgba(205,239,255,0.7)';
        c.fillText('HIGH SCORE  ' + String(st.hi).padStart(8, '0'), W / 2, 530);
      }
      c.font = `600 30px ${FONT}`;
      c.fillStyle = st.ready ? `rgba(232,251,255,${0.55 + 0.45 * Math.sin(performance.now() / 250)})` : '#cdefff';
      c.fillText(st.status, W / 2, 640);
      c.font = `400 22px ${FONT}`;
      c.fillStyle = 'rgba(205,239,255,0.7)';
      const help = ['LEFT / RIGHT  choose song      ENTER  start',
        'ARROWS / WASD  fly      SHIFT  slow      SPACE / J  fire',
        'X  HYPER beam      C  drone mode      P / ESC  pause      F  fullscreen'];
      help.forEach((l, i) => c.fillText(l, W / 2, 780 + i * 38));
    }

    results(g, st) {
      const c = this.c;
      c.fillStyle = 'rgba(2,3,10,0.6)';
      c.fillRect(0, 0, W, H);
      c.textAlign = 'center';
      c.font = `900 110px ${FONT}`;
      c.fillStyle = g.over ? '#ff5a7a' : '#e8fbff';
      c.shadowColor = g.over ? '#ff2050' : '#3fb4ff';
      c.shadowBlur = 30;
      c.fillText(g.over ? 'GAME OVER' : 'STAGE CLEAR', W / 2, 300);
      c.shadowBlur = 0;
      c.font = `600 36px ${FONT}`;
      c.fillStyle = '#dff6ff';
      const rows = [
        ['SCORE', String(Math.floor(g.score)).padStart(8, '0')],
        ['KILLS', `${g.kills} / ${g.spawned}`],
        ['SYNC KILLS', String(g.syncKills)],
        ['MAX CHAIN', String(g.maxChain)],
        ['HIGH SCORE', String(st.hi).padStart(8, '0')],
      ];
      rows.forEach(([k, v], i) => {
        c.textAlign = 'right'; c.fillText(k, W / 2 - 30, 430 + i * 64);
        c.textAlign = 'left'; c.fillText(v, W / 2 + 30, 430 + i * 64);
      });
      c.textAlign = 'center';
      c.font = `600 30px ${FONT}`;
      c.fillStyle = `rgba(232,251,255,${0.55 + 0.45 * Math.sin(performance.now() / 250)})`;
      c.fillText('PRESS ENTER', W / 2, 850);
    }

    paused() {
      const c = this.c;
      c.fillStyle = 'rgba(2,3,10,0.55)';
      c.fillRect(0, 0, W, H);
      c.textAlign = 'center';
      c.font = `900 90px ${FONT}`;
      c.fillStyle = '#e8fbff';
      c.fillText('PAUSE', W / 2, H / 2);
    }
  }

  window.Renderer = Renderer;
})();
