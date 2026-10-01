/* utils.js —— RNG / 数学 / 事件总线 / DOM 小工具 */
(function () {
  const BR = window.BR;

  // 可复现随机数（mulberry32）
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 1; }
    next() {
      let t = (this.s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
    range(a, b) { return a + this.next() * (b - a); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    chance(p) { return this.next() < p; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
  }
  BR.RNG = RNG;

  BR.hashSeed = function (str) {
    let h = 2166136261 >>> 0;
    str = String(str);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  BR.clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  BR.lerp = (a, b, t) => a + (b - a) * t;
  BR.damp = (a, b, k, dt) => BR.lerp(a, b, 1 - Math.exp(-k * dt));

  // 简易事件总线
  const listeners = {};
  BR.bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    off(ev, fn) {
      const a = listeners[ev]; if (!a) return;
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    emit(ev, data) {
      const a = listeners[ev]; if (!a) return;
      for (let i = 0; i < a.length; i++) {
        try { a[i](data); } catch (e) { BR.warn('bus handler error', ev, e); }
      }
    }
  };

  BR.$ = (id) => document.getElementById(id);
  BR.el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  // tile → 世界坐标（中心）
  BR.tileCX = (tx) => (tx + 0.5) * BR.TILE;
  BR.tileCZ = (ty) => (ty + 0.5) * BR.TILE;
  BR.worldTX = (x) => Math.floor(x / BR.TILE);
  BR.worldTY = (z) => Math.floor(z / BR.TILE);
  // 角度差（-PI..PI）
  BR.angDiff = (a, b) => {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
})();
