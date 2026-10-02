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
    var mark = function (s) { window.__brStep = s; };
    mark('textures'); BR.Textures.init();
    mark('input'); BR.Input.init();
    mark('ui'); BR.UI.init();
    // 先把菜单亮出来：后面 WebGL 若在平板上失败，用户看到菜单+提示，而不是黑屏
    BR.UI.showTitle();
    BR.UI.setPrompt(null);
    mark('camera'); BR.Player.initCamera();
    mark('quality'); this.applyQuality();

    mark('renderer');
    const cv = BR.$('game-canvas');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
      showBrErr('WebGL 初始化失败: ' + (e && e.message || e) + ' —— 请关闭其他标签页后刷新重试');
      return; // 菜单已显示，直接返回，不启动主循环
    }
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._pr || 1.5));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    // v1.2：ACES 色调映射压住过曝，保留荧光灯泛黄感
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

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

    // 菜单已在 init 前段显示过，这里刷新一次种子行即可
    BR.UI.showTitle();
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
      high: { fogScale: 1.15, maxLights: 7, pr: 2, grain: 1 },
      medium: { fogScale: 1.0, maxLights: 5, pr: 1.5, grain: 1 },
      low: { fogScale: 0.8, maxLights: 3, pr: 1, grain: 0 }
    };
    BR.QUALITY = cfgs[q] || cfgs.medium;
    this._pr = BR.QUALITY.pr;
    // 低画质：关掉胶片颗粒 overlay
    document.body.classList.toggle('fx-low', !BR.QUALITY.grain);
    if (this.renderer) this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this._pr));
    BR.log('quality', q);
  };

  /* ---------- 开局 / 读档 ---------- */
  G.newGame = function (seed) {
    this.seed = seed;
    this.level = 'L0';
    this.inv = {};
    this.flags = { clues: 0, gens: 0, riftCount: 0, berryCount: 0 };
    BR.Save.clearSave();
    BR.Input.ensureImmersive(); // 触屏：尝试全屏 + 锁横屏
    this.loadLevel('L0', { intro: true, drop: true });
  };

  G.continueGame = function () {
    const d = BR.Save.loadGame();
    if (!d) { BR.UI.toast('没有存档'); return; }
    this.seed = d.seed;
    this.inv = d.inv || {};
    this.flags = d.flags || { clues: 0, gens: 0 };
    // 可选字段向后兼容：老存档没有 riftCount/berryCount 时 ?? 0
    this.flags.riftCount = d.riftCount != null ? d.riftCount : 0;
    this.flags.berryCount = d.berryCount != null ? d.berryCount : 0;
    BR.Input.ensureImmersive();
    this.loadLevel(d.level, { saved: d, drop: true });
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
            BR.Player.sanity = opts.saved.sanity != null ? opts.saved.sanity : 100; // 存档读档恢复理智
            BR.Player.hunger = opts.saved.hunger != null ? opts.saved.hunger : 100; // 老存档缺 hunger 字段时默认 100
            BR.Player.flashBat = opts.saved.flashBat != null ? opts.saved.flashBat : 100; // 老存档缺 flashBat 字段时默认 100
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
          BR.Input.checkOrient();
          const afterEnter = () => {
            if (opts.intro && level === 'L0') {
              BR.Trans.play('intro');
              setTimeout(() => BR.UI.toast('WASD / 左摇杆移动，E / 交互键使用物品', 4000), 6000);
            }
          };
          // 入场掉落感：新游戏 / 读档 / 重生（已有转场进行中时不叠加）
          if (opts.drop && !BR.Trans.active) {
            BR.Trans.play('drop', { text: opts.dropText }).then(afterEnter);
          } else afterEnter();
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
      this.loadLevel(level, opts); // 修复吞 opts 的 bug：透传给 loadLevel（如 drop/dropText/saved）
      const iv = setInterval(() => {
        if (this.state === 'playing') { clearInterval(iv); resolve(); }
      }, 200);
    });
  };

  G.snapshot = function () {
    const ws = BR.World.state || { openedDoors: [], picked: [], openedCrates: [], events: [] };
    return {
      v: 1, t: Date.now(),
      seed: this.seed, level: this.level,
      px: BR.Player.pos.x, pz: BR.Player.pos.z, yaw: BR.Player.yaw,
      hp: Math.round(BR.Player.hp),
      sanity: Math.round(BR.Player.sanity), // 修复已知坑：读档不再回满
      hunger: Math.round(BR.Player.hunger != null ? BR.Player.hunger : 100),
      flashBat: Math.round(BR.Player.flashBat != null ? BR.Player.flashBat : 100), // 手电电池
      hasFlashlight: BR.Player.hasFlashlight,
      inv: Object.assign({}, this.inv),
      flags: Object.assign({}, this.flags),
      ws: JSON.parse(JSON.stringify(ws)),
      riftCount: this.flags.riftCount != null ? this.flags.riftCount : BR.Save.countEvents(ws.events, 'rift_'),
      berryCount: this.flags.berryCount != null ? this.flags.berryCount : BR.Save.countEvents(ws.events, 'berry_')
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
      this.loadLevel(cp.level, { saved: cp, drop: true });
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
        // Systems A：随机裂隙（关卡 tick 里不要再调，主循环统一调用，内部按帧去重）
        if (BR.Rifts) BR.Rifts.tick(dt);
        BR.Audio.updateListener(BR.Player.pos.x, BR.Player.pos.z, BR.Player.yaw);
        // 血条/理智条节流刷新
        this._barT = (this._barT || 0) + dt;
        if (this._barT > 0.25) { this._barT = 0; BR.UI.updateBars(); }
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

  // 启动（含诊断：init 抛错时把原因显示在屏幕上，而不是黑屏）
  var boot = function () {
    try { G.init(); window.__brStep = 'ok'; }
    catch (e) { showBrErr('INIT FAIL: ' + (e && e.message || e)); }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})();
