/* player.js —— 第一人称角色控制：移动/碰撞/视角/脚步/受伤 */
(function () {
  const BR = window.BR;
  const C = () => BR.Config;

  const P = {
    pos: new THREE.Vector3(0, 0, 0),  // 脚底
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    crouching: false, running: false,
    hp: 100, noise: 0,
    sanity: 100,          // 理智 0..100：黑暗/实体/断电侵蚀，杏仁水与安全屋恢复
    hunger: 100,          // 饥饿 0..100：随时间缓慢下降，食物恢复；<25 时回血减半、移速降低
    hasFlashlight: false, flashlightOn: false,
    flashBat: 100,        // 手电电池 0..100：开灯时 1.2/s 耗电，归零自动关灯；电池道具 +60
    camera: null,
    bobPhase: 0, stepAcc: 0,
    trauma: 0,           // 镜头震动 0..1
    landDipT: 0,
    // 外部镜头偏移（掉落转场等写入，update 中应用，不与转场抢相机）
    extDipY: 0, extRoll: 0, extPitch: 0, extFov: 0,
    hurtCd: 0,
    sanWhispT: 6, sanStingT: 20,
    eyeCur: 1.62,
    // —— 第三人称：火柴人 avatar + 肩视角 ——
    thirdPerson: false,
    avatar: null,   // 延迟到第一次切换第三人称时构建（平板默认第一人称，不占内存）
    _av: null       // avatar 部件引用 {torso,head,armL,armR,legL,legR}
  };
  BR.Player = P;

  P.initCamera = function () {
    this.camera = new THREE.PerspectiveCamera(C().FOV, innerWidth / innerHeight, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
  };
  P.eyeY = function () { return this.pos.y + this.eyeCur; };

  P.reset = function (x, z, yaw) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = yaw || 0; this.pitch = 0;
    this.hp = 100; this.noise = 0; this.trauma = 0;
    this.sanity = 100; this.sanWhispT = 6; this.sanStingT = 20;
    this.hunger = 100; this._hungerWarned = false;
    this.flashBat = 100; // 手电电池回满
    this.crouching = false; this.running = false;
    this.extDipY = 0; this.extRoll = 0; this.extPitch = 0; this.extFov = 0;
    this.eyeCur = C().EYE;
    // 第三人称默认关闭，avatar 若已构建则隐藏（不销毁，下次切换复用）
    this.thirdPerson = false;
    if (this.avatar) this.avatar.visible = false;
  };

  P.toggleCrouch = function () {
    this.crouching = !this.crouching;
    BR.bus.emit('crouch', { on: this.crouching });
  };
  P.toggleFlashlight = function () {
    if (!this.hasFlashlight) { BR.UI.toast('你还没有手电筒'); return; }
    if (!this.flashlightOn && this.flashBat <= 0) { BR.UI.toast('手电筒没电了，找块电池吧'); return; }
    this.flashlightOn = !this.flashlightOn;
    BR.Audio.uiClick();
    BR.UI.toast(this.flashlightOn ? '手电筒：开' : '手电筒：关');
  };

  /* ================= 第三人称：极简 3D 火柴人 =================
   * 圆柱身体、四肢圆柱 + 末端圆球（r128 没有 CapsuleGeometry，用
   * CylinderGeometry + SphereGeometry 拼）、头一个大圆球。
   * 单色深灰哑光 MeshLambertMaterial，全身共 10 个 mesh，
   * 四肢用 pivot Group 包裹以便摆动。
   */
  P.buildAvatar = function () {
    if (this.avatar) return this.avatar;
    const mat = new THREE.MeshLambertMaterial({ color: 0x3b4046 }); // 单色深灰哑光，材质复用
    const mesh = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false; // 小物件，避免裁剪抖动
      return m;
    };
    const g = new THREE.Group();
    // 躯干：圆柱 r0.11 h0.62，中心 y=1.05（6 段，性能审查：avatar 总三角 <500）
    const torso = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 6), 0, 1.05, 0);
    g.add(torso);
    // 头：大圆球 r0.16，y=1.58
    const head = mesh(new THREE.SphereGeometry(0.16, 10, 8), 0, 1.58, 0);
    g.add(head);
    // 四肢：pivot Group + 圆柱 + 末端圆球
    const mkLimb = (r, len, jointR, px, py) => {
      const piv = new THREE.Group();
      piv.position.set(px, py, 0);
      piv.add(mesh(new THREE.CylinderGeometry(r, r, len, 6), 0, -len / 2, 0));
      piv.add(mesh(new THREE.SphereGeometry(jointR, 6, 4), 0, -len, 0));
      g.add(piv);
      return piv;
    };
    const armL = mkLimb(0.05, 0.55, 0.065, -0.19, 1.30); // 手臂
    const armR = mkLimb(0.05, 0.55, 0.065, 0.19, 1.30);
    const legL = mkLimb(0.065, 0.62, 0.085, -0.10, 0.72); // 腿
    const legR = mkLimb(0.065, 0.62, 0.085, 0.10, 0.72);
    g.visible = false;
    this.avatar = g;
    this._av = { torso, head, armL, armR, legL, legR };
    return g;
  };

  // 切换第三人称（input.js 的按键绑定调用；判空由调用方负责）
  P.toggleThirdPerson = function () {
    this.thirdPerson = !this.thirdPerson;
    if (this.thirdPerson) {
      const av = this.buildAvatar();
      const sc = (BR.World && BR.World.scene) || null;
      if (sc && av.parent !== sc) sc.add(av);
      av.visible = true;
    } else if (this.avatar) {
      this.avatar.visible = false; // 第一人称隐藏，避免看到头内部
    }
    if (BR.bus && BR.bus.emit) BR.bus.emit('thirdperson', { on: this.thirdPerson });
    return this.thirdPerson;
  };

  // 低画质：四肢摆动幅度减半
  P._swingScale = function () {
    const q = BR.QUALITY;
    return (q && q.maxLights <= 3) ? 0.5 : 1;
  };

  // avatar 跟随 P.pos/yaw + 四肢动画（仅第三人称调用）
  P._updateAvatar = function (dt, world, moving, wantRun) {
    const av = this.buildAvatar();
    const sc = (world && world.scene) || (BR.World && BR.World.scene) || null;
    if (sc && av.parent !== sc) sc.add(av);
    av.visible = true;
    const A = this._av;
    // 蹲伏下沉系数（平滑）
    this._crouchK = BR.damp(this._crouchK || 0, this.crouching ? 1 : 0, 10, dt);
    const ck = this._crouchK;
    // 位置=脚底，朝向=yaw；蹲下时整体下沉
    av.position.set(this.pos.x, this.pos.y - 0.38 * ck, this.pos.z);
    av.rotation.y = this.yaw;
    // 四肢摆动：按 bobPhase 正弦，手臂与腿反相；幅度小
    const swing = this._swingScale() * (wantRun ? 0.85 : 0.55);
    if (moving) {
      const s = Math.sin(this.bobPhase);
      A.armL.rotation.x = s * swing;
      A.armR.rotation.x = -s * swing;
      A.legL.rotation.x = -s * swing;
      A.legR.rotation.x = s * swing;
    } else {
      // 静止：四肢回正 + 轻微呼吸起伏
      for (const p of [A.armL, A.armR, A.legL, A.legR])
        p.rotation.x = BR.damp(p.rotation.x, 0, 8, dt);
      const br = Math.sin(performance.now() * 0.002) * 0.012;
      A.torso.position.y = 1.05 + br;
      A.head.position.y = 1.58 + br;
    }
    if (moving) { A.torso.position.y = 1.05; A.head.position.y = 1.58; }
    // 蹲下：手臂下摆、腿微屈
    A.armL.rotation.x += ck * 0.35;
    A.armR.rotation.x += ck * 0.35;
    A.legL.rotation.x += ck * 0.5;
    A.legR.rotation.x += ck * 0.5;
  };

  // 第三人称肩视角相机：身后 3.2m、上方 1.9m、右偏 0.5m；撞墙拉近，绝不穿墙
  P._updateThirdCamera = function (dt, world, wantRun, moving) {
    const cfg = C();
    const cam = this.camera;
    const ck = this._crouchK || 0;
    const headY = this.pos.y + (1.58 - 0.38 * ck);
    const hx = this.pos.x, hz = this.pos.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // 前
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);  // 右
    // 期望机位偏移（yaw 方向）：后 3.2m、上 1.9m、右 0.5m；pitch 抬头则机位下压
    const dx = -fx * 3.2 + rx * 0.5;
    const dz = -fz * 3.2 + rz * 0.5;
    const dy = 1.9 - this.pitch * 2.2;
    const wallH = (world && world.theme && world.theme.wallH) || 3;
    // 相机碰撞：从头部向目标机位小步进，撞墙（circleFree）或顶到天花板就停
    const N = 14;
    let px = hx, py = headY, pz = hz;
    const canStep = world && typeof world.circleFree === 'function';
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const nx = hx + dx * t, nz = hz + dz * t;
      const ny = Math.min(headY + dy * t, wallH - 0.25);
      if (ny < 0.35) break;
      if (canStep && !world.circleFree(nx, nz, 0.28)) break;
      px = nx; py = ny; pz = nz;
    }
    cam.position.set(px, py, pz);
    // lookAt 头部前方（pitch 影响俯仰）
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    cam.lookAt(hx + fx * cp * 2, headY + sp * 2 - 0.15, hz + fz * cp * 2);
    const fovT = (wantRun && moving ? cfg.FOV_RUN : cfg.FOV) + (this.extFov || 0);
    if (Math.abs(cam.fov - fovT) > 0.1) {
      cam.fov = BR.damp(cam.fov, fovT, 6, dt);
      cam.updateProjectionMatrix();
    }
  };

  P.hurt = function (n, cause) {
    if (BR.Game.state !== 'playing' || this.hurtCd > 0 && cause !== 'steam') return;
    this.hp -= n;
    if (cause !== 'steam') this.hurtCd = 0.6;
    this.trauma = Math.min(1, this.trauma + n * 0.03);
    BR.bus.emit('hurt', { hp: this.hp, cause });
    if (this.hp <= 0) { this.hp = 0; BR.bus.emit('died', { cause }); }
  };
  P.heal = function (n) {
    // 饥饿过低（<25）时回血减半
    if (this.hunger < 25) n *= 0.5;
    this.hp = Math.min(100, this.hp + n);
    BR.bus.emit('heal', { hp: this.hp });
  };
  P.eat = function (n) {
    this.hunger = Math.min(100, this.hunger + n);
  };
  // —— 理智 ——
  P.drainSanity = function (n) {
    if (BR.Game.state !== 'playing') return;
    this.sanity = Math.max(0, this.sanity - n);
  };
  P.restoreSanity = function (n) {
    this.sanity = Math.min(100, this.sanity + n);
  };
  P.landDip = function () { this.landDipT = 1; };
  P.shake = function (amt) { this.trauma = Math.min(1, this.trauma + amt); };

  P.update = function (dt, input, world) {
    if (BR.Game.state !== 'playing') return;
    const cfg = C();
    this.hurtCd = Math.max(0, this.hurtCd - dt);

    // —— 视角 ——
    const lk = input.consumeLook();
    this.yaw -= lk.dx * input.sens();
    this.pitch -= lk.dy * input.sens();
    this.pitch = BR.clamp(this.pitch, -1.45, 1.45);

    // —— 移动输入 ——
    const mv = input.getMove(); // {x:右, z:前} -1..1
    const wantRun = (input.runHeld || input.runToggle) && mv.z > 0.1 && !this.crouching;
    this.running = wantRun;
    var speed = this.crouching ? cfg.CROUCH : (wantRun ? cfg.RUN : cfg.WALK);
    // 饥饿过低（<25）时移速小幅下降（约 10%）
    if (this.hunger < 25) speed *= 0.9;
    // 扩建钩子：游泳/涉水减速（BR.Swim 由水关卡提供，未加载时为 undefined）
    if (BR.Swim && BR.Swim.speedMul) speed *= BR.Swim.speedMul;
    // 世界方向（yaw=0 面向 -z）
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tx = (rx * mv.x + fx * mv.z) * speed;
    const tz = (rz * mv.x + fz * mv.z) * speed;

    this.vel.x = BR.damp(this.vel.x, tx, cfg.ACCEL, dt);
    this.vel.z = BR.damp(this.vel.z, tz, cfg.ACCEL, dt);
    if (mv.x === 0 && mv.z === 0) {
      this.vel.x = BR.damp(this.vel.x, 0, cfg.FRICTION, dt);
      this.vel.z = BR.damp(this.vel.z, 0, cfg.FRICTION, dt);
    }
    world.moveCircle(this.pos, this.vel.x * dt, this.vel.z * dt, cfg.RADIUS);

    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const moving = hSpeed > 0.4;

    // —— 噪音（实体听觉用） ——
    const target = !moving ? 0 : this.crouching ? 0.15 : wantRun ? 1.0 : 0.45;
    this.noise = BR.damp(this.noise, target, 6, dt);

    // —— 理智：黑暗/断电侵蚀，明亮处与安全屋恢复 ——
    // v1.3 修 Bug A：灯具太密导致 dark 恒 <0.3、玩家持续回理智。
    // 新规则：安全屋 +5/s；断电 -3.5/s；真黑区（dark>0.55）按 -(1.2+dark*2.2)/s；
    // dim 区（0.1<=dark<=0.55，有灯但较暗）-0.5/s 缓慢掉；
    // 明亮区（dark<0.1）才 +0.5/s 缓慢回（darknessAt 最低 0.15，实际到不了，条件苛刻）。
    // 实体 proximity 侵蚀在 entities.js 里，保留不动。
    const dark = world.darknessAt ? world.darknessAt(this.pos.x, this.pos.z) : 0;
    const inSafe = world.safeZoneAt ? world.safeZoneAt(this.pos.x, this.pos.z) : false;
    if (inSafe) this.restoreSanity(dt * 5);
    else if (world.blackout) this.drainSanity(dt * 3.5);
    else if (dark > 0.55) this.drainSanity(dt * (1.2 + dark * 2.2));
    else if (dark >= 0.1) this.drainSanity(dt * 0.5);
    else this.restoreSanity(dt * 0.5);
    // —— 低理智幻觉：耳语/惊吓/视线晃动 ——
    if (this.sanity < 38) {
      this.sanWhispT -= dt;
      if (this.sanWhispT <= 0) {
        this.sanWhispT = 7 + Math.random() * 9;
        BR.Audio.whisper();
        if (this.sanity < 22) BR.UI.toast('你听见有人在叫你的名字……');
      }
    }
    if (this.sanity < 20) {
      this.sanStingT -= dt;
      if (this.sanStingT <= 0) {
        this.sanStingT = 16 + Math.random() * 14;
        BR.Audio.stinger(); this.shake(0.3);
      }
    }
    if (BR.UI.setSanityFx) BR.UI.setSanityFx(this.sanity);

    // —— 饥饿：随时间缓慢下降（0.1/s，100 点约撑 16~17 分钟）——
    if (this.hunger > 0) this.hunger = Math.max(0, this.hunger - dt * 0.1);
    if (this.hunger < 25 && !this._hungerWarned) {
      this._hungerWarned = true;
      BR.UI.toast('你饿得发慌，回血变慢了，找点吃的吧！', 3200);
    } else if (this.hunger >= 30) this._hungerWarned = false;

    // —— 手电电池：开灯时 1.2/s 耗电，归零自动关灯 ——
    if (this.flashlightOn && this.hasFlashlight) {
      this.flashBat = Math.max(0, this.flashBat - dt * 1.2);
      if (this.flashBat <= 0) {
        this.flashlightOn = false;
        BR.UI.toast('手电筒没电了！');
        if (BR.UI.updateInv) BR.UI.updateInv();
      }
    }

    // —— 蹲伏眼高 ——
    const eyeT = this.crouching ? cfg.CROUCH_EYE : cfg.EYE;
    this.eyeCur = BR.damp(this.eyeCur, eyeT, 10, dt);

    // —— headbob + 脚步 ——
    // 镜头晃动设置：on=1 / weak=0.45 / off=0
    const hbSet = (input.settings && input.settings.headbob) || 'on';
    const hb = hbSet === 'off' ? 0 : (hbSet === 'weak' ? 0.45 : 1);
    const runK = wantRun ? 1.75 : 1;   // 冲刺幅度加大
    if (moving) {
      this.bobPhase += dt * (4 + hSpeed * 1.6);
      this.stepAcc += hSpeed * dt;
      if (this.stepAcc >= cfg.STEP_LEN) {
        this.stepAcc = 0;
        BR.Audio.footstep(world.surfaceAt(this.pos.x, this.pos.z));
        if (wantRun) BR.bus.emit('noise', { level: 1 });
      }
    } else {
      this.bobPhase = BR.damp(this.bobPhase, Math.round(this.bobPhase / Math.PI) * Math.PI, 8, dt);
    }
    const bobY = moving ? Math.abs(Math.sin(this.bobPhase)) * (this.crouching ? 0.03 : 0.055) * hb * runK : 0;
    const bobX = moving ? Math.sin(this.bobPhase) * 0.035 * hb * runK : 0;
    const bobRoll = moving ? Math.sin(this.bobPhase) * 0.014 * hb * runK : 0;

    // —— 第三人称：火柴人跟随与动画 ——
    if (this.thirdPerson) this._updateAvatar(dt, world, moving, wantRun);

    // —— 镜头 ——
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.landDipT = Math.max(0, this.landDipT - dt * 3);
    const sh = this.trauma * this.trauma;
    const shx = sh * 0.12 * Math.sin(performance.now() * 0.09);
    const shy = sh * 0.12 * Math.cos(performance.now() * 0.073);
    // 低理智：视线轻微游移
    const sanSway = this.sanity < 28 ? (28 - this.sanity) / 28 : 0;
    const swayX = sanSway * 0.02 * Math.sin(performance.now() * 0.0011);
    const swayY = sanSway * 0.02 * Math.cos(performance.now() * 0.0009);
    if (this.thirdPerson) {
      // 肩视角（走独立逻辑，第一人称逻辑不动）
      this._updateThirdCamera(dt, world, wantRun, moving);
    } else {
      if (this.avatar) this.avatar.visible = false; // 第一人称隐藏，避免看到头内部
      this.camera.position.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.eyeY() + bobY - this.landDipT * 0.22 + shy + (this.extDipY || 0),
      this.pos.z - bobX * Math.sin(this.yaw)
    );
    this.camera.rotation.set(
      this.pitch + shx * 0.4 + swayX + (this.extPitch || 0),
      this.yaw + swayY,
      shx * 0.3 + bobRoll + (this.extRoll || 0)
    );
    const fovT = (wantRun && moving ? cfg.FOV_RUN : cfg.FOV) + (this.extFov || 0);
    if (Math.abs(this.camera.fov - fovT) > 0.1) {
      this.camera.fov = BR.damp(this.camera.fov, fovT, 6, dt);
      this.camera.updateProjectionMatrix();
    }
    }

    // —— 交互射线（屏幕中心） ——
    this._intCd = Math.max(0, (this._intCd || 0) - dt);
    if (this._intCd === 0) {
      this._intCd = 0.12;
      // 修：复用 scratch 向量（每 0.12s 一次也避免 GC 抖动）
      this._intV = this._intV || new THREE.Vector3();
      this._intO = this._intO || new THREE.Vector3();
      this._intE = this._intE || new THREE.Euler(0, 0, 0, 'YXZ');
      // 第三人称：交互射线从玩家眼位沿视角方向发出（不用肩视角相机位）
      const dir = this.thirdPerson
        ? this._intV.set(0, 0, -1).applyEuler(this._intE.set(this.pitch, this.yaw, 0))
        : this._intV.set(0, 0, -1).applyEuler(this.camera.rotation);
      const origin = this.thirdPerson
        ? this._intO.set(this.pos.x, this.eyeY(), this.pos.z)
        : this.camera.position;
      const hit = world.rayInteract(origin, dir, cfg.INTERACT_DIST + 1.2);
      const cur = hit && hit.it.canUse() ? hit.it : null;
      if (cur !== this._curIt) {
        this._curIt = cur;
        BR.UI.setPrompt(cur ? cur.prompt() : null);
      } else if (cur) BR.UI.setPrompt(cur.prompt()); // 刷新动态文本
    }
    if (input.consumeInteract() && this._curIt) {
      this._curIt.use();
    }
  };
})();
