/* input.js —— 键盘鼠标 + 平板触控（摇杆/视角/按钮，多点触控）
 * v1.2：SVG 线条图标 / 全屏与横屏引导 / 镜头晃动设置 */
(function () {
  const BR = window.BR;

  // 统一线条图标（SVG，currentColor）
  const ICONS = {
    flashlight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h6v5H9z"/><path d="M10 7.5 6.5 15a2.4 2.4 0 0 0 2.1 3.5h6.8a2.4 2.4 0 0 0 2.1-3.5L14 7.5"/><circle cx="12" cy="16.5" r="1.2"/></svg>',
    crouch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="M6.5 9.5 12 15l5.5-5.5"/><path d="M4.5 20.5h15"/></svg>',
    run: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5h9M3 12h13M3 17.5h9"/><path d="M15.5 8.5 19.5 12l-4 3.5"/></svg>',
    interact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/></svg>',
    // G（v1.3 触屏补齐）：背包 / 第三人称
    backpack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7.5" width="10" height="11.5" rx="4"/><path d="M9.5 7.5V6a2.4 2.4 0 0 1 2.4-2.4h0.2A2.4 2.4 0 0 1 14.5 6v1.5"/><rect x="9.6" y="11.5" width="4.8" height="4.4" rx="1.4"/></svg>',
    thirdperson: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/></svg>',
    // F（v1.4）：跳跃 / 下潜（与蹲下图标同风格的线条箭头）
    jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5v-13"/><path d="M6.5 9.5 12 4l5.5 5.5"/><path d="M5 20.5h14" opacity="0.55"/></svg>',
    dive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v13"/><path d="M6.5 14.5 12 20l5.5-5.5"/><path d="M4.5 7.5c1.6 1.2 3.4 1.2 5 0s3.4-1.2 5 0 3.4 1.2 5 0" opacity="0.55"/></svg>',
    // v1.5 W8：道具（使用快捷道具）/ 下坐骑
    item: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V6.8a1.6 1.6 0 0 1 3.2 0v5.2"/><path d="M11.2 11.5V5.4a1.6 1.6 0 0 1 3.2 0v6.1"/><path d="M14.4 12V7.2a1.6 1.6 0 0 1 3.2 0v8.1c0 3-2.2 5.2-5.4 5.2-2.4 0-3.9-1-5.3-3.4l-2-3.5a1.5 1.5 0 0 1 2.6-1.5l1.5 2.6"/></svg>',
    dismount: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15.5h9"/><path d="M10.5 11.5 14.5 15.5l-4 4"/><path d="M15.5 4.5v6"/><path d="M13 8.5l2.5 2.5L18 8.5"/></svg>'
  };

  // 触屏判定：触屏笔记本/台式机的 maxTouchPoints>0，不能直接判触屏，
  // 否则桌面端指针锁定被禁用、鼠标"融不进去"。只认移动端 UA 或小屏。
  function detectTouchDevice() {
    var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!hasTouch) return false;
    var ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua)) return true;
    try { if (Math.min(screen.width, screen.height) < 820) return true; } catch (e) {}
    return false;
  }

  const I = {
    keys: {},
    isTouch: detectTouchDevice(),
    locked: false,            // 转场/菜单时锁定输入
    // 触控状态
    joyId: null, joyOX: 0, joyOY: 0, joyX: 0, joyY: 0,
    lookId: null, lookLX: 0, lookLY: 0,
    lookDX: 0, lookDY: 0,
    runToggle: false,
    _interact: false,
    // E 路（v1.4）：跳跃/下潜的触屏状态位（F 路触摸按钮写入，player.js 经 jumpHeld/diveHeld 读取；
    // 触屏按钮语义：跳跃钮=点按跳/水中按住上浮，下潜钮=按住下潜）
    touchJump: false, touchDive: false,
    // F（v1.4）：跳跃/下潜按住状态（触屏 hold 语义：touchstart 置 true，touchend/touchcancel/
    // 手指移出/切后台 置 false；玩家物理层读取，与 PC 按键按住语义对齐）
    touchJumpHold: false,
    touchDiveHold: false,
    _holdIds: {},          // 按住类按钮 id → 当前 touch identifier（多点触控跟踪）
    _orientDismissed: false,   // 本次游玩手动关闭过横屏提示
    settings: { sens: 1.0, joySize: 120, joySide: 'left', vol: 0.8, quality: 'auto', headbob: 'on', dropcam: 'full', sanityfx: 'on', shakecam: 'on' }
  };
  BR.Input = I;

  /* ---------- 可改键系统 ---------- */
  // 动作表：id → 中文名
  // v1.5 W8 新默认键位（替换旧默认）：
  //   E=交互/拾取/上下坐骑（鼠标左键保留副键）、Shift=疾跑、Space=陆地跳跃/水中上浮、
  //   C=下潜（陆地上按一下=蹲/起身）、Tab或I=背包、数字键 1-5=快捷栏选择、
  //   Q=使用快捷道具（独立可绑定）、F=手电、Esc=暂停、V=第三人称。
  // 全部动作可改键：冲突提示、恢复默认、localStorage 保存、刷新保持、
  // HUD/说明提示全部读 bindingLabel 实时渲染、自动同步新键。
  I.BINDINGS_VERSION = 2; // 键位表版本：v1 旧默认（Ctrl 疾跑/Shift 蹲/B 背包）→ v2 新默认
  I.ACTION_NAMES = {
    fwd: '前移', back: '后退', left: '左移', right: '右移',
    run: '疾跑', dive: '蹲下 / 下潜', jump: '跳跃 / 上浮', interact: '交互',
    backpack: '背包',
    flashlight: '手电筒', thirdperson: '第三人称', pause: '暂停'
  };
  // 默认绑定（v2）
  I.DEFAULT_BINDINGS = {
    fwd: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    run: ['ShiftLeft', 'ShiftRight'],
    dive: ['KeyC'],
    jump: ['Space'],
    interact: ['KeyE', 'MouseLeft'],
    backpack: ['Tab', 'KeyI'],
    flashlight: ['KeyF'],
    thirdperson: ['KeyV'],
    pause: ['Escape']
  };
  // code → 中文显示（左修饰键用通用名，右修饰键加"右"前缀）
  I.CODE_LABELS = {
    MouseLeft: '鼠标左键', MouseRight: '鼠标右键', MouseMiddle: '鼠标中键',
    Escape: 'Esc', Space: '空格', Enter: '回车', Tab: 'Tab',
    Backspace: '退格', Delete: '删除', Insert: '插入',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: '右Shift',
    ControlLeft: 'Ctrl', ControlRight: '右Ctrl',
    AltLeft: 'Alt', AltRight: '右Alt',
    MetaLeft: 'Win', MetaRight: '右Win',
    CapsLock: '大写锁定', NumLock: '数字锁定', ContextMenu: '菜单键',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
    Backquote: '`',
    NumpadDivide: '小键盘/', NumpadMultiply: '小键盘*', NumpadSubtract: '小键盘-',
    NumpadAdd: '小键盘+', NumpadEnter: '小键盘回车', NumpadDecimal: '小键盘.'
  };
  I.codeLabel = function (code) {
    if (this.CODE_LABELS[code]) return this.CODE_LABELS[code];
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];       // KeyW → W
    if ((m = /^Digit([0-9])$/.exec(code))) return m[1];      // Digit5 → 5
    if ((m = /^Numpad([0-9])$/.exec(code))) return m[1];     // Numpad1 → 1
    if ((m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code))) return 'F' + m[1];
    return code; // 未知 code 原样显示
  };
  I.isValidCode = function (code) {
    if (typeof code !== 'string') return false;
    if (this.CODE_LABELS[code]) return true;
    return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code);
  };
  // 深拷贝一份绑定（DEFAULT_BINDINGS 永不被改动）
  I.cloneBindings = function (src) {
    const out = {};
    for (const a of Object.keys(I.DEFAULT_BINDINGS)) {
      const v = src && src[a];
      out[a] = Array.isArray(v) ? v.slice() : [];
    }
    return out;
  };
  // 校验：非法值（非数组/非法 code）回填默认，保证向后兼容
  // 修（E 路 v1.4）：空数组 = "用户主动解绑（或冲突自动解除）"，属合法状态不再回填默认；
  // 否则冲突解决无法持久化（下次加载默认键回来，冲突复活）。缺失/非法才回填。
  I.sanitizeBindings = function (raw) {
    const out = {};
    for (const a of Object.keys(I.DEFAULT_BINDINGS)) {
      const v = raw && raw[a];
      const ok = Array.isArray(v) && v.every(c => this.isValidCode(c));
      out[a] = ok ? v.slice() : I.DEFAULT_BINDINGS[a].slice();
    }
    return out;
  };
  I.bindings = I.sanitizeBindings(null); // 先填默认；init 时 loadSettings 会从存档覆盖

  // 动作 → 中文显示，如 "Ctrl / 右Ctrl"、"鼠标左键 / E"、"未绑定"
  // （契约：别的工人用 BR.Input.bindingLabel(actionName)，一定存在）
  I.bindingLabel = function (action) {
    const list = (this.bindings && this.bindings[action]) || [];
    if (!list.length) return '未绑定';
    return list.map(c => this.codeLabel(c)).join(' / ');
  };
  // code 反查动作（同一 code 绑多个动作时按动作表顺序取第一个）
  I.actionForCode = function (code) {
    if (!this.bindings) return null;
    for (const a of Object.keys(I.DEFAULT_BINDINGS)) {
      if (this.bindings[a].indexOf(code) !== -1) return a;
    }
    return null;
  };
  // 动作分发（keydown / mousedown 共用）
  I.dispatchAction = function (action) {
    if (!action) return;
    const P = BR.Player, U = BR.UI;
    if (action === 'interact') {
      // v1.5 W8：E=交互/拾取/上下坐骑——坐骑上按 E = 下坐骑
      if (P && P.isMounted && P.isMounted()) P.dismount();
      else this._interact = true;
    }
    else if (action === 'flashlight') P.toggleFlashlight();
    else if (action === 'dive') {
      // v1.5 W8：C=下潜（水中按住语义走 diveHeld，不在这里分发）；
      // 陆地上按一下 = 蹲/起身切换（原 Shift 蹲的 toggle 语义搬过来）；
      // 坐骑上不许蹲（_enterState 已强制起身，这里防误触又蹲回去）
      if (P && P.isSwimmingState && P.isSwimmingState()) { /* 水中：按住下潜，无需分发 */ }
      else if (P && P.isMounted && P.isMounted()) { /* 坐骑上：忽略 */ }
      else P.toggleCrouch();
    }
    else if (action === 'pause') BR.UI.togglePause();
    else if (action === 'backpack') { if (BR.UI.toggleBackpack) BR.UI.toggleBackpack(); }
    else if (action === 'thirdperson') { if (P.toggleThirdPerson) P.toggleThirdPerson(); }
    // v1.5 W2：首次动作提示（键盘/触屏按钮走同一分发，在此统一钩入）
    if (action === 'interact' || action === 'flashlight' || action === 'dive' ||
        action === 'backpack' || action === 'thirdperson' || action === 'jump') {
      this.firstHint(action);
    }
  };

  /* ---------- 首次动作提示（v1.5 W2） ----------
   * 每个动作首次执行时 toast 短暂提示后自动淡出；无强制教学任务。
   * 已提示的动作记入 localStorage（br_hints_v1），跨存档只提示一次。
   * 离散动作经 dispatchAction 钩入；移动/疾跑为轮询，分别在 getMove 与 player.js 的
   * wantRun 处钩入。提示文案读实时按键绑定（bindingLabel），触屏显示触控按钮名。
   */
  I._hintSeen = null;
  I._loadHints = function () {
    try { this._hintSeen = JSON.parse(localStorage.getItem('br_hints_v1') || '{}') || {}; }
    catch (e) { this._hintSeen = {}; }
  };
  I._saveHints = function () {
    try { localStorage.setItem('br_hints_v1', JSON.stringify(this._hintSeen)); } catch (e) {}
  };
  I.firstHint = function (action) {
    if (!this._hintSeen) this._loadHints();
    if (this._hintSeen[action]) return;
    this._hintSeen[action] = 1; this._saveHints();
    const touch = !!this.isTouch;
    const L = (a) => this.bindingLabel(a);
    let msg = null;
    switch (action) {
      case 'move': msg = touch ? '推动左摇杆：移动' : (L('fwd') + '：移动'); break;
      case 'run': msg = touch ? '按住疾跑按钮：疾跑' : (L('run') + '：疾跑（移动时按住）'); break;
      case 'dive': msg = touch ? '点按蹲下按钮：蹲伏，再按起身' : (L('dive') + '：蹲下，再按起身'); break;
      case 'flashlight': msg = touch ? '点按手电按钮：开关手电筒' : (L('flashlight') + '：开关手电筒'); break;
      case 'interact': msg = touch ? '点按交互按钮：与目标互动' : (L('interact') + '：交互'); break;
      case 'backpack': msg = touch ? '点按背包按钮：打开背包' : (L('backpack') + '：打开背包'); break;
      case 'thirdperson': msg = touch ? '点按视角按钮：切换第一/第三人称' : (L('thirdperson') + '：切换视角'); break;
      case 'jump': msg = touch ? '点按跳跃按钮：跳跃' : (L('jump') + '：跳跃'); break;
    }
    if (msg && BR.UI && BR.UI.toast) BR.UI.toast(msg, 2600);
  };

  /* ---------- 改键捕获 ---------- */
  I.captureAction = null; // 正在改键的动作 id；非 null 时下一次按键/鼠标写入绑定
  I._captureEndT = 0;     // 上次捕获写入的时间戳（防写入那次 mousedown 紧接着的 click 又开捕获）
  I.startCapture = function (action) { this.captureAction = action; };
  I.cancelCapture = function () {
    this.captureAction = null;
    if (BR.UI && BR.UI.renderBindings) BR.UI.renderBindings();
  };
  // E 路（v1.4）：冲突检测 —— code 正被哪些其它动作占用（排除 exceptAction 自身）
  // 修：此前 finishCapture 直接覆盖绑定，无任何冲突提示；新动作与 12 个旧动作统一走此检测
  I.findConflicts = function (code, exceptAction) {
    const out = [];
    for (const a of Object.keys(this.DEFAULT_BINDINGS)) {
      if (a === exceptAction) continue;
      if ((this.bindings[a] || []).indexOf(code) !== -1) out.push(a);
    }
    return out;
  };
  I.finishCapture = function (code) {
    const a = this.captureAction;
    this.captureAction = null;
    this._captureEndT = Date.now();
    let changed = false, note = '';
    if (a && this.isValidCode(code)) {
      const cur = this.bindings[a] || [];
      if (cur.length === 1 && cur[0] === code) {
        note = '未更改';
      } else {
        // 冲突处理：新按键若已被其它动作占用，自动从那些动作上解除并提示（保证一键一动作）
        const conflicts = this.findConflicts(code, a);
        for (const ca of conflicts) {
          this.bindings[ca] = (this.bindings[ca] || []).filter(c => c !== code);
        }
        this.bindings[a] = [code]; // 单键绑定，直接覆盖
        this.saveSettings();
        changed = true;
        if (conflicts.length) {
          note = '已更改；' + this.codeLabel(code) + ' 已从「' +
            conflicts.map(c => this.ACTION_NAMES[c] || c).join('」「') + '」解除';
        }
      }
    }
    if (BR.UI) {
      if (BR.UI.renderBindings) BR.UI.renderBindings();
      if (BR.UI.renderKeyHint) BR.UI.renderKeyHint();
      if (BR.UI.renderKeysTable) BR.UI.renderKeysTable();
      if (BR.UI.toast) BR.UI.toast(note || (changed ? '已更改' : '未更改'));
    }
  };
  I.resetBindings = function () {
    this.bindings = this.cloneBindings(I.DEFAULT_BINDINGS);
    this.saveSettings();
  };

  I.sens = function () { return 0.0026 * this.settings.sens; };

  I.loadSettings = function () {
    try {
      const s = JSON.parse(localStorage.getItem('br_settings') || '{}');
      // W10：设置一致性检查（枚举/数值范围回填，老存档缺字段不崩；未知键透传）
      if (BR.Save && BR.Save.validateSettings) {
        const chk = BR.Save.validateSettings(s);
        if (chk.fixed && chk.fixed.length && BR.log) BR.log('settings fixed:', chk.fixed.join(','));
      }
      Object.assign(this.settings, s);
      // 向后兼容：老存档没有 headbob / dropcam 时回填默认值
      if (!['on', 'weak', 'off'].includes(this.settings.headbob)) this.settings.headbob = 'on';
      if (!['full', 'soft', 'off'].includes(this.settings.dropcam)) this.settings.dropcam = 'full';
      // Systems C-A：老存档没有 sanityfx 时回填 'on'
      if (!['on', 'off'].includes(this.settings.sanityfx)) this.settings.sanityfx = 'on';
      // W10：老存档没有 shakecam 时回填 'on'
      if (!['on', 'weak', 'off'].includes(this.settings.shakecam)) this.settings.shakecam = 'on';
    } catch (e) {}
    // 按键绑定：从 br_settings.bindings 读。
    // v1.5 W8 迁移：settings.bindingsV < BINDINGS_VERSION（v1 旧默认）→
    // 直接采用新默认键位（旧键位表整体替换）；v2+ 用户的自定义改键保留。
    // 迁移后立即落盘，保证版本号持久化（下次不再重复迁移）。
    if ((this.settings.bindingsV || 0) < I.BINDINGS_VERSION) {
      this.bindings = this.cloneBindings(I.DEFAULT_BINDINGS);
      this.saveSettings();
    } else {
      // 老存档无 bindings 时用默认，非法值回填默认
      this.bindings = this.sanitizeBindings(this.settings.bindings);
    }
  };
  I.saveSettings = function () {
    try {
      this.settings.bindings = this.bindings;
      this.settings.bindingsV = I.BINDINGS_VERSION;
      localStorage.setItem('br_settings', JSON.stringify(this.settings));
    } catch (e) {}
  };
  I.setLocked = function (b) {
    this.locked = b;
    // F（v1.4）：背包/菜单/商店打开时锁定输入——同时释放触控按住（跳跃/下潜/摇杆/视角），
    // 保证按住下潜时开菜单不会"穿透"继续下潜；按钮事件本身已有 locked 门禁。
    if (b && this.clearTouchInputs) this.clearTouchInputs();
  };
  // v1.5 W8：清理键盘持续输入（失焦 / 层级切换 / 测试复位用）。
  // 与 clearTouchInputs 配对；setLocked(true) 只清触控，这里补键盘。
  I.clearKeyboard = function () {
    this.keys = {};
  };
  // 一键全清：键盘 + 触控（背包/菜单锁定、切后台、切关卡时调用，
  // 保证"按住下潜时开菜单 / 切后台回来"不会残留持续输入）
  I.clearAll = function () {
    this.clearKeyboard();
    if (this.clearTouchInputs) this.clearTouchInputs();
  };

  /* ---------- 全屏 / 横屏 ---------- */
  I.isFullscreen = function () {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  };
  // 点击"开始游戏"后调用（用户手势内成功率最高）
  I.tryFullscreen = function () {
    try {
      if (this.isFullscreen()) return true;
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const p = req.call(el, { navigationUI: 'hide' });
        if (p && p.catch) p.catch(() => {});
        return true;
      }
    } catch (e) {}
    return false; // iOS Safari 等：优雅降级，由暂停菜单按钮手动触发
  };
  I.toggleFullscreen = function () {
    try {
      if (this.isFullscreen()) {
        const ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) ex.call(document);
      } else this.tryFullscreen();
    } catch (e) {}
  };
  I.tryLandscape = function () {
    try {
      const o = screen.orientation;
      if (o && o.lock) {
        const p = o.lock('landscape');
        if (p && p.catch) p.catch(() => {}); // 浏览器拒绝则静默，靠遮罩引导
        return true;
      }
    } catch (e) {}
    return false;
  };
  // 进入游戏时的沉浸式尝试：先全屏，再锁横屏（部分浏览器锁方向要求全屏）
  I.ensureImmersive = function () {
    this._orientDismissed = false;
    if (!this.isTouch) return;
    this.tryFullscreen();
    setTimeout(() => this.tryLandscape(), 350);
    setTimeout(() => this.checkOrient(), 600);
  };
  I.isPortrait = function () {
    return innerHeight > innerWidth;
  };
  // 横屏遮罩：触屏 + 竖屏 + 游戏中才显示；转横屏自动消失
  I.checkOrient = function () {
    if (!this.isTouch) return;
    const G = BR.Game;
    const inGame = G && (G.state === 'playing' || G.state === 'loading' || G.state === 'paused');
    const need = inGame && this.isPortrait() && !this._orientDismissed;
    document.body.classList.toggle('need-orient', need);
  };

  I.init = function () {
    this.loadSettings();
    this.buildTouchUI();
    // —— 键盘：走按键绑定分发 ——
    addEventListener('keydown', (e) => {
      // 改键捕获优先：暂停菜单点"更改"后，下一次按键写入绑定（Esc 取消）
      if (this.captureAction) {
        e.preventDefault(); e.stopPropagation();
        if (e.code === 'Escape') this.cancelCapture();
        else this.finishCapture(e.code);
        return;
      }
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (BR.Game.state !== 'playing' || this.locked) {
        // 非游玩 / 锁定状态只响应暂停键
        if (this.actionForCode(e.code) === 'pause') BR.UI.togglePause();
        return;
      }
      this.dispatchAction(this.actionForCode(e.code));
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    // —— 鼠标视角（pointer lock，桌面） ——
    // 不再用 isTouch 门禁：触屏笔记本曾被误判导致鼠标无法锁定；
    // 移动端浏览器本来就没有 requestPointerLock，按特性检测即可。
    const cv = BR.$('game-canvas');
    // 改键捕获：暂停菜单等待按键时，鼠标按下也写入绑定（document 级，面板遮住画布）
    document.addEventListener('mousedown', (e) => {
      if (!this.captureAction) return;
      e.preventDefault(); e.stopPropagation();
      const code = e.button === 0 ? 'MouseLeft' : e.button === 1 ? 'MouseMiddle' : e.button === 2 ? 'MouseRight' : null;
      if (code) this.finishCapture(code);
    }, true);
    // —— 鼠标按键 → 动作分发（左键交互在 pointer lock 下生效） ——
    cv.addEventListener('mousedown', (e) => {
      const code = e.button === 0 ? 'MouseLeft' : e.button === 1 ? 'MouseMiddle' : e.button === 2 ? 'MouseRight' : null;
      if (code) this.keys[code] = true;
      if (BR.Game.state !== 'playing' || this.locked) return;
      if (e.button === 0 && document.pointerLockElement !== cv) {
        // 未锁定：这次点击只负责请求锁定，不触发动作（原有 click 逻辑合并至此）
        if (cv.requestPointerLock) {
          try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
          catch (err) {}
        }
        return;
      }
      this.dispatchAction(this.actionForCode(code));
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.keys['MouseLeft'] = false;
      else if (e.button === 1) this.keys['MouseMiddle'] = false;
      else if (e.button === 2) this.keys['MouseRight'] = false;
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== cv && BR.Game.state === 'playing' && !this.locked) {
        // 退出 pointer lock → 暂停（避免视角乱飞）
        BR.UI.togglePause(true);
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === cv && BR.Game.state === 'playing' && !this.locked) {
        this.lookDX += e.movementX; this.lookDY += e.movementY;
      }
    });
    // 旋转 / 尺寸变化：不重置进度，只重查横屏遮罩
    addEventListener('resize', () => this.checkOrient());
    addEventListener('orientationchange', () => setTimeout(() => this.checkOrient(), 350));
    // 全屏变化后也重查一次
    document.addEventListener('fullscreenchange', () => setTimeout(() => this.checkOrient(), 300));
    // 遮罩上的"仍要继续"
    const go = BR.$('btn-orient-go');
    if (go) go.addEventListener('click', () => {
      this._orientDismissed = true;
      this.checkOrient();
    });
    // 阻止手势干扰
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  };

  /* ---------- 触控 UI ---------- */
  I.buildTouchUI = function () {
    const root = BR.$('touch-ui');
    // G（v1.3 触屏补齐）：按钮与 PC 改键走同一动作语义（全部经 dispatchAction 分发）；
    // 从上到下：背包 / 第三人称 / 手电 / 蹲下（仅陆地） / 道具 / 下坐骑（仅坐骑） / 疾跑 / 交互（大钮在最下，贴近拇指自然位）
    root.innerHTML =
      '<div id="joy-zone"><div id="joy-base"><div id="joy-knob"></div></div></div>' +
      '<div id="touch-btns">' +
      '<button id="btn-backpack" class="tbtn" aria-label="背包" title="背包">' + ICONS.backpack + '</button>' +
      '<button id="btn-thirdperson" class="tbtn" aria-label="第三人称" title="第三人称">' + ICONS.thirdperson + '</button>' +
      '<button id="btn-use" class="tbtn" aria-label="手电筒" title="手电筒">' + ICONS.flashlight + '</button>' +
      '<button id="btn-crouch" class="tbtn land-only" aria-label="蹲下" title="蹲下（陆地）">' + ICONS.crouch + '</button>' +
      '<button id="btn-dismount" class="tbtn mount-only" aria-label="下坐骑" title="下坐骑">' + ICONS.dismount + '</button>' +
      '<button id="btn-run" class="tbtn" aria-label="奔跑" title="疾跑">' + ICONS.run + '</button>' +
      '<button id="btn-interact" class="tbtn big" aria-label="交互" title="交互">' + ICONS.interact + '</button>' +
      '</div>' +
      // F（v1.4）：跳跃/下潜簇——交互大钮左侧的横排拇指区；下潜仅游泳时显示（body.swimming）
      '<div id="touch-jump-cluster">' +
      '<button id="btn-dive" class="tbtn big swim-only" aria-label="下潜" title="下潜（长按）">' + ICONS.dive + '</button>' +
      '<button id="btn-jump" class="tbtn big" aria-label="跳跃" title="跳跃">' + ICONS.jump + '</button>' +
      '</div>' +
      '<button id="btn-pause-t" class="tbtn mini" aria-label="暂停" title="暂停">' + ICONS.pause + '</button>';
    const joyZone = BR.$('joy-zone'), base = BR.$('joy-base'), knob = BR.$('joy-knob');
    const R = () => this.settings.joySize / 2;

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    // 摇杆触摸
    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.joyId !== null || this.locked || BR.Game.state !== 'playing') return;
      const t = e.changedTouches[0];
      // v1.5.1：HUD 快捷栏已移除（使用只走背包），此处不再拦截
      this.joyId = t.identifier; this.joyOX = t.clientX; this.joyOY = t.clientY;
      this.joyX = 0; this.joyY = 0;
      base.style.display = 'block';
      base.style.left = (t.clientX - R()) + 'px';
      base.style.top = (t.clientY - R()) + 'px';
      base.style.width = base.style.height = (R() * 2) + 'px';
      setKnob(0, 0);
    }, { passive: false });
    const joyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joyId) continue;
        e.preventDefault();
        let dx = t.clientX - this.joyOX, dy = t.clientY - this.joyOY;
        const len = Math.hypot(dx, dy), max = R();
        if (len > max) { dx = dx / len * max; dy = dy / len * max; } // 滑出仍持续控制
        const nx = dx / max, ny = dy / max;
        const dead = 0.15;
        const mag = Math.hypot(nx, ny);
        if (mag < dead) { this.joyX = 0; this.joyY = 0; }
        else {
          const s = Math.min(1, (mag - dead) / (1 - dead)) / mag;
          this.joyX = nx * s; this.joyY = ny * s;
        }
        setKnob(dx, dy);
      }
    };
    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joyId) continue;
        this.joyId = null; this.joyX = 0; this.joyY = 0;
        setKnob(0, 0); base.style.display = 'none';
      }
    };
    joyZone.addEventListener('touchmove', joyMove, { passive: false });
    joyZone.addEventListener('touchend', joyEnd);
    joyZone.addEventListener('touchcancel', joyEnd);

    // 视角：画布右侧区域拖动（按钮已 stopPropagation，不会误触）
    const cv = BR.$('game-canvas');
    cv.addEventListener('touchstart', (e) => {
      if (this.locked || BR.Game.state !== 'playing') return;
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.38) continue; // 左侧留给摇杆
        if (this.lookId === null) {
          this.lookId = t.identifier; this.lookLX = t.clientX; this.lookLY = t.clientY;
        }
      }
    }, { passive: true });
    cv.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        e.preventDefault();
        const dx = t.clientX - this.lookLX, dy = t.clientY - this.lookLY;
        this.lookLX = t.clientX; this.lookLY = t.clientY;
        // 灵敏度：全屏滑动约转 300°*sens
        this.lookDX += dx * 2.2; this.lookDY += dy * 2.2;
      }
    }, { passive: false });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.lookId) this.lookId = null;
    };
    cv.addEventListener('touchend', lookEnd);
    cv.addEventListener('touchcancel', lookEnd);

    // 按钮：全部走 dispatchAction，与 PC 键盘改键同一条动作分发路径。
    // 疾跑在触屏上是"开关"式（touch 独有），PC 是按住——语义都是"跑起来"，状态由 player.update 统一读取。
    const bind = (id, fn) => {
      const b = BR.$(id);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    };
    bind('btn-interact', () => { if (!this.locked) this.dispatchAction('interact'); });
    bind('btn-run', () => { // v1.4 集成修复：G 路发现背包打开时疾跑钮没上锁
      if (this.locked) return;
      this.runToggle = !this.runToggle;
      BR.$('btn-run').classList.toggle('on', this.runToggle);
    });
    bind('btn-crouch', () => { if (!this.locked) this.dispatchAction('dive'); }); // v1.5 W8：C=陆地蹲/水中下潜，走同一动作
    bind('btn-use', () => { if (!this.locked) this.dispatchAction('flashlight'); });
    bind('btn-backpack', () => { if (!this.locked) this.dispatchAction('backpack'); });
    bind('btn-dismount', () => { if (!this.locked && BR.Player) BR.Player.dismount(); });
    bind('btn-thirdperson', () => {
      if (this.locked) return;
      this.dispatchAction('thirdperson');
      BR.$('btn-thirdperson').classList.toggle('on', !!(BR.Player && BR.Player.thirdPerson));
    });
    bind('btn-pause-t', () => { if (!this.locked) this.dispatchAction('pause'); }); // v1.4 集成修复：同上

    // F（v1.4）：按住类按钮（跳跃/下潜）——多点触控语义：
    //   touchstart：dispatchAction 按下语义 + 置 hold 标志（touchJumpHold/touchDiveHold，
    //              供玩家物理层读"按住上浮/按住下潜"）；记录 touch identifier。
    //   touchend/touchcancel/手指移出按钮：只清自己 identifier 对应的按住，不动摇杆与视角。
    // 与 E 路约定：按下走 BR.Input.dispatchAction('jump'/'dive') 同一动作分发。
    const bindHold = (id, action, setHold) => {
      const b = BR.$(id);
      b.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.locked || BR.Game.state !== 'playing') return;
        if (this._holdIds[id] != null) return; // 同一按钮第二根手指忽略
        this._holdIds[id] = e.changedTouches[0].identifier;
        b.classList.add('on');
        setHold(true);
        this.dispatchAction(action);
      }, { passive: false });
      const release = (e, fromMove) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== this._holdIds[id]) continue;
          if (fromMove) {
            // 手指移出：超出按钮边界（含 14px 容差）才视为松开
            const r = b.getBoundingClientRect(), slop = 14;
            if (t.clientX >= r.left - slop && t.clientX <= r.right + slop &&
                t.clientY >= r.top - slop && t.clientY <= r.bottom + slop) continue;
            e.preventDefault();
          }
          this._holdIds[id] = null;
          b.classList.remove('on');
          setHold(false);
        }
      };
      b.addEventListener('touchend', (e) => release(e, false));
      b.addEventListener('touchcancel', (e) => release(e, false));
      b.addEventListener('touchmove', (e) => release(e, true), { passive: false });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    };
    // 跳跃：陆地点击=跳（dispatch 'jump'）；游泳时长按=上浮（touchJumpHold 供物理层读）
    bindHold('btn-jump', 'jump', (v) => { this.touchJumpHold = v; });
    // 下潜：仅游泳时显示；长按=下潜（touchDiveHold），松开立即停止
    bindHold('btn-dive', 'dive', (v) => { this.touchDiveHold = v; });

    // F（v1.4）：切后台 / 失去焦点时清理全部触控输入——
    // 避免切出去回来后"人物一直走 / 一直下潜 / 视角乱飞"。
    // v1.5 W8：桌面端也要清键盘（按住 W 切后台回来不再"鬼走"）。
    const onHide = () => { this.clearAll(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });
    addEventListener('blur', onHide);
    addEventListener('pagehide', onHide);

    this.applyJoySide();
  };

  // G（v1.3）：触屏按钮高亮与玩家状态同步（UI.updateBars 节流调用）
  // F（v1.4）：是否在游泳（头部在水下 / 身处水域）——决定下潜按钮显隐与跳跃按钮语义
  I.isSwimming = function () {
    const S = BR.Swim, P = BR.Player;
    if (S && S.inWater) return true; // L37 主实现每帧维护
    // 兜底：L7 shim 无 inWater 时，用水域 + 眼睛高度判定
    try {
      if (S && typeof S.zoneAt === 'function' && P && P.pos && typeof P.eyeY === 'function') {
        const z = S.zoneAt(P.pos.x, P.pos.z);
        if (z && z.waterY != null && P.eyeY() < z.waterY) return true;
      }
    } catch (e) {}
    return false;
  };
  // F（v1.4）：清理全部触控输入（切后台 / 菜单锁定 / 测试复位用）。
  // 注意：不碰键盘 keys（E 路辖区）与 runToggle（疾跑是触屏开关式状态，非按住）。
  I.clearTouchInputs = function () {
    this.joyId = null; this.joyX = 0; this.joyY = 0;
    this.lookId = null; this.lookDX = 0; this.lookDY = 0;
    this._interact = false;
    this.touchJumpHold = false;
    this.touchDiveHold = false;
    this._holdIds = {};
    const base = BR.$('joy-base'), knob = BR.$('joy-knob');
    if (base) base.style.display = 'none';
    if (knob) knob.style.transform = 'translate(0px,0px)';
    for (const id of ['btn-jump', 'btn-dive']) {
      const b = BR.$(id);
      if (b) b.classList.remove('on');
    }
  };
  I.syncTouchStates = function () {
    const P = BR.Player;
    if (!P || !this.isTouch) return;
    const tgl = (id, on) => {
      const b = BR.$(id);
      if (b) b.classList.toggle('on', !!on);
    };
    tgl('btn-crouch', P.crouching);
    tgl('btn-thirdperson', P.thirdPerson);
    tgl('btn-use', P.flashlightOn);
    tgl('btn-run', this.runToggle);
    // F（v1.4）：游泳时显示下潜按钮；跳跃按钮语义切换为"上浮"（长按）
    const swimming = this.isSwimming();
    document.body.classList.toggle('swimming', swimming);
    // v1.5 W8：坐骑时显示下坐骑按钮（body.mounted → CSS 显示 .mount-only）
    document.body.classList.toggle('mounted', !!(P.mountHandle));
    const jb = BR.$('btn-jump');
    if (jb) {
      jb.classList.toggle('swim', swimming);
      jb.classList.toggle('on', !!this.touchJumpHold);
      jb.setAttribute('aria-label', swimming ? '上浮（长按）' : '跳跃');
      jb.setAttribute('title', swimming ? '上浮（长按）' : '跳跃');
    }
    tgl('btn-dive', this.touchDiveHold);
  };

  I.applyJoySide = function () {
    document.body.classList.toggle('joy-right', this.settings.joySide === 'right');
  };

  /* ---------- 每帧读取 ---------- */
  I.getMove = function () {
    if (this.locked) return { x: 0, z: 0 };
    let x = 0, z = 0;
    const k = this.keys;
    const down = (a) => (this.bindings[a] || []).some(c => k[c]);
    if (down('fwd')) z += 1;
    if (down('back')) z -= 1;
    if (down('left')) x -= 1;
    if (down('right')) x += 1;
    x += this.joyX; z += -this.joyY; // 摇杆上推 = 前
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    if (m > 0.05 && this.firstHint) this.firstHint('move'); // v1.5 W2：首次移动提示
    return { x, z };
  };
  Object.defineProperty(I, 'runHeld', { get() { const k = this.keys; return (this.bindings.run || []).some(c => !!k[c]); } });
  // E 路（v1.4）：跳跃（陆地=点按起跳，水中=按住上浮）/ 下潜（水中按住=下沉）；
  // 触屏标志兼容两套命名：touchJump/touchDive（E 路预留）与 touchJumpHold/touchDiveHold
  // （F 路触摸按钮实际写入）；物理层只做边沿/按住轮询，dispatchAction('jump'/'dive')
  // 保持无 case（F 路按钮的 touchstart 置 hold=true 已产生上升沿，无需另起分发）。
  Object.defineProperty(I, 'jumpHeld', { get() { const k = this.keys; return ((this.bindings.jump || []).some(c => !!k[c])) || !!this.touchJump || !!this.touchJumpHold; } });
  Object.defineProperty(I, 'diveHeld', { get() { const k = this.keys; return ((this.bindings.dive || []).some(c => !!k[c])) || !!this.touchDive || !!this.touchDiveHold; } });
  I.consumeLook = function () {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  };
  I.consumeInteract = function () {
    const r = this._interact; this._interact = false; return r;
  };
  I.setTouchVisible = function (v) {
    // F（v1.4）：触控 UI 只在触屏设备显示；桌面端进关时 main.js 也会调这里，
    // 之前会导致桌面凭空出现一排触控按钮。
    BR.$('touch-ui').style.display = (v && this.isTouch) ? 'block' : 'none';
  };
})();
