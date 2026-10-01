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
    hasFlashlight: false, flashlightOn: false,
    camera: null,
    bobPhase: 0, stepAcc: 0,
    trauma: 0,           // 镜头震动 0..1
    landDipT: 0,
    hurtCd: 0,
    eyeCur: 1.62
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
    this.crouching = false; this.running = false;
    this.eyeCur = C().EYE;
  };

  P.toggleCrouch = function () {
    this.crouching = !this.crouching;
    BR.bus.emit('crouch', { on: this.crouching });
  };
  P.toggleFlashlight = function () {
    if (!this.hasFlashlight) { BR.UI.toast('你还没有手电筒'); return; }
    this.flashlightOn = !this.flashlightOn;
    BR.Audio.uiClick();
    BR.UI.toast(this.flashlightOn ? '手电筒：开' : '手电筒：关');
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
    this.hp = Math.min(100, this.hp + n);
    BR.bus.emit('heal', { hp: this.hp });
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
    const speed = this.crouching ? cfg.CROUCH : (wantRun ? cfg.RUN : cfg.WALK);
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

    // —— 蹲伏眼高 ——
    const eyeT = this.crouching ? cfg.CROUCH_EYE : cfg.EYE;
    this.eyeCur = BR.damp(this.eyeCur, eyeT, 10, dt);

    // —— headbob + 脚步 ——
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
    const bobY = moving ? Math.abs(Math.sin(this.bobPhase)) * (this.crouching ? 0.03 : 0.055) : 0;
    const bobX = moving ? Math.sin(this.bobPhase) * 0.03 : 0;

    // —— 镜头 ——
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.landDipT = Math.max(0, this.landDipT - dt * 3);
    const sh = this.trauma * this.trauma;
    const shx = sh * 0.12 * Math.sin(performance.now() * 0.09);
    const shy = sh * 0.12 * Math.cos(performance.now() * 0.073);
    this.camera.position.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.eyeY() + bobY - this.landDipT * 0.22 + shy,
      this.pos.z - bobX * Math.sin(this.yaw)
    );
    this.camera.rotation.set(this.pitch + shx * 0.4, this.yaw, shx * 0.3);
    const fovT = wantRun && moving ? cfg.FOV_RUN : cfg.FOV;
    if (Math.abs(this.camera.fov - fovT) > 0.1) {
      this.camera.fov = BR.damp(this.camera.fov, fovT, 6, dt);
      this.camera.updateProjectionMatrix();
    }

    // —— 交互射线（屏幕中心） ——
    this._intCd = Math.max(0, (this._intCd || 0) - dt);
    if (this._intCd === 0) {
      this._intCd = 0.12;
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
      const hit = world.rayInteract(this.camera.position, dir, cfg.INTERACT_DIST + 1.2);
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
