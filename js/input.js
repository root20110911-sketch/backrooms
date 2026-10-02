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
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/></svg>'
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
    _orientDismissed: false,   // 本次游玩手动关闭过横屏提示
    settings: { sens: 1.0, joySize: 120, joySide: 'left', vol: 0.8, quality: 'auto', headbob: 'on', dropcam: 'full' }
  };
  BR.Input = I;

  /* ---------- 可改键系统 ---------- */
  // 动作表：id → 中文名
  I.ACTION_NAMES = {
    fwd: '前移', back: '后退', left: '左移', right: '右移',
    run: '疾跑', crouch: '蹲下', flashlight: '手电筒', interact: '交互',
    backpack: '背包', thirdperson: '第三人称', pause: '暂停', useItem: '使用选中道具'
  };
  // 默认绑定（疾跑=Ctrl，蹲下=Shift；交互=鼠标左键+E）
  I.DEFAULT_BINDINGS = {
    fwd: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    run: ['ControlLeft', 'ControlRight'],
    crouch: ['ShiftLeft', 'ShiftRight'],
    flashlight: ['KeyF'],
    interact: ['MouseLeft', 'KeyE'],
    backpack: ['KeyB'],
    thirdperson: ['KeyV'],
    pause: ['Escape'],
    useItem: []
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
  // 校验：非法值（非数组/空数组/非法 code）回填默认，保证向后兼容
  I.sanitizeBindings = function (raw) {
    const out = {};
    for (const a of Object.keys(I.DEFAULT_BINDINGS)) {
      const v = raw && raw[a];
      const ok = Array.isArray(v) && v.length > 0 && v.every(c => this.isValidCode(c));
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
    const P = BR.Player;
    if (action === 'interact') this._interact = true;
    else if (action === 'flashlight') P.toggleFlashlight();
    else if (action === 'crouch') P.toggleCrouch();
    else if (action === 'pause') BR.UI.togglePause();
    else if (action === 'backpack') { if (BR.UI.toggleBackpack) BR.UI.toggleBackpack(); }
    else if (action === 'thirdperson') { if (P.toggleThirdPerson) P.toggleThirdPerson(); }
  };

  /* ---------- 改键捕获 ---------- */
  I.captureAction = null; // 正在改键的动作 id；非 null 时下一次按键/鼠标写入绑定
  I._captureEndT = 0;     // 上次捕获写入的时间戳（防写入那次 mousedown 紧接着的 click 又开捕获）
  I.startCapture = function (action) { this.captureAction = action; };
  I.cancelCapture = function () {
    this.captureAction = null;
    if (BR.UI && BR.UI.renderBindings) BR.UI.renderBindings();
  };
  I.finishCapture = function (code) {
    const a = this.captureAction;
    this.captureAction = null;
    this._captureEndT = Date.now();
    let changed = false;
    if (a && this.isValidCode(code)) {
      this.bindings[a] = [code]; // 单键绑定，直接覆盖
      this.saveSettings();
      changed = true;
    }
    if (BR.UI) {
      if (BR.UI.renderBindings) BR.UI.renderBindings();
      if (BR.UI.renderKeyHint) BR.UI.renderKeyHint();
      if (BR.UI.renderKeysTable) BR.UI.renderKeysTable();
      if (changed && BR.UI.toast) BR.UI.toast('已更改');
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
      Object.assign(this.settings, s);
      // 向后兼容：老存档没有 headbob / dropcam 时回填默认值
      if (!['on', 'weak', 'off'].includes(this.settings.headbob)) this.settings.headbob = 'on';
      if (!['full', 'soft', 'off'].includes(this.settings.dropcam)) this.settings.dropcam = 'full';
    } catch (e) {}
    // 按键绑定：从 br_settings.bindings 读；老存档无 bindings 时用默认，非法值回填默认
    this.bindings = this.sanitizeBindings(this.settings.bindings);
  };
  I.saveSettings = function () {
    try {
      this.settings.bindings = this.bindings;
      localStorage.setItem('br_settings', JSON.stringify(this.settings));
    } catch (e) {}
  };
  I.setLocked = function (b) { this.locked = b; };

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
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
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
    root.innerHTML =
      '<div id="joy-zone"><div id="joy-base"><div id="joy-knob"></div></div></div>' +
      '<div id="touch-btns">' +
      '<button id="btn-use" class="tbtn" aria-label="手电筒">' + ICONS.flashlight + '</button>' +
      '<button id="btn-crouch" class="tbtn" aria-label="蹲伏">' + ICONS.crouch + '</button>' +
      '<button id="btn-run" class="tbtn" aria-label="奔跑">' + ICONS.run + '</button>' +
      '<button id="btn-interact" class="tbtn big" aria-label="交互">' + ICONS.interact + '</button>' +
      '</div>' +
      '<button id="btn-pause-t" class="tbtn mini" aria-label="暂停">' + ICONS.pause + '</button>';
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

    // 按钮
    const bind = (id, fn) => {
      const b = BR.$(id);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    };
    bind('btn-interact', () => { if (!this.locked) this._interact = true; });
    bind('btn-run', () => {
      this.runToggle = !this.runToggle;
      BR.$('btn-run').classList.toggle('on', this.runToggle);
    });
    bind('btn-crouch', () => { if (!this.locked) BR.Player.toggleCrouch(); });
    bind('btn-use', () => { if (!this.locked) BR.Player.toggleFlashlight(); });
    bind('btn-pause-t', () => BR.UI.togglePause());
    this.applyJoySide();
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
    return { x, z };
  };
  Object.defineProperty(I, 'runHeld', { get() { const k = this.keys; return (this.bindings.run || []).some(c => !!k[c]); } });
  I.consumeLook = function () {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  };
  I.consumeInteract = function () {
    const r = this._interact; this._interact = false; return r;
  };
  I.setTouchVisible = function (v) {
    BR.$('touch-ui').style.display = v ? 'block' : 'none';
  };
})();
