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
    STEAM_DPS: 9,               // 蒸汽伤害（每秒）；L2 难度可调
    time: 0,
    playerPos: new THREE.Vector3(),
    stats: { chunks: 0, roomsVisible: 0, entities: 0, drawCalls: 0, tris: 0 }
  };
  BR.World = W;

  const key2 = (cx, cy) => cx + ',' + cy;
  const chunkOf = (tx, ty) => key2(Math.floor(tx / CH), Math.floor(ty / CH));
  W.chunkKeyOf = (tx, ty) => chunkOf(tx, ty);

  // H 路：遮挡检查用的复用向量（避免每 0.12s 的交互检测产生 GC）
  const _occDir = new THREE.Vector3();

  W.tile = function (tx, ty) {
    const m = this.map;
    if (!m) return 0;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) {
      // v1.5.1：L0 无限区——超出 56×56 按"种子+tile 坐标"程序化生成（与加载顺序无关）
      if (m.level === 'L0' && BR.Gen.l0InfiniteTile) return BR.Gen.l0InfiniteTile(m.seed, tx, ty, m.meta && m.meta.l0BorderDoors);
      return 0;
    }
    return m.tiles[ty * m.w + tx];
  };
  W.isWall = function (tx, ty) { return this.tile(tx, ty) === 0; };
  // 地面材质（脚步声用）：先查各关登记的多材质区，再回退关卡主题 surface。
  // 用法（各关 buildContent 里）：W.addSurfaceZone(x0, z0, x1, z1, 'metal')，
  // 坐标为世界坐标（米）。surface 取值见 audio.js footstep：carpet/concrete/metal/tile/wood。
  W.addSurfaceZone = function (x0, z0, x1, z1, surface) {
    this._surfZones = this._surfZones || [];
    this._surfZones.push({
      x0: Math.min(x0, x1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), z1: Math.max(z0, z1), surface
    });
  };
  W.surfaceAt = function (x, z) {
    const zs = this._surfZones || [];
    for (let i = zs.length - 1; i >= 0; i--) {
      const s = zs[i];
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s.surface;
    }
    return (this.theme && this.theme.surface) || 'concrete';
  };
  // 该点黑暗度 0(亮)..1(黑)：最近灯具距离 + 手电 + 断电
  // v1.5.1 修：手电/灯下必须能回理智（之前最低 0.15 导致全图只掉不回）
  W.darknessAt = function (x, z) {
    if (this.blackout) return 1;
    if (BR.Player && BR.Player.flashlightOn && BR.Player.hasFlashlight) return 0.08;
    let best = 1e9;
    for (const f of this.fixtures) {
      const dx = f.x - x, dz = f.z - z, d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
      if (best < 36) break;
    }
    const d = Math.sqrt(best);
    if (d < 5) return 0.08;
    return Math.min(1, 0.15 + (d - 5) / 9);
  };
  // 安全屋判定（马尼拉房间等）
  W.safeZoneAt = function (x, z) {
    const zs = this._safeZones || [];
    for (const s of zs) if (Math.hypot(x - s.x, z - s.z) < s.r) return true;
    return false;
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
      // v1.5 W1：恢复区块级状态（老存档缺 chunkState 字段 → 空对象，向后兼容）
      BR.ChunkState.deserialize(this.state.chunkState);
      const th = this.theme;
      sharedGeo();

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(th.bg != null ? th.bg : 0x000000);
      const q = BR.QUALITY;
      const fs = (q && q.fogScale) || 1;
      this.scene.fog = new THREE.Fog(th.bg != null ? th.bg : 0x000000,
        (th.fogNear || 8) * fs, (th.fogFar || 46) * fs * 0.92); // v1.2：雾略浓一点，压住远处过曝

      // v1.2：环境光整体下调，配合 ACES 消除"白茫茫"
      const amb = new THREE.AmbientLight(th.ambient != null ? th.ambient : 0x404040,
        (th.ambInt != null ? th.ambInt : 0.55) * 0.8);
      this.scene.add(amb); this._amb = amb;
      const hemi = new THREE.HemisphereLight(th.sky != null ? th.sky : 0x888888,
        th.ground != null ? th.ground : 0x222222, 0.3);
      this.scene.add(hemi); this._hemi = hemi;

      // 点光源池
      const maxL = (q && q.maxLights) || 5;
      for (let i = 0; i < maxL; i++) {
        const L = new THREE.PointLight(th.light != null ? th.light : 0xfff0d2, 0, 26, 2);
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
      // Systems D：环境涂鸦（各关通用；gen.js 已按种子登记 'graffiti' POI）
      if (BR.buildGraffitiDecals) BR.buildGraffitiDecals(map, this);
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
    // v1.5 W1：跨关扫尾 —— 残留的蒸汽循环音源清掉（卸区块时已逐个停，这里防漏）
    if (BR.Audio && BR.Audio.removeLoop)
      for (const v of this.steamVents) BR.Audio.removeLoop('steam_' + v.id);
    this.steamVents = []; this.lowDucts.clear();
    this.elevator = null; this.blackout = false;
    this._rbT = null; this._rbDur = 0; // 随机断电事件计时：跨关不残留
    this._noWall = null; this._openCeil = null; this._openFloor = null; this._matCache = null;
    this._funPit = null; // L0 FUN 深坑触发器（levels.js 登记，跨关不残留）
    this._manilaRect = null; // 马尼拉房间灯具禁区（levels.js 登记，跨关不残留）
    this._shopNPC = null;    // M.E.G. 交易站 NPC 动画引用（跨关不残留）
    this._surfZones = null;
    // 闪烁风暴出口提示音（updateStormHint 建的循环声）清理
    if (this._stormHintOn && BR.Audio && BR.Audio.removeLoop) BR.Audio.removeLoop('storm_exit_hint');
    this._stormHintOn = false;
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
      // v1.2：整体压暗约一成半并偏暖，消除贴图"发白"的廉价感
      const m = new THREE.MeshLambertMaterial({ map: tex, color: 0xdbd5c2 });
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
    // v1.5.1：L0 无限区——区块循环不再被 56×56 截断
    const _infL0 = this.map.level === 'L0';
    const _limW = _infL0 ? Infinity : this.map.w, _limH = _infL0 ? Infinity : this.map.h;

    for (let ty = y0; ty < y0 + CH && ty < _limH; ty++) {
      for (let tx = x0; tx < x0 + CH && tx < _limW; tx++) {
        const t = this.tile(tx, ty);
        const wx = BR.tileCX(tx), wz = BR.tileCZ(ty);
        // tile=2：二层地板（L188）：渲染/灯具与 1 相同；gen 侧 BFS/缝线只认 1
        const isFloor = (t === 1 || t === 2);
        const isGround = (x, y) => { const v = this.tile(x, y); return v === 1 || v === 2; };
        if (isFloor) {
          // v1.5 W2：setOpenFloor 登记的破洞 tile 跳过地板实例（坑体由内容钩子自建）
          if (!this.openFloorAt(tx, ty)) {
            dummy.position.set(wx, 0, wz); dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.scale.set(1, 1, 1); dummy.updateMatrix();
            floorM.push(dummy.matrix.clone());
          }
          if (!this.openCeilAt(tx, ty)) {
            dummy.position.set(wx, wallH, wz); dummy.rotation.set(Math.PI / 2, 0, 0);
            dummy.updateMatrix(); ceilM.push(dummy.matrix.clone());
          }
          // 灯具：按主题密度（马尼拉房间内不放 L0 荧光灯具：房间里只有一盏橙色顶灯，levels.js 登记 W._manilaRect）
          const dens = th.fixtureEvery || 5;
          const _mz = this._manilaRect;
          const _inMz = _mz && tx >= _mz.x0 && tx <= _mz.x1 && ty >= _mz.y0 && ty <= _mz.y1;
          if (rngH.int(1, dens) === 1 && !this.blackout && !_inMz && !this.openFloorAt(tx, ty) && !this.openCeilAt(tx, ty)) {
            dummy.position.set(wx, wallH - 0.02, wz); dummy.rotation.set(Math.PI / 2, 0, 0);
            dummy.updateMatrix(); fixM.push(dummy.matrix.clone());
            chunk.fixtures.push({ x: wx, y: wallH - 0.15, z: wz, phase: rngH.next() * 9, flicker: rngH.chance(th.flickerRate != null ? th.flickerRate : 0.12),
              bright: 0.88 + rngH.next() * 0.24 }); // W10：灯具亮度个体差异（种子派生 ±12%，灯下不死板均匀）
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
              (isGround(tx + 1, ty) || isGround(tx - 1, ty) ||
               isGround(tx, ty + 1) || isGround(tx, ty - 1))) {
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
    // v1.2：灯具面板本身也压暗，避免天花板一片死白（仍是发光体观感）
    const fixMat = this._fixMat || (this._fixMat = new THREE.MeshBasicMaterial({ map: BR.Textures.get('fluor'), color: 0xbdb7a6 }));
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
  // 地板破洞（L0 fun_hole2 真实深坑等）由 levels.js 登记：buildChunk 跳过该 tile 的
  // 地板/灯具实例，内容钩子自行建造坑体几何
  W.openFloorAt = function (tx, ty) {
    return !!(this._openFloor && this._openFloor.has(tx + ',' + ty));
  };
  W.setOpenFloor = function (tx, ty) {
    this._openFloor = this._openFloor || new Set();
    this._openFloor.add(tx + ',' + ty);
  };

  W.unloadChunkMeshes = function (chunk) {
    // 从场景移除并释放实例缓冲（共享几何体/材质保留）
    this.scene.remove(chunk.group);
    for (const mm of chunk.meshes) mm.dispose();
    // v1.5 W1：该区块的循环音源必须停掉（蒸汽/机器声），否则卸掉的区块声音会一直残留。
    // 灯光是全局池按距离重分配的（fixtures 记录已清），无残留；事件监听：区块内容钩子里
    // 没有 BR.bus.on / addEventListener（已全工程 grep 确认），交互物闭包随数组移除。
    if (BR.Audio && BR.Audio.removeLoop) {
      for (const v of this.steamVents)
        if (v.chunkKey === chunk.key) BR.Audio.removeLoop('steam_' + v.id);
    }
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

  /* ---------------- C 路 v1.4：跨区块确定性 ----------------
   * 边界契约：整图由（seed）一次性确定性生成，是唯一的真实来源；
   * 区块只是渲染/碰撞的划分。边界状态 = 缝线处的 tile 行/列，
   * 由（seed → map）派生；相邻区块读同一份数据（见 BR.Gen.chunkSeam /
   * BR.Gen.assertChunkSeams），与加载顺序无关。
   * 碰撞（blocked/circleFree）直接读 map.tiles，不依赖区块 meshes，
   * 因此碰撞在区块未建/已卸时也不会"暂时消失"。
   */
  // 已建区块的确定性指纹：tile 布局哈希（gen 层）+ 灯具 + 交互物 id + 网格数。
  // 同一种子、同一区块坐标 → 相同指纹，不受加载顺序影响。
  // 用途："乱序加载 vs 顺序加载"一致性测试；"返回原区块"布局稳定性测试。
  W.chunkFingerprint = function (cx, cy) {
    const c = this.chunks.get(key2(cx, cy));
    if (!c || !this.map || !BR.Gen || !BR.Gen.chunkLayoutHash) return null;
    const parts = [BR.Gen.chunkLayoutHash(this.map, cx, cy)];
    const fx = c.fixtures.map(f =>
      f.x.toFixed(2) + ',' + f.z.toFixed(2) + ',' + f.phase.toFixed(3) + ',' + (f.flicker ? 1 : 0)).sort();
    parts.push('F' + fx.join(';'));
    const its = this.interactables.filter(it => it.chunkKey === c.key).map(it => it.id).sort();
    parts.push('I' + its.join(','));
    parts.push('M' + c.meshes.length);
    const s = parts.join('|');
    return (BR.hashSeed ? (BR.hashSeed(s) >>> 0) : s.length).toString(16);
  };

  /* ---------------- v1.5 W1：区块状态存档 BR.ChunkState ----------------
   * 拾取/柜子/门锁/坐骑/事件等"区块级可变状态"的独立存档接口，供各关 builder 用。
   * - 与关级 W.state（openedDoors/picked/openedCrates/events）分离：按区块 key 隔离，
   *   各关自定义状态不再挤进全局数组；
   * - 不随区块卸载重置：数据只活在 ChunkState._data（内存）并直写 W.state.chunkState
   *   （存档）；区块卸载/重建只影响渲染与交互物实例，不碰这里；
   * - 存档：W.build 时从 savedState.chunkState 恢复；G.snapshot()/S.saveGame() 走
   *   W.state 自动带上；老存档缺 chunkState 字段 → 按空处理（向后兼容）；
   * - 值必须是 JSON 可序列化的（存档走 JSON）。
   * 用法：const k = W.chunkKeyOf(tx, ty);
   *       BR.ChunkState.set(k, 'shop_stock', { almond: 3 });
   *       const stock = BR.ChunkState.get(k, 'shop_stock', {});
   */
  const CS = { _data: {} };
  BR.ChunkState = CS;
  CS._k = (chunkKey, name) => chunkKey + '::' + name;
  CS._sync = function () { if (W.state) W.state.chunkState = this._data; };
  CS.get = function (chunkKey, name, def) {
    const v = this._data[this._k(chunkKey, name)];
    return v === undefined ? def : v;
  };
  CS.set = function (chunkKey, name, value) {
    this._data[this._k(chunkKey, name)] = value;
    this._sync();
    return value;
  };
  CS.remove = function (chunkKey, name) {
    delete this._data[this._k(chunkKey, name)];
    this._sync();
  };
  CS.has = function (chunkKey, name) {
    return Object.prototype.hasOwnProperty.call(this._data, this._k(chunkKey, name));
  };
  CS.keys = function (chunkKey) {
    const pre = chunkKey + '::', out = [];
    for (const k in this._data)
      if (k.indexOf(pre) === 0) out.push(k.slice(pre.length));
    return out;
  };
  CS.clearChunk = function (chunkKey) {
    for (const n of this.keys(chunkKey)) this.remove(chunkKey, n);
  };
  CS.serialize = function () { return JSON.parse(JSON.stringify(this._data)); };
  CS.deserialize = function (obj) {
    this._data = (obj && typeof obj === 'object') ? JSON.parse(JSON.stringify(obj)) : {};
    this._sync();
  };
  CS.reset = function () { this._data = {}; this._sync(); };

  /* ---------------- 每帧：加载/卸载 ---------------- */
  W.update = function (dt, px, pz, force) {
    this.time += dt;
    this.playerPos.set(px, 0, pz);
    if (this.flickerStorm && this.flickerStorm.t > 0) this.flickerStorm.t -= dt;
    const pcx = Math.floor(BR.worldTX(px) / CH), pcy = Math.floor(BR.worldTY(pz) / CH);
    const q = BR.QUALITY || {};
    const R = 2; // 加载半径（区块）
    // 入队缺失区块（按距离排序）
    this.buildQueue = [];
    for (let cy = pcy - R; cy <= pcy + R; cy++)
      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        // C 路 v1.4：完全落在地图外的区块不建（56×56 恰为 7×8 区块，无半包区块）
        if (this.map.level !== 'L0' && (cx < 0 || cy < 0 || cx * CH >= this.map.w || cy * CH >= this.map.h)) continue; // v1.5.1：L0 无限区不跳过越界区块
        const k = key2(cx, cy);
        if (!this.chunks.has(k)) this.buildQueue.push({ cx, cy, d: Math.abs(cx - pcx) + Math.abs(cy - pcy) });
      }
    this.buildQueue.sort((a, b) => a.d - b.d);
    // v1.5 W1：前进方向预加载 —— 玩家朝向的扇区多预载 1 圈（R+1），朝向对齐（余弦）> 0.6
    // 的区块优先入队（d 减 0.5，排在同圈远角之前）。行走 3.4~5.6m/s，区块 24m，
    // 前方 1 区块 ≈ 4~7s 路程；配合每帧 1 区块预算，玩家靠近前必建好，无虚空/墙体突现。
    // （卸载阈值是 >R+1，预载的这圈不会被立即卸掉。）
    const P = BR.Player;
    if (P && isFinite(P.yaw)) {
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw); // yaw=0 面向 -z（见 player.js）
      for (let cy = pcy - R - 1; cy <= pcy + R + 1; cy++)
        for (let cx = pcx - R - 1; cx <= pcx + R + 1; cx++) {
          const ox = cx - pcx, oy = cy - pcy;
          const rad = Math.max(Math.abs(ox), Math.abs(oy));
          if (rad <= R || rad > R + 1) continue; // 方阵已覆盖 / 超出预载圈
          const len = Math.hypot(ox, oy) || 1;
          if ((ox * fx + oy * fz) / len < 0.6) continue; // 只预载前进扇区
          if (this.map.level !== 'L0' && (cx < 0 || cy < 0 || cx * CH >= this.map.w || cy * CH >= this.map.h)) continue; // v1.5.1：L0 无限区不跳过越界区块
          const k = key2(cx, cy);
          if (!this.chunks.has(k)) this.buildQueue.push({ cx, cy, d: rad - 0.5 });
        }
      this.buildQueue.sort((a, b) => a.d - b.d);
    }
    // 预算：每帧最多建 1 个（force 时多建几个保证出生点）
    const t0 = performance.now();
    let built = 0;
    const maxBuild = force ? 9 : 1;
    while (this.buildQueue.length && built < maxBuild && (performance.now() - t0) < 10) {
      const b = this.buildQueue.shift();
      this.buildChunk(b.cx, b.cy);
      built++;
    }
    // C 路 v1.4：玩家所在 + 相邻 3×3 区块必须在本帧结束前建好（预算外补建）。
    // 正常行走时预算构建已跟上，这里只在落后时触发（慢设备、同层传送、刚读档），
    // 保证玩家脚下永远有地面/碰撞，不出现"虚空帧"；碰撞本身读 tile 网格，
    // 与区块是否建成无关（circleFree/blocked 不依赖 meshes），这里保的是视觉连续。
    for (let cy = pcy - 1; cy <= pcy + 1; cy++)
      for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
        if (this.map.level !== 'L0' && (cx < 0 || cy < 0 || cx * CH >= this.map.w || cy * CH >= this.map.h)) continue; // v1.5.1：L0 无限区不跳过越界区块
        if (!this.chunks.has(key2(cx, cy))) this.buildChunk(cx, cy);
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
    this.updateStormHint();
    this.updateRandomBlackout(dt); // 全关卡随机断电事件（只在 playing 时调到这里）
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
      let inten = (th.lightInt != null ? th.lightInt : 0.9) * 0.92;
      inten *= (f.bright || 1); // W10：灯具个体亮度差异
      const flickDepth = th.flickerDepth != null ? th.flickerDepth : 0.15;
      if (f.flicker && !this.blackout) {
        const n = Math.sin(this.time * 37 + f.phase) * Math.sin(this.time * 13.7 + f.phase * 2);
        if (n > 0.93) inten *= flickDepth; // 偶发闪烁
      }
      // 闪烁风暴：范围内灯具剧烈闪烁
      const st = this.flickerStorm;
      if (st && st.t > 0) {
        const sd = Math.hypot(f.x - st.x, f.z - st.z);
        if (sd < st.r && Math.sin(this.time * 31 + f.phase * 3) > 0.1) inten *= 0.08;
      }
      L.intensity = inten;
      L.color.setHex(th.light != null ? th.light : 0xfff0d2); // 默认灯色偏微黄
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
      // W9：统一加按键标签（读 BR.Input 当前绑定，不硬编码；levels.js 在运行时已定义）
      prompt: def.prompt || (() => (BR.interactKeyLabel ? BR.interactKeyLabel() : '') +
        (d.locked ? '🔒 ' + (def.label || '门') + '（锁住了）' : (d.open ? '关上' : '打开') + (def.label || '门'))),
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
  // 交互物 kind 注册表：扩建各关卡 builder 在此登记 kind（多退少补）。
  // addInteractable 不强制校验，但未知 kind 在 DEBUG 下会 BR.warn，方便 builder 自查。
  W.INTERACT_KINDS = [
    // 旧关（world.js / levels.js 已用）
    'door', 'crate', 'pickup', 'note', 'hole', 'generator', 'elevator',
    'clue', 'anomaly', 'valve', 'cabinet',
    // 扩建新关（各 builder 交付清单，陆续接入）
    'slide', 'npc_meg', 'npc_wanderer', 'radio', 'odd_window', 'stairwell',
    'pool_exit', 'tunnel', 'deep_exit', 'anomaly_exit', 'car', 'castle',
    'subway', 'entry_door', 'berry_bush', 'cache', 'hideout', 'house',
    'shop', 'balcony', 'room_door', 'lounge', 'staff_room',
    // builder 实际交付中新增的（lv_l11/lv_l37/lv_l7/lv_l94/lv_bang）
    'exit', 'inspect', 'shop_sign', 'car_exit', 'castle_exit',
    // v1.5 W4（L11 城市重构）：特定井盖出口、异常门
    'manhole_exit', 'anomaly_door',
    // F1 新增：跳水台（lv_l37）
    'dive_board',
    // v1.5 W5：小鸭子坐骑 / 金属扶梯（lv_l37）
    'mount_duck', 'ladder',
    // W9 补登记：此前已在使用但未注册（DEBUG 下会 warn）
    'fun_hole',   // levels.js：L1 天花板趣味洞（→FUN）
    'rift',       // cutout.js：随机裂隙
    // v1.5 W7：L188 百窗庭重构（楼梯换层/返回门/紧急出口/事件窗/穿越窗/魔术窗帘/衣柜）
    'stair_up', 'stair_down', 'return_door', 'emergency_exit',
    'event_window', 'travel_window', 'magic_curtain', 'cabinet'
    // 注：'ocean' / 'deep' 是 BR.Swim 的水 zone kind，不是交互物 kind，不在此登记
  ];
  // {id,kind,meshes,pos,radius,prompt(),canUse(),use()}
  W.addInteractable = function (o) {
    o.chunkKey = o.chunkKey || chunkOf(Math.floor(o.pos.x / T), Math.floor(o.pos.z / T));
    if (BR.DEBUG && W.INTERACT_KINDS.indexOf(o.kind) < 0) {
      BR.warn('addInteractable: 未注册的 kind "' + o.kind + '"（id=' + o.id + '），请在 world.js W.INTERACT_KINDS 登记');
    }
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
      // H 路：遮挡检查——被墙/关着的门挡住就不能隔墙拾取、不能隔墙开远处柜子。
      // 门自己除外（射线终点就在门 tile 里，tile 步进会跳过终点 tile）。
      if (this.interactOccluded(origin, h.point)) continue;
      return { it, dist: h.distance, point: h.point };
    }
    return null;
  };

  // H 路：交互遮挡检查。origin（眼位）→ point（命中点）之间：
  //  (1) 3D 精确：对玩家周围区块的墙体 InstancedMesh（chunk.meshes 里 BoxGeometry 的只有墙体）
  //      做射线，命中即被挡；
  //  (2) tile 步进：用 blocked() 查沿线 tile（覆盖"关着的门"——门 tile 没有墙体盒子，
  //      靠这一步；终点 tile 跳过，避免门把自己挡住）。
  // 返回 true = 被挡住（本次命中作废，继续找更远的候选）。
  W.interactOccluded = function (origin, point) {
    const dx = point.x - origin.x, dy = point.y - origin.y, dz = point.z - origin.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-4) return false;
    // (1) 墙体射线（只查玩家周围 (R+1) 区块，先粗后细）
    this._rcOcc = this._rcOcc || new THREE.Raycaster();
    const rc = this._rcOcc;
    rc.set(origin, _occDir.set(dx / dist, dy / dist, dz / dist));
    rc.far = dist - 0.12;
    const pcx = Math.floor(origin.x / T / CH), pcy = Math.floor(origin.z / T / CH);
    for (const c of this.chunks.values()) {
      if (Math.abs(c.cx - pcx) > 3 || Math.abs(c.cy - pcy) > 3) continue;
      const ms = c.meshes;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        // r128 的 BoxGeometry 没有 isBoxGeometry 标记，用 type 判（墙体是唯一的盒体实例网格）
        if (!m.isInstancedMesh || m.geometry.type !== 'BoxGeometry') continue; // 墙体实例网格
        if (rc.intersectObject(m, false).length) return true;
      }
    }
    // (2) 关着的门：tile 步进（终点 tile 跳过；起点 tile 是玩家脚下，必为地板）
    const endTX = Math.floor(point.x / T), endTY = Math.floor(point.z / T);
    const steps = Math.ceil(dist / (T * 0.25));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tx = Math.floor((origin.x + dx * t) / T), ty = Math.floor((origin.z + dz * t) / T);
      if (tx === endTX && ty === endTY) continue;
      if (this.blocked(tx, ty)) return true;
    }
    return false;
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
        if (dx * dx + dz * dz < 4.2) BR.Player.hurt(dt * this.STEAM_DPS, 'steam');
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

  /* ---------------- 全关卡随机断电事件 ----------------
   * 规则（与其它灯光事件的叠加约定）：
   * 1. 任意关卡都可能触发：首次在开局 60~120s 后掷，之后每 75~150s 掷一次；每次持续 8~15s（随机）。
   * 2. 灯光：复用 setBlackout(true)（灯具全灭、灯罩隐藏）；手电筒（flashSpot 聚光）不受影响，
   *    断电时手电是唯一可靠光源（toast 里明示）。
   * 3. 实体：断电期间移速 ×1.25、索敌半径 ×1.30 —— 实现在 entities.js（moveToward / entView），
   *    按 W.blackout 实时加成，断电结束自动恢复，无需手动还原。
   * 4. 理智：走 player.js 现有的 world.blackout 分支（2.5/s 侵蚀），不另写逻辑。
   * 5. 与 L1 闪烁风暴：断电期间暂停风暴的"下一次"计时 _stormT（levels.js 里 !W.blackout 才递减）；
   *    若断电开始时风暴正好在进行中，flickerStorm.t 照常衰减（不冻结），但灯光层面断电优先
   *    （updateLights 里 blackout 分支直接 intensity=0 并 continue，风暴闪烁代码不可达），
   *    电恢复后若风暴还有剩余时间会继续闪——两者叠加不打架。
   * 6. 与 L1 POI 闪烁区 blackout：共用 W.blackout 旗；随机事件只在 !W.blackout 时触发，
   *    POI 断电期间随机计时同样暂停（不延长、不嵌套、不抢它那套 setTimeout 结束逻辑）。
   * 提示：开始/结束走 BR.Audio.blackoutStart/blackoutEnd（电流断开的"啪"+嗡鸣消失 /
   * 来电的电流爬升+荧光灯逐个点亮声），HUD 小字 toast 提示"电力中断……"。
   */
  W.updateRandomBlackout = function (dt) {
    // 懒初始化：开局 60~120s 后首次掷
    if (this._rbT == null) this._rbT = 60 + Math.random() * 60;
    if (this._rbDur == null) this._rbDur = 0;
    if (this.blackout) {
      // 已在断电中（随机事件自身或 L1 POI 闪烁区）：随机计时暂停，不触发、不延长
      if (this._rbDur > 0) {
        this._rbDur -= dt;
        if (this._rbDur <= 0) {
          this._rbDur = 0;
          this.setBlackout(false);
          if (BR.Audio && BR.Audio.blackoutEnd) BR.Audio.blackoutEnd();
          if (BR.UI) BR.UI.toast('电力恢复了，灯重新亮起', 2600);
          if (BR.bus) BR.bus.emit('blackout:end');
        }
      }
      return;
    }
    this._rbT -= dt;
    if (this._rbT <= 0) {
      this._rbT = 75 + Math.random() * 75; // 下一次 75~150s 后再掷
      this._rbDur = 8 + Math.random() * 7;  // 本次持续 8~15s
      this.setBlackout(true);
      if (BR.Audio && BR.Audio.blackoutStart) BR.Audio.blackoutStart();
      if (BR.UI) BR.UI.toast('电力中断……抓紧你的手电筒', 3200);
      if (BR.bus) BR.bus.emit('blackout:start');
    }
  };

  /* ---------------- 闪烁风暴出口提示（L1 "必须判断"元素） ---------------- */
  // 闪烁风暴期间，在出口走廊入口放一个方位循环声（荧光灯近场嗡鸣，带距离衰减+声像）：
  // 闪烁时听声辨位可以判断出口方向，但必须顶着闪烁/理智侵蚀走过去——"必须判断"，不是白给。
  // _exitCorr 由 L1 buildContent 登记（levels.js）；其他关没有则静默不做。
  W.updateStormHint = function () {
    const st = this.flickerStorm;
    const active = !!(st && st.t > 0);
    const tgt = (active && this._exitCorr) ? this._exitCorr : null;
    if (!BR.Audio) return;
    if (tgt && !this._stormHintOn) {
      BR.Audio.addLoop('storm_exit_hint', 'hum', tgt.x, tgt.z, 0.85);
      this._stormHintOn = true;
    } else if (!tgt && this._stormHintOn) {
      BR.Audio.removeLoop('storm_exit_hint');
      this._stormHintOn = false;
    }
  };
  /* ---------------- H 路：光照管理（只追加新函数，不改现有函数） ----------------
   * 设计取舍（用户第九节）：
   *  - 灯下亮、远处平滑变暗：靠 PointLight decay=2 的物理衰减（build 里已设），本函数只按画质档
   *    收紧 distance（穿墙漏光主要来自"距离 26m 的灯隔墙照到玩家"——没有实时阴影时只能靠缩距离缓解）。
   *  - 实时阴影灯数量：恒为 0。点光源阴影 = 每灯 6 面 cube map，移动端/核显不可承受；
   *    转角/柱后/物体接触处的柔和变暗用 blob 接触阴影（textures.js）+ 灯光衰减 + 雾表现。
   *    quality.shadow 字段保留（全档 0），将来真机允许时再开。
   *  - 环境补光：build 里的 Ambient+Hemisphere 保留（暗部不死黑），本函数不动。
   * 调用：main.js applyQuality（画质切换）与 loadLevel 的 build().then（灯池重建后）。
   */
  // 按画质档调整灯池距离/衰减 + 粒子量（蒸汽点数按档缩放 drawRange）
  W.applyLightTuning = function () {
    const q = BR.QUALITY || {};
    const dist = q.lightDist || 22;
    for (const L of this.lights || []) { L.distance = dist; L.decay = 2; }
    if (this.playerLight) { this.playerLight.distance = 12; this.playerLight.decay = 2; }
    // 粒子：蒸汽 Points 按画质档缩放实际绘制点数（不重建几何，drawRange 即可）
    const ps = q.particles != null ? q.particles : 1;
    for (const v of this.steamVents || []) {
      if (!v.points || !v.points.geometry) continue;
      const total = v.points.geometry.attributes.position.count;
      v.points.geometry.setDrawRange(0, Math.max(8, Math.round(total * ps)));
    }
    BR.log('light tuning', 'dist=' + dist, 'particles=' + ps);
  };
  // 实时阴影灯数量（见上：设计为 0）
  W.shadowLightCount = function () { return 0; };

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
