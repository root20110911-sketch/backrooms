/* sanityEvents.js —— 低理智特殊事件（Systems C-A）
 * BR.SanityEvents：主循环 tick(dt) 驱动；纯运行时态，不进存档；
 * 关卡加载 / 读档时由 main.js 调用 reset() 清理。
 *
 * 事件（理智 < 30 时按概率触发，全局冷却避免刷屏）：
 *   1) 假补给：看起来像杏仁水的拾取物，玩家靠近到 2 米内消散，扣 3 理智，字幕"只是幻觉……"；
 *   2) 假出口：半透明的假门，触碰后消散，扣 5 理智，字幕"它从来就不在那里"；
 *   3) 耳语强化：理智越低耳语越频繁 + 立体声飘忽（见 audio.js whisperDeep / _nzPan）。
 * 视线模糊：blurPx(sanity) 给出 0~1.8px 的轻度模糊，由 ui.js setSanityFx 作用到画布；
 *   设置 sanityfx='off' 可关闭；理智回满即消失。
 */
(function () {
  const BR = window.BR = window.BR || {};

  const E = {
    active: null,     // {kind,id,group,x,z,born,triggerR,drain,caption}
    cooldownT: 0,     // 全局冷却（秒）
    rollT: 0,         // 掷骰间隔计时
    _i: 0,
    _fading: []       // 正在消散的 [{group, t}]
  };
  BR.SanityEvents = E;

  const TRIGGER_SANITY = 30;   // 理智 < 30 时可触发事件
  const MAX_BLUR = 1.8;        // 最大模糊 px（用户要求"不要太模糊"）
  const ROLL_EVERY = 3;        // 每 3 秒掷一次
  const COOLDOWN_MIN = 45, COOLDOWN_MAX = 95; // 触发后全局冷却
  const LIFE = 60;             // 幻觉存活秒数（过期则悄然消散，不扣理智）

  /* ---------- 视线模糊强度（纯函数，方便测试） ---------- */
  // 理智 30→0 线性映射 0→MAX_BLUR；sanityfx='off' 时恒为 0。
  E.blurPx = function (sanity) {
    if (sanity == null || sanity >= TRIGGER_SANITY) return 0;
    const s = (BR.Input && BR.Input.settings) || {};
    if (s.sanityfx === 'off') return 0;
    return ((TRIGGER_SANITY - sanity) / TRIGGER_SANITY) * MAX_BLUR;
  };

  // 把模糊作用到画布（ui.js setSanityFx 每帧调用）
  E.applyBlur = function (sanity) {
    const cv = BR.$ && BR.$('game-canvas');
    if (!cv) return;
    const b = this.blurPx(sanity);
    if (b <= 0.01) { cv.style.filter = ''; return; } // 恢复 CSS 级联（如 body.underwater 的滤镜）
    // 与水下滤镜叠加，避免内联样式覆盖掉 stylesheet 的 underwater 滤镜
    const uw = document.body.classList.contains('underwater') ? 'saturate(1.2) brightness(0.85) ' : '';
    cv.style.filter = uw + 'blur(' + b.toFixed(2) + 'px)';
  };

  E.reset = function () {
    if (this.active) this._removeActiveMesh();
    this.active = null;
    this.cooldownT = 8; // 入场短暂保护，避免刚加载就掷骰
    this.rollT = 0;
    this._fading.length = 0;
    const cv = BR.$ && BR.$('game-canvas');
    if (cv) cv.style.filter = '';
  };

  /* ---------- 主循环 ---------- */
  E.tick = function (dt) {
    this._tickFading(dt);
    const G = BR.Game, P = BR.Player, world = BR.World;
    if (!G || G.state !== 'playing' || !P || !world || !world.scene) return;

    // —— 活跃幻觉：距离触发 / 过期消散 ——
    const a = this.active;
    if (a) {
      const dx = P.pos.x - a.x, dz = P.pos.z - a.z;
      const age = (performance.now() - a.born) / 1000;
      if (dx * dx + dz * dz < a.triggerR * a.triggerR) {
        this._reveal(a);
      } else if (age > LIFE) {
        // 过期悄然消散：不扣理智、不字幕，只淡出
        this._startFade(a.group);
        this.active = null;
      }
    }

    // —— 掷骰 ——
    this.cooldownT -= dt;
    if (this.active || P.sanity >= TRIGGER_SANITY || this.cooldownT > 0) return;
    this.rollT -= dt;
    if (this.rollT > 0) return;
    this.rollT = ROLL_EVERY;
    const k = 1 - P.sanity / TRIGGER_SANITY; // 0..1：理智越低概率越高
    const p = 0.10 + 0.28 * k;
    if (Math.random() >= p) return;
    const kind = Math.random() < 0.5 ? 'supply' : 'exit';
    const ok = kind === 'supply' ? this._spawnFakeSupply(world) : this._spawnFakeExit(world);
    if (ok) this.cooldownT = COOLDOWN_MIN + Math.random() * (COOLDOWN_MAX - COOLDOWN_MIN);
    else this.rollT = 5; // 生成失败（没找到合适位置）稍后再试
  };

  /* ---------- 生成 ---------- */
  // 在玩家周围 distMin..distMax 米找一个可行走点（circleFree），10 次尝试
  E._findSpot = function (world, distMin, distMax) {
    const P = BR.Player;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = distMin + Math.random() * (distMax - distMin);
      const x = P.pos.x + Math.cos(a) * d, z = P.pos.z + Math.sin(a) * d;
      if (world.circleFree && world.circleFree(x, z, 0.35)) return { x, z };
    }
    return null;
  };

  E._spawnFakeSupply = function (world) {
    const spot = this._findSpot(world, 4, 8);
    if (!spot || typeof BR.itemMesh !== 'function') return false;
    const g = BR.itemMesh('almond'); // 复用真杏仁水 mesh，看起来一模一样
    g.position.set(spot.x, 0.02, spot.z);
    world.scene.add(g);
    this.active = {
      kind: 'supply', id: 'hallu_supply_' + (++this._i),
      group: g, x: spot.x, z: spot.z, born: performance.now(),
      triggerR: 2, drain: 3, caption: '只是幻觉……'
    };
    BR.log && BR.log('hallucination: fake supply', spot.x.toFixed(1), spot.z.toFixed(1));
    return true;
  };

  E._spawnFakeExit = function (world) {
    const spot = this._findSpot(world, 6, 10);
    if (!spot) return false;
    // 假门：门框 + 惨白半透明的门板（"看起来不太对"的质感）
    const g = new THREE.Group();
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x6a6252 });
    const postGeo = new THREE.BoxGeometry(0.14, 2.5, 0.14);
    const l = new THREE.Mesh(postGeo, frameMat); l.position.set(-0.6, 1.25, 0);
    const r = new THREE.Mesh(postGeo, frameMat); r.position.set(0.6, 1.25, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.14, 0.14), frameMat);
    top.position.set(0, 2.5, 0);
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.06, 2.36, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xb9b29a, transparent: true, opacity: 0.5 })
    );
    door.position.set(0, 1.18, 0);
    g.add(l, r, top, door);
    g.position.set(spot.x, 0, spot.z);
    // 面向玩家
    g.rotation.y = Math.atan2(BR.Player.pos.x - spot.x, BR.Player.pos.z - spot.z);
    world.scene.add(g);
    this.active = {
      kind: 'exit', id: 'hallu_exit_' + (++this._i),
      group: g, x: spot.x, z: spot.z, born: performance.now(),
      triggerR: 1.2, drain: 5, caption: '它从来就不在那里'
    };
    BR.log && BR.log('hallucination: fake exit', spot.x.toFixed(1), spot.z.toFixed(1));
    return true;
  };

  /* ---------- 触发 / 清理 ---------- */
  E._reveal = function (a) {
    if (!a || this.active !== a) return;
    this._startFade(a.group);
    this.active = null;
    BR.Player.drainSanity(a.drain);
    BR.UI.toast(a.caption, 2600);
    if (BR.Audio && BR.Audio.halluPoof) BR.Audio.halluPoof();
    else if (BR.Audio && BR.Audio.whisper) BR.Audio.whisper();
    this.cooldownT = Math.max(this.cooldownT, 30); // 触发后也给冷却，避免连刷
  };

  E._removeActiveMesh = function () {
    const a = this.active;
    if (a && a.group && a.group.parent) a.group.parent.remove(a.group);
  };

  // 开始消散：把组里所有材质设为透明，_tickFading 里 0.5s 淡出后移出场景
  E._startFade = function (group) {
    if (!group) return;
    group.traverse((m) => {
      if (m.material) {
        m.material = m.material.clone();
        m.material.transparent = true;
      }
    });
    this._fading.push({ group, t: 0 });
  };

  E._tickFading = function (dt) {
    if (!this._fading.length) return;
    for (let i = this._fading.length - 1; i >= 0; i--) {
      const f = this._fading[i];
      f.t += dt;
      const k = Math.min(1, f.t / 0.5);
      const op = 1 - k;
      f.group.traverse((m) => { if (m.material) m.material.opacity = op; });
      if (k >= 1) {
        if (f.group.parent) f.group.parent.remove(f.group);
        this._fading.splice(i, 1);
      }
    }
  };
})();
