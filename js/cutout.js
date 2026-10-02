/* cutout.js —— Systems A：统一切出状态机 + 随机裂隙
 *
 * BR.Cutout.travel(to, opts)：所有跨关出口的统一入口。
 *   opts: { kind: 'walk'|'rift'|'hole'|'berry'|'slide'|'drop'|'water',
 *           pre: 保留字段(暂未用), dropText: 抵达后提示文字 }
 *   流程：kind 专属前段 → BR.Game.gotoLevel(to) → 抵达演出(空中→失衡→落地→撑地→爬起)
 *         → 交还控制。全程 Input 锁定，30s 看门狗兜底。
 *   镜头强度：BR.Input.settings.dropcam ∈ 'full'|'soft'|'off'（默认 'full'）。
 *
 * BR.Rifts：随机裂隙（运行时选点，可复现）。
 *   判定 RNG 由 seed+':rift:'+count 派生，count 取自 W.state.events 中 rift_ 前缀个数；
 *   落点 RNG 由 seed+':riftspot:'+level+':'+count 派生。同一种子同 count 落点一致。
 *   每关每 90 秒最多显形 1 次；显形前 3~5 秒按关卡主题给视听征兆。
 *   目的地权重（排除当前关与未加载关卡）：
 *     L0:15 L1:15 L11:12 L37:12 L188:10 L94:10 L7:8 L2:8 L3:6 FUN:4
 *
 * 七色滑梯固定映射（本游戏原创机制——后室原作中 Level Fun 没有滑梯出口）：
 *   红→L0 / 橙→L37 / 黄→L11 / 绿→L1 / 青→L7 / 蓝→L94(夜间) / 紫→L188
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
    blue:   { to: 'L94',  name: '蓝', clue: '梯口星空贴纸', night: true }, // 危险落点（夜间抵达）
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
      clearTimeout(watchdog);
      const p = P();
      if (p) { p.extDipY = 0; p.extRoll = 0; p.extPitch = 0; p.extFov = 0; }
      document.body.classList.remove('dropping');
      document.body.classList.remove('underwater');
      self.busy = false;
      if (BR.Game.state === 'playing') BR.Input.setLocked(false);
    };
    // 30 秒看门狗：绝不永久锁死
    const watchdog = setTimeout(() => {
      BR.warn('Cutout watchdog fired:', from, '->', to, kind);
      finish();
    }, 30000);

    try {
      await this._pre(kind, opts);          // ① kind 专属前段
      await BR.Game.gotoLevel(to, opts);    // ② 跨关（gotoLevel 已修 opts 透传；resolve 时已 playing）
      BR.Input.setLocked(true);             // loadLevel 末尾解过锁，抵达演出期间重新锁定
      await this._arrival(to, kind, opts);  // ③ 抵达演出（核心）
      BR.Game.autosave();                   // gotoLevel 内部 loadLevel 已存过一次；这里补一次保证事件落盘
    } catch (e) {
      BR.warn('Cutout.travel failed', e);
    }
    finish();
  };

  /* ---------- ① kind 专属前段 ---------- */
  Cutout._pre = async function (kind, opts) {
    const p = P(), ovEl = ov();
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
    switch (kind) {
      case 'slide': {
        // 进入滑梯俯冲演出：镜头下压 + 呼啸 + 暗角收紧
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
        break;
      }
      case 'berry': {
        // 食用后视线眩晕：正弦摇摆（小幅，不许疯狂翻转）
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
        break;
      }
      case 'hole':
      case 'rift': {
        // 被吸入 / 坠入：下沉 + 嗡鸣
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
        break;
      }
      default: { // walk / drop / water：短暂黑边
        if (kind === 'water') BR.Audio.splash(); else BR.Audio.glitch();
        await waitMs(450);
        await setOv(1, 350);
      }
    }
    document.body.classList.remove('dropping');
    // overlay 保持黑场，抵达演出负责揭开
  };

  /* ---------- ③ 抵达演出 ---------- */
  Cutout._arrival = async function (to, kind, opts) {
    const ovEl = ov();
    const dropcam = (BR.Input.settings && BR.Input.settings.dropcam) || 'full';
    const watery = kind.indexOf('water') !== -1 ||
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
    ['L94', 10], ['L7', 8], ['L2', 8], ['L3', 6], ['FUN', 4]
  ];
  // 按关卡空间特性选显形形式：crack=墙角裂缝(主动进) / hole=地板洞(踩空) / door=回头变的门
  const RIFT_FORM = {
    L0: 'crack', L1: 'hole', L2: 'hole', L3: 'door', FUN: 'door',
    L188: 'crack', L37: 'hole', L94: 'door', L7: 'crack', L11: 'crack'
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
    RIFT_WEIGHTS: RIFT_WEIGHTS
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
      this._cd = 55 + (BR.hashSeed(BR.Game.seed + ':riftcd:' + level) % 35);
      this._pending = null;
      this._clearManifest();
    }
    this._cd -= dt;
    if (this._pending) this._tickPending(dt);
    else if (this._manifest) this._tickManifest(dt);
    else if (this._cd <= 0) this._roll();
  };

  // 纯派生：同一种子 + 同关卡 + 同 count → 同落点（可复现，供测试与判定共用）
  Rifts._derive = function (seed, level, count, W) {
    const rng = new BR.RNG(BR.hashSeed(seed + ':rift:' + count));
    if (rng.next() > 0.55) return { show: false };
    const pool = [];
    let total = 0;
    for (const [lv, w] of RIFT_WEIGHTS) {
      if (lv === level || !BR.Levels[lv]) continue;
      pool.push([lv, w]); total += w;
    }
    if (!pool.length) return { show: false };
    let r = rng.next() * total, to = pool[0][0];
    for (const [lv, w] of pool) { r -= w; if (r <= 0) { to = lv; break; } }
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
    // 跨关单调计数：flags.riftCount 在进入裂隙后递增、存档保留。
    // （修 bug：原来按本关 ws.events 计数，跨关后新关 events 为空，count 永远从 0 开始）
    const count = (BR.Game.flags && BR.Game.flags.riftCount) || 0;
    const d = this._derive(BR.Game.seed, level, count, W);
    if (!d.show) { this._cd = 45 + (BR.hashSeed(BR.Game.seed + ':riftnoshow:' + level + count) % 45); return; }
    this._pending = {
      t: 3 + (BR.hashSeed(BR.Game.seed + ':riftomen:' + level + count) % 200) / 100, // 3~5s
      form: d.form, tx: d.tx, ty: d.ty, nx: d.nx, nz: d.nz, to: d.to, count: count, marker: null, shakeT: 0
    };
    this._omen(level, d.form, d);
    this._cd = 90; // 本轮进入冷却：每关每 90s 最多显形 1 次
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
    m.group = g; m.itId = it.id; m.ttl = 30;
    this._manifest = m;
    if (m.form === 'door') BR.UI.toast('你身后好像多了扇门……', 2600);
    else if (m.form === 'hole') BR.UI.toast('地板上裂开了一个洞……', 2600);
    else BR.UI.toast('墙角的裂缝在渗出微光……', 2600);
  };

  Rifts._tickManifest = function (dt) {
    const m = this._manifest;
    m.ttl -= dt;
    // 地板洞：走上去踩空
    if (m.form === 'hole' && !Cutout.busy) {
      const p = P();
      const dx = p.pos.x - BR.tileCX(m.tx), dz = p.pos.z - BR.tileCZ(m.ty);
      if (Math.hypot(dx, dz) < 0.9) { this._enterRift(m); return; }
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
