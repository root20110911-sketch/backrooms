/* cutout.js —— Systems A：统一切出状态机 + 随机裂隙
 *
 * BR.Cutout.travel(to, opts)：所有跨关出口的统一入口。
 *   opts: { kind: 'walk'|'rift'|'hole'|'berry'|'slide'|'drop'|'water',
 *           pre: 保留字段(暂未用), dropText: 抵达后提示文字 }
 *   流程：kind 专属前段 → BR.Game.gotoLevel(to) → 抵达演出(空中→失衡→落地→撑地→爬起)
 *         → 交还控制。全程 Input 锁定，进度感知看门狗兜底（连续 30s 无加载进度
 *         或总时长超 120s 才视为加载失败；触发即无条件解锁输入 + 弹失败界面，
 *         不许只清 busy）。
 *   镜头强度：BR.Input.settings.dropcam ∈ 'full'|'soft'|'off'（默认 'full'）。
 *
 * BR.Rifts：随机裂隙（运行时选点，可复现）。
 *   判定 RNG 由 seed+':rift:'+count 派生，count 取自 W.state.events 中 rift_ 前缀个数；
 *   落点 RNG 由 seed+':riftspot:'+level+':'+count 派生。同一种子同 count 落点一致。
 *   每关每 90 秒最多显形 1 次；显形前 3~5 秒按关卡主题给视听征兆。
 *   目的地权重（排除当前关与未加载关卡）：
 *     L0:15 L1:15 L11:12 L37:12 L188:10 bang:10 L7:8 L2:8 L3:6 FUN:4
 *   （v1.5 W6：L94→bang 替换；flags.bangEscaped 置位后裂隙不再随机送回 bang）
 *
 * 七色滑梯固定映射（本游戏原创机制——后室原作中 Level Fun 没有滑梯出口）：
 *   红→L0 / 橙→L37 / 黄→L11 / 绿→L1 / 青→L7 / 蓝→bang / 紫→L188
 *   （v1.5 W6：蓝滑梯 94→! 替换；已逃脱时重抽其他已完成层级，见 levels.js 滑梯交互）
 *   映射写死在 BR.Cutout.SLIDE_MAP，滑梯实体见 levels.js FUN buildContent 末尾追加区，
 *   游戏内用海报/字条/痕迹留线索。
 */
