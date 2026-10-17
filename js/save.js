/* save.js —— 本地存档（localStorage）：种子/关卡/位置/状态 */
(function () {
  const BR = window.BR;
  const KEY = 'backrooms_save_v1';   // 旧 key：只读（迁移用），不再写入
  const KEY2 = 'backrooms_save_v2';  // P0-2：按关持久化，新写入一律走 v2

  const S = {};
  BR.Save = S;
  S.KEY = KEY; S.KEY2 = KEY2;

  S.hasSave = function () {
    try { return !!(localStorage.getItem(KEY2) || localStorage.getItem(KEY)); } catch (e) { return false; }
  };
  S.peek = function () {
    try {
      // P0-2：先读 v2；无则读旧 v1 key。S.migrate 统一做 l94→bang 与 v1→v2；
      // v1 读入只做内存迁移，下次 autosave 落盘 v2。
      let d = null;
      try { d = JSON.parse(localStorage.getItem(KEY2)); } catch (e) {}
      if (!d) { try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} }
      if (!d) return null;
      return S.migrate(d);
    } catch (e) { return null; }
  };
  // 关卡 id 迁移（v1.5 W6：Level 94「动画」→ Level !「不想死就快跑！」）：
  // 老存档 level 可能是 'l94' 或 'L94'（文件系统/历史命名），统一迁到 'bang'。
  // P0-2：加 v1→v2 内存迁移（S.v1toV2；已是 v2 则原样返回）。
  // 空/异常输入原样返回，绝不抛错。
  S.migrate = function (data) {
    try {
      if (!data || typeof data !== 'object') return data;
      data = S.v1toV2(data);
      if (data.level === 'l94' || data.level === 'L94') data.level = 'bang';
      return data;
    } catch (e) { return data; }
  };
  /* P0-2：v1→v2 内存迁移（只跑在内存里，不写盘；下次 autosave 落盘 v2）。
   * 顶层字段照搬（ws/deployed 除外）；v1 的 deployed 本来就是按关分桶
   * {关id:{glows,chalks,drops}}（见 items.js saveState），逐桶拆开装入对应关；
   * 顶层 ws 装入当前关桶；之后顶层不再保留 ws/deployed（v2 不再有）。
   * l94→bang 的关 id 迁移在这里先做（桶 key 一并改名），S.migrate 再兜一遍顶层。 */
  S.v1toV2 = function (d) {
    try {
      if (!d || typeof d !== 'object') return d;
      if (d.v === 2 && d.levels && typeof d.levels === 'object') return d; // 已是 v2
      const out = {};
      for (const k in d) {
        if (k === 'ws' || k === 'deployed') continue;
        out[k] = d[k];
      }
      out.v = 2;
      let level = d.level;
      if (level === 'l94' || level === 'L94') level = 'bang';
      if (typeof level !== 'string' || !level) level = 'L0';
      out.level = level;
      const levels = {};
      const v1dep = (d.deployed && typeof d.deployed === 'object' && !Array.isArray(d.deployed)) ? d.deployed : {};
      for (const k in v1dep) {
        const kk = (k === 'l94' || k === 'L94') ? 'bang' : k;
        levels[kk] = { deployed: v1dep[k] };
      }
      if (!levels[level] || typeof levels[level] !== 'object') levels[level] = {};
      levels[level].ws = d.ws;
      if (levels[level].deployed === undefined) levels[level].deployed = { glows: [], chalks: [], drops: [] };
      out.levels = levels;
      return out;
    } catch (e) { return d; }
  };
  // 统计事件数（'rift_0:...' / 'berry_0:...' 前缀）；读档兼容：缺字段时 ?? 0
  S.countEvents = function (events, prefix) {
    let n = 0;
    for (const e of (events || [])) if (e && e.indexOf(prefix) === 0) n++;
    return n;
  };
  // P0-2：v2 落盘（新写入一律走 v2 key）
  S.writeV2 = function (data) {
    try { localStorage.setItem(KEY2, JSON.stringify(data)); return true; }
    catch (e) { BR.warn('save v2 failed', e); return false; }
  };
  /* P0-2：存档 v2 序列化（G.snapshot 与 S.saveGame 共用同一函数，见 tools/SAVE_V2.md）。
   * 顶层只放"当前会话"字段；各关 ws + deployed 按关装入 levels。
   * levels = 内存关卡缓存全量（深拷贝）+ 当前关现态覆盖。 */
  S.serializeV2 = function () {
    const G = BR.Game, P = BR.Player, W = BR.World;
    const ws = (W && W.state) || { openedDoors: [], picked: [], openedCrates: [], events: [] };
    const wsCopy = JSON.parse(JSON.stringify(ws));
    // v1.5 W8：坐骑实例位置（W5 鸭子：buildDucks 经 BR.Mounts.savedFor 恢复）
    try { wsCopy.mounts = (BR.Mounts && BR.Mounts.getLevelSave) ? BR.Mounts.getLevelSave() : {}; }
    catch (e) { wsCopy.mounts = {}; }
    // W9：道具运行时态；saveState 把本关运行时合并进按关分桶（其它关透传）
    let itemCharges = null, equipped = null, stamina = null, diveLight = null, curBucket = null;
    if (BR.Items && BR.Items.saveState) {
      const ist = BR.Items.saveState();
      itemCharges = ist.itemCharges;
      equipped = ist.equipped;
      stamina = ist.stamina;
      diveLight = ist.diveLight;
      curBucket = (ist.deployed && ist.deployed[G.level]) || null;
    }
    const levels = {};
    const cache = (G && G._levelCache) || {};
    for (const k in cache) {
      const c = cache[k];
      if (!c) continue;
      levels[k] = {
        ws: JSON.parse(JSON.stringify(c.ws || {})),
        deployed: JSON.parse(JSON.stringify(c.deployed || { glows: [], chalks: [], drops: [] }))
      };
    }
    levels[G.level] = {
      ws: wsCopy,
      deployed: JSON.parse(JSON.stringify(curBucket || { glows: [], chalks: [], drops: [] }))
    };
    return {
      v: 2, t: Date.now(),
      seed: G.seed, level: G.level,
      px: P.pos.x, pz: P.pos.z, yaw: P.yaw,
      hp: Math.round(P.hp),
      sanity: Math.round(P.sanity),   // 修复已知坑：读档不再回满
      hunger: Math.round(P.hunger != null ? P.hunger : 100),
      flashBat: Math.round(P.flashBat != null ? P.flashBat : 100), // 手电电池（老存档缺字段默认 100）
      hasFlashlight: P.hasFlashlight,
      inv: Object.assign({}, G.inv),
      flags: Object.assign({}, G.flags),
      // v1.5 W8：坐骑运行时态（无坐骑时 null；handle.getSave 可选）
      // v1.5 W3：L7 小船不走 mount 读档恢复——船位经 W.state.boatSave 由关卡恢复
      // （位置存档，不复制不消失）；读档时人不坐在船上，避免 BR.Mounts.create('boat', …)
      // 造出未加入场景的幽灵船（工厂签名是 (W, opts)）。
      mount: (function () {
        const h = P && P.mountHandle;
        if (!h || h.kind === 'boat') return null;
        let data = null;
        try { data = (typeof h.getSave === 'function') ? h.getSave() : null; } catch (e) {}
        return { kind: h.kind, data: data };
      })(),
      riftCount: (G.flags && G.flags.riftCount != null) ? G.flags.riftCount : S.countEvents(ws.events, 'rift_'),
      berryCount: (G.flags && G.flags.berryCount != null) ? G.flags.berryCount : S.countEvents(ws.events, 'berry_'),
      // W9：新道具运行时态（独立电量/装备/耐力/照明灯；已部署物按关进 levels，不再有顶层 deployed）
      itemCharges: itemCharges, equipped: equipped, stamina: stamina, diveLight: diveLight,
      levels: levels
    };
  };
  // 手动存档入口（ui.js"退出到标题"按钮仍在用）：走同一 v2 序列化落盘 v2。
  // （旧实现自建 v1 数据；P0-2 起与 autosave 同源，旧 _readMount 逻辑已并入 serializeV2。）
  S.saveGame = function () {
    try {
      const ok = S.writeV2(S.serializeV2());
      if (ok) BR.log('saved', BR.Game && BR.Game.level);
      return ok;
    } catch (e) { BR.warn('save failed', e); return false; }
  };
  /* ---------- P0-2：ws / deployed 桶校验（v1 顶层 ws 与 v2 各关 ws 共用） ----------
   * 字段名是 world.js / save.js / levels.js 三方硬约定，不许改。
   * 缺省回填、类型错误回填、未知字段透传，绝不删除任何键。 */
  S.validateWs = function (ws) {
    const fixed = [];
    if (!ws || typeof ws !== 'object' || Array.isArray(ws)) { ws = {}; fixed.push('ws'); }
    ['openedDoors', 'picked', 'openedCrates', 'events'].forEach(k => {
      if (!Array.isArray(ws[k])) { ws[k] = []; fixed.push('ws.' + k); }
    });
    // 区块级状态（world.js ChunkState 直写；老存档缺字段 → 空对象）
    if (ws.chunkState == null || typeof ws.chunkState !== 'object' || Array.isArray(ws.chunkState)) {
      ws.chunkState = {}; fixed.push('ws.chunkState');
    }
    // v1.5 W7：Level 188「百窗庭」可选字段（缺失走默认值，不破坏老存档）：
    //   ws.l188win = { wins: {窗id: {lit}}, fired: {窗id: true}, curtainGone: {窗id: true} }
    //     窗户翻转/事件触发/魔术窗帘"消失"状态，卸载不重抽；
    //   ws.l188_from = 来源层级 id（返回门用；onEnter 从 BR.Game._cameFrom 记录）。
    if (ws.l188win == null || typeof ws.l188win !== 'object') {
      ws.l188win = { wins: {}, fired: {}, curtainGone: {} };
      fixed.push('ws.l188win');
    } else {
      ['wins', 'fired', 'curtainGone'].forEach(k => {
        if (ws.l188win[k] == null || typeof ws.l188win[k] !== 'object') {
          ws.l188win[k] = {}; fixed.push('ws.l188win.' + k);
        }
      });
    }
    if (typeof ws.l188_from !== 'string') { ws.l188_from = 'L0'; fixed.push('ws.l188_from'); }
    // v2.0 P5：Level 188 真垂直二层——玩家所在楼层（0=1F, 1=2F；老存档缺省 0）
    if (ws.l188floor !== 0 && ws.l188floor !== 1) { ws.l188floor = 0; fixed.push('ws.l188floor'); }
    // v2.0：Level 25「街机枢纽」可选字段（缺失走默认值，不破坏老存档）：
    //   ws.l25 = { coins: 游戏币数, mach: {街机idx: {seen, plays, wins, st}} }
    if (ws.l25 == null || typeof ws.l25 !== 'object' || Array.isArray(ws.l25)) {
      ws.l25 = { coins: 0, mach: {} };
      fixed.push('ws.l25');
    } else {
      if (!isFinite(+ws.l25.coins)) { ws.l25.coins = 0; fixed.push('ws.l25.coins'); }
      if (ws.l25.mach == null || typeof ws.l25.mach !== 'object' || Array.isArray(ws.l25.mach)) {
        ws.l25.mach = {}; fixed.push('ws.l25.mach');
      }
    }
    // v1.5 W8：坐骑实例位置（老存档缺省回填 {}）
    if (ws.mounts == null || typeof ws.mounts !== 'object' || Array.isArray(ws.mounts)) {
      ws.mounts = {}; fixed.push('ws.mounts');
    }
    return { ws: ws, fixed: fixed };
  };
  S.validateDeployed = function (dep) {
    const fixed = [];
    if (!dep || typeof dep !== 'object' || Array.isArray(dep)) { dep = {}; fixed.push('deployed'); }
    ['glows', 'chalks', 'drops'].forEach(k => {
      if (!Array.isArray(dep[k])) { dep[k] = []; fixed.push('deployed.' + k); }
    });
    return { deployed: dep, fixed: fixed };
  };
  /* ---------- W10 一致性检查 ----------
   * validate(data)：老字段缺省不崩（回填默认值）、类型错误回填、未知字段透传、
   * 绝不删除任何键（不清空进度）。返回 {data, fixed:[被修复的键]}；
   * data 非对象时返回 {data:null}。
   * 各路在 save.js 加字段时：只需保证"缺省可回填"，validate 会透传未知字段。
   * P0-2：v2 校验——levels 为对象；每关 ws/deployed 走上面的桶校验并回填缺省。
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
    if (out.levels && typeof out.levels === 'object' && !Array.isArray(out.levels)) {
      // v2：逐关校验 ws/deployed 桶（未知字段透传）
      for (const k in out.levels) {
        let b = out.levels[k];
        if (!b || typeof b !== 'object' || Array.isArray(b)) {
          b = {}; out.levels[k] = b; fixed.push('levels.' + k);
        }
        const wc = S.validateWs(b.ws);
        b.ws = wc.ws;
        wc.fixed.forEach(f => fixed.push('levels.' + k + '.' + f));
        const dc = S.validateDeployed(b.deployed);
        b.deployed = dc.deployed;
        dc.fixed.forEach(f => fixed.push('levels.' + k + '.' + f));
      }
    } else if (out.ws) {
      // 兼容：直接对 v1 形数据调 validate（旧调用方）；loadGame 外不再出现
      const wc = S.validateWs(out.ws);
      out.ws = wc.ws;
      wc.fixed.forEach(f => fixed.push(f));
    }
    // 缺省计数：v2 从本关 ws.events 按前缀回填（v1 兼容分支走顶层 ws）
    let curEvents = [];
    try {
      const lb = out.levels && out.levels[out.level];
      if (lb && lb.ws && Array.isArray(lb.ws.events)) curEvents = lb.ws.events;
      else if (out.ws && Array.isArray(out.ws.events)) curEvents = out.ws.events;
    } catch (e) {}
    num('riftCount', S.countEvents(curEvents, 'rift_'), 0);
    num('berryCount', S.countEvents(curEvents, 'berry_'), 0);
    if (out.mount === undefined) { out.mount = null; fixed.push('mount'); }
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
    // P0-2：两个 key 都清（防 v1 旧读档歧义；ending/newGame 本来就清档，无写入顺序问题）
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { localStorage.removeItem(KEY2); } catch (e) {}
  };
})();
