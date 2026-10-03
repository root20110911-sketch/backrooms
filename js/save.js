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
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      return S.migrate(d); // v1.5 W6：读档时迁移旧关卡 id（94→!）
    } catch (e) { return null; }
  };
  // 关卡 id 迁移（v1.5 W6：Level 94「动画」→ Level !「不想死就快跑！」）：
  // 老存档 level 可能是 'l94' 或 'L94'（文件系统/历史命名），统一迁到 'bang'。
  // 空/异常输入原样返回，绝不抛错。
  S.migrate = function (data) {
    try {
      if (!data || typeof data !== 'object') return data;
      if (data.level === 'l94' || data.level === 'L94') data.level = 'bang';
      return data;
    } catch (e) { return data; }
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
      // v1.5 W8：坐骑实例位置（W5 鸭子；buildDucks 经 BR.Mounts.savedFor 恢复；与 snapshot 对齐）
      try { ws.mounts = (BR.Mounts && BR.Mounts.getLevelSave) ? BR.Mounts.getLevelSave() : {}; } catch (e) {}
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
        // W10：坐骑状态（鸭子坐骑建造者接入后 P.mount / BR.Mount.state 生效；缺省 null）
        mount: S._readMount(P),
        riftCount: (G.flags && G.flags.riftCount != null) ? G.flags.riftCount : S.countEvents(ws.events, 'rift_'),
        berryCount: (G.flags && G.flags.berryCount != null) ? G.flags.berryCount : S.countEvents(ws.events, 'berry_')
      };
      // W9：新道具运行时态（独立电量/装备/耐力/照明灯/已部署物）；
      // W10 约定：缺省可回填——老存档无这些字段时 BR.Items.loadState 走默认值
      if (BR.Items && BR.Items.saveState) {
        const ist = BR.Items.saveState();
        data.itemCharges = ist.itemCharges;
        data.equipped = ist.equipped;
        data.stamina = ist.stamina;
        data.diveLight = ist.diveLight;
        data.deployed = ist.deployed;
      }
      localStorage.setItem(KEY, JSON.stringify(data));
      BR.log('saved', data.level);
      return true;
    } catch (e) { BR.warn('save failed', e); return false; }
  };
  // W10：读坐骑状态（与 main.js snapshot 的 v1.5 W8 约定对齐：P.mountHandle；
  // 坐骑系统未接入时返回 null；老存档缺字段由 validate 回填 null）
  S._readMount = function (P) {
    try {
      const h = P && P.mountHandle;
      if (!h) return null;
      // v1.5 W3：L7 小船不走 mount 读档恢复——船位经 W.state.boatSave 由关卡恢复
      // （位置存档，不复制不消失）；读档时人不坐在船上，避免 main.js 经
      // BR.Mounts.create('boat', …) 造出未加入场景的幽灵船（工厂签名是 (W, opts)）。
      if (h.kind === 'boat') return null;
      let data = null;
      try { data = (typeof h.getSave === 'function') ? h.getSave() : null; } catch (e) {}
      return { kind: h.kind, data: data };
    } catch (e) {}
    return null;
  };
  /* ---------- W10 一致性检查 ----------
   * validate(data)：老字段缺省不崩（回填默认值）、类型错误回填、未知字段透传、
   * 绝不删除任何键（不清空进度）。返回 {data, fixed:[被修复的键]}；
   * data 非对象时返回 {data:null}。
   * 各路在 save.js 加字段时：只需保证"缺省可回填"，validate 会透传未知字段。
   */
  S.validate = function (d) {
    const fixed = [];
    if (!d || typeof d !== 'object') return { data: null, fixed: ['not-an-object'] };
    const out = d;
    const num = (k, def, min, max) => {
      let v = +out[k];
      if (!isFinite(v)) { out[k] = def; fixed.push(k); }
      else {
        if (min != null && v < min) { v = min; fixed.push(k); }
        if (max != null && v > max) { v = max; fixed.push(k); }
        out[k] = v;
      }
    };
    const obj = (k) => {
      if (!out[k] || typeof out[k] !== 'object' || Array.isArray(out[k])) { out[k] = {}; fixed.push(k); }
    };
    if (!isFinite(+out.seed)) { out.seed = (Math.random() * 1e9) | 0; fixed.push('seed'); }
    if (typeof out.level !== 'string' || !out.level) { out.level = 'L0'; fixed.push('level'); }
    num('px', 0); num('pz', 0); num('yaw', 0);
    num('hp', 100, 0, 100); num('sanity', 100, 0, 100);
    num('hunger', 100, 0, 100); num('flashBat', 100, 0, 100);
    out.hasFlashlight = !!out.hasFlashlight;
    obj('inv'); obj('flags');
    obj('ws');
    ['openedDoors', 'picked', 'openedCrates', 'events'].forEach(k => {
      if (!Array.isArray(out.ws[k])) { out.ws[k] = []; fixed.push('ws.' + k); }
    });
    // v1.5 W7：Level 188「百窗庭」可选字段（缺失走默认值，不破坏老存档）：
    //   ws.l188win = { wins: {窗id: {lit}}, fired: {窗id: true}, curtainGone: {窗id: true} }
    //     窗户翻转/事件触发/魔术窗帘"消失"状态，卸载不重抽；
    //   ws.l188_from = 来源层级 id（返回门用；onEnter 从 BR.Game._cameFrom 记录）。
    if (out.ws.l188win == null || typeof out.ws.l188win !== 'object') {
      out.ws.l188win = { wins: {}, fired: {}, curtainGone: {} };
      fixed.push('ws.l188win');
    } else {
      ['wins', 'fired', 'curtainGone'].forEach(k => {
        if (out.ws.l188win[k] == null || typeof out.ws.l188win[k] !== 'object') {
          out.ws.l188win[k] = {}; fixed.push('ws.l188win.' + k);
        }
      });
    }
    if (typeof out.ws.l188_from !== 'string') { out.ws.l188_from = 'L0'; fixed.push('ws.l188_from'); }
    num('riftCount', S.countEvents(out.ws.events, 'rift_'), 0);
    num('berryCount', S.countEvents(out.ws.events, 'berry_'), 0);
    if (out.mount === undefined) { out.mount = null; fixed.push('mount'); }
    // v1.5 W8：坐骑实例位置（ws.mounts，老存档缺省回填 {}）
    if (out.ws.mounts == null || typeof out.ws.mounts !== 'object' || Array.isArray(out.ws.mounts)) {
      out.ws.mounts = {}; fixed.push('ws.mounts');
    }
    return { data: out, fixed: fixed };
  };
  /* validateSettings(s)：br_settings（按键/设置）一致性检查。
   * 枚举越界→回填默认；数值 clamp；bindings 非对象→删除（input.js 会重建默认）。
   * 未知键透传，不删除用户数据。
   */
  S.validateSettings = function (s) {
    const fixed = [];
    if (!s || typeof s !== 'object') return { data: null, fixed: ['not-an-object'] };
    const enums = {
      headbob: ['on', 'weak', 'off'], dropcam: ['full', 'soft', 'off'],
      sanityfx: ['on', 'off'], shakecam: ['on', 'weak', 'off'],
      quality: ['auto', 'high', 'medium', 'low'], joySide: ['left', 'right']
    };
    const defaults = { headbob: 'on', dropcam: 'full', sanityfx: 'on', shakecam: 'on', quality: 'auto', joySide: 'left' };
    for (const k in enums) {
      if (enums[k].indexOf(s[k]) < 0) { s[k] = defaults[k]; fixed.push(k); }
    }
    const clampNum = (k, def, min, max) => {
      let v = +s[k];
      if (!isFinite(v)) { s[k] = def; fixed.push(k); }
      else { s[k] = Math.min(max, Math.max(min, v)); if (s[k] !== v) fixed.push(k); }
    };
    clampNum('sens', 1.0, 0.3, 2.5);
    clampNum('vol', 0.8, 0, 1);
    clampNum('joySize', 120, 90, 170);
    if (s.bindings != null && (typeof s.bindings !== 'object' || Array.isArray(s.bindings))) {
      delete s.bindings; fixed.push('bindings');
    }
    return { data: s, fixed: fixed };
  };
  S.loadGame = function () {
    const d = this.peek();
    if (!d) return null;
    const chk = this.validate(d);
    if (!chk.data) return null;
    if (chk.fixed.length && BR.log) BR.log('save fixed:', chk.fixed.join(','));
    return chk.data;
  };
  S.clearSave = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
  };
})();