(function () {
  const BR = window.BR;

  /* ================= 七色滑梯固定映射（写死常量，可重复验证） ================= */
  // LORE：七色滑梯为本游戏原创机制。游戏内每条滑梯旁有海报/字条/痕迹作为线索。
  const SLIDE_MAP = {
    red:    { to: 'L0',   name: '红', clue: '滑梯旁褪色海报"回家"' },
    orange: { to: 'L37',  name: '橙', clue: '梯口水渍' },
    yellow: { to: 'L11',  name: '黄', clue: '梯口城市明信片' },
    green:  { to: 'L1',   name: '绿', clue: '梯口绿色荧光标记' },
    cyan:   { to: 'L7',   name: '青', clue: '梯口咸腥水渍+贝壳' },
    blue:   { to: 'bang',  name: '蓝', clue: '梯口"跑"字涂鸦' }, // v1.5 W6：94→! 替换，蓝滑梯改送 Level !
    purple: { to: 'L188', name: '紫', clue: '梯口窗框碎片' }
  };
  const SLIDE_ORDER = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'];

  /* ================= BR.Cutout：统一切出状态机 ================= */
  const Cutout = {
    busy: false,
    SLIDE_MAP: SLIDE_MAP,
    SLIDE_ORDER: SLIDE_ORDER
  };
  BR.Cutout = Cutout;

  const P = () => BR.Player;
  const ov = () => BR.$('screen-trans');
  const skipped = () => BR.Trans.active && BR.Trans.active.skipped;

  function waitMs(ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (skipped() || performance.now() - t0 >= ms) { clearInterval(iv); res(); }
      }, 50);
    });
  }

  // 屏幕底部第一人称撑地文字（#toasts 在顶部，不符合"底部"要求，故用专用 overlay）
  Cutout._landText = function (text, ms) {
    let el = document.getElementById('cutout-landtext');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cutout-landtext';
      el.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:70;' +
        'color:#e8e2d2;font-size:17px;letter-spacing:6px;text-shadow:0 0 12px #000;' +
        'background:rgba(0,0,0,0.45);padding:8px 22px;border-radius:8px;pointer-events:none;' +
        'transition:opacity 0.4s;white-space:nowrap;';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this._landTextT);
    this._landTextT = setTimeout(() => { el.style.opacity = 0; }, Math.max(250, ms - 400));
  };

  /* ---------- 主入口 ---------- */
  Cutout.travel = async function (to, opts) {
    opts = opts || {};
    const kind = opts.kind || 'walk';
    if (this.busy) { BR.warn('Cutout.travel busy, ignored:', to, kind); return; }
    if (!BR.Levels[to]) { BR.UI.toast('前方一片黑暗……（该楼层尚未开放）'); return; }
    const from = BR.Game.level;
    this.busy = true;
    // 供 L7 入口房间"返回来处"用
    BR.Game._cameFrom = { from: from, kind: kind, t: Date.now() };
    BR.Input.setLocked(true);

    let finished = false;
    const self = this;
    const finish = () => {
      if (finished) return;
      finished = true;
      watchdog.clear();
      const p = P();
      if (p) { p.extDipY = 0; p.extRoll = 0; p.extPitch = 0; p.extFov = 0; }
      document.body.classList.remove('dropping');
      document.body.classList.remove('underwater');
      self.busy = false;
      if (BR.Game.state === 'playing') BR.Input.setLocked(false);
    };
    // P0-4：加载失败统一处理（不是静默 finish）——无条件解锁输入、清 busy、弹失败界面
    const failLoad = (err) => {
      if (finished) return;
      finished = true;
      watchdog.clear();
      const p = P();
      if (p) { p.extDipY = 0; p.extRoll = 0; p.extPitch = 0; p.extFov = 0; }
      document.body.classList.remove('dropping');
      document.body.classList.remove('underwater');
      // P0-4：失败时转场遮罩绝不能盖住失败界面——_pre 可能已把它拉黑，
      // 也可能上一个转场（如 newGame 的 drop 掉落感）还没播完（此时 _hideOv 会因
      // BR.Trans.active 直接 return，遮罩以 pointer-events:auto 盖在 loading 屏上，
      // 失败按钮点不到——实测根因）。失败路径等不起外层收尾：立刻强制隐藏+让出点击，
      // 并跳过进行中的可跳过转场让它尽快收尾。transitions.js 不动：_finish 的收尾
      // 动作（opacity 0 / pointerEvents none / 去 show）与隐藏状态一致，无冲突。
      const ovEl = ov();
      ovEl.style.transition = 'opacity 200ms linear';
      ovEl.style.opacity = 0;
      ovEl.style.pointerEvents = 'none';
      ovEl.classList.remove('show');
      if (BR.Trans && BR.Trans.skip) BR.Trans.skip();
      self.busy = false;
      const G = BR.Game;
      // 补齐重试上下文（_pre 抛错时 loadLevel 还没跑过）
      G._loadFailCtx = { level: to, opts: opts };
      if (G && G._loadFailed) {
        if (G.state === 'title') BR.Input.setLocked(false); // 回滚失败已回标题，不再弹界面
        else if (G.state === 'loadfail' && G._loadError === err) BR.Input.setLocked(false); // loadLevel 已处理过
        else G._loadFailed(err);
      } else {
        BR.Input.setLocked(false);
      }
    };
    // v2.5 F6(A2-04)：进度感知看门狗（原 P0-4 固定 30s 墙钟版会误杀慢设备上的
    // 重关卡切关——L4→L3、L6→L7 实测目标关其实已生成、只是慢于 30s）。
    // 规则：每 1s 采样一次进度签名，有推进即刷新存活时间戳；连续 30s 零进度才判
    // 失败（走同一 failLoad，不许只清 busy）；另设 120s 绝对上限兜底，防"有假
    // 进度但永不完成"的活锁。进度信号只读加载流程的现成状态（不改 main/world）：
    //  · BR.Game.state / BR.Game._loading —— 加载阶段推进（loading→playing）
    //  · BR.World.map.level —— 目标关地图已生成
    //  · BR.World.chunks.size —— 区块建成数（生成后随 World.update 持续增长）
    //  · BR.World._loadHeartbeat —— 预留心跳槽：加载步骤若有更细粒度进度，可写
    //    入新时间戳推进存活；当前流程未写入，该项不贡献进度（签名恒定）。
    const WD_NO_PROGRESS_MS = 30000, WD_ABS_MS = 120000;
    const wdT0 = performance.now();
    let wdLastProgress = wdT0;
    const wdSig = () => {
      const G = BR.Game, W = BR.World;
      return [
        G ? G.state : '', (G && G._loading) ? 1 : 0,
        (W && W.map) ? W.map.level : '',
        (W && W.chunks) ? W.chunks.size : 0,
        (W && W._loadHeartbeat) || 0
      ].join('|');
    };
    let wdLastSig = wdSig();
    const watchdog = {
      _t: null, _iv: null,
      clear() {
        if (this._t) { clearTimeout(this._t); this._t = null; }
        if (this._iv) { clearInterval(this._iv); this._iv = null; }
      }
    };
    watchdog._iv = setInterval(() => {
      if (finished) { watchdog.clear(); return; }
      const sig = wdSig();
      if (sig !== wdLastSig) { wdLastSig = sig; wdLastProgress = performance.now(); }
    }, 1000);
    const wdArm = () => {
      if (finished) return;
      const now = performance.now();
      const noProgFor = now - wdLastProgress, totalFor = now - wdT0;
      const remain = Math.min(WD_NO_PROGRESS_MS - noProgFor, WD_ABS_MS - totalFor);
      if (remain <= 0) {
        const noProg = noProgFor >= WD_NO_PROGRESS_MS;
        BR.warn('Cutout watchdog fired:', from, '->', to, kind, noProg ? 'no-progress-30s' : 'absolute-120s');
        failLoad(new Error(noProg
          ? '切出超时（看门狗：连续 30s 无加载进度）: ' + from + ' -> ' + to
          : '切出超时（看门狗：总时长超过 120s 上限）: ' + from + ' -> ' + to));
        return;
      }
      watchdog._t = setTimeout(wdArm, remain + 50);
    };
    wdArm();

    try {
      if (kind !== 'none') await this._pre(kind, opts); // ① kind 专属前段（none 跳过）
      await BR.Game.gotoLevel(to, opts);    // ② 跨关（gotoLevel 已修 opts 透传；resolve 时已 playing）
      if (kind !== 'none') {
        BR.Input.setLocked(true);             // loadLevel 末尾解过锁，抵达演出期间重新锁定
        await this._arrival(to, kind, opts);  // ③ 抵达演出（核心）
      }
      BR.Game.autosave();                   // gotoLevel 内部 loadLevel 已存过一次；这里补一次保证事件落盘
    } catch (e) {
      failLoad(e); // P0-4：await 失败 → 失败处理（解锁输入+失败界面），不是静默 finish
      return;
    }
    finish();
  };

  /* ================= BR.Cutout.travelTo：W10 统一跨关接口 =================
   * travelTo(levelId, opts)：所有跨关出口的统一入口（各路出口 use() 里调用，
   *   如 W4 的 L11 井盖→L2 调 travelTo('L2', {mode:'door'})）。
   *   opts.mode: 'fall'（切出坠落，默认）| 'door'（穿门）| 'swim'（水下）| 'none'（无过渡）
   *   opts.dropText: 抵达后提示文字（透传给 travel）
   * mode→kind 映射：fall→'drop' / door→'door' / swim→'water' / none→'none'。
   * 旧 BR.Cutout.travel(to, {kind}) 保留兼容（各关现有调用不动）。
   * 返回 Promise<boolean>：成功开始跨关 true；被 busy/未知关卡拒绝 false。
   */
  Cutout.MODE_MAP = { fall: 'drop', door: 'door', swim: 'water', none: 'none' };
  Cutout.travelTo = function (levelId, opts) {
    opts = opts || {};
    const mode = opts.mode || 'fall';
    const kind = Cutout.MODE_MAP[mode] || 'drop';
    if (!BR.Levels[levelId]) {
      BR.UI.toast('前方一片黑暗……（该楼层尚未开放）');
      return Promise.resolve(false);
    }
    if (this.busy) { BR.warn('Cutout.travelTo busy, ignored:', levelId, mode); return Promise.resolve(false); }
    return Cutout.travel(levelId, { kind: kind, dropText: opts.dropText }).then(() => true);
  };

  /* ---------- 固定 / 条件连接登记（文档即契约；各路出口 use() 调 travelTo） ---------- */
  Cutout.CONNECTIONS = [
    { from: 'L0',   via: 'main_exit',      to: 'L1',   mode: 'door', label: '主出口金属门（v1.5.1 游戏性改编）' },
    { from: 'L11',  via: 'manhole',      to: 'L2',   mode: 'door', label: '井盖', note: 'W4 固定连接：调 travelTo("L2",{mode:"door"})' },
    { from: 'L7',   via: 'deep_exit',    to: 'L37',  mode: 'swim', cond: 'deep', label: '深处出口（水→水）' },
    { from: 'L37',  via: 'deep_channel', to: 'L7',   mode: 'swim', cond: 'deep', label: '深水区水下通道（水→水）' },
    { from: 'L37',  via: 'arch',         to: 'L0',   mode: 'swim', cond: 'shallow', label: '浅水区拱洞' },
    { from: 'L188', via: 'odd_window',   to: 'L1',   mode: 'fall', cond: 'observed', label: '异常窗（需观察发现）' },
    { from: 'L188', via: 'stairwell',    to: 'L11',  mode: 'door', label: '员工室楼梯间（稳定路线）' },
    { from: 'L188', via: 'radio',        to: 'L0',   mode: 'fall', label: '休息室收音机（静电线索）' },
    // v1.5 W6：L94「动画」退役（被 Level ! 'bang' 替换），其 car/castle 连接一并移除
    { from: 'L7',   via: 'entry_door',   to: null,   mode: 'door', cond: 'return', label: '入口房间（返回来处，可逆）' },
    { from: 'L7',   via: 'anomaly_exit', to: 'L0',   mode: 'fall', cond: 'observed', label: '异常切出点' },
    { from: 'L11',  via: 'meg',          to: 'L1',   mode: 'door', cond: 'talked', label: 'MEG 指引（对话后）' },
    { from: 'L11',  via: 'subway',       to: 'L2',   mode: 'door', label: '地铁' },
    { from: 'L11',  via: 'wanderer',     to: 'bang', mode: 'door', cond: 'traded', label: '流浪者信息（信息交换，v1.5 W6：94→! 替换）' }
  ];

  /* ---------- Level ! 屏蔽与随机候选池 ---------- */
  // Level !（"!"）为只出不进的特殊层：一旦 flags.bangEscaped 置位（玩家已逃脱），
  // 随机系统（裂隙/浆果）不再把玩家送回 Level !。
  // Level ! 建造者接入时：BR.Levels 注册关卡，并在主题或关卡对象上标记 bang:true；
  // 若关卡 id 不是 'BANG'，设置 BR.Cutout.BANG_ID 为实际 id。
  Cutout.BANG_ID = 'BANG';
  Cutout._extraRiftDests = []; // [id, weight]：后续新关卡登记随机候选
  Cutout.registerRiftDest = function (id, weight) {
    Cutout._extraRiftDests.push([id, weight == null ? 5 : weight]);
  };
  // 随机目的地候选池（裂隙/浆果共用）：仅"已完成"（BR.Levels 已注册）且合规
  Cutout.destPool = function (from) {
    const bang = Cutout.BANG_ID;
    const escaped = !!(BR.Game && BR.Game.flags && BR.Game.flags.bangEscaped);
    const pool = [];
    const push = (lv, w) => {
      if (lv === from) return;                    // 排除当前关
      const L = BR.Levels && BR.Levels[lv];
      if (!L) return;                             // 未完成/未注册不进
      if (L.noRift) return;                       // 关卡主动退出随机池
      if (escaped && (lv === bang || L.bang === true)) return; // 已逃脱不再送回 Level !
      pool.push([lv, w]);
    };
    for (const [lv, w] of RIFT_WEIGHTS) push(lv, w);
    for (const [lv, w] of Cutout._extraRiftDests) push(lv, w);
    return pool;
  };
  // 按权重抽取（rng 需有 next()；调用方保证种子派生可复现）
  Cutout.pickRandomDest = function (from, rng) {
    const pool = Cutout.destPool(from);
    let total = 0;
    for (const pw of pool) total += pw[1];
    if (!pool.length || total <= 0) return 'L0';
    let r = rng.next() * total, dest = pool[0][0];
    for (const pw of pool) { r -= pw[1]; if (r <= 0) { dest = pw[0]; break; } }
    return dest;
  };

  /* ================= 切出类型注册表（v2.3 W-cutout 接口整理） =================
   * 所有切出类型（kind）在此登记：接入新类型只许 Cutout.registerType(name, def)，
   * 不许改 Cutout._pre / Cutout._arrival 的分发逻辑。
   * def 字段：
   *   label: 中文名；desc: 一句话说明；
   *   media: 介质（'air' | 'water' | 'duct' …，供设计文档与测试分类）；
   *   sense: 主导身体感（'walk' | 'fall' | 'swim' | 'crawl' | 'slide' | 'vertigo' …）；
   *   preBudget: 前段时长预算（ms，红线 ≤ 3000）；
   *   arrivalBudget: 抵达时长预算（ms，红线 ≤ 3500）；
   *   pre(opts, setOv): 前段演出（this=Cutout；须配合 skipped() 可跳过）；
   *   arrival(ovEl, opts): 自定义抵达（this=Cutout）；不填则按 arrivalStyle 走既有抵达演出；
   *   arrivalStyle: 'drop' | 'water' | 'door' | 'none'（既有抵达演出的复用开关）。
   * 时长红线（详见 docs/CUTOUT_DESIGN.md）：前段 ≤ 3s、抵达 ≤ 3.5s，不许做成冗长动画。
   */
  Cutout.TYPES = {};
  Cutout.PRE_BUDGET_MAX = 3000;
  Cutout.ARRIVAL_BUDGET_MAX = 3500;
  Cutout.registerType = function (name, def) {
    if (typeof name !== 'string' || !name || !def || typeof def !== 'object') {
      BR.warn('Cutout.registerType 参数非法:', name);
      return false;
    }
    if (this.TYPES[name]) BR.warn('Cutout.registerType 覆盖已有切出类型:', name);
    const d = Object.assign({
      label: name, desc: '', media: 'air', sense: 'walk',
      preBudget: 800, arrivalBudget: 3000,
      pre: null, arrival: null, arrivalStyle: 'drop'
    }, def);
    if (d.preBudget > this.PRE_BUDGET_MAX) BR.warn('切出类型前段超红线:', name, d.preBudget);
    if (d.arrivalBudget > this.ARRIVAL_BUDGET_MAX) BR.warn('切出类型抵达超红线:', name, d.arrivalBudget);
    this.TYPES[name] = d;
    return true;
  };

  /* ---------- 内建切出类型登记（v2.3：把旧 _pre/_arrival switch 的各分支原样搬入注册表，
   *   演出代码逐字一致、只搬运不改逻辑；后续新类型只许新增 registerType 调用） ---------- */
  (function registerBuiltinTypes() {
    // walk / manila：短暂黑边（manila 为 L0 马尼拉房间专用 kind，演出与 walk 一致）
    const preStepThrough = (splash) => async function (opts, setOv) {
      if (splash) BR.Audio.splash(); else BR.Audio.glitch();
      await waitMs(450);
      await setOv(1, 350);
    };
    Cutout.registerType('walk', {
      label: '步行切出', desc: '穿门/野切出等默认', media: 'air', sense: 'walk',
      preBudget: 800, arrivalBudget: 3000,
      pre: preStepThrough(false), arrivalStyle: 'drop'
    });
    Cutout.registerType('manila', {
      label: '马尼拉房间', desc: 'L0 马尼拉房间切出（演出与 walk 一致）', media: 'air', sense: 'walk',
      preBudget: 800, arrivalBudget: 3000,
      pre: preStepThrough(false), arrivalStyle: 'drop'
    });
    // water：旧 default 分支的水下变体；抵达走坠水演出（travelTo mode 'swim' 映射到此）
    Cutout.registerType('water', {
      label: '落水切出', desc: '旧水下通道/深水出口', media: 'water', sense: 'swim',
      preBudget: 800, arrivalBudget: 2300,
      pre: preStepThrough(true), arrivalStyle: 'water'
    });
    // door：穿门前段（门轴声 + 渐暗，无坠落）+ 穿门抵达（淡入）
    Cutout.registerType('door', {
      label: '穿门', desc: '门后是平地，无坠落', media: 'air', sense: 'walk',
      preBudget: 1100, arrivalBudget: 1400,
      pre: async function (opts, setOv) {
        BR.Audio.doorCreak();
        await waitMs(500);
        await setOv(1, 600);
      },
      arrival: async function (ovEl, opts) { await this._arrivalDoor(ovEl, opts); }
    });
    // drop：切出坠落前段（短暂异常 → 失重下沉；travelTo mode 'fall' 映射到此）
    Cutout.registerType('drop', {
      label: '坠落切出', desc: '异常点/窗等坠落式切出', media: 'air', sense: 'fall',
      preBudget: 1200, arrivalBudget: 3000,
      pre: async function (opts, setOv) {
        const p = P(), ovEl = ov();
        BR.Audio.glitch();
        BR.Audio.dropRumble(0.9);
        const t0d = performance.now(), durd = 900;
        await new Promise((res) => {
          const iv = setInterval(() => {
            if (skipped() || performance.now() - t0d >= durd) { clearInterval(iv); res(); return; }
            const t = Math.min(1, (performance.now() - t0d) / durd);
            p.extDipY = -0.5 * t * t;
            p.extRoll = Math.sin(t * 7) * 0.04 * t;
            ovEl.style.opacity = Math.max(0.25, 1 - t * 0.75);
          }, 33);
        });
        p.extDipY = 0; p.extRoll = 0;
        await setOv(1, 300);
      },
      arrivalStyle: 'drop'
    });
    // slide：滑梯俯冲前段（镜头下压 + 呼啸 + 暗角收紧）
    Cutout.registerType('slide', {
      label: '滑梯切出', desc: '七色滑梯（levels2 第一人称滑行之后）', media: 'air', sense: 'slide',
      preBudget: 1700, arrivalBudget: 3000,
      pre: async function (opts, setOv) {
        const p = P(), ovEl = ov();
        BR.Audio.dropRumble(1.3);
        document.body.classList.add('dropping');
        const t0 = performance.now(), dur = 1300;
        await new Promise((res) => {
          const iv = setInterval(() => {
            if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
            const t = Math.min(1, (performance.now() - t0) / dur);
            p.extPitch = -0.55 * t;
            p.extRoll = Math.sin(t * 9) * 0.06 * t;
            p.extDipY = -0.25 * t;
            p.extFov = Math.sin(t * Math.PI) * 10;
            ovEl.style.opacity = Math.max(0.55, 1 - t * 0.45);
          }, 33);
        });
        p.extPitch = 0; p.extRoll = 0; p.extDipY = 0; p.extFov = 0;
        await setOv(1, 350);
      },
      arrivalStyle: 'drop'
    });
    // berry：食用后视线眩晕（正弦摇摆，小幅）
    Cutout.registerType('berry', {
      label: '浆果切出', desc: '食用浆果后的眩晕切出', media: 'air', sense: 'vertigo',
      preBudget: 1900, arrivalBudget: 3000,
      pre: async function (opts, setOv) {
        const p = P(), ovEl = ov();
        BR.Audio.glitch();
        ovEl.classList.add('glitch');
        const t0 = performance.now(), dur = 1600;
        await new Promise((res) => {
          const iv = setInterval(() => {
            if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
            const t = Math.min(1, (performance.now() - t0) / dur);
            const kk = Math.sin(t * Math.PI);
            p.extRoll = Math.sin(t * 14) * 0.22 * kk;
            p.extPitch = Math.sin(t * 9 + 1) * 0.12 * kk;
            ovEl.style.opacity = Math.max(0, 1 - t * 1.4);
          }, 33);
        });
        ovEl.classList.remove('glitch');
        p.extRoll = 0; p.extPitch = 0;
        await setOv(1, 300);
      },
      arrivalStyle: 'drop'
    });
    // hole / rift：被吸入 / 坠入（下沉 + 嗡鸣）
    const preSinkIn = async function (opts, setOv) {
      const p = P(), ovEl = ov();
      BR.Audio.dropRumble(1.1);
      const t0 = performance.now(), dur = 1100;
      await new Promise((res) => {
        const iv = setInterval(() => {
          if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
          const t = Math.min(1, (performance.now() - t0) / dur);
          p.extDipY = -0.9 * t * t;
          p.extRoll = Math.sin(t * 8) * 0.05 * t;
          ovEl.style.opacity = Math.max(0, 1 - t * 1.1);
        }, 33);
      });
      p.extDipY = 0; p.extRoll = 0;
      await setOv(1, 300);
    };
    Cutout.registerType('hole', {
      label: '坠入切出', desc: '地板洞/天花板被拉入', media: 'air', sense: 'fall',
      preBudget: 1400, arrivalBudget: 3000,
      pre: preSinkIn, arrivalStyle: 'drop'
    });
    Cutout.registerType('rift', {
      label: '裂隙切出', desc: '随机裂隙/实体裂隙', media: 'air', sense: 'fall',
      preBudget: 1400, arrivalBudget: 3000,
      pre: preSinkIn, arrivalStyle: 'drop'
    });
    // none：无过渡；travel 内部直接跳过 _pre/_arrival，登记仅作目录
    Cutout.registerType('none', {
      label: '无过渡', desc: '直接黑场切关', media: 'air', sense: 'walk',
      preBudget: 0, arrivalBudget: 500,
      pre: null, arrival: null, arrivalStyle: 'none'
    });

    /* ---------- v2.3 原型 1：管道爬行切出（duct） ----------
     * 身体感：入管压低（extDipY）→ 视野收窄（extFov 负向）→ 手脚交替爬行的
     * 俯仰起伏 + 左右轻摆（extPitch/extRoll）→ 黑场衔接抵达。
     * 方向连续：全程不碰 yaw；抵达后由目标关 spawn 朝向接管。 */
    Cutout.registerType('duct', {
      label: '管道爬行', desc: 'v2.3 原型：真实爬行穿越通风管', media: 'duct', sense: 'crawl',
      preBudget: 2800, arrivalBudget: 1500,
      pre: async function (opts, setOv) {
        const p = P(), ovEl = ov();
        BR.Audio.dropRumble(2.0); // 管壁低频回声
        const t0 = performance.now(), dur = 2400;
        await new Promise((res) => {
          const iv = setInterval(() => {
            if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
            const t = Math.min(1, (performance.now() - t0) / dur);
            // P1 入管（0~0.5s）：压低身体 + 收窄视野 + 微低头
            const k1 = Math.min(1, t / 0.21);
            p.extDipY = -0.55 * k1;
            p.extFov = -8 * k1;
            p.extPitch = -0.12 * k1;
            // P2 爬行（0.5~1.9s）：手脚交替的起伏与左右轻摆（管壁近，黑边压暗）
            if (t > 0.21) {
              const ct = (t - 0.21) / 0.58;
              p.extRoll = Math.sin(ct * Math.PI * 6) * 0.05;
              p.extPitch = -0.12 + Math.sin(ct * Math.PI * 6 + 1) * 0.035;
              p.extFov = -8 + Math.sin(ct * Math.PI * 4) * 1.5;
            }
            ovEl.style.opacity = Math.max(0.55, 1 - t * 0.45);
          }, 33);
        });
        p.extPitch = 0; p.extRoll = 0;
        // extDipY/extFov 保留（-0.55/-8），抵达演出负责"钻出站起"，保证身体连续
        await setOv(1, 400);
      },
      arrival: async function (ovEl, opts) {
        const p = P();
        // 从管口钻出：视野渐开 + 1 秒内缓缓站起
        ovEl.style.transition = 'opacity 900ms linear';
        ovEl.style.opacity = 0;
        const t0 = performance.now(), dur = 1000;
        await new Promise((res) => {
          const iv = setInterval(() => {
            if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
            const t = Math.min(1, (performance.now() - t0) / dur);
            p.extDipY = -0.55 * (1 - t);
            p.extFov = -8 * (1 - t);
          }, 33);
        });
        p.extDipY = 0; p.extFov = 0;
        if (opts && opts.dropText) BR.UI.toast(opts.dropText, 2200);
        await waitMs(300);
        this._hideOv(ovEl);
      }
    });

    /* ---------- v2.3 原型 2：深水穿越（dive） ----------
     * 身体感：潜入下沉（extDipY）→ 水压（低频 + 视野收窄）→ 介质阻力
     * （慢速摆动前行）→ 黑场衔接既有坠水抵达（浮起）。
     * 方向连续：全程不碰 yaw。 */
    Cutout.registerType('dive', {
      label: '深水穿越', desc: 'v2.3 原型：真实潜游穿越水下通道', media: 'water', sense: 'swim',
      preBudget: 2700, arrivalBudget: 2300,
      pre: async function (opts, setOv) {
        const p = P(), ovEl = ov();
        BR.Audio.splash();
        BR.Audio.dropRumble(1.6); // 水压低频
        document.body.classList.add('underwater');
        const t0 = performance.now(), dur = 2200;
        await new Promise((res) => {
          const iv = setInterval(() => {
            if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
            const t = Math.min(1, (performance.now() - t0) / dur);
            // P1 潜入（0~0.6s）：下沉
            const k1 = Math.min(1, t / 0.27);
            p.extDipY = -0.9 * k1;
            // P2 潜游穿越：身体前倾 + 水流摆动（介质阻力 = 慢）
            const st = Math.max(0, (t - 0.27) / 0.5);
            p.extPitch = -0.18 * Math.min(1, st * 2);
            p.extRoll = Math.sin(st * Math.PI * 4) * 0.06;
            p.extFov = -4 + Math.sin(st * Math.PI * 3) * 2;
            ovEl.style.opacity = Math.min(0.9, 0.55 + t * 0.4);
          }, 33);
        });
        p.extPitch = 0; p.extRoll = 0;
        // extDipY 保留 -0.9（黑场下不可见跳变），抵达演出负责浮起
        await setOv(1, 500);
      },
      arrivalStyle: 'water'
    });
  })();

  /* ---------- ① kind 专属前段（分发只走注册表：未知 kind 回落 walk，不许加 switch/if 扩展） ---------- */
  Cutout._pre = async function (kind, opts) {
    const ovEl = ov();
    const inTrans = !!BR.Trans.active;
    if (!inTrans) {
      ovEl.classList.add('show');
      ovEl.style.transition = 'none';
      ovEl.style.opacity = 1;
      ovEl.style.pointerEvents = 'none';
    }
    const setOv = (op, ms) => new Promise((res) => {
      ovEl.style.transition = `opacity ${ms}ms linear`;
      ovEl.style.opacity = op;
      setTimeout(res, ms);
    });
    const T = this.TYPES[kind] || this.TYPES.walk;
    if (T && typeof T.pre === 'function') await T.pre.call(this, opts, setOv);
    document.body.classList.remove('dropping');
    // overlay 保持黑场，抵达演出负责揭开
  };

  /* ---------- ③ 抵达演出（分发只走注册表） ---------- */
  Cutout._arrival = async function (to, kind, opts) {
    const ovEl = ov();
    const T = this.TYPES[kind] || this.TYPES.walk;
    // 自定义抵达（如穿门/管道钻出）优先：与旧行为一致，忽略 dropcam 设置
    if (T && typeof T.arrival === 'function') { await T.arrival.call(this, ovEl, opts); return; }
    const style = (T && T.arrivalStyle) || 'drop';
    if (style === 'none') { this._hideOv(ovEl); return; }
    const dropcam = (BR.Input.settings && BR.Input.settings.dropcam) || 'full';
    const watery = style === 'water' ||
      !!(BR.Levels[to] && BR.Levels[to].theme && BR.Levels[to].theme.waterArrival);
    if (dropcam === 'off') {
      // 用淡入淡出代替抵达演出
      await waitMs(600);
      ovEl.style.transition = 'opacity 1200ms linear';
      ovEl.style.opacity = 0;
      await waitMs(1300);
      if (opts && opts.dropText) BR.UI.toast(opts.dropText, 2200);
      this._hideOv(ovEl);
      return;
    }
    const soft = dropcam === 'soft';
    if (watery) await this._arrivalWater(ovEl, soft, opts);
    else await this._arrivalDrop(ovEl, soft, opts);
  };

  // 旱地抵达：空中出现 → 视角失衡（小幅正弦，不许疯狂翻转）→ 地面接近 →
  // 落地冲击（thud+shake+landDip+撑地文字）→ 缓慢爬起 → 交还控制
  Cutout._arrivalDrop = async function (ovEl, soft, opts) {
    const p = P();
    const k = soft ? 0.5 : 1; // soft：幅度减半、无翻转成分
    document.body.classList.add('dropping');
    BR.Audio.dropRumble(1.5); // 下坠风声
    const t0 = performance.now(), dur = 1500;
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
        const t = Math.min(1, (performance.now() - t0) / dur);
        const fall = t * t; // 加速下坠
        p.extDipY = 1.35 * k * (1 - fall);
        p.extRoll = soft ? 0 : Math.sin(t * 10) * 0.06 * (1 - t);
        p.extPitch = Math.sin(t * 6 + 1) * 0.035 * k * (1 - t);
        p.extFov = soft ? 0 : Math.sin(t * Math.PI) * 7;
        ovEl.style.opacity = Math.max(0, 1 - t * 1.5);
      }, 33);
    });
    // 落地冲击
    p.extDipY = 0; p.extRoll = 0; p.extPitch = 0; p.extFov = 0;
    BR.Audio.thud();
    p.shake(0.6); p.landDip();
    this._landText('手臂撑地……', 1000); // 第一人称撑地：屏幕底部文字 1 秒
    document.body.classList.remove('dropping');
    // 缓慢爬起：1.2s 内 extDipY 从 -0.5 回 0
    const t1 = performance.now(), dur2 = 1200;
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (skipped() || performance.now() - t1 >= dur2) { clearInterval(iv); res(); return; }
        const t = Math.min(1, (performance.now() - t1) / dur2);
        p.extDipY = -0.5 * k * (1 - t);
      }, 33);
    });
    p.extDipY = 0;
    if (opts && opts.dropText) BR.UI.toast(opts.dropText, 2200);
    await waitMs(300);
    this._hideOv(ovEl);
  };

  // 坠水专属：入水闷响 + 水花声 + underwater 视角
  Cutout._arrivalWater = async function (ovEl, soft, opts) {
    const p = P();
    BR.Audio.splash();
    BR.Audio.thud(); // 入水闷响
    document.body.classList.add('underwater');
    const t0 = performance.now(), dur = 1400;
    await new Promise((res) => {
      const iv = setInterval(() => {
        if (skipped() || performance.now() - t0 >= dur) { clearInterval(iv); res(); return; }
        const t = Math.min(1, (performance.now() - t0) / dur);
        p.extDipY = -0.35 * (1 - t); // 从水下浮起
        p.extRoll = Math.sin(t * 7) * 0.04 * (1 - t);
        ovEl.style.opacity = Math.max(0, 1 - t * 1.3);
      }, 33);
    });
    p.extDipY = 0; p.extRoll = 0;
    p.shake(0.4);
    BR.UI.toast('你跌进了水里……', 2000);
    // 水下效果 2 秒内退去
    setTimeout(() => document.body.classList.remove('underwater'), 2000);
    if (opts && opts.dropText) BR.UI.toast(opts.dropText, 2200);
    await waitMs(900);
    this._hideOv(ovEl);
  };

  // 穿门抵达（W10）：淡入（门后是平地，无坠落演出）+ 身后门合上声
  Cutout._arrivalDoor = async function (ovEl, opts) {
    await waitMs(400);
    ovEl.style.transition = 'opacity 900ms linear';
    ovEl.style.opacity = 0;
    await waitMs(950);
    BR.Audio.doorCreak();
    if (opts && opts.dropText) BR.UI.toast(opts.dropText, 2200);
    this._hideOv(ovEl);
  };

  Cutout._hideOv = function (ovEl) {
    if (BR.Trans.active) return; // 外层转场自己收尾
    ovEl = ovEl || ov();
    ovEl.style.transition = 'opacity 400ms linear';
    ovEl.style.opacity = 0;
    ovEl.style.pointerEvents = 'none';
    setTimeout(() => { if (!BR.Trans.active) ovEl.classList.remove('show'); }, 450);
  };

  /* ================= BR.Rifts：随机裂隙 ================= */
  // LORE：随机裂隙为本游戏原创机制。
  const RIFT_WEIGHTS = [
    ['L0', 15], ['L1', 15], ['L11', 12], ['L37', 12], ['L188', 10],
    ['L7', 8], ['L2', 8], ['L3', 6], ['FUN', 4]
  ];
  // v1.5 W6：L94 从随机池移除；Level !（id 'bang'）由 lv_bang.js 经
  // BR.Cutout.registerRiftDest('bang', 10) 登记（见本文件 _extraRiftDests）。
  // 按关卡空间特性选显形形式：crack=墙角裂缝(主动进) / hole=地板洞(踩空) / door=回头变的门
  const RIFT_FORM = {
    L0: 'crack', L1: 'hole', L2: 'hole', L3: 'door', FUN: 'door',
    L188: 'crack', L37: 'hole', bang: 'door', L7: 'crack', L11: 'crack'
  };
  const RIFT_OMEN_TEXT = {
    L0: '墙缝里渗出微光，还伴着低鸣……',
    L1: '地板在微微震动……',
    L2: '管道深处传来异响……',
    L3: '有电火花在墙角跳动……',
    FUN: '有只气球自己飘了起来……'
  };

  const Rifts = {
    _cd: 90,        // 距下次判定的秒数
    _level: null,
    _pending: null, // {t, form, tx, ty, nx, nz, to, count, marker}
    _manifest: null,// {form, tx, ty, nx, nz, to, count, group, itId, ttl}
    _frameT: undefined,
    _visitCount: 0, // 本关本次停留已显形次数（上限用，重载不无限刷）
    RIFT_WEIGHTS: RIFT_WEIGHTS,
    // W10：随机规则配置——概率（showChance/权重表）+ 上限（冷却/每关显形上限）均可调；
    // 不许每帧抽（tick 按帧去重 + 冷却），重载不无限刷（riftCount 跨关单调 + 本关上限）。
    config: {
      showChance: 0.55,   // 每次判定显形的概率
      cdSec: 90,          // 显形冷却（秒）：每关每 90s 最多显形 1 次
      firstMin: 55, firstMax: 90,   // 进关后首次判定延迟区间
      noShowMin: 45, noShowMax: 90, // 判定未显形后的退避
      omenMin: 3, omenMax: 5,       // 显形前征兆秒数
      maxPerVisit: 4,     // 每关每次停留最多显形次数
      manifestTtl: 30     // 显形持续秒数
    }
  };
  BR.Rifts = Rifts;

  // 主循环调用（main.js）；关卡 tick 里也可调，内部按帧去重
  Rifts.tick = function (dt) {
    if (BR.Game.state !== 'playing' || Cutout.busy) return;
    const ft = BR.Game._lastT;
    if (typeof ft === 'number' && ft === this._frameT) return; // 同一帧重复调用去重
    this._frameT = ft;
    const level = BR.Game.level, W = BR.World;
    if (!W || !W.map) return;
    if (level !== this._level) {
      this._level = level;
      // 进关后 55~90s 首次判定（种子派生，保证同一种子行为一致）
      const cfg = this.config;
      this._cd = cfg.firstMin + (BR.hashSeed(BR.Game.seed + ':riftcd:' + level) % (cfg.firstMax - cfg.firstMin));
      this._pending = null;
      this._visitCount = 0; // 换关重置本关显形计数
      this._clearManifest();
    }
    this._cd -= dt;
    if (this._pending) this._tickPending(dt);
    else if (this._manifest) this._tickManifest(dt);
    else if (this._cd <= 0) this._roll();
  };

  // 纯派生：同一种子 + 同关卡 + 同 count → 同落点（可复现，供测试与判定共用）
  // W10：候选池走 Cutout.destPool（仅已完成且合规；尊重 flags.bangEscaped）
  Rifts._derive = function (seed, level, count, W) {
    const cfg = this.config;
    const rng = new BR.RNG(BR.hashSeed(seed + ':rift:' + count));
    if (rng.next() > cfg.showChance) return { show: false };
    const pool = Cutout.destPool(level);
    if (!pool.length) return { show: false };
    const to = Cutout.pickRandomDest(level, rng);
    const srng = new BR.RNG(BR.hashSeed(seed + ':riftspot:' + level + ':' + count));
    const spot = this._pickSpot(W, srng);
    if (!spot) return { show: false };
    return { show: true, to: to, tx: spot.tx, ty: spot.ty, nx: spot.nx, nz: spot.nz, form: RIFT_FORM[level] || 'crack' };
  };

  Rifts._pickSpot = function (W, rng) {
    const map = W.map, rooms = map.rooms || [];
    if (!rooms.length) return null;
    const sp = (map.pois || []).find(p => p.type === 'spawn');
    for (let tries = 0; tries < 24; tries++) {
      const r = rooms[rng.int(0, rooms.length - 1)];
      const tx = rng.int(r.x, r.x + r.w - 1), ty = rng.int(r.y, r.y + r.h - 1);
      if (W.tile(tx, ty) !== 1) continue;
      if (sp && Math.hypot(tx - sp.tx, ty - sp.ty) < 4) continue; // 别糊脸
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let wall = null;
      for (const [dx, dy] of dirs) if (W.isWall(tx + dx, ty + dy)) { wall = [dx, dy]; break; }
      return { tx: tx, ty: ty, nx: wall ? -wall[0] : 0, nz: wall ? -wall[1] : 1 };
    }
    return null;
  };

  Rifts._roll = function () {
    const W = BR.World, level = BR.Game.level;
    const cfg = this.config;
    // 本关显形上限：达到后不再判定（防无限刷）
    if (this._visitCount >= cfg.maxPerVisit) { this._cd = cfg.cdSec; return; }
    // 跨关单调计数：flags.riftCount 在进入裂隙后递增、存档保留。
    // （修 bug：原来按本关 ws.events 计数，跨关后新关 events 为空，count 永远从 0 开始）
    const count = (BR.Game.flags && BR.Game.flags.riftCount) || 0;
    const d = this._derive(BR.Game.seed, level, count, W);
    if (!d.show) {
      this._cd = cfg.noShowMin + (BR.hashSeed(BR.Game.seed + ':riftnoshow:' + level + count) % (cfg.noShowMax - cfg.noShowMin));
      return;
    }
    const omenSpan = cfg.omenMax - cfg.omenMin;
    this._pending = {
      t: cfg.omenMin + (BR.hashSeed(BR.Game.seed + ':riftomen:' + level + count) % Math.round(omenSpan * 100)) / 100, // 3~5s
      form: d.form, tx: d.tx, ty: d.ty, nx: d.nx, nz: d.nz, to: d.to, count: count, marker: null, shakeT: 0
    };
    this._omen(level, d.form, d);
    this._cd = cfg.cdSec; // 本轮进入冷却：每关每 90s 最多显形 1 次
  };

  // 显形前 3~5 秒视听征兆（按关卡主题）
  Rifts._omen = function (level, form, d) {
    const W = BR.World;
    const x = BR.tileCX(d.tx), z = BR.tileCZ(d.ty);
    const color = { L0: 0xbfd8ff, L1: 0xffd080, L2: 0x9fd8ff, L3: 0xc0a0ff, FUN: 0xffa0d0 }[level] || 0x9fd8ff;
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    if (form === 'hole') { mk.rotation.x = -Math.PI / 2; mk.position.set(x, 0.06, z); }
    else {
      mk.position.set(x + d.nx * 0.25, 1.2, z + d.nz * 0.25);
      mk.rotation.y = Math.atan2(d.nx, d.nz);
    }
    W.scene.add(mk);
    this._pending.marker = mk;
    const A = BR.Audio;
    if (level === 'L0') A.dropRumble(3);        // 墙缝渗光 + 低鸣
    else if (level === 'L1') { /* 地板震动在 _tickPending 里做 */ }
    else if (level === 'L2') A.glitch();       // 管道异响
    else if (level === 'L3') A.flickerBuzz();  // 电火花
    else if (level === 'FUN') A.partyStart();  // 气球飘动（音乐先起）
    else A.glitch();                           // 新关卡按主题：通用异响
    BR.UI.toast(RIFT_OMEN_TEXT[level] || '空气里有什么不对劲……', 2800);
  };

  Rifts._tickPending = function (dt) {
    const pd = this._pending;
    pd.t -= dt;
    if (pd.marker) {
      pd.marker.material.opacity = 0.3 + 0.25 * Math.sin(performance.now() * 0.012);
      pd.marker.rotation.z += dt * 0.8;
    }
    // L1 地板震动征兆
    if (this._level === 'L1') {
      pd.shakeT -= dt;
      if (pd.shakeT <= 0) { pd.shakeT = 0.5; P().shake(0.12); }
    }
    if (pd.t <= 0) {
      if (pd.marker) { BR.World.scene.remove(pd.marker); pd.marker.material.dispose(); pd.marker.geometry.dispose(); }
      this._pending = null;
      this._manifestRift(pd);
    }
  };

  Rifts._manifestRift = function (m) {
    const W = BR.World;
    const x = BR.tileCX(m.tx), z = BR.tileCZ(m.ty);
    const g = new THREE.Group();
    const faceY = Math.atan2(m.nx, m.nz);
    if (m.form === 'crack') {
      // 墙角裂缝：竖直发光裂缝 + 光晕
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.2),
        new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, depthWrite: false }));
      crack.position.set(x + m.nx * (BR.TILE / 2 - 0.06), 1.35, z + m.nz * (BR.TILE / 2 - 0.06));
      crack.rotation.y = faceY;
      g.add(crack);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6),
        new THREE.MeshBasicMaterial({ color: 0x4a90c8, transparent: true, opacity: 0.25, depthWrite: false }));
      halo.position.copy(crack.position);
      halo.rotation.y = faceY;
      g.add(halo);
    } else if (m.form === 'hole') {
      // 地板洞：黑洞 + 微光边缘
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000 }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(x, 0.03, z);
      g.add(hole);
      const rim = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 20),
        new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(x, 0.045, z);
      g.add(rim);
    } else {
      // 回头变的门：门框 + 黑暗门板
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.4, 0.12),
        new THREE.MeshLambertMaterial({ color: 0x4a3f33 }));
      frame.position.set(x + m.nx * 0.4, 1.2, z + m.nz * 0.4);
      frame.rotation.y = faceY;
      g.add(frame);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1),
        new THREE.MeshBasicMaterial({ color: 0x061018 }));
      panel.position.set(x + m.nx * 0.48, 1.15, z + m.nz * 0.48);
      panel.rotation.y = faceY;
      g.add(panel);
      const seam = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.06),
        new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.8, depthWrite: false }));
      seam.position.set(x + m.nx * 0.49, 2.0, z + m.nz * 0.49);
      seam.rotation.y = faceY;
      g.add(seam);
    }
    W.scene.add(g);
    const it = {
      id: 'rift_' + m.count, kind: 'rift',
      chunkKey: W.chunkKeyOf(m.tx, m.ty),
      meshes: g.children.slice(),
      pos: new THREE.Vector3(x, 1.4, z), radius: 2.8,
      prompt: () => m.form === 'hole' ? '跳进这个洞（下面有风声）' :
        m.form === 'door' ? '这扇门刚才好像不在这里……推门进去' : '挤进墙缝里的裂隙',
      canUse: () => !Cutout.busy,
      use: () => Rifts._enterRift(m)
    };
    W.addInteractable(it);
    m.group = g; m.itId = it.id; m.ttl = this.config.manifestTtl;
    this._visitCount++; // 本关显形计数（上限见 config.maxPerVisit）
    this._manifest = m;
    if (m.form === 'door') BR.UI.toast('你身后好像多了扇门……', 2600);
    else if (m.form === 'hole') BR.UI.toast('地板上裂开了一个洞……', 2600);
    else BR.UI.toast('墙角的裂缝在渗出微光……', 2600);
  };

  Rifts._tickManifest = function (dt) {
    const m = this._manifest;
    m.ttl -= dt;
    // 地板洞：走上去踩空
    // W10：垂直贴合判定——脚底必须贴近洞所在 tile 的地面（±0.6m）才算踩进。
    // 修隐患：L37 游泳时脚底 pos.y≈-0.82，旧的 pos.y<0.45 守卫会被游过池底裂隙误触发；
    // 新判定下：陆面行走（脚≈地面）✓ / 跳跃穿过（脚高于地面）✗ / 水面游泳（脚悬于深水）✗ /
    // 下潜到池底（脚≈池底）✓。原有 busy 防重复触发保留。
    if (m.form === 'hole' && !Cutout.busy) {
      const p = P();
      const dx = p.pos.x - BR.tileCX(m.tx), dz = p.pos.z - BR.tileCZ(m.ty);
      if (Math.hypot(dx, dz) < 0.9) {
        let gy = 0;
        try { gy = (typeof p._groundYAt === 'function') ? p._groundYAt(BR.tileCX(m.tx), BR.tileCZ(m.ty)) : 0; }
        catch (e) { gy = 0; }
        if (isFinite(gy) && Math.abs(p.pos.y - gy) < 0.6) { this._enterRift(m); return; }
      }
    }
    if (m.ttl <= 0) {
      this._clearManifest();
      BR.UI.toast('裂隙闪烁了几下，消失了', 2000);
    }
  };

  Rifts._enterRift = async function (m) {
    if (Cutout.busy) return;
    const from = BR.Game.level;
    this._clearManifest();
    this._pending = null;
    await Cutout.travel(m.to, { kind: 'rift' });
    // 落地=目标关 spawn 附近（loadLevel 已放出生点）+ 3 秒"落地恢复"（短暂无敌+提示）
    P().hurtCd = 3;
    BR.UI.toast('裂隙把你吐了出来。先缓一缓……', 3000);
    const W = BR.World;
    W.state.events = W.state.events || [];
    W.state.events.push('rift_' + m.count + ':' + from + '>' + m.to);
    // 跨关单调计数（见 _roll 注释）
    BR.Game.flags.riftCount = (BR.Game.flags.riftCount || 0) + 1;
    BR.Game.autosave();
  };

  Rifts._clearManifest = function () {
    const m = this._manifest;
    if (!m) return;
    this._manifest = null;
    if (m.itId) BR.World.removeInteractable(m.itId);
    if (m.group) {
      BR.World.scene.remove(m.group);
      m.group.children.forEach(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    }
  };
})();
