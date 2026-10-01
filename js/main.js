/* main.js —— 游戏主流程：初始化 / 关卡切换 / 主循环 / 存档调度 */
(function () {
  const BR = window.BR;

  const G = {
    state: 'title',   // title|loading|playing|paused|dying|dead|ending
    level: 'L0',
    seed: 0,
    inv: {},
    flags: { clues: 0, gens: 0 },
    renderer: null,
    fps: 0, _fpsN: 0, _fpsT: 0,
    _saveT: 0,
    checkpoint: null
  };
  BR.Game = G;

  G.init = function () {
    BR.Textures.init();
    BR.Input.init();
    BR.UI.init();
    BR.Player.initCamera();
    this.applyQuality();

    const cv = BR.$('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._pr || 1.5));
    this.renderer.outputEncoding = THREE.sRGBEncoding;

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight);
      if (BR.Player.camera) {
        BR.Player.camera.aspect = innerWidth / innerHeight;
        BR.Player.camera.updateProjectionMatrix();
      }
    });
    // 屏幕旋转不重置进度：只重设尺寸
    addEventListener('orientationchange', () => {
      setTimeout(() => {
        this.renderer.setSize(innerWidth, innerHeight);
        if (BR.Player.camera) {
          BR.Player.camera.aspect = innerWidth / innerHeight;
          BR.Player.camera.updateProjectionMatrix();
        }
      }, 300);
    });

    // 死亡事件
    BR.bus.on('died', (d) => {
      if (this.state !== 'playing') return;
      this.state = 'dying';
      BR.Input.setLocked(true);
      BR.Trans.play('fail', { cause: d.cause, skippable: false });
    });
    // 自动存档事件
    ['picked', 'door:opened', 'crate:opened', 'event'].forEach(ev =>
      BR.bus.on(ev, () => this.autosave()));

    // 首次手势启动音频
    const boot = () => { BR.Audio.init(); BR.Audio.setVolume(BR.Input.settings.vol); };
    addEventListener('pointerdown', boot, { once: true });
    addEventListener('touchstart', boot, { once: true });
    addEventListener('keydown', boot, { once: true });

    BR.UI.showTitle();
    BR.UI.setPrompt(null);
    this._lastT = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    BR.log('game init ok');
  };

  G.applyQuality = function () {
    const s = BR.Input.settings.quality || 'auto';
    let q = s;
    if (q === 'auto') {
      const small = Math.min(innerWidth, innerHeight) < 700;
      q = (BR.Input.isTouch && small) ? 'medium' : 'high';
    }
    const cfgs = {
      high: { fogScale: 1.15, maxLights: 7, pr: 2 },
      medium: { fogScale: 1.0, maxLights: 5, pr: 1.5 },
      low: { fogScale: 0.8, maxLights: 3, pr: 1 }
    };
    BR.QUALITY = cfgs[q] || cfgs.medium;
    this._pr = BR.QUALITY.pr;
    if (this.renderer) this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._pr));
    BR.log('quality', q);
  };

  /* ---------- 开局 / 读档 ---------- */
  G.newGame = function (seed) {
    this.seed = seed;
    this.level = 'L0';
    this.inv = {};
    this.flags = { clues: 0, gens: 0 };
    BR.Save.clearSave();
    this.loadLevel('L0', { intro: true });
  };

  G.continueGame = function () {
    const d = BR.Save.loadGame();
    if (!d) { BR.UI.toast('没有存档'); return; }
    this.seed = d.seed;
    this.inv = d.inv || {};
    this.flags = d.flags || { clues: 0, gens: 0 };
    this.loadLevel(d.level, { saved: d });
  };

  /* ---------- 关卡加载 ---------- */
  G.loadLevel = function (level, opts) {
    opts = opts || {};
    this.state = 'loading';
    this.level = level;
    BR.Input.setLocked(true);
    BR.UI.show('screen-loading');
    BR.$('loading-text').textContent = '正在生成 ' + (BR.Levels[level] ? BR.Levels[level].name : level) + '……';

    // 下一帧再做重活，让 loading 先画出来
    setTimeout(() => {
      try {
        const map = BR.Gen.generate(level, this.seed);
        const ws = opts.saved ? opts.saved.ws : { openedDoors: [], picked: [], openedCrates: [], events: [] };
        BR.World.build(map, ws).then(() => {
          // 从事件恢复计数器
          this.flags.gens = ws.events.filter(e => e.indexOf('gen_') === 0).length;
          this.flags.clues = ws.events.filter(e => e.indexOf('clue_') === 0).length;
          const sp = BR.World.spawnOf(map);
          let px = sp.x, pz = sp.z, yaw = sp.yaw;
          if (opts.saved) { px = opts.saved.px; pz = opts.saved.pz; yaw = opts.saved.yaw; }
          BR.Player.reset(px, pz, yaw);
          if (opts.saved) {
            BR.Player.hp = opts.saved.hp != null ? opts.saved.hp : 100;
            BR.Player.hasFlashlight = !!opts.saved.hasFlashlight;
          } else {
            // 非 L0：给基础物资（跨关不保留手电之外的消耗品也合理，但保留更友好）
            if (level !== 'L0' && !BR.Player.hasFlashlight && (this.inv.flashlight || 0) > 0) {
              BR.Player.hasFlashlight = true;
            }
          }
          BR.Player.camera.aspect = innerWidth / innerHeight;
          BR.Player.camera.updateProjectionMatrix();
          BR.Levels[level].onEnter();
          BR.UI.updateInv();
          BR.UI.setPrompt(null);
          this.state = 'playing';
          BR.Input.setLocked(false);
          BR.UI.show(null);
          BR.Input.setTouchVisible(true);
          // 检查点 + 存档
          this.checkpoint = this.snapshot();
          this.autosave();
          if (opts.intro && level === 'L0') {
            BR.Trans.play('intro');
            setTimeout(() => BR.UI.toast('WASD/摇杆移动，E/✋ 交互', 4000), 6000);
          }
        });
      } catch (e) {
        BR.warn('loadLevel failed', e);
        BR.$('loading-text').textContent = '加载失败：' + e.message;
      }
    }, 60);
  };

  // 转场调用的跨关（存档跟随）
  G.gotoLevel = function (level, opts) {
    opts = opts || {};
    this.autosave();
    // 跨关保留：手电、部分物资
    return new Promise((resolve) => {
      this.loadLevel(level, {});
      const iv = setInterval(() => {
        if (this.state === 'playing') { clearInterval(iv); resolve(); }
      }, 200);
    });
  };

  G.snapshot = function () {
    return {
      v: 1, t: Date.now(),
      seed: this.seed, level: this.level,
      px: BR.Player.pos.x, pz: BR.Player.pos.z, yaw: BR.Player.yaw,
      hp: Math.round(BR.Player.hp),
      hasFlashlight: BR.Player.hasFlashlight,
      inv: Object.assign({}, this.inv),
      flags: Object.assign({}, this.flags),
      ws: JSON.parse(JSON.stringify(BR.World.state))
    };
  };

  G.autosave = function () {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    try {
      localStorage.setItem('backrooms_save_v1', JSON.stringify(this.snapshot()));
    } catch (e) {}
  };

  /* ---------- 死亡 / 重试 / 结局 ---------- */
  G.showDeath = function (cause) {
    this.state = 'dead';
    BR.Input.setLocked(true);
    BR.UI.showDeath(cause || 'default');
  };

  G.retryAfterDeath = function () {
    const cp = this.checkpoint;
    if (!cp) { location.reload(); return; }
    // 回到检查点：同种子同关，恢复检查点时刻的全部状态
    this.seed = cp.seed;
    this.inv = Object.assign({}, cp.inv);
    this.flags = Object.assign({}, cp.flags);
    BR.Trans.play('fade').then(() => {
      this.loadLevel(cp.level, { saved: cp });
    });
  };

  G.gotoEnding = function () {
    this.state = 'ending';
    BR.Save.clearSave();
    BR.Audio.setAmbient('END');
    return new Promise((res) => setTimeout(() => {
      BR.UI.showEnding(
        '你切出来了',
        '电梯门开了。\n\n外面不是 Level 4，也不是任何已知的楼层——是白光，和久违的新鲜空气的味道。\n\n你回头看了一眼，身后的门缓缓关上，荧光灯的嗡鸣声越来越远。\n\n你切出来了。这一次，是切回了现实。\n\n—— 通关 ——\n\n（电梯的下行按钮还亮着……也许有一天，你会想知道 Level 4 是什么样子。）'
      );
      res();
    }, 800));
  };

  /* ---------- 主循环 ---------- */
  G.loop = function (t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this._lastT) / 1000;
    this._lastT = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    // FPS
    this._fpsN++; this._fpsT += dt;
    if (this._fpsT >= 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsN = 0; this._fpsT = 0; }

    if (this.state === 'playing' || this.state === 'paused') {
      if (this.state === 'playing') {
        BR.Player.update(dt, BR.Input, BR.World);
        BR.World.update(dt, BR.Player.pos.x, BR.Player.pos.z);
        const L = BR.Levels[this.level];
        if (L && L.tick) L.tick(dt);
        BR.Audio.updateListener(BR.Player.pos.x, BR.Player.pos.z, BR.Player.yaw);
        // 周期存档
        this._saveT += dt;
        if (this._saveT > 25) { this._saveT = 0; this.autosave(); }
        // 每 60 秒更新一次检查点（死亡重试回到近期状态）
        this._cpT = (this._cpT || 0) + dt;
        if (this._cpT > 60) { this._cpT = 0; this.checkpoint = this.snapshot(); }
      }
      BR.UI.updateDebug();
      if (BR.World.scene) this.renderer.render(BR.World.scene, BR.Player.camera);
    }
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => G.init());
  } else G.init();
})();
