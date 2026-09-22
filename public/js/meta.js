// Meta-Progression: HyperCoins und die dauerhaften Upgrades aus dem Incubator.
// Gespeichert im Browser (localStorage); fehlt der Speicher, gilt alles nur für die laufende Sitzung.
(function () {
  'use strict';

  const KEY = 'hypersense.save';

  // id, Name, Beschreibung, Stufen, Grundpreis. Preis der nächsten Stufe = base · (Stufe+1)^1.5
  const UPGRADES = [
    { id: 'firepower', name: 'FIREPOWER', desc: '+10 % damage for every shot and missile', max: 5, base: 40 },
    { id: 'weapon', name: 'START WEAPON', desc: 'Start with weapon B / C - and never drop below it', max: 2, base: 120 },
    { id: 'armor', name: 'ARMOR PLATING', desc: 'Start and respawn with 1 / 2 shield hits', max: 2, base: 80 },
    { id: 'lives', name: 'EXTRA SHIP', desc: '+1 ship per run', max: 2, base: 150 },
    { id: 'drone', name: 'DRONE CORE', desc: 'Drone takes more hits and recharges faster', max: 3, base: 50 },
    { id: 'hyper', name: 'HYPER CAPACITOR', desc: 'HYPER beam charges 25 % faster', max: 3, base: 50 },
    { id: 'magnet', name: 'MAGNET', desc: 'Pull coins and capsules from further away', max: 3, base: 30 },
    { id: 'engine', name: 'ENGINE', desc: '+8 % ship speed', max: 3, base: 40 },
    { id: 'missiles', name: 'MISSILE TUBE', desc: 'Start every run with one missile tube', max: 1, base: 200 },
  ];

  const cost = (u, level) => Math.round(u.base * Math.pow(level + 1, 1.5));

  class Save {
    constructor() {
      this.coins = 0;
      this.up = {};
      try {
        const d = JSON.parse(localStorage.getItem(KEY) || '{}');
        this.coins = Math.max(0, Math.floor(d.coins || 0));
        this.up = d.up && typeof d.up === 'object' ? d.up : {};
      } catch (e) { /* kein Speicher oder kaputt: frisch anfangen */ }
    }
    level(id) { return this.up[id] || 0; }
    store() {
      try { localStorage.setItem(KEY, JSON.stringify({ coins: this.coins, up: this.up })); } catch (e) { /* egal */ }
    }
    priceOf(u) { return this.level(u.id) >= u.max ? null : cost(u, this.level(u.id)); }
    buy(u) {
      const p = this.priceOf(u);
      if (p === null || p > this.coins) return false;
      this.coins -= p;
      this.up[u.id] = this.level(u.id) + 1;
      this.store();
      return true;
    }
    bank(n) { this.coins += Math.floor(n); this.store(); }

    // Werte für das Spiel
    stats() {
      const L = id => this.level(id);
      return {
        damage: 1 + 0.1 * L('firepower'),
        startWeapon: 1 + L('weapon'),
        armor: L('armor'),
        lives: 3 + L('lives'),
        droneDrain: 1 - 0.2 * L('drone'),
        droneRegen: 1 + 0.35 * L('drone'),
        hyperGain: 1 + 0.25 * L('hyper'),
        magnet: 1 + 0.4 * L('magnet'),
        speed: 1 + 0.08 * L('engine'),
        startMissiles: L('missiles'),
      };
    }
  }

  window.Meta = { UPGRADES, Save, cost };
})();
