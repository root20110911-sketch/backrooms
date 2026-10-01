/* world.js —— 场景/区块管理：构建、加载/卸载、碰撞、交互、灯光 */
(function () {
  const BR = window.BR;
  const T = BR.TILE, CH = BR.CHUNK;

  // 共享基础几何体（永不释放）
  let GEO = null;
  function sharedGeo() {
    if (!GEO) {
      GEO = {
        wall: new THREE.BoxGeometry(T, 1, T),      // y 缩放至墙高
        plane: new THREE.PlaneGeometry(T, T),
        box: new THREE.BoxGeometry(1, 1, 1),
        cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
        sph: new THREE.SphereGeometry(0.5, 10, 8)
      };
    }
    return GEO;
  }

  const W = {
    scene: null, map: null, theme: null,
    chunks: new Map(),          // key -> {group, meshes:[], fixtures:[], disposables:[]}
    buildQueue: [],
    contentHooks: new Map(),   // chunkKey -> [fn(group, chunk)]
    interactables: [],          // {id,kind,meshes,pos,prompt,canUse,use,chunkKey,radius}
    interactMeshes: [],
    doors: {},                  // id -> {def, open, locked, mesh, panel, chunkKey, anim}
    fixtures: [],               // 全局灯具位置（已加载区块） {x,y,z,chunkKey,phase,flicker}
    lights: [],                 // 点光源池
    playerLight: null, flashSpot: null,
    blackout: false,
    state: null,                // {openedDoors,picked,openedCrates,events}
    elevator: null,
    steamVents: [],             // {id,x,z,points,on,chunkKey}
    lowDucts: new Set(),        // "tx,ty" 需要蹲伏通过
    time: 0,
    playerPos: new THREE.Vector3(),
    stats: { chunks: 0, roomsVisible: 0, entities: 0, drawCalls: 0, tris: 0 }
  };
  BR.World = W;

  const key2 = (cx, cy) => cx + ',' + cy;
  const chunkOf = (tx, ty) => key2(Math.floor(tx / CH), Math.floor(ty / CH));
  W.chunkKeyOf = (tx, ty) => chunkOf(tx, ty);

  W.tile = function (tx, ty) {
    const m = this.map;
    if (!m || tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return 0;
    return m.tiles[ty * m.w + tx];
  };
  W.isWall = function (tx, ty) { return this.tile(tx, ty) === 0; };
  W.surfaceAt = function (x, z) {
    return (this.theme && this.theme.surface) || 'concrete';
  };
  W.doorAt = function (tx, ty) {
    for (const id in this.doors) {
      const d = this.doors[id];
      if (d.def.tx === tx && d.def.ty === ty) return d;
    }
    return null;
  };
  // 门 tile：开着可通行（虚空之门等可设 solidWhenOpen 保持阻挡）
  W.blocked = function (tx, ty) {
    const d = this.doorAt(tx, ty);
    if (d) return !(d.open && !d.def.solidWhenOpen);
    if (this.isWall(tx, ty)) return true;
    return false;
  };
  // 跳过某墙 tile 的墙体渲染（门洞/电梯井由专用网格覆盖）
  W.skipWall = function (tx, ty) {
    this._noWall = this._noWall || new Set();
    this._noWall.add(tx + ',' + ty);
  };

  // tile 网格视线（实体 AI 用）
  W.los = function (ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / (T * 0.4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((ax + dx * t) / T), ty = Math.floor((az + dz * t) / T);
      if (this.blocked(tx, ty)) return false;
    }
    return true;
  };

  /* ---------------- 构建 ---------------- */
  W.build = function (map, savedState) {
    return new Promise((resolve) => {
      this.dispose();
      this.map = map;
      this.theme = (BR.Levels[map.level] && BR.Levels[map.level].theme) || {};
      this.state = savedState || { openedDoors: [], picked: [], openedCrates: [], events: [] };
      const th = this.theme;
      sharedGeo();

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(th.bg != null ? th.bg : 0x000000);
      const q = BR.QUALITY;
      const fs = (q && q.fogScale) || 1;
      this.scene.fog = new THREE.Fog(th.bg != null ? th.bg : 0x000000,
        (th.fogNear || 8) * fs, (th.fogFar || 46) * fs);

      const amb = new THREE.AmbientLight(th.ambient != null ? th.ambient : 0x404040,
        th.ambInt != null ? th.ambInt : 0.55);
      this.scene.add(amb); this._amb = amb;
      const hemi = new THREE.HemisphereLight(th.sky != null ? th.sky : 0x888888,
        th.ground != null ? th.ground : 0x222222, 0.35);
      this.scene.add(hemi); this._hemi = hemi;

      // 点光源池
      const maxL = (q && q.maxLights) || 5;
      for (let i = 0; i < maxL; i++) {
        const L = new THREE.PointLight(th.light != null ? th.light : 0xfff2cc, 0, 26, 2);
        this.scene.add(L); this.lights.push(L);
      }
      // 玩家基础光 + 手电
      this.playerLight = new THREE.PointLight(0xfff6e0, 0.32, 12, 2);
      this.scene.add(this.playerLight);
      this.flashSpot = new THREE.SpotLight(0xfff2d8, 0, 30, 0.5, 0.45, 1.2);
      this.scene.add(this.flashSpot); this.scene.add(this.flashSpot.target);

      // 关卡内容（门/道具/事件物）由 levels.js 注册
      if (BR.Levels[map.level] && BR.Levels[map.level].buildContent) {
        BR.Levels[map.level].buildContent(map, this);
      }
      // 实体
      if (BR.Entities && BR.Entities.spawnForMap) BR.Entities.spawnForMap(map, this);

      // 出生点周围立即建好，避免开场空白
      const sp = this.spawnOf(map);
      this.update(0.016, sp.x, sp.z, true);
      BR.log('world built', map.level, 'seed', map.seed);
      resolve();
    });
  };

  W.spawnOf = function (map) {
    const p = (map.pois || []).find(p => p.type === 'spawn');
    if (p) return { x: BR.tileCX(p.tx), z: BR.tileCZ(p.ty), yaw: (p.data && p.data.yaw) || 0 };
    const r = map.rooms[0];
    return { x: BR.tileCX(r.cx), z: BR.tileCZ(r.cy), yaw: 0 };
  };

  W.dispose = function () {
    if (BR.Entities && BR.Entities.dispose) BR.Entities.dispose();
    this.chunks.forEach((c) => this.unloadChunkMeshes(c));
    this.chunks.clear();
    this.buildQueue = [];
    this.contentHooks.clear();
    this.interactables = []; this.interactMeshes = [];
    this.doors = {}; this.fixtures = []; this.lights = [];
    this.steamVents = []; this.lowDucts.clear();
    this.elevator = null; this.blackout = false;
    this._noWall = null; this._openCeil = null; this._matCache = null;
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        // 共享几何体/材质不释放
      });
      this.scene = null;
    }
    // 释放本关创建的非共享材质
    if (this._levelMats) { this._levelMats.forEach(m => m.dispose && m.dispose()); this._levelMats = null; }
    this._amb = this._hemi = this.playerLight = this.flashSpot = null;
  };

  // 注册"某区块构建时执行"的内容钩子（可重复执行，卸载重建时恢复）
  W.addChunkContent = function (tx, ty, fn) {
    const k = chunkOf(tx, ty);
    if (!this.contentHooks.has(k)) this.contentHooks.set(k, []);
    this.contentHooks.get(k).push(fn);
  };
  // 在钩子内调用：把 obj 加入区块 group 并登记释放
  W.reg = function (group, obj) {
    group.add(obj);
    const c = group.userData.chunk;
    if (c) c.disposables.push(obj);
    return obj;
  };

  /* ---------------- 区块构建 ---------------- */
  W.mat = function (name) {
    // 本关材质缓存（dispose 时释放）
    this._matCache = this._matCache || {};
    if (!this._matCache[name]) {
      this._levelMats = this._levelMats || [];
      const tex = BR.Textures.get(name);
      const m = new THREE.MeshLambertMaterial({ map: tex });
      this._matCache[name] = m; this._levelMats.push(m);
    }
    return this._matCache[name];
  };

  W.buildChunk = function (cx, cy) {
    const k = key2(cx, cy);
    if (this.chunks.has(k)) return;
    const t0 = performance.now();
    const th = this.theme, wallH = th.wallH || 3;
    const group = new THREE.Group();
    const chunk = { key: k, cx, cy, group, meshes: [], fixtures: [], disposables: [] };
    group.userData.chunk = chunk;

    const wallM = [], floorM = [], ceilM = [], fixM = [];
    const dummy = new THREE.Object3D();
    const x0 = cx * CH, y0 = cy * CH;
    const rngH = new BR.RNG(BR.hashSeed(this.map.seed + ':' + k)); // 灯具分布确定性

    for (let ty = y0; ty < y0 + CH && ty < this.map.h; ty++) {
      for (let tx = x0; tx < x0 + CH && tx < this.map.w; tx++) {
        const t = this.tile(tx, ty);
        const wx = BR.tileCX(tx), wz = BR.tileCZ(ty);
        if (t === 1) {
          dummy.position.set(wx, 0, wz); dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          floorM.push(dummy.matrix.clone());
          if (!this.openCeilAt(tx, ty)) {
            dummy.position.set(wx, wallH, wz); dummy.rotation.set(Math.PI / 2, 0, 0);
            dummy.updateMatrix(); ceilM.push(dummy.matrix.clone());
          }
          // 灯具：按主题密度
          const dens = th.fixtureEvery || 5;
          if (rngH.int(1, dens) === 1 && !this.blackout) {
            dummy.position.set(wx, wallH - 0.02, wz); dummy.rotation.set(Math.PI / 2, 0, 0);
            dummy.updateMatrix(); fixM.push(dummy.matrix.clone());
            chunk.fixtures.push({ x: wx, y: wallH - 0.15, z: wz, phase: rngH.next() * 9, flicker: rngH.chance(0.12) });
          }
        } else {
          // 墙：任一 4 邻域是地面则渲染；门洞/电梯井跳过（专用网格覆盖）
          const hasDoor = this.doorAt(tx, ty);
          const noWall = this._noWall && this._noWall.has(tx + ',' + ty);
          if (hasDoor) {
            // 门洞下补一块地板（开门后可站立）
            dummy.position.set(wx, 0, wz); dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.scale.set(1, 1, 1); dummy.updateMatrix();
            floorM.push(dummy.matrix.clone());
          }
          if (!hasDoor && !noWall &&
              (this.tile(tx + 1, ty) === 1 || this.tile(tx - 1, ty) === 1 ||
               this.tile(tx, ty + 1) === 1 || this.tile(tx, ty - 1) === 1)) {
            dummy.position.set(wx, wallH / 2, wz); dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, wallH, 1); dummy.updateMatrix();
            wallM.push(dummy.matrix.clone());
            dummy.scale.set(1, 1, 1);
          }
        }
      }
    }

    const G = sharedGeo();
    function inst(geo, material, mats) {
      if (!mats.length) return null;
      const im = new THREE.InstancedMesh(geo, material, mats.length);
      for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
      im.instanceMatrix.needsUpdate = true;
      return im;
    }
    let m = inst(G.wall, this.mat(th.wall || 'concrete'), wallM);
    if (m) { group.add(m); chunk.meshes.push(m); }
    m = inst(G.plane, this.mat(th.floor || 'concreteFloor'), floorM);
    if (m) { group.add(m); chunk.meshes.push(m); }
    m = inst(G.plane, this.mat(th.ceil || 'ceiling'), ceilM);
    if (m) { group.add(m); chunk.meshes.push(m); }
    const fixMat = this._fixMat || (this._fixMat = new THREE.MeshBasicMaterial({ map: BR.Textures.get('fluor') }));
    m = inst(G.plane, fixMat, fixM);
    if (m) { group.add(m); chunk.meshes.push(m); chunk.fixtureMesh = m; }
    if (this.blackout && chunk.fixtureMesh) chunk.fixtureMesh.visible = false;

    // 内容钩子（门/道具/事件物）
    const hooks = this.contentHooks.get(k);
    if (hooks) for (const fn of hooks) { try { fn(group, chunk); } catch (e) { BR.warn('chunk hook err', e); } }

    this.scene.add(group);
    this.chunks.set(k, chunk);
    for (const f of chunk.fixtures) this.fixtures.push(Object.assign({ chunkKey: k }, f));
    const dt = performance.now() - t0;
    if (dt > 24) BR.log('chunk build slow', k, dt.toFixed(1) + 'ms');
  };

  W.openCeilAt = function (tx, ty) {
    // 天花板破洞（L1 fun_hole 等）由 levels.js 登记
    return this._openCeil && this._openCeil.has(tx + ',' + ty);
  };
  W.setOpenCeil = function (tx, ty) {
    this._openCeil = this._openCeil || new Set();
    this._openCeil.add(tx + ',' + ty);
  };

  W.unloadChunkMeshes = function (chunk) {
    // 从场景移除并释放实例缓冲（共享几何体/材质保留）
    this.scene.remove(chunk.group);
    for (const mm of chunk.meshes) mm.dispose();
    // 移除该区块的交互物与灯具记录
    this.interactables = this.interactables.filter(it => it.chunkKey !== chunk.key);
    this.interactMeshes = this.interactMeshes.filter(mm => {
      const it = mm.userData.it;
      return it && it.chunkKey !== chunk.key;
    });
    this.fixtures = this.fixtures.filter(f => f.chunkKey !== chunk.key);
    for (const o of chunk.disposables) {
      if (o.geometry && !Object.values(sharedGeo()).includes(o.geometry)) o.geometry.dispose();
      if (o._ownMat) o.material.dispose();
    }
    // 门网格销毁（状态保留）
    for (const id in this.doors) {
      const d = this.doors[id];
      if (d.chunkKey === chunk.key && d.mesh) { d.mesh = null; d.panel = null; }
    }
    this.steamVents = this.steamVents.filter(v => v.chunkKey !== chunk.key);
  };

  W.unloadChunk = function (cx, cy) {
    const k = key2(cx, cy);
    const c = this.chunks.get(k);
    if (!c) return;
    this.unloadChunkMeshes(c);
    this.chunks.delete(k);
  };

  /* ---------------- 每帧：加载/卸载 ---------------- */
  W.update = function (dt, px, pz, force) {
    this.time += dt;
    this.playerPos.set(px, 0, pz);
    const pcx = Math.floor(BR.worldTX(px) / CH), pcy = Math.floor(BR.worldTY(pz) / CH);
    const q = BR.QUALITY || {};
    const R = 2; // 加载半径（区块）
    // 入队缺失区块（按距离排序）
    this.buildQueue = [];
    for (let cy = pcy - R; cy <= pcy + R; cy++)
      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        const k = key2(cx, cy);
        if (!this.chunks.has(k)) this.buildQueue.push({ cx, cy, d: Math.abs(cx - pcx) + Math.abs(cy - pcy) });
      }
    this.buildQueue.sort((a, b) => a.d - b.d);
    // 预算：每帧最多建 1 个（force 时多建几个保证出生点）
    const t0 = performance.now();
    let built = 0;
    const maxBuild = force ? 9 : 1;
    while (this.buildQueue.length && built < maxBuild && (performance.now() - t0) < 10) {
      const b = this.buildQueue.shift();
      this.buildChunk(b.cx, b.cy);
      built++;
    }
    // 卸载过远区块（每帧 ≤2）
    let un = 0;
    this.chunks.forEach((c, k) => {
      if (un >= 2) return;
      if (Math.abs(c.cx - pcx) > R + 1 || Math.abs(c.cy - pcy) > R + 1) {
        this.unloadChunk(c.cx, c.cy); un++;
      }
    });
    this.updateLights(dt, px, pz);
    this.updateSteam(dt);
    this.updateDoors(dt);
    // 实体
    if (BR.Entities && BR.Entities.update) {
      const ctx = this.entityCtx(px, pz);
      BR.Entities.update(dt, ctx);
      this.stats.entities = BR.Entities.countActive ? BR.Entities.countActive() : 0;
    }
    this.stats.chunks = this.chunks.size;
    // 可见房间数估算
    let rv = 0;
    for (const c of this.chunks.values()) rv += c.meshes.length ? 1 : 0;
    this.stats.roomsVisible = rv;
    if (BR.DEBUG && this.scene) {
      const r = BR.Game && BR.Game.renderer;
      if (r) { this.stats.drawCalls = r.info.render.calls; this.stats.tris = r.info.render.triangles; }
    }
  };

  W.entityCtx = function (px, pz) {
    const P = BR.Player;
    return {
      playerPos: P ? P.pos : new THREE.Vector3(),
      playerNoise: P ? P.noise : 0,
      crouching: P ? P.crouching : false,
      running: P ? P.running : false,
      flashlightOn: P ? P.flashlightOn : false,
      losTo: (x, z) => this.los(px, pz, x, z),
      blackout: this.blackout
    };
  };

  W.updateLights = function (dt, px, pz) {
    const q = BR.QUALITY || {};
    const maxL = q.maxLights || 5;
    // 最近的灯具分配点光源
    const near = [];
    for (const f of this.fixtures) {
      const d2 = (f.x - px) * (f.x - px) + (f.z - pz) * (f.z - pz);
      if (d2 < 30 * 30) near.push({ f, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2);
    const th = this.theme || {};
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      if (this.blackout || i >= near.length || i >= maxL) { L.intensity = 0; continue; }
      const f = near[i].f;
      L.position.set(f.x, f.y, f.z);
      let inten = th.lightInt != null ? th.lightInt : 0.9;
      if (f.flicker && !this.blackout) {
        const n = Math.sin(this.time * 37 + f.phase) * Math.sin(this.time * 13.7 + f.phase * 2);
        if (n > 0.93) inten *= 0.15; // 偶发闪烁
      }
      L.intensity = inten;
      L.color.setHex(th.light != null ? th.light : 0xfff2cc);
    }
    // 玩家光跟随
    if (this.playerLight && BR.Player) {
      this.playerLight.position.set(px, BR.Player.eyeY() + 0.3, pz);
      this.playerLight.intensity = this.blackout ? 0.12 : 0.32;
    }
    if (this.flashSpot && BR.Player) {
      const on = BR.Player.flashlightOn && BR.Player.hasFlashlight;
      this.flashSpot.intensity = on ? 1.6 : 0;
      if (on) {
        const P = BR.Player;
        this.flashSpot.position.set(px, P.eyeY(), pz);
        const d = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(P.pitch, P.yaw, 0, 'YXZ'));
        this.flashSpot.target.position.set(px + d.x * 8, P.eyeY() + d.y * 8, pz + d.z * 8);
      }
    }
  };

  /* ---------------- 碰撞 ---------------- */
  // 圆心 (nx,nz) 半径 radius 是否无碰撞
  W.circleFree = function (nx, nz, radius) {
    const minTX = Math.floor((nx - radius) / T), maxTX = Math.floor((nx + radius) / T);
    const minTY = Math.floor((nz - radius) / T), maxTY = Math.floor((nz + radius) / T);
    for (let ty = minTY; ty <= maxTY; ty++) for (let tx = minTX; tx <= maxTX; tx++) {
      if (!this.blocked(tx, ty)) continue;
      const cx = BR.tileCX(tx), cz = BR.tileCZ(ty);
      const dx = nx - cx, dz = nz - cz;
      const px = T / 2 + radius - Math.abs(dx), pz = T / 2 + radius - Math.abs(dz);
      if (px > 0 && pz > 0) return false;
    }
    // 低矮管道区：必须蹲伏才能进入
    const ltx = Math.floor(nx / T), lty = Math.floor(nz / T);
    if (this.lowDucts.has(ltx + ',' + lty) && BR.Player && !BR.Player.crouching) return false;
    return true;
  };
  // 轴分离移动（先 x 后 z，贴墙滑动）
  W.moveCircle = function (pos, dx, dz, radius) {
    let nx = pos.x + dx;
    if (!this.circleFree(nx, pos.z, radius)) nx = pos.x;
    let nz = pos.z + dz;
    if (!this.circleFree(nx, nz, radius)) nz = pos.z;
    pos.x = nx; pos.z = nz;
  };

  /* ---------------- 门 ---------------- */
  // def: {id,tx,ty,axis:'x'|'z',locked,label,exitTo}
  W.addDoor = function (def) {
    this.doors[def.id] = {
      def, open: false, locked: !!def.locked,
      mesh: null, panel: null, chunkKey: chunkOf(def.tx, def.ty), anim: 0
    };
    // 已存档开过的门直接打开
    if (this.state && this.state.openedDoors.includes(def.id)) this.doors[def.id].open = true;
    // 区块构建时创建网格
    this.addChunkContent(def.tx, def.ty, (group) => this.buildDoorMesh(def.id, group));
    return this.doors[def.id];
  };
  W.buildDoorMesh = function (id, group) {
    const d = this.doors[id]; if (!d || d.mesh) return;
    const def = d.def, th = this.theme, wallH = th.wallH || 3;
    const wx = BR.tileCX(def.tx), wz = BR.tileCZ(def.ty);
    const g = new THREE.Group();
    g.position.set(wx, 0, wz);
    const metal = this.mat('doorMetal');
    const G = sharedGeo();
    const dh = Math.min(2.6, wallH - 0.4), dw = T * 0.92;
    // 门框
    const post = new THREE.Mesh(G.box, metal);
    post.scale.set(0.18, dh + 0.15, 0.24); post.position.set(0, (dh + 0.15) / 2, 0);
    const mkPost = (sx) => { const p = post.clone(); p.position.x = sx * dw / 2; return p; };
    g.add(mkPost(-1)); g.add(mkPost(1));
    const lintel = new THREE.Mesh(G.box, metal);
    lintel.scale.set(dw + 0.36, 0.18, 0.24); lintel.position.set(0, dh + 0.09, 0);
    g.add(lintel);
    // 门扇（铰链在 -x 侧）
    const hinge = new THREE.Group();
    hinge.position.set(-dw / 2, 0, 0);
    const panel = new THREE.Mesh(G.box, metal.clone());
    panel.material.map = BR.Textures.get('doorMetal');
    panel.scale.set(dw, dh, 0.12);
    panel.position.set(dw / 2, dh / 2, 0);
    hinge.add(panel);
    if (def.axis === 'z') g.rotation.y = Math.PI / 2;
    g.add(hinge);
    this.reg(group, g);
    d.mesh = g; d.panel = hinge;
    hinge.rotation.y = d.open ? -1.9 : 0;
    // 交互
    const self = this;
    this.addInteractable({
      id: 'door_' + id, kind: 'door', chunkKey: d.chunkKey,
      meshes: [panel], pos: new THREE.Vector3(wx, 1.4, wz), radius: 2.2,
      prompt: def.prompt || (() => d.locked ? '🔒 ' + (def.label || '门') + '（锁住了）' : (d.open ? '关上' : '打开') + (def.label || '门')),
      canUse: () => true,
      use: def.use ? () => def.use(d) : () => {
        if (d.locked) { BR.Audio.doorLocked(); BR.UI.toast('锁住了，纹丝不动'); return; }
        self.setDoor(id, !d.open);
      }
    });
  };
  W.setDoor = function (id, open, instant) {
    const d = this.doors[id]; if (!d || d.open === open) return;
    d.open = open; d.anim = instant ? 1 : 0;
    if (d.panel && instant) d.panel.rotation.y = open ? -1.9 : 0;
    if (open) {
      BR.Audio.doorOpen();
      if (this.state && !this.state.openedDoors.includes(id)) {
        this.state.openedDoors.push(id);
        BR.bus.emit('door:opened', { id });
      }
    } else BR.Audio.doorCreak();
  };
  W.updateDoors = function (dt) {
    for (const id in this.doors) {
      const d = this.doors[id];
      if (!d.panel || d.anim >= 1) continue;
      d.anim = Math.min(1, d.anim + dt * 1.6);
      const target = d.open ? -1.9 : 0;
      d.panel.rotation.y = BR.lerp(d.panel.rotation.y, target, Math.min(1, dt * 6));
      if (d.anim >= 1) d.panel.rotation.y = target;
    }
  };

  /* ---------------- 交互物 ---------------- */
  // {id,kind,meshes,pos,radius,prompt(),canUse(),use()}
  W.addInteractable = function (o) {
    o.chunkKey = o.chunkKey || chunkOf(Math.floor(o.pos.x / T), Math.floor(o.pos.z / T));
    this.interactables.push(o);
    for (const mm of (o.meshes || [])) { mm.userData.it = o; this.interactMeshes.push(mm); }
    return o;
  };
  W.removeInteractable = function (id) {
    this.interactables = this.interactables.filter(it => it.id !== id);
    this.interactMeshes = this.interactMeshes.filter(mm => !(mm.userData.it && mm.userData.it.id === id));
  };
  W.rayInteract = function (origin, dir, maxD) {
    if (!this.interactMeshes.length) return null;
    this._rc = this._rc || new THREE.Raycaster();
    this._rc.set(origin, dir);
    this._rc.far = maxD;
    const hits = this._rc.intersectObjects(this.interactMeshes, false);
    for (const h of hits) {
      const it = h.object.userData.it;
      if (!it) continue;
      if (h.distance > (it.radius || BR.Config.INTERACT_DIST)) continue;
      return { it, dist: h.distance, point: h.point };
    }
    return null;
  };

  /* ---------------- 蒸汽 ---------------- */
  W.addSteamVent = function (id, tx, ty, dirx, dirz, len) {
    const x = BR.tileCX(tx), z = BR.tileCZ(ty);
    this.addChunkContent(tx, ty, (group, chunk) => {
      const n = 42;
      const pos = new Float32Array(n * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xcfd8dc, size: 0.9, transparent: true, opacity: 0.5, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.position.set(x, 0.4, z);
      pts.userData.seeds = [];
      for (let i = 0; i < n; i++) pts.userData.seeds.push(Math.random());
      this.reg(group, pts);
      const vent = { id, x, z, points: pts, on: true, chunkKey: chunk.key, dirx, dirz, len, timer: 0 };
      // 存档恢复：阀门关过则保持关闭
      if (this.state.events.includes('steam_off_' + id)) vent.on = false;
      this.steamVents.push(vent);
      BR.Audio.addLoop('steam_' + id, 'steam', x, z, 0.5);
    });
  };
  W.setSteam = function (id, on) {
    for (const v of this.steamVents) if (v.id === id) {
      v.on = on;
      v.points.visible = on;
      if (on) BR.Audio.addLoop('steam_' + id, 'steam', v.x, v.z, 0.5);
      else BR.Audio.removeLoop('steam_' + id);
      if (!on && !this.state.events.includes('steam_off_' + id)) {
        this.state.events.push('steam_off_' + id);
        BR.bus.emit('event', { id: 'steam_off_' + id });
      }
    }
  };
  W.updateSteam = function (dt) {
    for (const v of this.steamVents) {
      if (!v.on || !v.points.visible) continue;
      const pos = v.points.geometry.attributes.position;
      const seeds = v.points.userData.seeds;
      for (let i = 0; i < seeds.length; i++) {
        const s = (seeds[i] + dt * 0.5) % 1;
        seeds[i] = s;
        pos.array[i * 3] = (s - 0.5) * 2.4 + v.dirx * s * 3;
        pos.array[i * 3 + 1] = 0.3 + s * 2.6;
        pos.array[i * 3 + 2] = (seeds[(i * 7) % seeds.length] - 0.5) * 2.4 + v.dirz * s * 3;
      }
      pos.needsUpdate = true;
      // 蒸汽伤害：站在蒸汽里掉血
      if (BR.Player && BR.Game.state === 'playing') {
        const dx = BR.Player.pos.x - v.x, dz = BR.Player.pos.z - v.z;
        if (dx * dx + dz * dz < 4.2) BR.Player.hurt(dt * 9, 'steam');
      }
    }
  };
  // 蒸汽是否挡住某 tile（用于伤害/提示）
  W.steamBlocking = function (tx, ty) {
    for (const v of this.steamVents) {
      if (!v.on) continue;
      const vtx = Math.floor(v.x / T), vty = Math.floor(v.z / T);
      if (Math.abs(tx - vtx) + Math.abs(ty - vty) <= 2) return v;
    }
    return null;
  };

  /* ---------------- 闪烁（黑夜事件） ---------------- */
  W.setBlackout = function (on) {
    this.blackout = on;
    this.chunks.forEach((c) => { if (c.fixtureMesh) c.fixtureMesh.visible = !on; });
    for (const L of this.lights) if (on) L.intensity = 0;
    BR.log('blackout', on);
  };

  /* ---------------- 统计 ---------------- */
  W.getStats = function () {
    return {
      chunks: this.stats.chunks,
      roomsVisible: this.stats.roomsVisible,
      entities: this.stats.entities,
      seed: this.map ? this.map.seed : 0,
      drawCalls: this.stats.drawCalls,
      tris: this.stats.tris,
      interactables: this.interactables.length
    };
  };
})();
