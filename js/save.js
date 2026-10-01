/* save.js —— 本地存档（localStorage）：种子/关卡/位置/状态 */
(function () {
  const BR = window.BR;
  const KEY = 'backrooms_save_v1';

  const S = {};
  BR.Save = S;

  S.hasSave = function () {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  };
  S.peek = function () {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  };
  S.saveGame = function () {
    try {
      const G = BR.Game, P = BR.Player, W = BR.World;
      const data = {
        v: 1, t: Date.now(),
        seed: G.seed,
        level: G.level,
        px: P.pos.x, pz: P.pos.z, yaw: P.yaw,
        hp: Math.round(P.hp),
        hasFlashlight: P.hasFlashlight,
        inv: G.inv,
        flags: G.flags,
        ws: W.state
      };
      localStorage.setItem(KEY, JSON.stringify(data));
      BR.log('saved', data.level);
      return true;
    } catch (e) { BR.warn('save failed', e); return false; }
  };
  S.loadGame = function () { return this.peek(); };
  S.clearSave = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
  };
})();
