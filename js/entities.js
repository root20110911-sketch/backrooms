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

  /* ---------- L94 观察者 / L7 利维坦（扩建新实体） ----------
   * TODO(与关卡 builder 对齐)：L94/L7 的 builder 尚未交付，此为 Systems B 按
   * 现有实体模式先写的占位实现。POI 类型 watcher_post / leviathan_route、
   * 行为参数（视距/移速/伤害）待 builder 交付片段后替换对齐。
   */
  function buildWatcher() {
    const g = new THREE.Group();
    const skin = lam(0x14161c);
    // 细长躯干
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.32), skin);
    torso.position.y = 1.35; g.add(torso);
    // 长脖子 + 头
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.6, 8), skin);
    neck.position.y = 2.45; g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
    head.position.y = 2.85; head.scale.set(1, 1.35, 1); g.add(head);
    // 独眼（注视感）
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), basic(0xe8f4ff));
    eye.position.set(0, 2.85, 0.22); g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), basic(0x0a0a0a));
    pupil.position.set(0, 2.85, 0.3); g.add(pupil);
    // 细长四肢
    const limbG = new THREE.CylinderGeometry(0.05, 0.04, 1.5, 6);
    const legs = [];
    [-1, 1].forEach(s => {
      const l = new THREE.Mesh(limbG, skin);
      l.position.set(s * 0.16, 0.75, 0); g.add(l); legs.push(l);
    });
    const armG = new THREE.CylinderGeometry(0.04, 0.03, 1.6, 6);
    const arms = [];
    [-1, 1].forEach(s => {
      const a = new THREE.Mesh(armG, skin);
      a.position.set(s * 0.36, 1.5, 0); a.rotation.z = s * 0.08;
      g.add(a); arms.push(a);
    });
    g.userData.legs = legs;
    g.userData.arms = arms;
    g.userData.height = 3.1;
    return g;
  }

  function buildLeviathan() {
    const g = new THREE.Group();
    const skin = lam(0x1d3038);
    const belly = lam(0x9fb3ad);
    // 蛇形躯干：5 节
    const segs = [];
    const segG = new THREE.BoxGeometry(1.1, 0.9, 1.5);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(segG, i % 2 ? belly : skin);
      s.position.set(0, 0.75, -i * 1.35);
      s.scale.set(1 - i * 0.09, 1 - i * 0.07, 1);
      g.add(s); segs.push(s);
    }
    // 头：宽吻 + 眼
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 1.3), skin);
    head.position.set(0, 1.0, 1.0); g.add(head);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 1.1), belly);
    jaw.position.set(0, 0.62, 1.1); g.add(jaw);
    const eyeG = new THREE.SphereGeometry(0.09, 8, 6);
    const eyeM = basic(0x7df0ff);
    [-1, 1].forEach(s => {
      const e = new THREE.Mesh(eyeG, eyeM);
      e.position.set(s * 0.45, 1.15, 1.5); g.add(e);
    });
    // 背鳍
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 6), belly);
      fin.position.set(0, 1.35 - i * 0.06, -0.6 - i * 1.35);
      g.add(fin);
    }
    g.userData.segs = segs;
    g.userData.height = 1.6;
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
    const builders = { hound: buildHound, lurker: buildLurker, partygoer: buildPartygoer, watcher: buildWatcher, leviathan: buildLeviathan };
    const group = builders[type]();
    group.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
    W.scene.add(group);
    const ent = {
      id: 'e' + (eid++), type, group, W,
      x: group.position.x, z: group.position.z, yaw: Math.random() * 6.28,
      state: 'idle', stateT: 0, path: null, pathI: 0, repath: 0,
      target: null, lastSeen: null, loseT: 0,
      atkCd: 0, sndCd: 0, animT: Math.random() * 9,
      lureCd: 0, lured: false, // 发电机噪音引怪用
      data: data || {},
      active: true
    };
    // 初始状态
    if (type === 'hound') { ent.state = 'patrol'; ent.wp = (data.route || []).slice(); ent.wpi = 0; }
    if (type === 'lurker') { ent.state = 'hide'; ent.home = { x: ent.x, z: ent.z }; }
    if (type === 'partygoer') { ent.state = 'wander'; }
    if (type === 'watcher') { ent.state = 'stand'; ent.gazeT = 0; }
    if (type === 'leviathan') { ent.state = 'dwell'; ent.home = { x: ent.x, z: ent.z }; }
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
    // 观察者：L94（POI type 'watcher', data.mode: 'day' 白天只注视不追击）
    pois.filter(p => p.type === 'watcher').forEach(p => {
      spawn('watcher', p.tx, p.ty, W, p.data || {});
    });
    // 利维坦：L7（POI type 'leviathan'，单点 + data.depth；栖居最深水区，不远离巢穴）
    pois.filter(p => p.type === 'leviathan').forEach(p => {
      spawn('leviathan', p.tx, p.ty, W, p.data || {});
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

  /* ---------- 道具接入（ui.js 的 useItem 调用） ----------
   * 实体没有 hp 字段：受伤语义 = 驱散 + 爆炸硬直（atkCd 抬高，短时间无法攻击），
   * 伤害数字由调用方 toast 展示（hurtRadius 返回 {n, dmg}）。 */
  // 笑魇驱散剂：半径内实体逃跑 dur 秒
  E.fleeRadius = function (x, z, radius, dur) {
    let n = 0;
    for (const e of this.list) {
      if (!e.active) continue;
      if (Math.hypot(e.x - x, e.z - z) <= radius) {
        e.fleeT = dur; e.fleeSpeed = 3.4; n++;
      }
    }
    return n;
  };
  // 火盐：半径内实体受伤 + 驱散 8 秒 + 2.5 秒硬直
  E.hurtRadius = function (x, z, radius, dmg) {
    let n = 0;
    for (const e of this.list) {
      if (!e.active) continue;
      if (Math.hypot(e.x - x, e.z - z) <= radius) {
        e.fleeT = Math.max(e.fleeT || 0, 8); e.fleeSpeed = 3.6;
        e.atkCd = Math.max(e.atkCd || 0, 2.5);
        n++;
      }
    }
    return { n, dmg: n * dmg };
  };
  // 痛液：前方锥形（range 米、方向点积 >= cosHalf）内实体腐蚀 dur 秒 + 疼痛逃窜
  E.coneCorrode = function (x, z, fx, fz, range, cosHalf, dur) {
    let n = 0;
    for (const e of this.list) {
      if (!e.active) continue;
      const dx = e.x - x, dz = e.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const dot = d > 0.01 ? (dx / d) * fx + (dz / d) * fz : 1;
      if (dot >= cosHalf) {
        e.corrodeT = dur; e.corrodeFxT = 0;
        e.fleeT = Math.max(e.fleeT || 0, dur); e.fleeSpeed = 3.2;
        n++;
      }
    }
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
    // 轴分离 + 滑动（两轴独立尝试）。
    // 注意：之前这里是 `if (x) ... else if (z)`，当 dx 恰为 0（寻路 waypoint 与实体同 x，
    // 纯 z 方向移动）时第一分支是空操作恒成立，z 永远走不动——实体在 z 向腿上永久卡死。
    // 由于寻路 waypoint 都是 tile 中心、实体出生也在 tile 中心，约一半路腿是纯 z 向，
    // 实际效果是猎犬/潜伏者走几步就卡住，几乎永远到不了玩家面前（"偏容易"的头号真因）。
    const ox = ent.x, oz = ent.z;
    if (W.circleFree(nx, ent.z, 0.42)) ent.x = nx;
    if (W.circleFree(ent.x, nz, 0.42)) ent.z = nz;
    if (ent.x === ox && ent.z === oz) ent.stuckT = (ent.stuckT || 0) + dt;
    else ent.stuckT = 0;
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

  /* 拦截点：按估计速度给提前量（×0.75 保守，防蛇形走位抖动）；玩家基本不动则直接瞄准。
   * 这是"索敌能力"而非移速：4.55m/s 追不上 5.6m/s 疾跑是物理事实，拦截靠的是抄近道/迎面，
   * 在有回环的走廊里猎犬会自己切角，而不是永远跟在屁股后面吃灰。 */
  function aimPoint(ent, px, pz, speed) {
    const vx = ent._evx || 0, vz = ent._evz || 0;
    if (Math.hypot(vx, vz) < 1.2) return { x: px, z: pz };
    const dist = Math.hypot(px - ent.x, pz - ent.z) || 1;
    const lead = Math.min(dist / speed, 2.2) * 0.75;
    return { x: px + vx * lead, z: pz + vz * lead };
  }
  /* 朝拦截点寻路；预测点落在墙里走不通则回退到玩家当前位置（永不空转） */
  function pathToAim(ent, tx, tz, fx, fz) {
    if (pathTo(ent, tx, tz)) return true;
    return pathTo(ent, fx, fz);
  }
  /* hound chase→search：搜捕首腿偏向玩家消失时的行进方向，而非原地打转 */
  function houndToSearch(ent) {
    ent.state = 'search'; ent.stateT = 0; ent.noticed = false; ent._searchBiased = false;
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
      // 玩家速度估计（追击拦截预测用）：各实体独立观测、指数平滑。
      // 只在 entities.js 内部做，不碰 world.js/main.js。
      if (ent._lpx !== undefined && dt > 0) {
        const k = 0.35;
        ent._evx = (ent._evx || 0) * (1 - k) + ((ctx.playerPos.x - ent._lpx) / dt) * k;
        ent._evz = (ent._evz || 0) * (1 - k) + ((ctx.playerPos.z - ent._lpz) / dt) * k;
      } else { ent._evx = 0; ent._evz = 0; }
      ent._lpx = ctx.playerPos.x; ent._lpz = ctx.playerPos.z;
      // 实体 proximity 侵蚀理智：追击/注视时更快
      if (dist < 13) {
        const hostile = ent.state === 'chase' || ent.state === 'stalk' || ent.state === 'attack';
        BR.Player.drainSanity(dt * (hostile ? 5 : seen ? 2.5 : 1.2));
      }

      // —— 道具接入：腐蚀 tick（痛液）——
      if (ent.corrodeT > 0) {
        ent.corrodeT -= dt;
        ent.corrodeFxT = (ent.corrodeFxT || 0) + dt;
        if (ent.corrodeFxT >= 1) { ent.corrodeFxT = 0; ent.atkCd = Math.max(ent.atkCd || 0, 1); }
      }
      // —— 道具接入：驱散（笑魇驱散剂/火盐/痛液）优先于原状态机，逃离玩家 ——
      if (ent.fleeT > 0) {
        ent.fleeT -= dt;
        const d = dist || 0.001, k = 12 / d;
        moveToward(ent, ent.x + (ent.x - ctx.playerPos.x) * k,
          ent.z + (ent.z - ctx.playerPos.z) * k, ent.fleeSpeed || 3.4, dt);
        ent.stateT = 0; // 驱散结束不直接接攻击，状态机自己恢复
        ent.group.position.set(ent.x, 0, ent.z);
        ent.group.rotation.y = ent.yaw;
        animateEnt(ent, dt);
        continue;
      }

      if (ent.type === 'hound') updateHound(ent, dt, ctx, dist, seen);
      else if (ent.type === 'lurker') updateLurker(ent, dt, ctx, dist, seen);
      else if (ent.type === 'watcher') updateWatcher(ent, dt, ctx, dist, seen);
      else if (ent.type === 'leviathan') updateLeviathan(ent, dt, ctx, dist, seen);
      else updatePartygoer(ent, dt, ctx, dist, seen);

      // 落位 + 朝向 + 步行动画
      ent.group.position.set(ent.x, 0, ent.z);
      ent.group.rotation.y = ent.yaw;
      animateEnt(ent, dt);
    }
  };

  function entView(ent, ctx) {
    let v;
    // 视距（ patrol 状态也吃这套）：猎犬 20→22/13→14 —— L3 是它的主场，灯光下看得更远；
    // 潜伏者 11→12（黑暗 16→17）；派对客 15→16。配合听觉，不单纯靠移速。
    if (ent.type === 'hound') v = ctx.flashlightOn ? 22 : 14;
    else if (ent.type === 'lurker') v = isDark(ent) ? 17 : 12; // 黑暗增益：灯灭/风暴期它看得更远
    else if (ent.type === 'watcher') v = 18;
    else if (ent.type === 'leviathan') v = 22;
    else v = 16;
    // 低理智：你更容易被"注意"到（也更难集中精神躲藏）
    if (BR.Player && BR.Player.sanity < 30) v *= 1.35;
    return v;
  }

  // 实体所处环境是否黑暗：L1 的 blackout / 闪烁风暴期间
  // lurker 在黑暗中更活跃——"闪烁风暴与实体行为的配合"：风暴嗡鸣就是预警
  function isDark(ent) {
    const W = ent.W;
    return !!(W && (W.blackout || (W.flickerStorm && W.flickerStorm.t > 0)));
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
  // 发电机噪音引怪（L3）：运行中的发电机在 GEN_LURE_R 米内会把巡逻的猎犬吸引过去查看。
  // 风险/收益：开电 → 引怪。旋钮 E.GEN_LURE_R（米）。
  E.GEN_LURE_R = 18;
  // 最近的运行中发电机（interactable kind 'generator'，事件 'gen_<id>' 已记录）
  function nearestRunningGen(ent) {
    const W = ent.W;
    if (!W || !W.interactables || !W.state || !W.state.events) return null;
    let best = null, bd = Infinity;
    for (const it of W.interactables) {
      if (it.kind !== 'generator') continue;
      const evId = 'gen_' + it.id.replace(/^genbtn_/, '');
      if (W.state.events.indexOf(evId) < 0) continue; // 未启动
      const d = Math.hypot(it.pos.x - ent.x, it.pos.z - ent.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { x: best.pos.x, z: best.pos.z, d: bd } : null;
  }
  function updateHound(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    const W = ent.W;
    switch (ent.state) {
      case 'patrol': {
        if (ent.lureCd > 0) ent.lureCd -= dt;
        if (seen && (dist < 10 || ctx.playerNoise > 0.5 || (ctx.flashlightOn && dist < 16))) {
          // 预警：先进入 investigate 跟踪并低吼示警，不直接 chase；
          // 玩家有约 1.5s 窗口决定跑/蹲/关手电（见 investigate 的 warnT 逻辑）
          ent.state = 'investigate';
          ent.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          ent.lured = false; ent.warnT = 0; ent.loseT = 0;
          ent.stateT = 0; pathTo(ent, ent.target.x, ent.target.z);
          BR.Audio.growl();
          break;
        }
        if (ctx.playerNoise > 0.4 && dist < 24) {
          // 听觉：步行 0.45 也能被听见（原来只有疾跑 1.0 才触发）——走廊里走路不再是隐身；
          // 照例先给 growl 预警，玩家有 1.5s 窗口应对
          ent.state = 'investigate';
          ent.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          ent.lured = false; ent.warnT = 0;
          ent.stateT = 0; pathTo(ent, ent.target.x, ent.target.z);
          BR.Audio.growl();
          break;
        }
        // 发电机噪音：比玩家脚步声优先级低（玩家先被处理），但能把远处的猎犬引过来
        const gl = nearestRunningGen(ent);
        if (gl && gl.d < E.GEN_LURE_R && !(ent.lureCd > 0)) {
          ent.state = 'investigate';
          ent.target = { x: gl.x, z: gl.z };
          ent.lured = true; // 被发电机引来：到地方看一眼就走，不追击发电机
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
        if (ent.repath <= 0) {
          let tgt = wp;
          // 听觉漂移：听到走动声（步行 0.45/疾跑 1.0）且在 30m 内，下一腿偏向玩家大方向。
          // 只是"巡逻过去看看"，不直接 investigate——预警仍在 investigate 里给，玩家不会被无声偷袭。
          // 太近（<9m）不漂移：那个距离听觉 investigate 本来就会触发。
          // 漂移目标按玩家行进方向再往前推 3s：迎面堵比跟在后面闻尾气管用（对付疾跑者的关键）。
          if (ctx.playerNoise > 0.3 && dist < 30 && dist > 9) {
            const px = ctx.playerPos.x + (ent._evx || 0) * 3;
            const pz = ctx.playerPos.z + (ent._evz || 0) * 3;
            let bi = ent.wpi % ent.wp.length, bd = Infinity;
            for (let i = 0; i < ent.wp.length; i++) {
              const d = Math.hypot(ent.wp[i].x - px, ent.wp[i].z - pz);
              if (d < bd) { bd = d; bi = i; }
            }
            if (ent.wp[bi] !== tgt) tgt = ent.wp[bi];
          }
          pathTo(ent, tgt.x, tgt.z); ent.repath = 3;
        }
        break;
      }
      case 'investigate': {
        // 目视预警流程：持续被看见则 warnT 累积，1.5s 后（或贴脸 6m 内）转 chase；
        // 期间玩家可以跑开/蹲下/关手电应对——预警时间从 0 提到约 1.5s
        if (seen && dist < 14 && !ent.lured) {
          ent.warnT = (ent.warnT || 0) + dt; ent.loseT = 0;
          ent.lastSeen = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          ent.repath -= dt;
          if (ent.repath <= 0) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 1.0; }
          if (ent.warnT > 1.5 || dist < 6) {
            ent.state = 'chase';
            notice(ent, ctx, dist); BR.Audio.bark();
            break;
          }
          followPath(ent, 3.0, dt);
          break;
        }
        // 被发电机引来途中发现玩家：同样给短预警再转追击
        if (ent.lured && seen && dist < 11) {
          ent.warnT = (ent.warnT || 0) + dt;
          if (ent.warnT > 1.0 || dist < 6) {
            ent.lured = false; ent.state = 'chase';
            notice(ent, ctx, dist); BR.Audio.bark(); break;
          }
          followPath(ent, 3.0, dt);
          break;
        }
        ent.warnT = Math.max(0, (ent.warnT || 0) - dt * 2);
        if (followPath(ent, 3.0, dt)) {
          if (ent.stateT > 4) {
            ent.state = 'patrol'; ent.path = null;
            if (ent.lured) { ent.lured = false; ent.lureCd = 25; } // 防在发电机旁反复横跳
          }
        } else ent.stateT = 0;
        break;
      }
      case 'chase': {
        if (dist < 1.9) {
          ent.state = 'attack'; ent.stateT = 0; break;
        }
        if (seen) {
          ent.lastSeen = { x: ctx.playerPos.x, z: ctx.playerPos.z }; ent.loseT = 0;
          ent._trackVx = ent._evx || 0; ent._trackVz = ent._evz || 0; // 搜捕偏置用
        } else {
          ent.loseT += dt;
          // 跟丢 9s 才转搜捕（原来 6s）：甩掉需要真正的卡视线+拉开距离，绕个柱子不够
          if (ent.loseT > 9) { houndToSearch(ent); break; }
        }
        const tgt = ent.lastSeen || ctx.playerPos;
        // 索敌：看见时瞄准拦截点（抄近道/迎面），看不见时沿最后目击点；移速仍是 4.55 上限
        let ax = tgt.x, az = tgt.z;
        if (seen) { const ap = aimPoint(ent, ctx.playerPos.x, ctx.playerPos.z, 4.55); ax = ap.x; az = ap.z; }
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathToAim(ent, ax, az, tgt.x, tgt.z); ent.repath = 1.0; }
        // 追击中被甩掉太久则放弃
        if (followPath(ent, 4.55, dt) && !seen) { houndToSearch(ent); }
        if (ent.sndCd <= 0 && dist < 18) { BR.Audio.growl(); ent.sndCd = 5; }
        break;
      }
      case 'search': {
        if (seen && dist < 13) { ent.state = 'chase'; notice(ent, ctx, dist); break; }
        // 搜捕 12s（原来 9s）：在附近多找一会儿，躲猫猫没那么容易
        if (ent.stateT > 12) { ent.state = 'patrol'; ent.path = null; ent.noticed = false; break; }
        if (!ent.path || followPath(ent, 2.6, dt)) {
          if (!ent._searchBiased && ent.lastSeen) {
            // 首腿：沿跟丢瞬间的行进方向延伸搜（玩家大概率继续往那跑），而非原地打转
            ent._searchBiased = true;
            const lx = ent.lastSeen.x + (ent._trackVx || 0) * 2.2;
            const lz = ent.lastSeen.z + (ent._trackVz || 0) * 2.2;
            if (pathTo(ent, lx, lz)) break;
          }
          // 之后在最后目击点附近随机转
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
  // hide --(目视 1.2s 预警 / 贴脸 5m 直扑)--> warn --(确认)--> stalk --(跟丢)--> search --(10s 无果)--> hide
  // 黑暗增益（L1 灯灭/风暴期）：触发距离 12→15m，stalk 速度 3.5→3.8m/s
  function updateLurker(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    const dark = isDark(ent);
    const zoneR = (ent.data.r || 5) * T * 0.5 + 6;
    const hd = Math.hypot(ent.x - ent.home.x, ent.z - ent.home.z);
    switch (ent.state) {
      case 'hide': {
        ent.group.scale.y = BR.damp(ent.group.scale.y, 0.72, 4, dt);
        if (seen && dist < (dark ? 15 : 12)) {
          ent.state = 'warn'; ent.stateT = 0; // 预警：它抬头了，先别动
          BR.Audio.whisper();
        }
        break;
      }
      case 'warn': {
        // 1.2s 凝视预警：脱离视线/拉开距离则作罢，否则转 stalk；
        // 阴：玩家直接走到 5m 脸上（没听见 whisper），不等 1.2s 直接扑
        ent.group.scale.y = BR.damp(ent.group.scale.y, 1, 6, dt);
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (!seen || dist > (dark ? 17 : 13)) { ent.state = 'hide'; ent.stateT = 0; break; }
        if (ent.stateT > 1.2 || dist < 5) {
          ent.state = 'stalk'; ent.stateT = 0;
          notice(ent, ctx, dist);
          BR.Audio.stinger();
        }
        break;
      }
      case 'stalk': {
        ent.group.scale.y = BR.damp(ent.group.scale.y, 1, 4, dt);
        if (seen) ent.lastSeen = { x: ctx.playerPos.x, z: ctx.playerPos.z };
        // 玩家蹲伏不动 → 困惑，退回
        const still = ctx.playerNoise < 0.1;
        if (ctx.crouching && still && dist < 7) {
          ent.confuseT = (ent.confuseT || 0) + dt;
          if (ent.confuseT > 3) { ent.state = 'hide'; ent.confuseT = 0; pathTo(ent, ent.home.x, ent.home.z); break; }
        } else ent.confuseT = 0;
        if (dist < 1.7) { ent.state = 'attack'; break; }
        // 跟丢：不再直接回家，而是在最后目击点附近搜索一番
        if (hd > zoneR + 8 || dist > 26) { ent.state = 'search'; ent.stateT = 0; ent.path = null; break; }
        // 被直视时减速（它不喜欢被盯着）
        const facing = isFacingPlayer(ent, ctx);
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 0.8; }
        // stalk 3.5（黑暗 3.8）：修正原来 3.1 < 玩家步行 3.4、数学上永远追不上步行玩家的 bug；
        // 仍远低于疾跑 5.6——潜伏者是"阴"（埋伏），不是短跑冠军
        followPath(ent, facing ? 1.6 : (dark ? 3.8 : 3.5), dt);
        if (ent.sndCd <= 0 && dist < 12) { BR.Audio.whisper(); ent.sndCd = 7; }
        break;
      }
      case 'search': {
        // 搜索能力：在最后目击点附近转 10s（原来 7s）；期间再被看见则转回 stalk
        ent.group.scale.y = BR.damp(ent.group.scale.y, 1, 4, dt);
        if (seen && dist < 12) { ent.state = 'stalk'; ent.stateT = 0; notice(ent, ctx, dist); break; }
        if (ent.stateT > 10) {
          ent.state = 'hide'; ent.stateT = 0; ent.path = null; ent.noticed = false;
          pathTo(ent, ent.home.x, ent.home.z);
          break;
        }
        if (!ent.path || followPath(ent, 2.4, dt)) {
          const a = Math.random() * 6.28, r = 6 + Math.random() * 4;
          const lx = ent.lastSeen ? ent.lastSeen.x : ent.x;
          const lz = ent.lastSeen ? ent.lastSeen.z : ent.z;
          pathTo(ent, lx + Math.cos(a) * r, lz + Math.sin(a) * r);
        }
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
        // 诡：16m（原来 14m）外就注意到你了，giggle 预警保留
        if (seen && dist < 16) { ent.state = 'stalk'; notice(ent, ctx, dist); BR.Audio.giggle(); break; }
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
        // 韧性：30m（原来 26m）才降级回 stalk，别想跑两步就甩掉
        if (dist > 30) { ent.state = 'stalk'; break; }
        ent.repath -= dt;
        // 索敌：和猎犬一样做拦截预测（移速仍是 4.25 上限）
        if (ent.repath <= 0 || !ent.path) {
          const ap = seen ? aimPoint(ent, ctx.playerPos.x, ctx.playerPos.z, 4.25) : null;
          if (ap) pathToAim(ent, ap.x, ap.z, ctx.playerPos.x, ctx.playerPos.z);
          else pathTo(ent, ctx.playerPos.x, ctx.playerPos.z);
          ent.repath = 0.9;
        }
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

  /* ----- 观察者（L94）----- */
  // 行为：平时静立扫视；看见玩家→注视（理智侵蚀）；手电直照>3s 或贴脸→追击；
  // 甩掉（>30m）则回到原地。
  // 白天模式（POI data.mode==='day'，且 L94 昼夜系统未报夜晚）：只注视不追击，
  // 呼应"L94 白天安全、夜晚高风险"的关卡设计。参数待 L94 builder 对齐。
  function watcherAggressive(ent) {
    if (ent.data && ent.data.mode && ent.data.mode !== 'day') return true;
    try {
      const L = BR.Levels && BR.Levels.L94;
      if (L && typeof L.isNight === 'function' && L.isNight()) return true;
    } catch (e) { /* 昼夜系统未接入时按 POI mode */ }
    return false;
  }
  function updateWatcher(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    switch (ent.state) {
      case 'stand': {
        ent.yaw += Math.sin(ent.animT * 0.3) * dt * 0.5; // 缓慢扫视
        if (seen && dist < 18) {
          ent.state = 'watch'; ent.stateT = 0;
          notice(ent, ctx, dist);
        }
        break;
      }
      case 'watch': {
        // 注视玩家
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (dist < 13) BR.Player.drainSanity(dt * 3);
        // 手电直照或贴脸 → 激怒（仅攻击性模式）
        ent.gazeT = (ctx.flashlightOn && dist < 14) || dist < 2.4 ? (ent.gazeT || 0) + dt : 0;
        if (watcherAggressive(ent) && ent.gazeT > 3) {
          ent.state = 'chase'; ent.stateT = 0;
          notice(ent, ctx, dist); BR.Audio.stinger();
          break;
        }
        if (!seen && ent.stateT > 8) { ent.state = 'stand'; ent.stateT = 0; ent.noticed = false; }
        break;
      }
      case 'chase': {
        if (dist < 2.0) { ent.state = 'attack'; ent.stateT = 0; break; }
        // 夜晚韧性：35m（原来 30m）才放弃；白天模式依然只注视不追击（昼夜分明保留）
        if (dist > 35) { ent.state = 'stand'; ent.stateT = 0; ent.noticed = false; ent.gazeT = 0; break; }
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 1.2; }
        followPath(ent, 3.4, dt);
        if (ent.sndCd <= 0 && dist < 16) { BR.Audio.whisper(); ent.sndCd = 6; }
        break;
      }
      case 'attack': {
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (ent.atkCd <= 0 && dist < 2.5) {
          ent.atkCd = 1.4;
          BR.Player.hurt(24, 'watcher');
          BR.Audio.stinger();
        }
        if (dist > 3) ent.state = 'chase';
        break;
      }
    }
  }

  /* ----- 利维坦（L7）----- */
  // 行为：栖居最深水区（巢穴 home），巢穴附近缓游；高噪音/目视（22m）→调查；
  // 确认→追击；近身扑击；跟丢/远离巢穴→搜索→返回巢穴。参数待 L7 builder 对齐。
  function updateLeviathan(ent, dt, ctx, dist, seen) {
    ent.stateT += dt;
    if (!ent.home) ent.home = { x: ent.x, z: ent.z };
    const homeDist = Math.hypot(ent.x - ent.home.x, ent.z - ent.home.z);
    switch (ent.state) {
      case 'dwell': {
        if (seen && dist < 22) {
          ent.state = 'chase'; ent.stateT = 0;
          notice(ent, ctx, dist); BR.Audio.stinger();
          break;
        }
        if (ctx.playerNoise > 0.55 && dist < 26) {
          ent.state = 'investigate';
          ent.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          ent.stateT = 0; pathTo(ent, ent.target.x, ent.target.z);
          break;
        }
        // 巢穴附近缓游（圆周巡弋）
        if (!ent.path || followPath(ent, 1.8, dt)) {
          const a = ent.animT * 0.25;
          pathTo(ent, ent.home.x + Math.cos(a) * 6, ent.home.z + Math.sin(a) * 6);
        }
        break;
      }
      case 'investigate': {
        if (seen && dist < 20) { ent.state = 'chase'; notice(ent, ctx, dist); break; }
        if (followPath(ent, 2.6, dt)) {
          if (ent.stateT > 6) { ent.state = 'dwell'; ent.path = null; }
        } else ent.stateT = 0;
        break;
      }
      case 'chase': {
        if (dist < 2.4) { ent.state = 'attack'; ent.stateT = 0; break; }
        // 离巢穴太远则放弃
        if (homeDist > 30) { ent.state = 'return'; ent.stateT = 0; ent.path = null; break; }
        if (seen) { ent.lastSeen = { x: ctx.playerPos.x, z: ctx.playerPos.z }; ent.loseT = 0; }
        else {
          ent.loseT += dt;
          if (ent.loseT > 9) { ent.state = 'search'; ent.stateT = 0; ent.noticed = false; break; }
        }
        const tgt = ent.lastSeen || ctx.playerPos;
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, tgt.x, tgt.z); ent.repath = 1.2; }
        if (followPath(ent, 4.2, dt) && !seen) { ent.state = 'search'; ent.stateT = 0; }
        if (ent.sndCd <= 0 && dist < 20) { BR.Audio.growl(); ent.sndCd = 6; }
        break;
      }
      case 'search': {
        if (seen && dist < 20 && homeDist < 28) { ent.state = 'chase'; notice(ent, ctx, dist); break; }
        if (ent.stateT > 10) { ent.state = 'return'; ent.path = null; ent.noticed = false; break; }
        if (!ent.path || followPath(ent, 2.2, dt)) {
          const a = Math.random() * 6.28, r = 5 + Math.random() * 6;
          const lx = ent.lastSeen ? ent.lastSeen.x : ent.x;
          const lz = ent.lastSeen ? ent.lastSeen.z : ent.z;
          pathTo(ent, lx + Math.cos(a) * r, lz + Math.sin(a) * r);
        }
        break;
      }
      case 'return': {
        if (!ent.path) pathTo(ent, ent.home.x, ent.home.z);
        if (followPath(ent, 2.8, dt)) { ent.state = 'dwell'; ent.stateT = 0; ent.noticed = false; ent.path = null; }
        if (seen && dist < 18) { ent.state = 'chase'; ent.stateT = 0; }
        break;
      }
      case 'attack': {
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (ent.atkCd <= 0 && dist < 2.8) {
          ent.atkCd = 1.5;
          BR.Player.hurt(26, 'leviathan');
          BR.Audio.bark();
        }
        if (dist > 3.2) ent.state = 'chase';
        break;
      }
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
    if (u.segs) {
      // 利维坦：躯干波浪式摆动
      u.segs.forEach((s, i) => { s.position.x = Math.sin(t * 0.9 + i * 1.1) * 0.28; });
    }
  }
})();
