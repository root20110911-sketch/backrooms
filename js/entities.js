/* entities.js —— 实体建模 + AI（猎犬 / 潜伏者 / 派对客） */
(function () {
  const BR = window.BR;
  const T = BR.TILE;

  const E = { list: [] };
  BR.Entities = E;

  /* ---------- 网格 BFS 寻路 ---------- */
  function findPath(W, sx, sy, tx, ty) {
    sx |= 0; sy |= 0; tx |= 0; ty |= 0;
    if (sx === tx && sy === ty) return [];
    const w = W.map.w, h = W.map.h;
    const key = (x, y) => y * w + x;
    const prev = new Int32Array(w * h).fill(-1);
    const q = [key(sx, sy)];
    prev[key(sx, sy)] = key(sx, sy);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let found = false, qi = 0;
    while (qi < q.length && q.length < 4000) {
      const cur = q[qi++], cx = cur % w, cy = (cur / w) | 0;
      if (cx === tx && cy === ty) { found = true; break; }
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (W.blocked(nx, ny)) continue;
        const nk = key(nx, ny);
        if (prev[nk] !== -1) continue;
        prev[nk] = cur; q.push(nk);
      }
    }
    if (!found) return null;
    const path = [];
    let cur = key(tx, ty);
    while (cur !== key(sx, sy)) {
      path.push({ x: BR.tileCX(cur % w), z: BR.tileCZ((cur / w) | 0) });
      cur = prev[cur];
      if (path.length > 200) break;
    }
    path.reverse();
    return path;
  }

  /* ---------- 程序化模型 ---------- */
  function lam(color) { return new THREE.MeshLambertMaterial({ color }); }
  function basic(color) { return new THREE.MeshBasicMaterial({ color }); }

  function buildHound() {
    const g = new THREE.Group();
    const skin = lam(0x1a1512);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 1.5), skin);
    body.position.y = 0.85; g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.55), skin);
    head.position.set(0, 1.15, 0.95); g.add(head);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.45), lam(0x0d0a08));
    jaw.position.set(0, 0.92, 1.0); g.add(jaw);
    //  teeth
    for (let i = -1; i <= 1; i++) {
      const tth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), basic(0xd8d4c8));
      tth.position.set(i * 0.11, 0.86, 1.12); g.add(tth);
    }
    const eyeG = new THREE.SphereGeometry(0.055, 8, 6);
    const eyeM = basic(0xfffde8);
    [-1, 1].forEach(s => {
      const e = new THREE.Mesh(eyeG, eyeM);
      e.position.set(s * 0.13, 1.22, 1.2); g.add(e);
    });
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.8), skin);
    tail.position.set(0, 0.95, -1.0); tail.rotation.x = 0.5; g.add(tail);
    const legs = [];
    const legG = new THREE.CylinderGeometry(0.09, 0.07, 0.85, 6);
    [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]].forEach(([x, z]) => {
      const l = new THREE.Mesh(legG, skin);
      l.position.set(x, 0.42, z); g.add(l); legs.push(l);
    });
    g.userData.legs = legs;
    g.userData.height = 1.35;
    return g;
  }

  function buildLurker() {
    const g = new THREE.Group();
    const skin = lam(0x23282a);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 1.9), skin);
    body.position.y = 0.45; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), skin);
    head.position.set(0, 0.5, 1.05); head.scale.set(1, 0.8, 1.2); g.add(head);
    const eyeG = new THREE.SphereGeometry(0.05, 8, 6);
    const eyeM = basic(0xff3020);
    [[-0.12, 0.12], [0.12, 0.12], [-0.12, -0.05], [0.12, -0.05]].forEach(([x, y]) => {
      const e = new THREE.Mesh(eyeG, eyeM);
      e.position.set(x, 0.55 + y, 1.28); g.add(e);
    });
    const legs = [];
    const legG = new THREE.CylinderGeometry(0.06, 0.05, 0.5, 6);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(legG, skin);
      l.position.set(i % 2 ? 0.35 : -0.35, 0.25, 0.7 - Math.floor(i / 2) * 0.7);
      l.rotation.z = i % 2 ? -0.5 : 0.5;
      g.add(l); legs.push(l);
    }
    g.userData.legs = legs;
    g.userData.height = 0.8;
    return g;
  }

  function buildPartygoer() {
    const g = new THREE.Group();
    const skin = lam(0xe8b820); // 金黄
    const legG = new THREE.CylinderGeometry(0.11, 0.09, 1.25, 8);
    [-1, 1].forEach(s => {
      const l = new THREE.Mesh(legG, skin);
      l.position.set(s * 0.18, 0.62, 0); g.add(l);
    });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 1.05, 10), skin);
    torso.position.y = 1.75; g.add(torso);
    const armG = new THREE.CylinderGeometry(0.07, 0.05, 1.7, 8);
    const arms = [];
    [-1, 1].forEach(s => {
      const a = new THREE.Mesh(armG, skin);
      a.position.set(s * 0.48, 1.55, 0); a.rotation.z = s * 0.12;
      g.add(a); arms.push(a);
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), skin);
    head.position.y = 2.55; g.add(head);
    // 血红笑脸
    const smile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.32),
      new THREE.MeshBasicMaterial({ map: BR.Textures.get('smiley'), transparent: true })
    );
    smile.position.set(0, 2.55, 0.36); g.add(smile);
    // 派对帽
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 10), lam(0xd03050));
    hat.position.y = 2.95; hat.rotation.z = 0.25; g.add(hat);
    g.userData.arms = arms;
    g.userData.height = 2.9;
    return g;
  }

  /* ---------- 实体基类 ---------- */
  let eid = 0;
  function spawn(type, tx, ty, W, data) {
    const builders = { hound: buildHound, lurker: buildLurker, partygoer: buildPartygoer };
    const group = builders[type]();
    group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
    W.scene.add(group);
    const ent = {
      id: 'e' + (eid++), type, group, W,
      x: group.position.x, z: group.position.z, yaw: Math.random() * 6.28,
      state: 'idle', stateT: 0, path: null, pathI: 0, repath: 0,
      target: null, lastSeen: null, loseT: 0,
      atkCd: 0, sndCd: 0, animT: Math.random() * 9,
      data: data || {},
      active: true
    };
    // 初始状态
    if (type === 'hound') { ent.state = 'patrol'; ent.wp = (data.route || []).slice(); ent.wpi = 0; }
    if (type === 'lurker') { ent.state = 'hide'; ent.home = { x: ent.x, z: ent.z }; }
    if (type === 'partygoer') { ent.state = 'wander'; }
    E.list.push(ent);
    BR.log('spawn entity', type, tx, ty);
    return ent;
  }

  E.spawnForMap = function (map, W) {
    const pois = map.pois || [];
    // 猎犬：L3 巡逻路线
    const patrols = pois.filter(p => p.type === 'patrol').sort((a, b) => a.data.order - b.data.order);
    if (patrols.length) {
      spawn('hound', patrols[0].tx, patrols[0].ty, W, {
        route: patrols.map(p => ({ x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty) }))
      });
    }
    // 潜伏者：L2
    pois.filter(p => p.type === 'lurker_zone').forEach(p => {
      spawn('lurker', p.tx, p.ty, W, { r: p.data.r || 5 });
    });
    // 派对客：FUN
    pois.filter(p => p.type === 'partygoer').forEach(p => {
      spawn('partygoer', p.tx, p.ty, W, {});
    });
  };

  E.dispose = function () {
    for (const e of this.list) {
      if (e.group.parent) e.group.parent.remove(e.group);
    }
    this.list = [];
  };
  E.countActive = function () {
    let n = 0;
    for (const e of this.list) if (e.near) n++;
    return n;
  };

  /* ---------- 移动 ---------- */
  function moveToward(ent, tx, tz, speed, dt) {
    const dx = tx - ent.x, dz = tz - ent.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const step = Math.min(d, speed * dt);
    const nx = ent.x + dx / d * step, nz = ent.z + dz / d * step;
    const W = ent.W;
    // 轴分离 + 滑动
    if (W.circleFree(nx, ent.z, 0.42)) ent.x = nx;
    else if (W.circleFree(ent.x, nz, 0.42)) ent.z = nz;
    else { ent.stuckT = (ent.stuckT || 0) + dt; }
    ent.yaw = Math.atan2(dx, dz);
    return false;
  }

  function followPath(ent, speed, dt) {
    if (!ent.path || ent.pathI >= ent.path.length) return true;
    const wp = ent.path[ent.pathI];
    if (moveToward(ent, wp.x, wp.z, speed, dt)) ent.pathI++;
    return ent.pathI >= ent.path.length;
  }

  function pathTo(ent, tx, tz) {
    const W = ent.W;
    const p = findPath(W, Math.floor(ent.x / T), Math.floor(ent.z / T), Math.floor(tx / T), Math.floor(tz / T));
    if (p) { ent.path = p; ent.pathI = 0; ent.stuckT = 0; return true; }
    ent.path = null; return false;
  }

  /* ---------- 主更新 ---------- */
  E.update = function (dt, ctx) {
    for (const ent of this.list) {
      const dx = ctx.playerPos.x - ent.x, dz = ctx.playerPos.z - ent.z;
      const dist = Math.hypot(dx, dz);
      ent.near = dist < 48;
      ent.dist = dist;
      ent.animT += dt * (ent.state === 'chase' || ent.state === 'stalk' ? 9 : 4);
      ent.atkCd = Math.max(0, ent.atkCd - dt);
      ent.sndCd = Math.max(0, ent.sndCd - dt);
      if (!ent.near) { ent.group.visible = dist < 60; continue; }
      ent.group.visible = true;
      const seen = dist < entView(ent, ctx) && ctx.losTo(ent.x, ent.z);
      // 实体 proximity 侵蚀理智：追击/注视时更快
      if (dist < 13) {
        const hostile = ent.state === 'chase' || ent.state === 'stalk' || ent.state === 'attack';
        BR.Player.drainSanity(dt * (hostile ? 5 : seen ? 2.5 : 1.2));
      }

      if (ent.type === 'hound') updateHound(ent, dt, ctx, dist, seen);
      else if (ent.type === 'lurker') updateLurker(ent, dt, ctx, dist, seen);
      else updatePartygoer(ent, dt, ctx, dist, seen);

      // 落位 + 朝向 + 步行动画
      ent.group.position.set(ent.x, 0, ent.z);
      ent.group.rotation.y = ent.yaw;
      animateEnt(ent, dt);
    }
  };

  function entView(ent, ctx) {
    let v;
    if (ent.type === 'hound') v = ctx.flashlightOn ? 20 : 13;
    else if (ent.type === 'lurker') v = 11;
    else v = 15;
    // 低理智：你更容易被"注意"到（也更难集中精神躲藏）
    if (BR.Player && BR.Player.sanity < 30) v *= 1.35;
    return v;
  }

  function notice(ent, ctx, dist) {
    // 首次发现：惊吓演出
    if (!ent.noticed) {
      ent.noticed = true;
      BR.Audio.stinger();
      BR.Player.shake(0.45);
    }
  }

  /* ----- 猎犬 ----- */
  function updateHound(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    const W = ent.W;
    switch (ent.state) {
      case 'patrol': {
        if (seen && (dist < 10 || ctx.playerNoise > 0.5 || (ctx.flashlightOn && dist < 16))) {
          ent.state = 'chase'; notice(ent, ctx, dist);
          BR.Audio.bark(); BR.Audio.growl();
          break;
        }
        if (ctx.playerNoise > 0.62 && dist < 22) {
          ent.state = 'investigate';
          ent.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          ent.stateT = 0; pathTo(ent, ent.target.x, ent.target.z);
          break;
        }
        if (!ent.wp.length) break;
        const wp = ent.wp[ent.wpi % ent.wp.length];
        if (followPath(ent, 2.3, dt) || !ent.path) {
          if (!ent.path) pathTo(ent, wp.x, wp.z);
          else { ent.wpi++; ent.path = null; }
        }
        ent.repath -= dt;
        if (ent.repath <= 0) { pathTo(ent, wp.x, wp.z); ent.repath = 3; }
        break;
      }
      case 'investigate': {
        if (seen && dist < 11) { ent.state = 'chase'; notice(ent, ctx, dist); BR.Audio.bark(); break; }
        if (followPath(ent, 3.0, dt)) {
          if (ent.stateT > 4) { ent.state = 'patrol'; ent.path = null; }
        } else ent.stateT = 0;
        break;
      }
      case 'chase': {
        if (dist < 1.9) {
          ent.state = 'attack'; ent.stateT = 0; break;
        }
        if (seen) { ent.lastSeen = { x: ctx.playerPos.x, z: ctx.playerPos.z }; ent.loseT = 0; }
        else {
          ent.loseT += dt;
          if (ent.loseT > 6) { ent.state = 'search'; ent.stateT = 0; ent.noticed = false; break; }
        }
        const tgt = ent.lastSeen || ctx.playerPos;
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, tgt.x, tgt.z); ent.repath = 1.0; }
        // 追击中被甩掉太久则放弃
        if (followPath(ent, 4.55, dt) && !seen) { ent.state = 'search'; ent.stateT = 0; }
        if (ent.sndCd <= 0 && dist < 18) { BR.Audio.growl(); ent.sndCd = 5; }
        break;
      }
      case 'search': {
        if (seen && dist < 11) { ent.state = 'chase'; notice(ent, ctx, dist); break; }
        if (ent.stateT > 9) { ent.state = 'patrol'; ent.path = null; ent.noticed = false; break; }
        if (!ent.path || followPath(ent, 2.6, dt)) {
          // 在最后目击点附近随机转
          const a = Math.random() * 6.28, r = 4 + Math.random() * 5;
          const lx = ent.lastSeen ? ent.lastSeen.x : ent.x;
          const lz = ent.lastSeen ? ent.lastSeen.z : ent.z;
          pathTo(ent, lx + Math.cos(a) * r, lz + Math.sin(a) * r);
        }
        break;
      }
      case 'attack': {
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (ent.atkCd <= 0 && dist < 2.4) {
          ent.atkCd = 1.1;
          BR.Player.hurt(22, 'hound');
          BR.Audio.bark();
        }
        if (dist > 2.6) ent.state = 'chase';
        break;
      }
    }
  }

  /* ----- 潜伏者 ----- */
  function updateLurker(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    const zoneR = (ent.data.r || 5) * T * 0.5 + 6;
    const hd = Math.hypot(ent.x - ent.home.x, ent.z - ent.home.z);
    switch (ent.state) {
      case 'hide': {
        ent.group.scale.y = BR.damp(ent.group.scale.y, 0.72, 4, dt);
        if (seen && dist < 10.5) {
          ent.state = 'stalk'; notice(ent, ctx, dist);
          BR.Audio.stinger();
        }
        break;
      }
      case 'stalk': {
        ent.group.scale.y = BR.damp(ent.group.scale.y, 1, 4, dt);
        // 玩家蹲伏不动 → 困惑，退回
        const still = ctx.playerNoise < 0.1;
        if (ctx.crouching && still && dist < 7) {
          ent.confuseT = (ent.confuseT || 0) + dt;
          if (ent.confuseT > 3) { ent.state = 'hide'; ent.confuseT = 0; pathTo(ent, ent.home.x, ent.home.z); break; }
        } else ent.confuseT = 0;
        if (dist < 1.7) { ent.state = 'attack'; break; }
        if (hd > zoneR + 8 || dist > 26) { ent.state = 'hide'; pathTo(ent, ent.home.x, ent.home.z); ent.noticed = false; break; }
        // 被直视时减速（它不喜欢被盯着）
        const facing = isFacingPlayer(ent, ctx);
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 0.8; }
        followPath(ent, facing ? 1.6 : 3.1, dt);
        if (ent.sndCd <= 0 && dist < 12) { BR.Audio.whisper(); ent.sndCd = 7; }
        break;
      }
      case 'attack': {
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (ent.atkCd <= 0 && dist < 2.2) {
          ent.atkCd = 1.3;
          BR.Player.hurt(18, 'lurker');
          BR.Audio.stinger();
        }
        if (dist > 2.6) ent.state = 'stalk';
        break;
      }
    }
    // hide 状态走回家
    if (ent.state === 'hide' && hd > 1.2) followPath(ent, 2.2, dt);
  }

  function isFacingPlayer(ent, ctx) {
    // 实体是否在玩家视野正前方（±35°）
    const dx = ent.x - ctx.playerPos.x, dz = ent.z - ctx.playerPos.z;
    const ang = Math.atan2(dx, dz); // 世界朝向
    let diff = ang - (Math.PI - BR.Player.yaw); // 玩家面向 -z 为 yaw=0
    // 简化：用玩家视角方向与到实体的方向夹角
    const px = -Math.sin(BR.Player.yaw), pz = -Math.cos(BR.Player.yaw);
    const d = Math.hypot(dx, dz) || 1;
    const dot = (dx / d) * px + (dz / d) * pz;
    return dot > 0.82;
  }

  /* ----- 派对客 ----- */
  function updatePartygoer(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    switch (ent.state) {
      case 'wander': {
        if (seen && dist < 14) { ent.state = 'stalk'; notice(ent, ctx, dist); BR.Audio.giggle(); break; }
        if (!ent.path || followPath(ent, 1.7, dt)) {
          const a = Math.random() * 6.28, r = 5 + Math.random() * 9;
          const nx = ent.x + Math.cos(a) * r, nz = ent.z + Math.sin(a) * r;
          if (!pathTo(ent, nx, nz)) ent.stateT = 0;
        }
        break;
      }
      case 'stalk': {
        // 蹲伏静止 4 秒 → 失去兴趣
        if (ctx.crouching && ctx.playerNoise < 0.1) {
          ent.boreT = (ent.boreT || 0) + dt;
          if (ent.boreT > 4) { ent.state = 'wander'; ent.boreT = 0; ent.path = null; ent.noticed = false; break; }
        } else ent.boreT = 0;
        if (dist < 7 || ctx.playerNoise > 0.72) { ent.state = 'chase'; BR.Audio.giggle(); break; }
        if (dist > 24) { ent.state = 'wander'; ent.path = null; ent.noticed = false; break; }
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 1.2; }
        followPath(ent, 2.9, dt);
        break;
      }
      case 'chase': {
        if (dist < 1.9) { ent.state = 'attack'; break; }
        if (dist > 26) { ent.state = 'stalk'; break; }
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 0.9; }
        followPath(ent, 4.25, dt);
        if (ent.sndCd <= 0) { BR.Audio.giggle(); ent.sndCd = 4; }
        break;
      }
      case 'attack': {
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (ent.atkCd <= 0 && dist < 2.4) {
          ent.atkCd = 1.2;
          BR.Player.hurt(28, 'partygoer');
          BR.Audio.giggle();
        }
        if (dist > 2.8) ent.state = 'chase';
        break;
      }
    }
    if (ent.sndCd <= 0 && dist < 16 && ent.state === 'wander') {
      if (Math.random() < 0.3) BR.Audio.giggle();
      ent.sndCd = 9;
    }
  }

  /* ---------- 步行动画 ---------- */
  function animateEnt(ent, dt) {
    const u = ent.group.userData;
    const t = ent.animT;
    if (u.legs) {
      u.legs.forEach((l, i) => { l.rotation.x = Math.sin(t + i * 1.7) * 0.55; });
    }
    if (u.arms) {
      // 派对客：手臂诡异摆动 + 身体轻微摇晃
      u.arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 0.7 + i * 3.1) * 0.5; });
      ent.group.rotation.z = Math.sin(t * 0.5) * 0.06;
      // 靠近时头部转向玩家（tilt）
      if (ent.dist < 10) {
        ent.group.rotation.z = Math.sin(t * 1.3) * 0.14;
      }
    }
  }
})();
