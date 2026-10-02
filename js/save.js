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
  // 统计事件数（'rift_0:...' / 'berry_0:...' 前缀）；读档兼容：缺字段时 ?? 0
  S.countEvents = function (events, prefix) {
    let n = 0;
    for (const e of (events || [])) if (e && e.indexOf(prefix) === 0) n++;
    return n;
  };
  S.saveGame = function () {
    try {
      const G = BR.Game, P = BR.Player, W = BR.World;
      const ws = W.state || { openedDoors: [], picked: [], openedCrates: [], events: [] };
      const data = {
        v: 1, t: Date.now(),
        seed: G.seed,
        level: G.level,
        px: P.pos.x, pz: P.pos.z, yaw: P.yaw,
        hp: Math.round(P.hp),
        sanity: Math.round(P.sanity),   // 修复已知坑：以前不存理智，读档回满
        hunger: Math.round(P.hunger != null ? P.hunger : 100),
        flashBat: Math.round(P.flashBat != null ? P.flashBat : 100), // 手电电池（老存档缺字段默认 100）
        hasFlashlight: P.hasFlashlight,
        inv: G.inv,
        flags: G.flags,
        ws: ws,
        riftCount: (G.flags && G.flags.riftCount != null) ? G.flags.riftCount : S.countEvents(ws.events, 'rift_'),
        berryCount: (G.flags && G.flags.berryCount != null) ? G.flags.berryCount : S.countEvents(ws.events, 'berry_')
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
