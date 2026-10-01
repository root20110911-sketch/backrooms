/* input.js —— 键盘鼠标 + 平板触控（摇杆/视角/按钮，多点触控） */
(function () {
  const BR = window.BR;

  const I = {
    keys: {},
    isTouch: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
    locked: false,            // 转场/菜单时锁定输入
    // 触控状态
    joyId: null, joyOX: 0, joyOY: 0, joyX: 0, joyY: 0,
    lookId: null, lookLX: 0, lookLY: 0,
    lookDX: 0, lookDY: 0,
    runToggle: false,
    _interact: false,
    settings: { sens: 1.0, joySize: 120, joySide: 'left', vol: 0.8, quality: 'auto' }
  };
  BR.Input = I;

  I.sens = function () { return 0.0026 * this.settings.sens; };

  I.loadSettings = function () {
    try {
      const s = JSON.parse(localStorage.getItem('br_settings') || '{}');
      Object.assign(this.settings, s);
    } catch (e) {}
  };
  I.saveSettings = function () {
    try { localStorage.setItem('br_settings', JSON.stringify(this.settings)); } catch (e) {}
  };
  I.setLocked = function (b) { this.locked = b; };

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
    const cv = BR.$('game-canvas');
    cv.addEventListener('click', () => {
      if (BR.Game.state === 'playing' && !this.locked && !this.isTouch && document.pointerLockElement !== cv) {
        cv.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== cv && BR.Game.state === 'playing' && !this.isTouch && !this.locked) {
        // 桌面端退出 pointer lock → 暂停（避免视角乱飞）
        BR.UI.togglePause(true);
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === cv && BR.Game.state === 'playing' && !this.locked) {
        this.lookDX += e.movementX; this.lookDY += e.movementY;
      }
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
      '<button id="btn-use" class="tbtn">🔦</button>' +
      '<button id="btn-crouch" class="tbtn">⬇</button>' +
      '<button id="btn-run" class="tbtn">🏃</button>' +
      '<button id="btn-interact" class="tbtn big">✋</button>' +
      '</div>' +
      '<button id="btn-pause-t" class="tbtn mini">⏸</button>';
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
