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
    flashCone: null, flashDust: null, // v2.4 W-shadowlight：手电光锥/锥内尘埃
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

  // v2.4 W-shadowlight：灯光气质用到的模块级常量/纹理缓存
  const _PINK = new THREE.Color(0xff9ad5);       // 镇流器垂死：灯管衰变偏粉
  const _BALLAST_DIM = new THREE.Color(0x6a6a6a); // 垂死灯具面板 bake 微暗（instanceColor）
  const _WHITE = new THREE.Color(0xffffff);       // instanceColor 全实例写色用（r128 混用崩溃规避）
  let _beamTexCache = null, _dotTexCache = null, _shaftTexCache = null;
  // 手电光锥渐变纹理：alpha 只沿轴向变化——近端几乎不可见（避免糊脸）→0.55 处峰值→远端收到 0。
  // v2.5 F6(A4-04)：锥面已改径向对称的开口锥面网格，横向（绕锥一周）必须均匀：
  // 旧版给交叉面片侧边用的横向 sin 羽化绕锥一周会留下明暗带，故去掉横向项。
  // 行序：canvas 顶行（j=0）经 flipY 对应 uv v=1 = 锥面远端，故 s = 1 - j/255（0=近端 → 1=远端）。
  function _beamTexture() {
    if (_beamTexCache) return _beamTexCache;
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const x = c.getContext('2d');
    const img = x.createImageData(4, 256);
    for (let j = 0; j < 256; j++) {
      const s = 1 - j / 255; // 0=近相机端 → 1=远端
      const axial0 = s < 0.55 ? (0.03 + 0.97 * (s / 0.55)) : (1 - (s - 0.55) / 0.45);
      const axial = Math.pow(Math.max(0, axial0), 1.4);
      for (let i = 0; i < 4; i++) {
        const k = (j * 4 + i) * 4;
        img.data[k] = 255; img.data[k + 1] = 244; img.data[k + 2] = 220;
        img.data[k + 3] = Math.round(axial * 255);
      }
    }
    x.putImageData(img, 0, 0);
    _beamTexCache = new THREE.CanvasTexture(c);
    return _beamTexCache;
  }
  // 尘埃圆点：径向渐变
  function _dotTexture() {
    if (_dotTexCache) return _dotTexCache;
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(0.4, 'rgba(255,250,235,0.5)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    _dotTexCache = new THREE.CanvasTexture(c);
    return _dotTexCache;
  }
  // L7 深海光柱：纵向顶亮→底灭，横向羽化（canvas 顶 = 光柱顶端）
  function _shaftTexture() {
    if (_shaftTexCache) return _shaftTexCache;
    const c = document.createElement('canvas'); c.width = 32; c.height = 128;
    const x = c.getContext('2d');
    const img = x.createImageData(32, 128);
    for (let j = 0; j < 128; j++) {
      const v = j / 127; // 0=底 →1=顶
      const axial = Math.pow(v, 1.8);
      for (let i = 0; i < 32; i++) {
        const edge = Math.pow(Math.sin(Math.PI * (i / 31)), 1.5);
        const a = Math.max(0, Math.min(1, axial * edge));
        const k = (j * 32 + i) * 4;
        img.data[k] = 200; img.data[k + 1] = 230; img.data[k + 2] = 255;
        img.data[k + 3] = Math.round(a * 255);
      }
    }
    x.putImageData(img, 0, 0);
    _shaftTexCache = new THREE.CanvasTexture(c);
    return _shaftTexCache;
  }

  // H 路：遮挡检查用的复用向量（避免每 0.12s 的交互检测产生 GC）
  const _occDir = new THREE.Vector3();
  // 性能优化：手电方向逐帧计算复用的向量/欧拉角（原先每帧 new Vector3 + new Euler）
  const _flashDir = new THREE.Vector3();
  const _flashEuler = new THREE.Euler(0, 0, 0, 'YXZ');

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
      this._lp = W.lightProfiles[map.level] || {}; // v2.4 W-shadowlight：本关灯光气质（行为归我，排布密度归 W-l0gen）
      this._levelMats = []; // v2.4 W-shadowlight：提前初始化（_buildFlashFx/_buildLevelFx 在首个 buildChunk 之前 push 材质）
      this.state = savedState || { openedDoors: [], picked: [], openedCrates: [], events: [] };
      // v1.5 W1：恢复区块级状态（老存档缺 chunkState 字段 → 空对象，向后兼容）
      BR.ChunkState.deserialize(this.state.chunkState);
      // W-hotfix(2026-10-18)：L37 水下通道低板 3D 条件碰撞。
      // 低板 y 0.8~1.05 高出水面(0.5)，须潜水（头顶 < yBot）从下方穿过；
      // 头顶高于 yBot 时水平进入低板 tile 视为撞墙。tile 碰撞系是 2D 的，
      // 这里按玩家实时头高做条件阻挡（只读 BR.Player，不改其逻辑；
      // 不在 W.blocked 里做，避免污染实体 LOS 的 tile 查询）。
      this._slabTiles = null;
      const _l37pits = map.meta && map.meta.l37 && map.meta.l37.pits;
      if (_l37pits) {
        for (const pit of _l37pits) {
          if (pit.role === 'underpass' && pit.slab && pit.slab.yBot != null) {
            this._slabTiles = this._slabTiles || new Map(); // "tx,ty" -> yBot
            for (let sy = pit.slab.ty0; sy <= pit.slab.ty1; sy++)
              for (let sx = pit.slab.tx0; sx <= pit.slab.tx1; sx++)
                this._slabTiles.set(sx + ',' + sy, pit.slab.yBot);
          }
        }
      }
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
      // v2.4 W-shadowlight：手电收窄（AAA_REF 1.1：angle 0.42 / penumbra 0.5 / decay 2 / distance 30，
      // 硬芯+软边）；手电 = 本关唯一实时阴影灯（阴影相机即其视锥，天然"灯具归属房间"、不穿墙）
      this.flashSpot = new THREE.SpotLight(0xfff2d8, 0, 30, 0.42, 0.5, 2);
      this.flashSpot.shadow.camera.near = 0.4;
      this.flashSpot.shadow.camera.far = 32;
      this.flashSpot.shadow.camera.fov = 2 * 0.42 * 180 / Math.PI;
      this.flashSpot.shadow.camera.updateProjectionMatrix();
      this.flashSpot.shadow.bias = -0.0025;
      this.scene.add(this.flashSpot); this.scene.add(this.flashSpot.target);
      this.setShadowLevel(BR.QUALITY ? (BR.QUALITY.shadow | 0) : 0);
      this._buildFlashFx(); // 手电光锥 + 锥内尘埃（加法假体，开口锥面网格）

      // 关卡内容（门/道具/事件物）由 levels.js 注册
      if (BR.Levels[map.level] && BR.Levels[map.level].buildContent) {
        BR.Levels[map.level].buildContent(map, this);
      }
      // Systems D：环境涂鸦（各关通用；gen.js 已按种子登记 'graffiti' POI）
      if (BR.buildGraffitiDecals) BR.buildGraffitiDecals(map, this);
      // 实体
      if (BR.Entities && BR.Entities.spawnForMap) BR.Entities.spawnForMap(map, this);
      this._buildLevelFx(); // v2.4 W-shadowlight：L37 焦散 / L7 光柱+冷蓝保底（关卡灯光气质）

      // 出生点周围立即建好，避免开场空白
      const sp = this.spawnOf(map);
      this.update(0.016, sp.x, sp.z, true);
      // v2.4 W-shadowlight：透明材质不投射阴影（水面/焦散/涂鸦/加法假体），其余 mesh 投射+接收
      this._noShadowMats = new Set();
      for (const mt of (this._levelMats || [])) if (mt && mt.transparent) this._noShadowMats.add(mt);
      this._flagShadows(this.scene);
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
    this.propColliders = []; // v2.5 道具碰撞：跨关整表清空
    this._vents = []; // v2.5 F6(A1-08)：通风管记录跨关清空——不调 buildVents 的关卡（如 L3）不继承上一关数据
    this.doors = {}; this.fixtures = []; this.lights = [];
    // v1.5 W1：跨关扫尾 —— 残留的蒸汽循环音源清掉（卸区块时已逐个停，这里防漏）
    if (BR.Audio && BR.Audio.removeLoop)
      for (const v of this.steamVents) BR.Audio.removeLoop('steam_' + v.id);
    this.steamVents = []; this.lowDucts.clear();
    this.elevator = null; this.blackout = false;
    this._rbT = null; this._rbDur = 0; // 随机断电事件计时：跨关不残留
    this._noWall = null; this._openCeil = null; this._openFloor = null; this._matCache = null;
    this._slabTiles = null; // W-hotfix：L37 水下通道低板碰撞（跨关不残留）
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
    // v2.4 W-shadowlight：灯光 FX 状态清理（mesh 随 scene 释放，这里清引用防跨关残留）
    this.flashCone = this.flashDust = null;
    this._caustic = this._causticTex = null;
    this._shafts = this._shaftGroup = null;
    this._dustBase = this._dustPh = null;
    this._noShadowMats = null; this._lp = null; this._coneFade = 0;
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
            this._initBallast(chunk.fixtures[chunk.fixtures.length - 1]); // v2.4 W-shadowlight：镇流器垂死灯具登记
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
            // W-fix（马尼拉安全屋天花板黑洞）：门 tile 是墙值（0），旧逻辑只补地板、
            // 从不补天花板 → 门洞整列（3×3m）顶部敞向虚空，门外看门框上方是纯黑梯形，
            // 而门内/走廊的地板 tile 天花板都完好。与补地板同理补天花板，但仅当任一
            // 相邻地板 tile 本身有吊顶（非 openCeil）时才补——露天/自建吊顶关卡
            // （L11/L94 全图 openCeil、L188 中庭）不会凭空多出引擎天花板。
            if (!this.openCeilAt(tx, ty) &&
                ((isGround(tx + 1, ty) && !this.openCeilAt(tx + 1, ty)) ||
                 (isGround(tx - 1, ty) && !this.openCeilAt(tx - 1, ty)) ||
                 (isGround(tx, ty + 1) && !this.openCeilAt(tx, ty + 1)) ||
                 (isGround(tx, ty - 1) && !this.openCeilAt(tx, ty - 1)))) {
              dummy.position.set(wx, wallH, wz); dummy.rotation.set(Math.PI / 2, 0, 0);
              dummy.scale.set(1, 1, 1); dummy.updateMatrix();
              ceilM.push(dummy.matrix.clone());
              // 门楣上方到天花板的竖向空档：门扇高 dh=min(2.6, wallH-0.4)（buildDoorMesh
              // 同式），门框顶只到 dh+0.18，天花板补上后仍留一条横缝。补一段与相邻墙
              // 同材质、同截面（整 tile）的过梁墙体封住；仅空档 <1m 的常规关卡补，
              // wallH=12 的 L188 等自建吊顶关卡跳过（其门洞上方由自建结构处理）。
              const dhF = Math.min(2.6, wallH - 0.4);
              const gapBot = dhF + 0.18, gapH = wallH - gapBot;
              if (gapH > 0.01 && gapH < 1.0) {
                dummy.position.set(wx, gapBot + gapH / 2, wz); dummy.rotation.set(0, 0, 0);
                dummy.scale.set(1, gapH, 1); dummy.updateMatrix();
                wallM.push(dummy.matrix.clone());
                dummy.scale.set(1, 1, 1);
              }
            }
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
    if (this._lp && this._lp.fixTint) fixMat.color.setHex(this._lp.fixTint); // v2.4 W-shadowlight：灯具面板色温
    m = inst(G.plane, fixMat, fixM);
    if (m) {
      group.add(m); chunk.meshes.push(m); chunk.fixtureMesh = m;
      // v2.4 W-shadowfix：灯具面板实例一律写 instanceColor（正常纯白、镇流器垂死微暗）。
      // 根因（r128 源码实证）：WebGLRenderer.setProgram 只按 isInstancedMesh 判 program
      // 切换、不看 instancingColor；_fixMat 跨关卡缓存在 W 单例上（dispose 不清），
      // L0（ballast）写色后、切到无 ballast 关卡会复用带 USE_INSTANCING_COLOR 的 program
      // 去渲染 instanceColor=null 的 mesh，bindingStates 对 null 调 attributes.get
      // → 每帧抛 isInterleavedBufferAttribute。纯白写色不改变观感。
      const dimOn = !!(this._lp && this._lp.ballast);
      for (let fi = 0; fi < m.count; fi++) {
        m.setColorAt(fi, (dimOn && fi < chunk.fixtures.length && chunk.fixtures[fi]._blBad) ? _BALLAST_DIM : _WHITE);
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (this.blackout && chunk.fixtureMesh) chunk.fixtureMesh.visible = false;

    // 内容钩子（门/道具/事件物）
    const hooks = this.contentHooks.get(k);
    if (hooks) for (const fn of hooks) { try { fn(group, chunk); } catch (e) { BR.warn('chunk hook err', e); } }

    this.scene.add(group);
    this.chunks.set(k, chunk);
    for (const f of chunk.fixtures) this.fixtures.push(Object.assign({ chunkKey: k }, f));
    this._flagShadows(group); // v2.4 W-shadowlight：新区块 mesh 补阴影旗（含内容钩子增补物）
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
    // v2.5 道具碰撞：与 interactables 同款，按 chunkKey 清掉该区块的登记（钩子重跑会重新登记）
    if (this.propColliders) this.propColliders = this.propColliders.filter(c => c.chunkKey !== chunk.key);
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
    // 入队缺失区块（按距离排序）。性能优化：队列数组复用，不再每帧新建
    if (!this.buildQueue) this.buildQueue = []; else this.buildQueue.length = 0;
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

  // 性能优化：实体上下文对象只建一次、逐帧刷新字段（原先每帧新建对象 + 闭包）。
  // Entities.update 在同一帧内同步消费 ctx，不跨帧持有，复用安全；
  // losTo 改读 ctx 上缓存的本帧坐标，语义与原先一致。
  W.entityCtx = function (px, pz) {
    const P = BR.Player;
    if (!this._ctxObj) {
      const self = this;
      this._ctxObj = {
        playerPos: new THREE.Vector3(),
        playerNoise: 0, crouching: false, running: false, flashlightOn: false,
        blackout: false, _px: 0, _pz: 0,
        losTo: (x, z) => self.los(self._ctxObj._px, self._ctxObj._pz, x, z)
      };
    }
    const c = this._ctxObj;
    if (P) c.playerPos = P.pos;
    c.playerNoise = P ? P.noise : 0;
    c.crouching = P ? P.crouching : false;
    c.running = P ? P.running : false;
    c.flashlightOn = P ? P.flashlightOn : false;
    c.blackout = this.blackout;
    c._px = px; c._pz = pz;
    return c;
  };

  W.updateLights = function (dt, px, pz) {
    const q = BR.QUALITY || {};
    const maxL = q.maxLights || 5;
    // 最近的灯具分配点光源。性能优化：选择结果缓存 0.25s（或玩家移动 >4m、
    // 灯具总数变化时重算）——灯光绑定本身有淡入淡出，4Hz 重选无可感差异；
    // 原先每帧全量遍历 + 新建 {f,d2} 对象 + 排序，是逐帧 GC 的主要来源之一。
    // 注意：blackout/闪烁/强度仍在下方逐帧计算，不受缓存影响。
    let near = this._nearSel;
    const mdx = px - (this._nearSelX || 0), mdz = pz - (this._nearSelZ || 0);
    if (!near || this.time - (this._nearSelT || 0) > 0.25 ||
        mdx * mdx + mdz * mdz > 16 || this._nearSelNF !== this.fixtures.length) {
      near = this._nearSel = [];
      for (const f of this.fixtures) {
        const d2 = (f.x - px) * (f.x - px) + (f.z - pz) * (f.z - pz);
        if (d2 < 30 * 30) near.push({ f, d2 });
      }
      near.sort((a, b) => a.d2 - b.d2);
      this._nearSelT = this.time; this._nearSelX = px; this._nearSelZ = pz;
      this._nearSelNF = this.fixtures.length;
    }
    const th = this.theme || {};
    const lp = this._lp || {};
    const lightHex = lp.light != null ? lp.light : (th.light != null ? th.light : 0xfff0d2); // v2.4 W-shadowlight：关卡灯光气质色温
    // P5：点光源重分配淡入淡出——灯具切换时先快速淡出（~0.17s）再在新位置淡入，
    // 避免玩家看到灯"闪现"。_lfx=当前绑定的灯具（null=未分配），_lfade=0..1 系数。
    const FADE_RATE = 6;
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i];
      const f = (!this.blackout && i < near.length && i < maxL) ? near[i].f : null;
      if (L._lfx === undefined) {
        L._lfx = f; L._lfade = f ? 1 : 0;
        if (f) L.position.set(f.x, f.y, f.z);
      } else if (L._lfx !== f) {
        L._lfade = Math.max(0, (L._lfade == null ? 1 : L._lfade) - dt * FADE_RATE);
        if (L._lfade <= 0) {
          L._lfx = f;
          if (f) L.position.set(f.x, f.y, f.z);
        }
      } else {
        L._lfade = Math.min(1, (L._lfade == null ? 1 : L._lfade) + dt * FADE_RATE);
      }
      const fade = (L._lfade == null ? 1 : L._lfade);
      if (!f) { L.intensity = 0; continue; }
      let inten = (th.lightInt != null ? th.lightInt : 0.9) * 0.92;
      inten *= (f.bright || 1); // W10：灯具个体亮度差异
      let pinkDrift = false;
      const bl = f._bl;
      if (bl) {
        // v2.4 W-shadowlight：镇流器垂死三件套 —— 打火→不规则掉电+色温漂粉→熄灭（AAA_REF 1.3）
        bl.t += dt;
        if (bl.st === 'strike') {
          if (bl.t >= 0 && !bl.buzzed) { bl.buzzed = true; if (BR.Audio && BR.Audio.flickerBuzz) BR.Audio.flickerBuzz(); }
          if (Math.floor(Math.max(0, bl.t) / 0.08) % 2 === 1) inten *= 0.06; // 0.08s 级打火明灭
          if (bl.t > bl.n * 0.16) { bl.st = 'unstable'; bl.t = 0; }
        } else if (bl.st === 'unstable') {
          const n2 = Math.sin(this.time * 47 + f.phase * 3) * Math.sin(this.time * 19.3 + f.phase);
          if (n2 > 0.86) { inten *= 0.15; pinkDrift = true; } // 不规则掉电 + 色温漂粉
          if (bl.t > 22 + bl.n * 6) { bl.st = 'dead'; bl.t = 0; }
        } else { inten = 0; } // dead：灯管熄灭（面板已 bake 微暗）
      } else {
        const flickDepth = th.flickerDepth != null ? th.flickerDepth : 0.15;
        if (f.flicker && !this.blackout) {
          const n = Math.sin(this.time * 37 + f.phase) * Math.sin(this.time * 13.7 + f.phase * 2);
          if (n > 0.93) inten *= flickDepth; // 偶发闪烁
        }
      }
      // 闪烁风暴：范围内灯具剧烈闪烁
      const st = this.flickerStorm;
      if (st && st.t > 0) {
        const sd = Math.hypot(f.x - st.x, f.z - st.z);
        if (sd < st.r && Math.sin(this.time * 31 + f.phase * 3) > 0.1) inten *= 0.08;
      }
      L.intensity = inten * fade;
      L.color.setHex(lightHex);
      if (pinkDrift) L.color.lerp(_PINK, 0.55); // 灯管衰变偏粉偏紫（真实故障色温）
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
        const d = _flashDir.set(0, 0, -1).applyEuler(_flashEuler.set(P.pitch, P.yaw, 0));
        this.flashSpot.target.position.set(px + d.x * 8, P.eyeY() + d.y * 8, pz + d.z * 8);
      }
    }
    this._updateFx(dt, px, pz); // v2.4 W-shadowlight：光锥/尘埃/焦散/光柱逐帧
  };

  /* ============ v2.4 W-shadowlight：实时阴影 + 灯光重设计 + 手电筒 ============
   * 分工：灯具"排布密度"归 W-l0gen（fixtureEvery/钩子），灯光"行为/气质"归我。
   * 阴影架构：玩家手电 SpotLight = 每关唯一实时阴影灯（castShadow 按画质档开关；
   *   移动端 512 / 桌面 1024(中)/2048(高)）。阴影相机即其视锥 → 天然"灯具归属房间"；
   *   墙体/地面同时投射+接收 → 光被墙挡住，不穿墙。灯具点光源池保持无阴影（perf），
   *   靠 decay=2 + 按档收紧 distance 控制漏光（applyLightTuning）。
   * 投射物：实体/家具/玩家身体/墙体地面的 mesh；透明加法假体（光锥/尘埃/焦散/
   *   水面/涂鸦/光柱）不投射（userData.noShadow 或 _noShadowMats）。
   * 体积感：r128 无后期链，一律加法面片/粒子等价物（AAA_REF 3.2/3.3）。
   */
  W.lightProfiles = {
    // L0：冷白荧光 + 镇流器垂死三件套
    L0:  { light: 0xd8ffe8, fixTint: 0xcfe0d8, ballast: true, coneColor: 0xf2f7ff },
    // L1：暖黄钨丝
    L1:  { light: 0xffb46b, fixTint: 0xd8b28a, coneColor: 0xffe2b8 },
    // L2：锈橙（沿用主题色）
    L2:  { coneColor: 0xffe8c8 },
    // L37：青白瓷砖 + 水面焦散
    L37: { light: 0xeaf6ff, fixTint: 0xd8ecf2, caustics: true, coneColor: 0xf4fbff },
    // L37.2：过曝暖白（沿用主题）
    L372:{ coneColor: 0xfff6e8 },
    // L7：深海冷蓝保底 + 光柱
    L7:  { light: 0x9fd8ff, hemiBoost: 0.14, deepTint: 0x2a4a5a, shafts: true, coneColor: 0xdff2ff },
    // L11：钠灯橙（沿用主题）；其余关卡用主题色
  };

  // 画质档 → 阴影灯开关/尺寸。world 未 build 时只记档，build 后生效。
  W.setShadowLevel = function (n) {
    this._shadowN = n | 0;
    const on = this._shadowN > 0;
    if (!this.flashSpot) return;
    this.flashSpot.castShadow = on;
    if (on) {
      const touch = !!(BR.Input && BR.Input.isTouch);
      const sz = touch ? 512 : (this._shadowN >= 2 ? 2048 : 1024);
      if (this.flashSpot.shadow.mapSize.x !== sz) {
        this.flashSpot.shadow.mapSize.set(sz, sz);
        if (this.flashSpot.shadow.map) { this.flashSpot.shadow.map.dispose(); this.flashSpot.shadow.map = null; }
      }
    }
    BR.log('shadow level', this._shadowN, on ? (this.flashSpot.shadow.mapSize.x + 'px') : 'off');
  };

  // 阴影投射/接收旗（幂等：userData._shf 标记已处理过的 root）
  W._flagShadows = function (root) {
    if (!root || root.userData._shf) return;
    const noMats = this._noShadowMats;
    const flagOne = (o) => {
      if (!o || (o.userData && o.userData.noShadow)) return;
      if (o.isMesh || o.isInstancedMesh) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        if (noMats) for (const mt of ms) if (mt && noMats.has(mt)) return;
        o.castShadow = true; o.receiveShadow = true;
      }
    };
    if (root.traverse) root.traverse(flagOne); else flagOne(root);
    root.userData._shf = 1;
  };

  // 镇流器垂死灯具登记（L0）：位置哈希 deterministic，~16% 进入 strike→unstable→dead 状态机
  W._initBallast = function (f) {
    if (!this._lp || !this._lp.ballast) return;
    const h = Math.abs(Math.sin(f.x * 12.9898 + f.z * 78.233) * 43758.5453) % 1;
    if (h < 0.16) {
      f._blBad = true;
      f._bl = { st: 'strike', t: -((h * 37) % 5), n: 3 + Math.floor((h * 91) % 3), buzzed: false };
    }
  };

  /* ---- 手电光锥 + 锥内尘埃（开口锥面网格 + 轴向 alpha 羽化，加法混合） ---- */
  W._buildFlashFx = function () {
    const lp = this._lp || {};
    const coneLen = 15, ang = 0.42; // 视觉锥略短于光照距离（30m），避免穿墙穿雾
    const farW = 2 * coneLen * Math.tan(ang);
    // v2.5 F6(A4-04)：fresnel 型 shader——alpha 再乘 |dot(法线,视线)|：锥面在
    // 轮廓处（法线⊥视线）渐隐为 0，纯锥面网格在亮关留下的柔边"灯泡"轮廓也压掉；
    // 轴向羽化仍由 _beamTexture 提供（uv.y=1 为远端）。uOpacity 由 _updateFx 按
    // coneFade 逐帧写（0.26 为 fresnel 衰减后的观感标定：正对片段 |dot|≈0.41，
    // 等效峰值 ≈0.11，与原面片版 0.07 同级略亮；轮廓处恒为 0）。
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(lp.coneColor || 0xfff2d8) },
        uOpacity: { value: 0 },
        uMap: { value: _beamTexture() }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'varying vec3 vNormal;',
        'varying vec3 vViewDir;',
        'void main() {',
        '  vUv = uv;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  vNormal = normalMatrix * normal;',
        '  vViewDir = -mv.xyz;',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform float uOpacity;',
        'uniform sampler2D uMap;',
        'varying vec2 vUv;',
        'varying vec3 vNormal;',
        'varying vec3 vViewDir;',
        'void main() {',
        '  float axial = texture2D(uMap, vUv).a;',
        '  float fr = abs(dot(normalize(vNormal), normalize(vViewDir)));',
        '  gl_FragColor = vec4(uColor, axial * fr * uOpacity);',
        '  #include <tonemapping_fragment>',
        '  #include <encodings_fragment>',
        '}'
      ].join('\n'),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    this._levelMats.push(mat);
    const grp = new THREE.Group();
    // v2.5 F6(A4-04)：原 GPU Gems 交叉面片（3 片 PlaneGeometry 绕轴相交）的边线/折线在
    // 加色混合下显形——亮关呈以视线中心为汇聚点的放射 X 线、暗关呈带矩形远端边框的
    // 玻璃梯形罩。改用径向对称的开口锥面网格（CylinderGeometry 开放端）：无交叉面、
    // 无直线硬边；配合 _beamTexture 的纯轴向 alpha 羽化（近端≈0、远端=0），锥口不显
    // 边框。锥长/张角/近端口径（0.12 收腰比）与旧面片一致；材质换 fresnel shader
    // （见上方 mat 注释）并按观感标定等效亮度，coneFade 淡入淡出与逐帧跟随逻辑
    // （_updateFx）不变；单网格 24×12 段 + 单个 shader，帧率成本同级。
    const cg = new THREE.CylinderGeometry(farW / 2, 0.12 * farW / 2, coneLen, 24, 12, true);
    cg.rotateX(-Math.PI / 2); // +Y 端（大口、半径 farW/2）转到 -Z（相机前方远端）
    cg.translate(0, -0.05, -coneLen / 2 - 0.4); // 近端在相机前方 0.4m（与旧面片一致）
    const cm = new THREE.Mesh(cg, mat);
    cm.userData.noShadow = true; cm.frustumCulled = false;
    grp.add(cm);
    grp.visible = false; grp.userData.noShadow = true;
    this.scene.add(grp);
    this.flashCone = grp;
    // 尘埃：300 点，锥体内分布，随光锥走
    const N = 300;
    const base = new Float32Array(N * 3), ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = Math.random();
      const r = (0.12 + 0.88 * t) * farW * 0.5 * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      base[i * 3] = Math.cos(a) * r;
      base[i * 3 + 1] = Math.sin(a) * r - 0.05;
      base[i * 3 + 2] = -(0.6 + t * (coneLen - 2.5));
      ph[i] = Math.random() * Math.PI * 2;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
    const dmat = new THREE.PointsMaterial({
      size: 0.035, map: _dotTexture(), color: 0xfff4dc,
      transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true, fog: false
    });
    this._levelMats.push(dmat);
    const pts = new THREE.Points(dg, dmat);
    pts.userData.noShadow = true; pts.frustumCulled = false; pts.visible = false;
    this.scene.add(pts);
    this.flashDust = pts; this._dustBase = base; this._dustPh = ph;
    this._coneFade = 0;
  };

  /* ---- 关卡灯光气质：L37 焦散 / L7 光柱+冷蓝保底 ---- */
  W._buildLevelFx = function () {
    const lv = this.map && this.map.level, lp = this._lp || {};
    if (lp.hemiBoost && this._hemi) { // L7 冷蓝保底
      this._hemi.intensity += lp.hemiBoost;
      this._hemi.color.lerp(new THREE.Color(0x86c5ee), 0.35);
    }
    if (lp.deepTint) { // L7 雾/背景微推蓝（雾色=背景色同步推，保持一致）
      const c = new THREE.Color(lp.deepTint);
      this.scene.fog.color.lerp(c, 0.35);
      if (this.scene.background && this.scene.background.isColor) this.scene.background.lerp(c, 0.35);
    }
    if (lp.caustics) { // L37 水面焦散：加法双层错速滚动近似
      let tex = null;
      try { tex = BR.Textures.get('caustics'); } catch (e) { tex = null; }
      if (tex) {
        tex = tex.clone(); tex.needsUpdate = true;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(7, 7);
        const mat = new THREE.MeshBasicMaterial({
          map: tex, color: 0xbfeaff, transparent: true, opacity: 0.2,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false
        });
        this._levelMats.push(mat);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(42, 42), mat);
        m.rotation.x = -Math.PI / 2;
        m.userData.noShadow = true; m.visible = false; m.frustumCulled = false;
        this.scene.add(m);
        this._caustic = m; this._causticTex = tex;
      } else { this._caustic = null; }
    }
    if (lp.shafts) { // L7 深海光柱：12 组交叉面片，玩家周围 wrap
      const stex = _shaftTexture();
      const SG = new THREE.Group();
      this._shafts = [];
      for (let i = 0; i < 12; i++) {
        const g2 = new THREE.Group();
        const sm = new THREE.MeshBasicMaterial({
          map: stex, color: 0x9fd8ff, transparent: true, opacity: 0.10,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false
        });
        this._levelMats.push(sm);
        for (let k = 0; k < 2; k++) {
          const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 14), sm);
          p.rotation.y = k * Math.PI / 2;
          p.userData.noShadow = true;
          g2.add(p);
        }
        g2.position.set((Math.random() - 0.5) * 70, 4, (Math.random() - 0.5) * 70);
        g2.userData.noShadow = true;
        SG.add(g2); this._shafts.push(g2);
      }
      SG.userData.noShadow = true;
      this.scene.add(SG);
      this._shaftGroup = SG;
    }
  };

  // 逐帧：光锥/尘埃跟随相机、焦散滚动、光柱 wrap、avatar 阴影旗懒挂载
  W._updateFx = function (dt, px, pz) {
    const P = BR.Player, cam = P && P.camera;
    const on = !!(P && P.flashlightOn && P.hasFlashlight);
    this._coneFade = BR.damp(this._coneFade || 0, on ? 1 : 0, 8, dt);
    const cf = this._coneFade;
    if (this.flashCone) {
      this.flashCone.visible = cf > 0.01;
      if (this.flashCone.visible && cam) {
        this.flashCone.position.set(px, P.eyeY(), pz);
        this.flashCone.quaternion.copy(cam.quaternion); // 严格绑定相机朝向
        const cmat = this.flashCone.children[0].material;
        cmat.opacity = 0.26 * cf; // F6：fresnel 衰减后的观感标定（原交叉面片版 0.07）
        if (cmat.uniforms && cmat.uniforms.uOpacity) cmat.uniforms.uOpacity.value = cmat.opacity;
      }
    }
    if (this.flashDust) {
      this.flashDust.visible = cf > 0.01;
      if (this.flashDust.visible && cam) {
        this.flashDust.position.set(px, P.eyeY(), pz);
        this.flashDust.quaternion.copy(cam.quaternion);
        const dp = this.flashDust.geometry.attributes.position;
        const arr = dp.array, base = this._dustBase, ph = this._dustPh, t = this.time;
        for (let i = 0; i < ph.length; i++) {
          arr[i * 3] = base[i * 3] + Math.sin(t * 0.7 + ph[i]) * 0.08;
          arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.5 + ph[i] * 1.7) * 0.06;
          arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.6 + ph[i] * 0.6) * 0.08;
        }
        dp.needsUpdate = true;
        this.flashDust.material.opacity = 0.45 * cf;
      }
    }
    if (this._caustic) { // L37：玩家附近有水才显示，贴水面
      let w = null;
      try {
        const L37 = BR.Levels.L37;
        if (L37 && L37.waterAt) {
          w = L37.waterAt(px, pz);
          if (!w) {
            const R = 10;
            const ss = [[px + R, pz], [px - R, pz], [px, pz + R], [px, pz - R]];
            for (const s of ss) { w = L37.waterAt(s[0], s[1]); if (w) break; }
          }
        }
      } catch (e) { w = null; }
      if (w) {
        this._caustic.visible = true;
        this._caustic.position.set(px, (w.surface != null ? w.surface : 1) + 0.06, pz);
        this._causticTex.offset.x = (this.time * 0.014) % 1;
        this._causticTex.offset.y = (this.time * 0.010) % 1;
        this._caustic.material.opacity = 0.16 + 0.06 * Math.sin(this.time * 1.3);
      } else this._caustic.visible = false;
    }
    if (this._shafts) { // L7：光柱 wrap + 缓慢旋转
      for (const s of this._shafts) {
        const dx = s.position.x - px, dz = s.position.z - pz;
        if (dx * dx + dz * dz > 45 * 45) {
          const a = Math.random() * Math.PI * 2, r = 28 + Math.random() * 14;
          s.position.set(px + Math.cos(a) * r, 4, pz + Math.sin(a) * r);
        }
        s.rotation.y += dt * 0.02;
      }
    }
    if (P && P.avatar && !P.avatar.userData._shf) this._flagShadows(P.avatar); // 玩家身体（第三人称）
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
    // W-hotfix(2026-10-18)：L37 水下通道低板 —— 头顶高于低板底则挡住，
    // 须下潜（头顶 < yBot）才能水平穿过；已在低板下/外则不受限，不会困住玩家。
    if (this._slabTiles) {
      const yBot = this._slabTiles.get(ltx + ',' + lty);
      // BODY_H 取 player.js 的身体总高（1.78），取不到则回退常量
      const bodyH = (BR.Player && BR.Player.BODY_H) || 1.78;
      if (yBot != null && BR.Player && BR.Player.pos.y + bodyH > yBot) return false;
    }
    return true;
  };
  /* ---- v2.5 道具碰撞（仅玩家：moveCircle 第 5 参 useProps 才启用；
   * 实体/AI 不走这里，W.blocked / W.los 语义不变） ----
   * 登记：视觉尺寸未缩，内部统一 ×0.88 存为碰撞体；
   * chunkKey 由世界坐标推导（tile 坐标 → chunkOf），供 unloadChunkMeshes 按区块清除、
   * dispose 整表清空；登记点都在区块钩子内，钩子重跑即重新登记，不重复堆积。
   * opts: { rot（弧度，网格 rotation.y）, floor（L188 楼层号）, yBase（道具底面高度）, tag（可选字符串，供 W.removePropByTag 按标签移除） } */
  const PROP_SHRINK = 0.88;
  W.addPropBox = function (cx, cz, hw, hd, opts) {
    opts = opts || {};
    this.propColliders = this.propColliders || [];
    const rot = opts.rot || 0;
    this.propColliders.push({
      kind: 'box', x: cx, z: cz,
      hw: hw * PROP_SHRINK, hd: hd * PROP_SHRINK,
      rot, cos: Math.cos(rot), sin: Math.sin(rot),
      floor: opts.floor, yBase: opts.yBase, tag: opts.tag,
      chunkKey: chunkOf(Math.floor(cx / T), Math.floor(cz / T))
    });
  };
  W.addPropCircle = function (cx, cz, r, opts) {
    opts = opts || {};
    this.propColliders = this.propColliders || [];
    this.propColliders.push({
      kind: 'circle', x: cx, z: cz, r: r * PROP_SHRINK,
      floor: opts.floor, yBase: opts.yBase, tag: opts.tag,
      chunkKey: chunkOf(Math.floor(cx / T), Math.floor(cz / T))
    });
  };
  // 按 tag 移除道具碰撞体（如浆果灌木采摘后立即清掉，不等区块卸载）；无匹配时静默
  W.removePropByTag = function (tag) {
    if (!this.propColliders || tag == null) return;
    this.propColliders = this.propColliders.filter(c => c.tag !== tag);
  };
  W.circleFreeProps = function (nx, nz, radius) {
    // 必须走 this.circleFree：L188/L11 的 wrap（楼层 AABB / 车辆有向矩形）叠加生效
    if (!this.circleFree(nx, nz, radius)) return false;
    const cs = this.propColliders;
    if (!cs || !cs.length) return true;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      // 楼层过滤（floor/yBase 为 0 是有效值，用 != null 判“非空”，不能用真值判断）
      if (c.floor != null && this._l188floor != null && c.floor !== this._l188floor) continue;
      if (c.yBase != null && BR.Player && BR.Player.pos &&
          Math.abs(BR.Player.pos.y - c.yBase) > 1.3) continue;
      if (c.kind === 'circle') {
        const dx = nx - c.x, dz = nz - c.z, rr = radius + c.r;
        if (dx * dx + dz * dz < rr * rr) return false;
      } else if (c.rot) {
        // 有向矩形：局部坐标判定（与 lv_l11.js carObstacles 的 lx/lz 同约定）
        const dx = nx - c.x, dz = nz - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw + radius && Math.abs(lz) < c.hd + radius) return false;
      } else {
        // AABB：最近点距离判定（与 lv_l188.js wrap 同写法）
        const qx = nx < c.x - c.hw ? c.x - c.hw : (nx > c.x + c.hw ? c.x + c.hw : nx);
        const qz = nz < c.z - c.hd ? c.z - c.hd : (nz > c.z + c.hd ? c.z + c.hd : nz);
        const dx = nx - qx, dz = nz - qz;
        if (dx * dx + dz * dz < radius * radius) return false;
      }
    }
    return true;
  };
  // 轴分离移动（先 x 后 z，贴墙滑动）；useProps 为真时两轴都查道具碰撞，
  // 为假/缺省时行为与改动前逐字一致（仍走 this.circleFree，wrap 照常生效）
  W.moveCircle = function (pos, dx, dz, radius, useProps) {
    let nx = pos.x + dx;
    if (!(useProps ? this.circleFreeProps(nx, pos.z, radius) : this.circleFree(nx, pos.z, radius))) nx = pos.x;
    let nz = pos.z + dz;
    if (!(useProps ? this.circleFreeProps(nx, nz, radius) : this.circleFree(nx, nz, radius))) nz = pos.z;
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
  /* ---------------- 门（v2.2 重写） ----------------
   * 根因（2026-10-17 审计）：gen.js findDoorSpot 给门 axis 时四面全写反
   * （南北墙给 'z'、东西墙给 'x'），而本函数的渲染语义是
   * 'x' = 门跨世界 X（不旋转）、'z' = 绕 Y 旋转 90° 跨世界 Z，
   * 导致 L2/L1/FUN 的门全部侧着嵌在墙里（用户原话"全都是斜着的门"）。
   * gen.js 已修正（findDoorSpot / manualWallSpot / L1 走廊门）。
   * 本重写保证：
   *   1) 门框四边（双柱 + 门楣 + 门槛）与墙面共面、端正，门扇关闭时落在框内；
   *   2) 开合动画绕正确的轴：平开门绕铰链 Y 轴，推拉门沿墙面平移；
   *   3) 按关卡风格区分视觉（DOOR_STYLES），不再一个模子；
   *   4) 碰撞沿用 tile 级（门 tile：关着阻挡、开着可通行），与可见门框/门扇一致。
   * 交互（开/关、准星提示）与存档（openedDoors 按关保存）行为保持不变。
   */
  // ---- v2.2：按关卡风格的门扇贴图（256 小道具规格；painter(w,h) 返回 canvas）----
  (function registerDoorTextures() {
    if (!BR.Textures || !BR.Textures.registerTex || typeof document === 'undefined') return;
    const reg = BR.Textures.registerTex;
    function cv(w, h, base) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = base; x.fillRect(0, 0, w, h);
      return [c, x];
    }
    function vshade(x, bx, bw, h, dark, lite) { // 竖板明暗
      const g = x.createLinearGradient(bx, 0, bx + bw, 0);
      g.addColorStop(0, dark); g.addColorStop(0.5, lite); g.addColorStop(1, dark);
      x.fillStyle = g; x.fillRect(bx, 0, bw, h);
    }
    function planks(x, w, h, n, dark, lite, seam) {
      for (let i = 0; i < n; i++) {
        const bx = i * w / n;
        vshade(x, bx, w / n, h, dark, lite);
        x.fillStyle = seam; x.fillRect(bx, 0, 2, h);
      }
    }
    // L0：黄色木门
    reg('door_wood_yellow', function (w, h) {
      const r = cv(w, h, '#c99a45'), c = r[0], x = r[1];
      planks(x, w, h, 4, 'rgba(90,55,15,0.25)', 'rgba(255,240,200,0.10)', 'rgba(70,40,10,0.6)');
      for (let k = 0; k < 70; k++) {
        x.strokeStyle = 'rgba(120,75,25,' + (0.05 + Math.random() * 0.09).toFixed(3) + ')';
        x.lineWidth = 1 + Math.random();
        const gx = Math.random() * w, gy = Math.random() * h, len = 20 + Math.random() * 60;
        x.beginPath(); x.moveTo(gx, gy);
        x.quadraticCurveTo(gx + 4, gy + len / 2, gx - 3, gy + len); x.stroke();
      }
      return c;
    });
    // L1：混凝土门
    reg('door_concrete', function (w, h) {
      const r = cv(w, h, '#8f9296'), c = r[0], x = r[1];
      for (let k = 0; k < 260; k++) {
        const v = 120 + (Math.random() * 60 | 0);
        x.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',' + (0.05 + Math.random() * 0.08).toFixed(3) + ')';
        const s = 2 + Math.random() * 14;
        x.fillRect(Math.random() * w, Math.random() * h, s, s);
      }
      x.strokeStyle = 'rgba(40,42,45,0.5)'; x.lineWidth = 3;
      x.strokeRect(20, 16, w - 40, h * 0.42); x.strokeRect(20, h * 0.54, w - 40, h * 0.40);
      return c;
    });
    // L2：管道层金属门（铆钉 + 管箍）
    reg('door_metal_pipe', function (w, h) {
      const r = cv(w, h, '#5d6672'), c = r[0], x = r[1];
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(20,24,28,0.55)';
      x.fillRect(0, h * 0.30, w, 10); x.fillRect(0, h * 0.66, w, 10);
      x.fillStyle = 'rgba(200,210,220,0.5)';
      for (let i = 0; i < 6; i++) for (const yy of [14, h - 14]) {
        x.beginPath(); x.arc(14 + i * (w - 28) / 5, yy, 4, 0, 7); x.fill();
      }
      return c;
    });
    // L188：酒店深色雕花木
    reg('door_wood_dark', function (w, h) {
      const r = cv(w, h, '#3a2a18'), c = r[0], x = r[1];
      planks(x, w, h, 3, 'rgba(0,0,0,0.35)', 'rgba(190,140,80,0.08)', 'rgba(10,5,2,0.7)');
      for (let k = 0; k < 60; k++) {
        x.strokeStyle = 'rgba(200,150,90,' + (0.04 + Math.random() * 0.06).toFixed(3) + ')';
        x.lineWidth = 1;
        const gx = Math.random() * w, gy = Math.random() * h;
        x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + 3, gy + 30 + Math.random() * 40); x.stroke();
      }
      return c;
    });
    // L37：白瓷砖
    reg('door_tile_white', function (w, h) {
      const r = cv(w, h, '#edf0f0'), c = r[0], x = r[1];
      x.strokeStyle = 'rgba(120,130,135,0.55)'; x.lineWidth = 2;
      const nx = 4, ny = 8;
      for (let i = 0; i <= nx; i++) { x.beginPath(); x.moveTo(i * w / nx, 0); x.lineTo(i * w / nx, h); x.stroke(); }
      for (let j = 0; j <= ny; j++) { x.beginPath(); x.moveTo(0, j * h / ny); x.lineTo(w, j * h / ny); x.stroke(); }
      return c;
    });
    // FUN：派对红木门
    reg('door_party_red', function (w, h) {
      const r = cv(w, h, '#7a2e2e'), c = r[0], x = r[1];
      planks(x, w, h, 4, 'rgba(30,5,5,0.30)', 'rgba(255,180,150,0.08)', 'rgba(25,5,5,0.6)');
      return c;
    });
  })();
  // ---- v2.2：门风格表（按关卡）----
  // axis 约定：'x' = 门跨世界 X（南北墙，不旋转）；'z' = 旋转 90° 跨世界 Z（东西墙）。
  // anim: 'swing' 平开（绕铰链 Y 轴）/ 'slide' 推拉（沿墙面平移）。
  function doorStyleFor(level) {
    const S = {
      L0:   { frame: 0x4a3a24, frameFinish: 'wood',     panelTex: 'door_wood_yellow', panelFinish: 'wood',     handle: 'knob',    handleColor: 0xc9a227, decor: 'none',    anim: 'swing', openAngle: -1.9 },
      L1:   { frame: 0x4c4f54, frameFinish: 'concrete', panelTex: 'door_concrete',    panelFinish: 'concrete', handle: 'lever',   handleColor: 0x242628, decor: 'none',    anim: 'swing', openAngle: -1.9 },
      L2:   { frame: 0x333a42, frameFinish: 'metal',    panelTex: 'door_metal_pipe',  panelFinish: 'metal',    handle: 'lever',   handleColor: 0x1d2126, decor: 'rivets',  anim: 'swing', openAngle: -1.9 },
      L188: { frame: 0x2a1e12, frameFinish: 'wood',     panelTex: 'door_wood_dark',   panelFinish: 'wood',     handle: 'knob',    handleColor: 0xc9a227, decor: 'carve',   anim: 'swing', openAngle: -1.9 },
      L4:   { frame: 0x9aa0a6, frameFinish: 'metal',    panelGlass: true, panelColor: 0xbdd8e4, panelOpacity: 0.38, panelFinish: 'metal', handle: 'lever', handleColor: 0x6a7076, decor: 'midrail', anim: 'swing', openAngle: -1.9 },
      L37:  { frame: 0x7d838a, frameFinish: 'metal',    panelTex: 'door_tile_white',  panelFinish: 'tile',     handle: 'pullbar', handleColor: 0x5a6068, decor: 'toprail', anim: 'slide' },
      L6:   { frame: 0x2c2e33, frameFinish: 'metal',    panelTex: 'l6_door_steel',    panelFinish: 'metal',    handle: 'lever',   handleColor: 0x111214, decor: 'none',    anim: 'swing', openAngle: -1.9 },
      FUN:  { frame: 0x3a2420, frameFinish: 'wood',     panelTex: 'door_party_red',   panelFinish: 'wood',     handle: 'knob',    handleColor: 0xd8b13a, decor: 'none',    anim: 'swing', openAngle: -1.9 },
      L3:   { frame: 0x4a3a28, frameFinish: 'rust',     panelTex: 'door_metal_pipe',  panelFinish: 'rust', panelColor: 0xc09a78, handle: 'lever', handleColor: 0x1d2126, decor: 'none', anim: 'swing', openAngle: -1.9 },
    };
    return S[level] || { frame: 0x6a7076, frameFinish: 'metal', panelTex: 'doorMetal', panelFinish: 'metal', handle: 'lever', handleColor: 0x2b2d30, decor: 'none', anim: 'swing', openAngle: -1.9 };
  }
  W.buildDoorMesh = function (id, group) {
    const d = this.doors[id]; if (!d || d.mesh) return;
    const def = d.def, th = this.theme, wallH = th.wallH || 3;
    const level = (this.map && this.map.level) || '';
    const st = doorStyleFor(level);
    const wx = BR.tileCX(def.tx), wz = BR.tileCZ(def.ty);
    const g = new THREE.Group();
    // v2.0 P5（L188 真垂直二层）：门定义可选 yBase（门组整体抬升，用于二层门）；
    // 缺省 0，旧关行为不变。
    g.position.set(wx, def.yBase || 0, wz);
    const G = sharedGeo();
    const dh = Math.min(2.6, wallH - 0.4), dw = T * 0.92;
    const frameMat = BR.Textures.finishMaterial(null, st.frameFinish, { color: st.frame });
    const panelMat = st.panelGlass
      ? BR.Textures.finishMaterial(null, 'metal', { color: st.panelColor, transparent: true, opacity: st.panelOpacity, side: THREE.DoubleSide })
      : BR.Textures.finishMaterial(st.panelTex, st.panelFinish, st.panelColor ? { color: st.panelColor } : null);
    const trimMat = BR.Textures.finishMaterial(null, st.frameFinish, { color: st.handleColor });
    const handleMat = BR.Textures.finishMaterial(null, 'metal', { color: st.handleColor });
    const mkBox = (parent, sx, sy, sz, mat, x, y, z) => {
      const m = new THREE.Mesh(G.box, mat);
      m.scale.set(sx, sy, sz); m.position.set(x, y, z);
      parent.add(m); return m;
    };
    // —— 门框：双柱 + 门楣 + 门槛（四边与墙面共面、端正）——
    const postH = dh + 0.15;
    mkBox(g, 0.18, postH, 0.24, frameMat, -dw / 2, postH / 2, 0);
    mkBox(g, 0.18, postH, 0.24, frameMat, dw / 2, postH / 2, 0);
    mkBox(g, dw + 0.36, 0.18, 0.24, frameMat, 0, dh + 0.09, 0);
    mkBox(g, dw + 0.2, 0.07, 0.3, frameMat, 0, 0.035, 0);
    // —— 门扇（动子）——
    const pw = dw - 0.12, pt = st.panelGlass ? 0.06 : 0.12;
    const mover = new THREE.Group();   // 铰链 / 滑轨动子（d.panel 指向它）
    const panelG = new THREE.Group();  // 门扇本体（居中坐标系，x=0 为门扇中心）
    mover.add(panelG);
    const panel = new THREE.Mesh(G.box, panelMat);
    panel.scale.set(pw, dh, pt); panel.position.set(0, dh / 2, 0);
    panelG.add(panel);
    d.animKind = st.anim; d.openAngle = st.openAngle || -1.9;
    if (st.anim === 'slide') {
      // L37 推拉门：谷仓式——导轨装在房间一侧墙面上，门扇沿墙面平移
      const t = this.map.tiles, mw = this.map.w;
      const at = (x, y) => (x < 0 || y < 0 || x >= mw || y >= this.map.h) ? 0 : t[y * mw + x];
      // 局部 z 的正方向 = 世界法线方向：axis 'x' 时 local z = world z；'z' 时 local z = world x
      const zoff = def.axis === 'z'
        ? (at(def.tx + 1, def.ty) === 1 ? 1 : -1)
        : (at(def.tx, def.ty - 1) === 1 ? -1 : 1);
      const zface = zoff * (T / 2 + 0.14);
      mkBox(g, dw * 2, 0.1, 0.12, frameMat, 0, dh + 0.14, zface); // 顶部导轨
      mover.position.set(0, 0, zface);
      mkBox(mover, 0.08, 0.22, 0.08, handleMat, -pw * 0.32, dh + 0.03, 0); // 吊件
      mkBox(mover, 0.08, 0.22, 0.08, handleMat, pw * 0.32, dh + 0.03, 0);
      d.slideDist = dw * 0.98;
    } else {
      mover.position.set(-pw / 2, 0, 0); // 铰链在 -x 侧
      panelG.position.set(pw / 2, 0, 0); // 门扇中心对准框中心（铰链在门扇边缘）
    }
    // —— 把手（随门扇一起动）——
    const hx = pw / 2 - 0.2, hy = 1.05, hz = pt / 2;
    if (st.handle === 'knob') {
      const k = new THREE.Mesh(G.sph, handleMat);
      k.scale.set(0.18, 0.18, 0.18); k.position.set(hx, hy, hz + 0.08);
      panelG.add(k);
    } else if (st.handle === 'pullbar') {
      mkBox(panelG, 0.06, 0.55, 0.06, handleMat, hx, 1.15, hz + 0.08);
    } else { // lever
      mkBox(panelG, 0.05, 0.05, 0.1, handleMat, hx, hy, hz + 0.03);
      mkBox(panelG, 0.24, 0.05, 0.06, handleMat, hx - 0.08, hy, hz + 0.08);
    }
    // —— 装饰 ——
    if (st.decor === 'carve') { // L188 雕花：门扇双面各两组凹线框
      const cw = pw * 0.62, ch1 = dh * 0.32, ch2 = dh * 0.28, tt = 0.035, dp = 0.02;
      for (const zs of [pt / 2 + 0.008, -pt / 2 - 0.008]) {
        for (const [bw2, bh2, oy] of [[cw, ch1, dh * 0.70], [cw, ch2, dh * 0.28]]) {
          mkBox(panelG, bw2, tt, dp, trimMat, 0, oy + bh2 / 2, zs);
          mkBox(panelG, bw2, tt, dp, trimMat, 0, oy - bh2 / 2, zs);
          mkBox(panelG, tt, bh2, dp, trimMat, -bw2 / 2, oy, zs);
          mkBox(panelG, tt, bh2, dp, trimMat, bw2 / 2, oy, zs);
        }
      }
    } else if (st.decor === 'midrail') { // L4 玻璃门中横梁
      mkBox(panelG, pw, 0.09, pt + 0.03, frameMat, 0, 1.15, 0);
    }
    // 'rivets' 走贴图；'toprail' 即导轨本身；'none' 无装饰
    if (def.axis === 'z') g.rotation.y = Math.PI / 2;
    g.add(mover);
    this.reg(group, g);
    d.mesh = g; d.panel = mover; d.doorPanel = panel; d.styleName = level + ':' + (st.panelGlass ? 'glass' : st.panelTex);
    if (d.animKind === 'slide') mover.position.x = d.open ? d.slideDist : 0;
    else mover.rotation.y = d.open ? d.openAngle : 0;
    // 交互（行为与旧版一致）
    const self = this;
    this.addInteractable({
      id: 'door_' + id, kind: 'door', chunkKey: d.chunkKey,
      // W-hotfix(2026-10-18)：radius 2.2→3.2。根因：rayInteract 按"射线命中点距离 >
      // it.radius" 过滤，而玩家站在门相邻 tile 瞄准门扇中心时命中距离恒为 ~2.94m
      //（tile 3m - 门扇半厚 0.06m），2.2 恒过滤掉 → _curIt 恒 null、按 E 无反应。
      // 与 axis 无关（x/z 门实测命中距离一致）；3.2 覆盖相邻 tile 自然站位，
      // 仍在 INTERACT_DIST+1.2=4.0 的射线范围内，不会隔墙误触（遮挡检查仍在）。
      meshes: [panel], pos: new THREE.Vector3(wx, (def.yBase || 0) + 1.4, wz), radius: 3.2,
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
    if (d.panel && instant) {
      if (d.animKind === 'slide') d.panel.position.x = open ? d.slideDist : 0;
      else d.panel.rotation.y = open ? d.openAngle : 0;
    }
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
      const k = Math.min(1, dt * 6);
      if (d.animKind === 'slide') {
        const target = d.open ? d.slideDist : 0;
        d.panel.position.x = BR.lerp(d.panel.position.x, target, k);
        if (d.anim >= 1) d.panel.position.x = target;
      } else {
        const target = d.open ? d.openAngle : 0;
        d.panel.rotation.y = BR.lerp(d.panel.rotation.y, target, k);
        if (d.anim >= 1) d.panel.rotation.y = target;
      }
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
    // v2.0 P4（L6 熄灯之时）："最安静的房间"电灯开关
    'l6_switch',
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
   * 设计取舍（用户第九节 + v2.4 W-shadowlight）：
   *  - 灯下亮、远处平滑变暗：靠 PointLight decay=2 的物理衰减（build 里已设），本函数只按画质档
   *    收紧 distance（穿墙漏光主要来自"距离 26m 的灯隔墙照到玩家"）。
   *  - 实时阴影灯：v2.4 起为 1 盏 = 玩家手电 SpotLight（castShadow 按画质档开关；
   *    移动端 512 / 桌面 1024(中)/2048(高)；见 W.setShadowLevel）。点光源阴影
   *    （每灯 6 面 cube map）移动端不可承受，故灯具池保持无阴影；转角/柱后/接触处的
   *    柔和变暗仍用 blob 接触阴影（textures.js）+ 灯光衰减 + 雾表现。
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
  // 实时阴影灯数量（v2.4 W-shadowlight：手电 SpotLight，1 盏；画质低档时 0）
  W.shadowLightCount = function () { return (this._shadowN > 0 && this.flashSpot && this.flashSpot.castShadow) ? 1 : 0; };

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
