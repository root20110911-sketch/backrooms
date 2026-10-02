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

  I.sens = function () { return 0.0026 * this.settings.sens; };

  I.loadSettings = function () {
    try {
      const s = JSON.parse(localStorage.getItem('br_settings') || '{}');
      Object.assign(this.settings, s);
      // 向后兼容：老存档没有 headbob / dropcam 时回填默认值
      if (!['on', 'weak', 'off'].includes(this.settings.headbob)) this.settings.headbob = 'on';
      if (!['full', 'soft', 'off'].includes(this.settings.dropcam)) this.settings.dropcam = 'full';
    } catch (e) {}
  };
  I.saveSettings = function () {
    try { localStorage.setItem('br_settings', JSON.stringify(this.settings)); } catch (e) {}
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
    // —— 键盘 ——
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (BR.Game.state !== 'playing' || this.locked) {
        if (e.code === 'Escape') BR.UI.togglePause();
        return;
      }
      if (e.code === 'KeyE') this._interact = true;
      if (e.code === 'KeyF') BR.Player.toggleFlashlight();
      if (e.code === 'KeyC' || e.code === 'ControlLeft') BR.Player.toggleCrouch();
      if (e.code === 'Escape') BR.UI.togglePause();
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    // —— 鼠标视角（pointer lock，桌面） ——
    // 不再用 isTouch 门禁：触屏笔记本曾被误判导致鼠标无法锁定；
    // 移动端浏览器本来就没有 requestPointerLock，按特性检测即可。
    const cv = BR.$('game-canvas');
    cv.addEventListener('click', () => {
      if (BR.Game.state === 'playing' && !this.locked && document.pointerLockElement !== cv) {
        if (cv.requestPointerLock) {
          try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); }
          catch (e) {}
        }
      }
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
    if (k['KeyW'] || k['ArrowUp']) z += 1;
    if (k['KeyS'] || k['ArrowDown']) z -= 1;
    if (k['KeyA'] || k['ArrowLeft']) x -= 1;
    if (k['KeyD'] || k['ArrowRight']) x += 1;
    x += this.joyX; z += -this.joyY; // 摇杆上推 = 前
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    return { x, z };
  };
  Object.defineProperty(I, 'runHeld', { get() { return !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight']; } });
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
