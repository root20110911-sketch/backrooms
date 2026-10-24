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

  /* ---------- v2.4 W-entityvisual：程序化建模重制 ----------
   * 设计依据：docs/AAA_REF.md 第五章（Ito 法则：剪影签名 + 藏脸 + 不对称；
   * 远剪影/近细节两档 LOD；Alan Wake 式逆光轮廓；眼发光）。
   * 约束：只用 r128 基础几何体（Box/Sphere/Cylinder/Cone/Plane，
   * 与 node 测试垫片对齐）；无骨骼管线——关节 = Group 嵌套，程序化旋转驱动。
   * AI 行为数值与遭遇逻辑一律不动，只改视觉呈现。 */
  function lam(color) { return new THREE.MeshLambertMaterial({ color }); }
  function basic(color) { return new THREE.MeshBasicMaterial({ color }); }

  /* 远剪影材质（共享）：纯黑无光照，雾中即"逆光剪影"本体。dispose 时跳过。 */
  var _silMat = null;
  function silhouetteMat() {
    if (!_silMat) _silMat = new THREE.MeshBasicMaterial({ color: 0x030304 });
    return _silMat;
  }
  /* 顶点色脏污（建模期静态）：逐顶点压暗 + 底部更脏（重力语法）。
   * 用顶点位置哈希，保证静态不闪烁；node 垫片无 setAttribute 时静默跳过。 */
  function grimeGeo(geo, amt, seed) {
    if (!geo || !geo.setAttribute || !THREE.BufferAttribute) return geo;
    try {
      if (geo.userData && geo.userData._grimed) return geo;
      var pos = geo.attributes.position, n = pos.count;
      var col = new Float32Array(n * 3);
      var s = seed || 0;
      for (var i = 0; i < n; i++) {
        var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        var h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s * 19.19) * 43758.5453;
        h -= Math.floor(h);
        var v = 1 - amt * h * h;
        v *= 1 - amt * 0.4 * Math.max(0, Math.min(1, -y * 2));
        col[i * 3] = v;
        col[i * 3 + 1] = v * (0.93 + h * 0.07);
        col[i * 3 + 2] = v * (0.88 + h * 0.07);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (geo.userData) geo.userData._grimed = true;
    } catch (e) { /* 垫片环境：无脏污也无妨 */ }
    return geo;
  }
  /* 脏污 Lambert：vertexColors 与材质色相乘，打破"均匀干净 CG 感" */
  function dirtyMat(color, amt, seed) {
    var m = new THREE.MeshLambertMaterial({ color: color, vertexColors: true });
    try { m.userData.grime = { amt: (amt == null ? 0.5 : amt), seed: seed || 0 }; } catch (e) {}
    return m;
  }
  /* 装配：建模期自动脏污；Lambert 部件登记剪影替换；detail=true 的只在近处显示 */
  function mk(parent, geo, mat, u, o) {
    o = o || {};
    var gr = null;
    try { gr = mat.userData.grime; } catch (e) {}
    if (gr) grimeGeo(geo, gr.amt, gr.seed + (o.gs || 0));
    var m = new THREE.Mesh(geo, mat);
    if (o.p) m.position.set(o.p[0], o.p[1], o.p[2]);
    if (o.r) { m.rotation.x = o.r[0]; m.rotation.y = o.r[1]; m.rotation.z = o.r[2]; }
    if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
    parent.add(m);
    if (u) {
      if (!o.keep && mat && mat.isMeshLambertMaterial) u.swap.push({ mesh: m, mat: mat });
      if (o.detail) u.detail.push(m);
    }
    return m;
  }
  /* 关节 pivot */
  function J(parent, x, y, z) {
    var p = new THREE.Group();
    p.position.set(x, y, z);
    parent.add(p);
    return p;
  }
  /* 沿 -Y 生长的肢段（pivot 在关节处，动画转 pivot.rotation） */
  function seg(piv, r1, r2, len, mat, u, detail) {
    return mk(piv, new THREE.CylinderGeometry(r1, r2, len, 7), mat, u,
      { p: [0, -len / 2, 0], detail: detail });
  }
  /* 眼发光：MeshBasicMaterial 不受光照，远处即"两点光"（AAA_REF 5.3） */
  function eye(u, parent, dimHex, hotHex, r, x, y, z) {
    if (!u.eyeMat) {
      u.eyeMat = new THREE.MeshBasicMaterial({ color: dimHex });
      u.eyeDimHex = dimHex; u.eyeHotHex = (hotHex == null ? dimHex : hotHex);
    }
    var e = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), u.eyeMat);
    e.position.set(x, y, z);
    parent.add(e);
    u.eyes.push(e);
    return e;
  }
  /* 抽搐脉冲：双正弦拍频过阈值 → 痉挛式 0/1 */
  function twitch(t, f1, f2, th) {
    return (Math.sin(t * f1) * Math.sin(t * f2) > th) ? 1 : 0;
  }
  /* 实体骨架容器：g=世界落位（update 驱动 position/rotation.y），
   * rig=动画层（bob/呼吸/倾斜，不打架） */
  function newFigure(height) {
    var g = new THREE.Group();
    var rig = new THREE.Group();
    g.add(rig);
    var u = g.userData;
    u.rig = rig; u.j = {};
    u.detail = [];   // 近处才显示的细节件
    u.swap = [];     // {mesh, mat}：远处剪影替换登记
    u.eyes = [];
    u.eyeMat = null;
    u.height = height;
    return { g: g, rig: rig, u: u, j: u.j };
  }
  /* 手掌 + 三指（潜伏者）：手指登记为抽搐目标 */
  function armHand(u, wristJ, y, mat) {
    mk(wristJ, new THREE.BoxGeometry(0.1, 0.18, 0.06), mat, u, { p: [0, y - 0.06, 0] });
    u.twFingers = u.twFingers || [];
    for (var fi = -1; fi <= 1; fi++) {
      var f = mk(wristJ, new THREE.BoxGeometry(0.022, 0.16, 0.022), mat, u,
        { p: [fi * 0.035, y - 0.2, 0.01], r: [0.08, 0, fi * 0.12], detail: true });
      u.twFingers.push(f);
    }
  }

  /* 猎犬 —— 剪影签名：四足低伏 + 过长前肢 + 弓背驼峰 + 长吻 + 上扬细尾。
   * Ito 不对称：左前肢比右前肢长约 9%。藏脸：头部深色、只有两点冷白眼。 */
  function buildHound() {
    var f = newFigure(1.35);
    var g = f.g, rig = f.rig, u = f.u, j = u.j;
    var skin = dirtyMat(0x1a1410, 0.55, 11);
    var dark = dirtyMat(0x0e0b09, 0.4, 23);
    var tooth = basic(0xcfc9b8);

    // 躯干：低伏长条 + 肩部驼峰（弓背）+ 后臀
    mk(rig, new THREE.SphereGeometry(0.5, 12, 10), skin, u,
      { p: [0, 0.78, -0.05], s: [0.62, 0.58, 1.7] });
    mk(rig, new THREE.SphereGeometry(0.34, 10, 8), skin, u,
      { p: [0, 1.0, 0.42], s: [0.95, 0.85, 1.1] });
    mk(rig, new THREE.SphereGeometry(0.3, 10, 8), skin, u,
      { p: [0, 0.72, -0.72], s: [0.85, 0.8, 1.0] });

    // 头颈关节 + 长吻
    j.head = J(rig, 0, 1.02, 0.88);
    mk(j.head, new THREE.BoxGeometry(0.4, 0.36, 0.5), skin, u, { p: [0, 0.04, 0.22] });
    mk(j.head, new THREE.BoxGeometry(0.26, 0.2, 0.55), skin, u, { p: [0, -0.03, 0.68] });
    // 耳（近细节，可抽搐）
    u.twEar = [];
    [-1, 1].forEach(function (s) {
      u.twEar.push(mk(j.head, new THREE.ConeGeometry(0.07, 0.24, 6), dark, u,
        { p: [s * 0.16, 0.28, 0.05], r: [0, 0, -s * 0.25], detail: true }));
    });
    // 眼：两点冷白（远处即剪影 + 眼发光）
    eye(u, j.head, 0xfff2c8, 0xfff2c8, 0.05, -0.13, 0.12, 0.44);
    eye(u, j.head, 0xfff2c8, 0xfff2c8, 0.05, 0.13, 0.12, 0.44);
    // 颌关节 + 牙（近细节）
    j.jaw = J(j.head, 0, -0.14, 0.42);
    mk(j.jaw, new THREE.BoxGeometry(0.22, 0.07, 0.52), dark, u, { p: [0, -0.04, 0.24] });
    for (var ti = -1; ti <= 1; ti++) {
      mk(j.head, new THREE.ConeGeometry(0.025, 0.1, 5), tooth, u,
        { p: [ti * 0.08, -0.12, 0.86], r: [Math.PI, 0, 0], detail: true });
    }

    // 腿：前肢过长（签名），左前肢再长约 9%（不对称）
    function leg(x, py, z, len, r1, r2, name) {
      var piv = J(rig, x, py, z);
      seg(piv, r1, r2, len, skin, u);
      mk(piv, new THREE.BoxGeometry(0.14, 0.09, 0.2), dark, u,
        { p: [0, -len - 0.02, 0.04], detail: true });
      j[name] = piv;
    }
    leg(-0.24, 1.0, 0.55, 1.0, 0.10, 0.055, 'legFL');
    leg(0.24, 0.92, 0.55, 0.92, 0.10, 0.055, 'legFR');
    leg(-0.24, 0.72, -0.55, 0.72, 0.115, 0.06, 'legBL');
    leg(0.24, 0.72, -0.55, 0.72, 0.115, 0.06, 'legBR');

    // 尾：上扬细尾，两节
    j.tail = J(rig, 0, 0.92, -0.85);
    mk(j.tail, new THREE.CylinderGeometry(0.045, 0.03, 0.55, 6), skin, u,
      { p: [0, 0.2, -0.2], r: [1.1, 0, 0] });
    mk(j.tail, new THREE.CylinderGeometry(0.03, 0.015, 0.45, 6), dark, u,
      { p: [0, 0.52, -0.42], r: [1.35, 0, 0], detail: true });

    return g;
  }

  /* 潜伏者 —— 剪影签名：2.6 米瘦高人形 + 双臂垂过膝 + 左臂长约 24% +
   * 低头藏脸（无五官）+ 微驼背。眼平时暗红几不可见，警告以上才亮起。 */
  function buildLurker() {
    var f = newFigure(2.6);
    var g = f.g, rig = f.rig, u = f.u, j = f.j;
    var skin = dirtyMat(0x39414a, 0.6, 31);
    var bone = dirtyMat(0x4b545c, 0.5, 47);

    // 骨盆 + 瘦长躯干（微驼）
    mk(rig, new THREE.BoxGeometry(0.34, 0.24, 0.26), skin, u, { p: [0, 1.1, 0] });
    mk(rig, new THREE.CylinderGeometry(0.21, 0.15, 1.0, 9), skin, u,
      { p: [0, 1.68, 0.02], r: [0.1, 0, 0] });
    // 脊背骨节（近细节）
    for (var bi = 0; bi < 4; bi++) {
      mk(rig, new THREE.SphereGeometry(0.05, 6, 5), bone, u,
        { p: [0, 1.44 + bi * 0.22, -0.17 - bi * 0.018], detail: true });
    }

    // 颈 + 头：藏脸式低头，无五官
    j.neck = J(rig, 0, 2.24, 0.06);
    j.neck.rotation.x = 0.42;
    mk(j.neck, new THREE.SphereGeometry(0.21, 12, 10), skin, u,
      { p: [0, 0.16, 0.05], s: [0.92, 1.18, 1.0] });
    eye(u, j.neck, 0x4a1008, 0xff2a18, 0.034, -0.075, 0.19, 0.26);
    eye(u, j.neck, 0x4a1008, 0xff2a18, 0.034, 0.075, 0.19, 0.26);

    // 手臂：过长垂过膝；左臂总长比右臂长约 24%（不对称）
    j.shL = J(rig, -0.3, 2.12, 0);
    j.shR = J(rig, 0.3, 2.06, 0);
    seg(j.shL, 0.055, 0.045, 0.62, skin, u);
    j.elL = J(j.shL, 0, -0.62, 0);
    seg(j.elL, 0.045, 0.032, 0.85, skin, u);
    armHand(u, j.elL, -0.85, bone);
    seg(j.shR, 0.055, 0.045, 0.55, skin, u);
    j.elR = J(j.shR, 0, -0.55, 0);
    seg(j.elR, 0.045, 0.032, 0.6, skin, u);
    armHand(u, j.elR, -0.6, bone);

    // 腿：细长，微 X 形（膝内扣）
    j.hipL = J(rig, -0.13, 1.04, 0); j.hipL.rotation.z = 0.05;
    j.hipR = J(rig, 0.13, 1.04, 0); j.hipR.rotation.z = -0.05;
    seg(j.hipL, 0.075, 0.058, 0.5, skin, u);
    j.kneeL = J(j.hipL, 0, -0.5, 0);
    seg(j.kneeL, 0.058, 0.04, 0.5, skin, u);
    mk(j.kneeL, new THREE.BoxGeometry(0.11, 0.07, 0.27), bone, u, { p: [0, -0.53, 0.08] });
    seg(j.hipR, 0.075, 0.058, 0.5, skin, u);
    j.kneeR = J(j.hipR, 0, -0.5, 0);
    seg(j.kneeR, 0.058, 0.04, 0.5, skin, u);
    mk(j.kneeR, new THREE.BoxGeometry(0.11, 0.07, 0.27), bone, u, { p: [0, -0.53, 0.08] });

    return g;
  }

  /* ---------- 已退役实体（v2.3 W-entity 清理） ----------
   * 观察者（watcher）：L94「动画」已于 v1.5 W6 退役（被 Level ! 替换；
   * gen_l94.js / lv_l94.js 不再加载，LORE.md 有退役说明）——它是 L94 的
   * 标志性实体，硬塞进其他关卡不符合原著定位，故明确退役：buildWatcher /
   * updateWatcher / watcherAggressive 及 POI 生成分支已删除，不留"代码存在
   * 但玩家永远见不到"的第三种状态。
   * 利维坦（leviathan）：v1.5 W3 起 L7 的深海实体只做环境演出（lv_l7.js 的
   * L.entity 真 AI：dormant→lurk→stalk→strike→retreat），不再经 entities.js
   * 的 POI 生成追逐实体；此处的旧 buildLeviathan / updateLeviathan（"保留未用"）
   * 已删除。L7 POI type 'leviathan' 仍保留为环境演出锚点（lv_l7.js initEntity 用）。
   */
  /* 派对客 —— 剪影签名：3.5 米瘦高身形 + 大圆头 + 血红宽笑脸 + 歪派对帽 +
   * 褶皱领 + 白手套长臂（左长 20%）。笑脸与帽是远剪影签名，远处保留。 */
  function buildPartygoer() {
    var f = newFigure(3.5);
    var g = f.g, rig = f.rig, u = f.u, j = f.j;
    var skin = dirtyMat(0xddb93e, 0.55, 61);
    var red = dirtyMat(0xa02838, 0.4, 77);
    var glove = dirtyMat(0xe6dcc4, 0.35, 83);

    // 腿
    j.hipL = J(rig, -0.17, 1.5, 0);
    j.hipR = J(rig, 0.17, 1.5, 0);
    seg(j.hipL, 0.095, 0.07, 0.72, skin, u);
    j.kneeL = J(j.hipL, 0, -0.72, 0);
    seg(j.kneeL, 0.07, 0.052, 0.7, skin, u);
    mk(j.kneeL, new THREE.BoxGeometry(0.16, 0.1, 0.3), red, u, { p: [0, -0.74, 0.06] });
    seg(j.hipR, 0.095, 0.07, 0.72, skin, u);
    j.kneeR = J(j.hipR, 0, -0.72, 0);
    seg(j.kneeR, 0.07, 0.052, 0.7, skin, u);
    mk(j.kneeR, new THREE.BoxGeometry(0.16, 0.1, 0.3), red, u, { p: [0, -0.74, 0.06] });

    // 躯干 + 纽扣（近细节）
    mk(rig, new THREE.CylinderGeometry(0.3, 0.24, 1.15, 10), skin, u, { p: [0, 2.05, 0] });
    for (var bi2 = 0; bi2 < 3; bi2++) {
      mk(rig, new THREE.SphereGeometry(0.045, 8, 6), red, u,
        { p: [0, 1.78 + bi2 * 0.24, 0.26], detail: true });
    }
    // 褶皱领
    mk(rig, new THREE.CylinderGeometry(0.42, 0.5, 0.22, 10), red, u, { p: [0, 2.66, 0] });
    mk(rig, new THREE.CylinderGeometry(0.3, 0.34, 0.12, 10), glove, u,
      { p: [0, 2.56, 0], detail: true });

    // 头：恒定歪斜（诡异）
    j.head = J(rig, 0, 2.78, 0);
    j.head.rotation.z = 0.14;
    mk(j.head, new THREE.SphereGeometry(0.34, 14, 12), skin, u, { p: [0, 0.3, 0] });
    // 血红笑脸（签名：远处保留，不进剪影替换）
    var smile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.38),
      new THREE.MeshBasicMaterial({ map: BR.Textures.get('smiley'), transparent: true })
    );
    smile.position.set(0, 0.28, 0.345);
    j.head.add(smile);
    // 派对帽（签名）：歪戴 + 绒球
    mk(j.head, new THREE.ConeGeometry(0.2, 0.55, 10), red, u,
      { p: [-0.1, 0.78, 0], r: [0, 0, 0.32] });
    mk(j.head, new THREE.CylinderGeometry(0.24, 0.26, 0.06, 10), red, u,
      { p: [-0.02, 0.55, 0], r: [0, 0, 0.32], detail: true });
    mk(j.head, new THREE.SphereGeometry(0.07, 8, 6), glove, u,
      { p: [-0.19, 1.02, 0], detail: true });

    // 手臂：过长白手套，左臂长 20%
    j.shL = J(rig, -0.44, 2.42, 0);
    j.shR = J(rig, 0.44, 2.42, 0);
    seg(j.shL, 0.062, 0.05, 0.62, skin, u);
    j.elL = J(j.shL, 0, -0.62, 0);
    seg(j.elL, 0.05, 0.038, 0.68, skin, u);
    mk(j.elL, new THREE.SphereGeometry(0.095, 8, 6), glove, u, { p: [0, -0.74, 0] });
    seg(j.shR, 0.062, 0.05, 0.55, skin, u);
    j.elR = J(j.shR, 0, -0.55, 0);
    seg(j.elR, 0.05, 0.038, 0.55, skin, u);
    mk(j.elR, new THREE.SphereGeometry(0.095, 8, 6), glove, u, { p: [0, -0.61, 0] });

    return g;
  }

  /* ---------- 七层之物：远影 / 局部躯体工厂（v2.4 W-entityvisual） ----------
   * 设计（AAA_REF 5.x + 任务约束）：永不完整出镜，不做精细近模，保持"不可理解"感；
   * 只给远处逆光巨型剪影 + 局部躯体。定位仍是"超大型环境威胁"，不是可击杀 Boss。
   * 调用方：js/lv_l7.js（_spawnSilhouette / _spawnBreach 的升级替换，接口见下；
   * lv_l7.js 为只读文件，接入由其所属工作流完成，此处只提供工厂）。
   *   var sil = BR.Entities.LeviathanFX.buildSilhouette(seed); // {g, mat, segs}
   *   sil.g.position.set(x, y, z); scene.add(sil.g);            // mat.opacity 做淡入
   *   BR.Entities.LeviathanFX.updateSilhouette(sil, dt, t);     // 缓慢沉浮
   *   var br = BR.Entities.LeviathanFX.buildBreach();           // {g, mat} 一段弧形脊背
   */
  E.LeviathanFX = {
    // 远处逆光巨型剪影：6 节错开的巨型暗影 + 尾鳍 + 背鳍列（纯黑 Basic，雾中即剪影）
    buildSilhouette: function (seed) {
      var g = new THREE.Group();
      var mat = new THREE.MeshBasicMaterial({ color: 0x05090c, transparent: true, opacity: 0 });
      var s = (seed == null ? 7 : seed) >>> 0;
      function rnd() { s = (s * 16807) % 2147483647; return s / 2147483647; }
      var segs = [];
      var lens = [22, 18, 14, 11, 8.5, 6];
      var x = 0;
      for (var i = 0; i < lens.length; i++) {
        var L = lens[i];
        var m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
        m.scale.set(L, L * 0.22, L * 0.3);
        m.position.set(x + L * 0.42, Math.sin(i * 1.3) * 1.6, Math.cos(i * 0.9) * 3);
        m.rotation.y = (rnd() - 0.5) * 0.5;
        g.add(m); segs.push(m);
        x += L * 0.8;
      }
      // 尾鳍剪影
      var fin = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 4), mat);
      fin.scale.set(1, 1, 0.25);
      fin.rotation.z = Math.PI / 2 + 0.3;
      fin.position.set(x + 4, 1, 0);
      g.add(fin);
      // 背鳍列：只给剪影边缘的三片小三角
      for (var fi = 0; fi < 3; fi++) {
        var df = new THREE.Mesh(new THREE.ConeGeometry(1.6 - fi * 0.3, 4.5 - fi, 4), mat);
        df.scale.z = 0.3;
        df.position.set(6 + fi * 9, 6.4 - fi * 0.5, 0);
        g.add(df);
      }
      return { g: g, mat: mat, segs: segs };
    },
    // 远影缓慢沉浮：段间错动，节奏不可理解地慢
    updateSilhouette: function (sil, dt, t) {
      if (!sil || !sil.segs) return;
      for (var i = 0; i < sil.segs.length; i++) {
        sil.segs[i].position.y += Math.sin(t * 0.4 + i * 1.1) * dt * 0.5;
      }
    },
    // 局部出水躯体：只是一段弧形脊背 + 背鳍（6 球拼弧，无精细建模）
    buildBreach: function () {
      var g = new THREE.Group();
      var mat = new THREE.MeshLambertMaterial({ color: 0x0a0e11 });
      var R = 15, arc = 1.15, n = 6;
      for (var i = 0; i < n; i++) {
        var a = -arc / 2 + arc * (i / (n - 1));
        var m = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 6), mat);
        m.position.set(Math.sin(a) * R, (1 - Math.cos(a)) * R * 0.4, 0);
        m.scale.set(1.4, 1, 1);
        g.add(m);
      }
      var fin = new THREE.Mesh(new THREE.ConeGeometry(1.8, 5, 4), mat);
      fin.scale.z = 0.3;
      fin.position.set(0, 6.4, 0);
      g.add(fin);
      return { g: g, mat: mat };
    }
  };

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
      lureCd: 0, lured: false, // 发电机噪音引怪用
      // —— 遭遇光谱（v2.3 W-entity）：0 未察觉 / 1 痕迹·远处目击 / 2 警告 / 3 危险。
      // 状态机只允许逐级升级（不许 0→3 跳级）；回到平静状态时归 0。
      alert: 0, traceDone: false, peekT: 0, stareT: 0,
      data: data || {},
      active: true
    };
    // 初始状态
    if (type === 'hound') { ent.state = 'patrol'; ent.wp = (data.route || []).slice(); ent.wpi = 0; }
    if (type === 'lurker') {
      ent.state = 'hide'; ent.home = { x: ent.x, z: ent.z };
      placeLurkerTraces(ent, W); // 巢穴周围的抓痕：光谱第 1 级"环境痕迹"的物理载体
    }
    if (type === 'partygoer') { ent.state = 'wander'; }
    E.list.push(ent);
    BR.log('spawn entity', type, tx, ty);
    return ent;
  }

  /* 潜伏者巢穴痕迹：3 道抓痕（暗色薄片，贴地），手电照到才能看清。
   * 这是"环境痕迹"阶段——玩家先看到"这里住过东西"，然后才遇到东西本身。
   * 纯实体行为（不碰场景生成），随实体一起释放。 */
  function placeLurkerTraces(ent, W) {
    try {
      ent._traces = [];
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5 + Math.random() * 0.6, 0.05 + Math.random() * 0.04),
          new THREE.MeshBasicMaterial({ color: 0x0b0b0d, transparent: true, opacity: 0.6 })
        );
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.random() * Math.PI;
        const a = Math.random() * 6.2832, r = 2.5 + Math.random() * 3.5;
        m.position.set(ent.x + Math.cos(a) * r, 0.02, ent.z + Math.sin(a) * r);
        W.scene.add(m);
        ent._traces.push(m);
      }
    } catch (e) { /* 无痕也无妨：痕迹是加分项 */ }
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
    // 潜伏者：L1/L2（lurker_zone POI）
    pois.filter(p => p.type === 'lurker_zone').forEach(p => {
      spawn('lurker', p.tx, p.ty, W, { r: p.data.r || 5 });
    });
    // 派对客：FUN
    pois.filter(p => p.type === 'partygoer').forEach(p => {
      spawn('partygoer', p.tx, p.ty, W, {});
    });
    // v2.3 W-entity：观察者已退役（见文件头注释），此处不再生成；
    // 'leviathan' POI 是 L7 环境演出的锚点（lv_l7.js initEntity 用），此处不生成实体。
  };

  // v2.0 P2：释放几何体与材质（审计遗留：只 remove 不 dispose 会跨关累积 GPU 缓冲）。
  // 实体材质均为 lam()/basic() 逐实体新建，贴图走 BR.Textures 共享缓存（此处不碰贴图）。
  E.dispose = function () {
    for (const e of this.list) {
      // 巢穴痕迹是加到场景上的独立 mesh（不在 group 内），随实体一起清理
      if (e._traces) {
        for (const t of e._traces) {
          try {
            if (t.parent) t.parent.remove(t);
            if (t.geometry) t.geometry.dispose();
            if (t.material) t.material.dispose();
          } catch (err3) {}
        }
        e._traces = null;
      }
      if (e.group.parent) e.group.parent.remove(e.group);
      var _sil = silhouetteMat(); // 共享剪影材质：永不释放
      e.group.traverse(function (o) {
        if (o.geometry) { try { o.geometry.dispose(); } catch (err) {} }
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            if (m === _sil) continue;
            try { m.dispose(); } catch (err2) {}
          }
        }
      });
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
    // 断电事件加成：灯灭期间实体更活跃，移速 ×1.25。
    // 按 W.blackout 实时加成（随机断电/L1 POI 闪烁区都走这个旗），断电结束自动恢复，无需手动还原。
    if (ent.W && ent.W.blackout) speed *= 1.25;
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
      // —— v2.4 W-entityvisual：速度估计（程序化行走动画驱动）+ 两档 LOD ——
      // 不碰 AI：只观测位移，不改变任何行为数值。
      var _ox = (ent._px === undefined) ? ent.x : ent._px;
      var _oz = (ent._pz === undefined) ? ent.z : ent._pz;
      var _iv = Math.hypot(ent.x - _ox, ent.z - _oz) / Math.max(dt, 0.001);
      ent._spd = (ent._spd === undefined) ? _iv : BR.damp(ent._spd, _iv, 6, dt);
      ent._px = ent.x; ent._pz = ent.z;
      var _hunting = (ent.state === 'chase' || ent.state === 'stalk' || ent.state === 'attack');
      ent._phase = (ent._phase || 0) + dt * (1.1 + ent._spd * 2.6) * (_hunting ? 1.3 : 1);
      updateLOD(ent);
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
      else updatePartygoer(ent, dt, ctx, dist, seen);

      // 落位 + 朝向 + 步行动画
      ent.group.position.set(ent.x, 0, ent.z);
      ent.group.rotation.y = ent.yaw;
      animateEnt(ent, dt);
    }
    // —— v2.4 W-entityvisual：Alan Wake 式逆光轮廓（AAA_REF 1.2）——
    // 同一时间只给威胁度最高的实体 1 盏极弱冷色 PointLight（手机规则），
    // 放在实体背后（相对其朝向），玩家只看到剪影边缘被勾出来。
    var _prim = null, _bs = 0, _ri, _re, _sc;
    for (_ri = 0; _ri < this.list.length; _ri++) {
      _re = this.list[_ri];
      if (!_re.active || !_re.near) continue;
      _sc = _re.state === 'chase' ? 4 : _re.state === 'attack' ? 4 :
        _re.state === 'stalk' ? 3 : _re.alert >= 2 ? 2 : _re.alert >= 1 ? 1 : 0;
      if (_sc > _bs) { _bs = _sc; _prim = _re; }
    }
    for (_ri = 0; _ri < this.list.length; _ri++) {
      _re = this.list[_ri];
      var _L = ensureRim(_re);
      if (!_L) continue;
      var _on = (_re === _prim && _bs >= 2);
      _L.visible = _on; // 不可见的灯不进入 forward 光照收集，零成本
      if (_on) _L.intensity = BR.damp(_L.intensity, _bs >= 4 ? 0.55 : 0.3, 5, dt);
    }
  };

  /* 两档 LOD（AAA_REF 5.2）：远处只渲染剪影 + 眼发光（Lambert→共享纯黑 Basic，
   * 近细节件隐藏）；近处恢复材质与细节（顶点抽搐等只在近处跑）。 */
  var LOD_FAR = 24;
  function updateLOD(ent) {
    var want = ent.dist > LOD_FAR ? 'far' : 'near';
    if (ent._lod === want) return;
    ent._lod = want;
    var u = ent.group.userData;
    if (u.swap) {
      var sm = silhouetteMat();
      for (var i = 0; i < u.swap.length; i++) {
        u.swap[i].mesh.material = (want === 'far') ? sm : u.swap[i].mat;
      }
    }
    if (u.detail) {
      for (var k = 0; k < u.detail.length; k++) u.detail[k].visible = (want === 'near');
    }
  }
  /* 逆光轮廓灯：实体背后（本地 -z，实体朝向 +z），威胁时才可见 */
  function ensureRim(ent) {
    if (!THREE.PointLight) return null; // node 垫片：无灯
    if (!ent._rim) {
      var L = new THREE.PointLight(0x8fc4ff, 0, 9, 2);
      L.position.set(0, (ent.group.userData.height || 1.5) * 0.62, -1.5);
      ent.group.add(L);
      ent._rim = L;
    }
    return ent._rim;
  }

  function entView(ent, ctx) {
    let v;
    // 视距（ patrol 状态也吃这套）：猎犬 20→22/13→14 —— L3 是它的主场，灯光下看得更远；
    // 潜伏者 11→12（黑暗 16→17）；派对客 15→16。配合听觉，不单纯靠移速。
    if (ent.type === 'hound') v = ctx.flashlightOn ? 22 : 14;
    else if (ent.type === 'lurker') v = isDark(ent) ? 17 : 12; // 黑暗增益：灯灭/风暴期它看得更远
    else v = 16;
    // 低理智：你更容易被"注意"到（也更难集中精神躲藏）
    if (BR.Player && BR.Player.sanity < 30) v *= 1.35;
    // 断电事件加成：索敌半径 ×1.3，随 W.blackout 自动恢复
    // （与 lurker 自带的黑暗增益是两套独立加成，会叠加——黑暗里它本来就看得远，断电更甚）
    if (ent.W && ent.W.blackout) v *= 1.3;
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
        // —— 遭遇光谱第 1 级：痕迹/远处目击（v2.3 W-entity）——
        // 34m 内首次：远处一声低吼 + 停步朝你注视 1.5s，然后继续巡逻。
        // 它"注意"到你了，但还没把你当猎物——这是绕开/关手电/蹲下的窗口。
        // 贴脸（<6m）则跳过注视，直接进 investigate 预警。
        if (!ent.traceDone && dist < 34) {
          ent.traceDone = true; ent.alert = 1; ent.stareT = 1.5;
          BR.Audio.growl();
          break;
        }
        if (ent.stareT > 0) {
          ent.stareT -= dt;
          ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
          if (dist < 6) ent.stareT = 0; else break;
        }
        if (ent.lureCd > 0) ent.lureCd -= dt;
        if (seen && (dist < 10 || ctx.playerNoise > 0.5 || (ctx.flashlightOn && dist < 16))) {
          // 预警：先进入 investigate 跟踪并低吼示警，不直接 chase；
          // 玩家有约 1.5s 窗口决定跑/蹲/关手电（见 investigate 的 warnT 逻辑）
          ent.state = 'investigate'; ent.alert = 2;
          ent.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
          ent.lured = false; ent.warnT = 0; ent.loseT = 0;
          ent.stateT = 0; pathTo(ent, ent.target.x, ent.target.z);
          BR.Audio.growl();
          break;
        }
        if (ctx.playerNoise > 0.4 && dist < 24) {
          // 听觉：步行 0.45 也能被听见（原来只有疾跑 1.0 才触发）——走廊里走路不再是隐身；
          // 照例先给 growl 预警，玩家有 1.5s 窗口应对
          ent.state = 'investigate'; ent.alert = 2;
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
            ent.state = 'chase'; ent.alert = 3;
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
            ent.lured = false; ent.state = 'chase'; ent.alert = 3;
            notice(ent, ctx, dist); BR.Audio.bark(); break;
          }
          followPath(ent, 3.0, dt);
          break;
        }
        ent.warnT = Math.max(0, (ent.warnT || 0) - dt * 2);
        if (followPath(ent, 3.0, dt)) {
          if (ent.stateT > 4) {
            ent.state = 'patrol'; ent.alert = 0; ent.path = null;
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
        if (seen && dist < 13) { ent.state = 'chase'; ent.alert = 3; notice(ent, ctx, dist); break; }
        // 搜捕 12s（原来 9s）：在附近多找一会儿，躲猫猫没那么容易
        if (ent.stateT > 12) { ent.state = 'patrol'; ent.alert = 0; ent.path = null; ent.noticed = false; break; }
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
        // —— 遭遇光谱第 1 级：痕迹/远处目击（v2.3 W-entity）——
        // 28m 内首次：巢穴周围的抓痕（spawn 时已放置）+ 它抬头朝你的方向
        // 看了一眼（1.8s），又蜷回去。只响耳语，不进警告——玩家可选择绕开。
        // 休眠/激活与玩家接近度挂钩：离得远时它一直蜷着，靠近才"醒"。
        if (!ent.traceDone && dist < 28) {
          ent.traceDone = true; ent.alert = 1; ent.peekT = 1.8;
          BR.Audio.whisper();
        }
        if (ent.peekT > 0) {
          ent.peekT -= dt;
          ent.group.scale.y = BR.damp(ent.group.scale.y, 1, 6, dt);
          ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        } else {
          ent.group.scale.y = BR.damp(ent.group.scale.y, 0.72, 4, dt);
        }
        if (seen && dist < (dark ? 15 : 12)) {
          ent.state = 'warn'; ent.stateT = 0; ent.alert = 2; // 光谱第 2 级：凝视警告
          BR.Audio.whisper();
        }
        break;
      }
      case 'warn': {
        // 1.2s 凝视预警：脱离视线/拉开距离则作罢（光谱回落：alert 归 0），否则转 stalk；
        // 阴：玩家直接走到 5m 脸上（没听见 whisper），不等 1.2s 直接扑
        ent.group.scale.y = BR.damp(ent.group.scale.y, 1, 6, dt);
        ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
        if (!seen || dist > (dark ? 17 : 13)) { ent.state = 'hide'; ent.stateT = 0; ent.alert = 0; break; }
        if (ent.stateT > 1.2 || dist < 5) {
          ent.state = 'stalk'; ent.stateT = 0; ent.alert = 3; // 光谱第 3 级：危险
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
          if (ent.confuseT > 3) { ent.state = 'hide'; ent.alert = 0; ent.confuseT = 0; pathTo(ent, ent.home.x, ent.home.z); break; }
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
          ent.state = 'hide'; ent.stateT = 0; ent.alert = 0; ent.path = null; ent.noticed = false;
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
        // —— 遭遇光谱第 1 级：痕迹/远处目击（v2.3 W-entity）——
        // 26m 内首次：远处一声咯咯笑 + 它停下来歪头"看"你 1.2s，然后继续游荡。
        // 贴脸（<7m）则跳过注视，直接进 stalk。
        if (!ent.traceDone && dist < 26) {
          ent.traceDone = true; ent.alert = 1; ent.stareT = 1.2;
          BR.Audio.giggle();
          break;
        }
        if (ent.stareT > 0) {
          ent.stareT -= dt;
          ent.yaw = Math.atan2(ctx.playerPos.x - ent.x, ctx.playerPos.z - ent.z);
          if (dist < 7) ent.stareT = 0; else break;
        }
        // 诡：16m（原来 14m）外就注意到你了，giggle 预警保留
        if (seen && dist < 16) { ent.state = 'stalk'; ent.alert = 2; notice(ent, ctx, dist); BR.Audio.giggle(); break; }
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
          if (ent.boreT > 4) { ent.state = 'wander'; ent.alert = 0; ent.boreT = 0; ent.path = null; ent.noticed = false; break; }
        } else ent.boreT = 0;
        if (dist < 7 || ctx.playerNoise > 0.72) { ent.state = 'chase'; ent.alert = 3; BR.Audio.giggle(); break; }
        if (dist > 24) { ent.state = 'wander'; ent.alert = 0; ent.path = null; ent.noticed = false; break; }
        ent.repath -= dt;
        if (ent.repath <= 0 || !ent.path) { pathTo(ent, ctx.playerPos.x, ctx.playerPos.z); ent.repath = 1.2; }
        followPath(ent, 2.9, dt);
        break;
      }
      case 'chase': {
        if (dist < 1.9) { ent.state = 'attack'; break; }
        // 韧性：30m（原来 26m）才降级回 stalk，别想跑两步就甩掉
        if (dist > 30) { ent.state = 'stalk'; ent.alert = 2; break; }
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

  /* ---------- 程序化行走动画（v2.4 W-entityvisual） ----------
   * 全部按实测移动速度驱动：步频/摆幅/身体起伏/头部微动；
   * 待机=呼吸，追击=摆幅与步频放大；顶点抽搐只在近处 + 警戒以上跑。 */
  function animateEnt(ent, dt) {
    var u = ent.group.userData;
    if (!u.rig || !u.j) return;
    var t = ent.animT;
    var spd = ent._spd || 0;
    var ph = ent._phase || 0;
    var hunting = (ent.state === 'chase' || ent.state === 'stalk' || ent.state === 'attack');
    var amp = Math.min(1, spd / 3);
    var j = u.j, rig = u.rig;

    // 眼发光强度：藏脸 → 警告时亮起（node 垫片无 Color 时跳过）
    if (u.eyeMat && THREE.Color) {
      if (!u._eyeDim) {
        u._eyeDim = new THREE.Color(u.eyeDimHex);
        u._eyeHot = new THREE.Color(u.eyeHotHex);
        u._eyeTmp = new THREE.Color();
      }
      var hot = (ent.state === 'warn' || hunting) ? 1 : 0;
      u._eyeK = BR.damp(u._eyeK || 0, hot, 4, dt);
      u._eyeTmp.copy(u._eyeDim).lerp(u._eyeHot, u._eyeK);
      if (u.eyeMat.color) u.eyeMat.color.copy(u._eyeTmp);
    }

    if (ent.type === 'hound') animHound(ent, u, j, rig, t, ph, amp, hunting, dt);
    else if (ent.type === 'lurker') animLurker(ent, u, j, rig, t, ph, amp, hunting, dt);
    else animPartygoer(ent, u, j, rig, t, ph, amp, hunting, dt);
  }

  /* 猎犬：对角步态（左前+右后 / 右前+左后），身体 2 倍频起伏 */
  function animHound(ent, u, j, rig, t, ph, amp, hunting, dt) {
    var sw = 0.10 + 0.55 * amp;
    j.legFL.rotation.x = Math.sin(ph) * sw;
    j.legBR.rotation.x = Math.sin(ph) * sw * 0.9;
    j.legFR.rotation.x = Math.sin(ph + Math.PI) * sw;
    j.legBL.rotation.x = Math.sin(ph + Math.PI) * sw * 0.9;
    rig.position.y = Math.abs(Math.sin(ph)) * 0.08 * amp;
    rig.rotation.x = Math.sin(ph * 2) * 0.018 * amp;
    // 头：平时低头嗅探，追击抬头锁定
    j.head.rotation.x = BR.damp(j.head.rotation.x,
      (hunting ? -0.10 : 0.14) + Math.sin(t * 1.7) * 0.05, 5, dt);
    j.head.rotation.y = Math.sin(t * 0.6) * (hunting ? 0.03 : 0.14);
    // 尾：平时慢摆，追击急摆
    j.tail.rotation.y = Math.sin(t * (hunting ? 7 : 2.2)) * (hunting ? 0.4 : 0.16);
    j.tail.rotation.x = -0.55 + Math.sin(t * 1.3) * 0.08;
    // 颌：追击/攻击张开
    j.jaw.rotation.x = BR.damp(j.jaw.rotation.x,
      (hunting ? 0.6 : 0.1 + Math.max(0, Math.sin(t * 0.8)) * 0.06), 6, dt);
    // 待机呼吸 + 追击剪影放大（AAA_REF 5.4）
    var br = amp < 0.08 ? 1 + Math.sin(t * 2.4) * 0.016 : 1;
    var sc = hunting ? 1.06 : 1;
    rig.scale.set(BR.damp(rig.scale.x, sc, 4, dt),
      BR.damp(rig.scale.y, sc * br, 4, dt), BR.damp(rig.scale.z, sc, 4, dt));
    // 近处细节：耳抖
    if (ent._lod === 'near' && (hunting || ent.alert >= 2) && u.twEar) {
      for (var i = 0; i < u.twEar.length; i++) {
        u.twEar[i].rotation.z = (i ? -1 : 1) * (twitch(t + i * 2.1, 29, 17.3, 0.88) ? 0.18 : 0);
      }
    }
  }

  /* 潜伏者：瘦高人形的蹒跚步态；蜷伏（hide）时屈膝收臂；警告以上抬头 */
  function animLurker(ent, u, j, rig, t, ph, amp, hunting, dt) {
    var cq = BR.damp(u._crouch || 0, ent.state === 'hide' ? 1 : 0, 4, dt);
    u._crouch = cq;
    j.hipL.rotation.x = Math.sin(ph) * 0.5 * amp;
    j.hipR.rotation.x = Math.sin(ph + Math.PI) * 0.5 * amp;
    j.kneeL.rotation.x = Math.max(0, -Math.sin(ph)) * 0.9 * amp + 0.07 + cq * 0.35;
    j.kneeR.rotation.x = Math.max(0, Math.sin(ph)) * 0.9 * amp + 0.07 + cq * 0.35;
    j.shL.rotation.x = Math.sin(ph + Math.PI) * 0.38 * amp + cq * 0.5;
    j.shR.rotation.x = Math.sin(ph) * 0.32 * amp + cq * 0.5;
    j.elL.rotation.x = -0.12 - Math.max(0, Math.sin(ph + Math.PI)) * 0.35 * amp - cq * 0.6;
    j.elR.rotation.x = -0.28 - Math.max(0, Math.sin(ph)) * 0.3 * amp - cq * 0.6;
    rig.rotation.z = Math.sin(ph) * 0.05 * amp + Math.sin(t * 0.9) * 0.018;
    rig.position.y = Math.abs(Math.cos(ph)) * 0.06 * amp - cq * 0.12;
    // 头：藏脸低头；warn/追击抬头凝视
    var headUp = (ent.state === 'warn' || hunting) ? 1 : 0;
    u._headUp = BR.damp(u._headUp || 0, headUp, 3, dt);
    j.neck.rotation.x = 0.42 - u._headUp * 0.5 + Math.sin(t * 0.8) * 0.045;
    j.neck.rotation.y = Math.sin(t * 0.55) * (0.16 - u._headUp * 0.1);
    var br = amp < 0.08 ? 1 + Math.sin(t * 1.9) * 0.014 : 1;
    rig.scale.set(1, BR.damp(rig.scale.y, br, 4, dt), 1);
    // 顶点抽搐：手指痉挛（近 + alert>=2）
    if (ent._lod === 'near' && ent.alert >= 2 && u.twFingers) {
      for (var i = 0; i < u.twFingers.length; i++) {
        u.twFingers[i].rotation.x = twitch(t + i * 1.7, 31, 23.7, 0.9) ? 0.5 : 0.08;
      }
    }
  }

  /* 派对客：蹦跳步态 + 大起伏；追击时双臂上举（"要抱抱"） */
  function animPartygoer(ent, u, j, rig, t, ph, amp, hunting, dt) {
    j.hipL.rotation.x = Math.sin(ph) * 0.55 * amp;
    j.hipR.rotation.x = Math.sin(ph + Math.PI) * 0.55 * amp;
    j.kneeL.rotation.x = Math.max(0, -Math.sin(ph)) * 0.7 * amp + 0.05;
    j.kneeR.rotation.x = Math.max(0, Math.sin(ph)) * 0.7 * amp + 0.05;
    rig.position.y = Math.abs(Math.sin(ph)) * 0.13 * amp;
    rig.rotation.z = Math.sin(ph) * 0.03 * amp;
    var rs = BR.damp(u._raise || 0, hunting ? 1 : 0, 3, dt);
    u._raise = rs;
    j.shL.rotation.x = Math.sin(ph + Math.PI) * 0.6 * amp - rs * 1.15;
    j.shR.rotation.x = Math.sin(ph) * 0.6 * amp - rs * 1.15;
    j.shL.rotation.z = 0.16 + rs * 0.55;
    j.shR.rotation.z = -0.16 - rs * 0.55;
    j.elL.rotation.x = -0.2 - rs * 0.4;
    j.elR.rotation.x = -0.2 - rs * 0.4;
    // 头：恒定歪 + 摇晃；近处追击时痉挛抖动
    j.head.rotation.z = 0.14 + Math.sin(t * 1.2) * 0.085;
    if (ent._lod === 'near' && hunting) {
      j.head.rotation.y = Math.sin(t * 0.8) * 0.13 + Math.sin(t * 23.7) * 0.1;
      j.head.rotation.x = Math.sin(t * 31.7) * 0.06;
    } else {
      j.head.rotation.y = Math.sin(t * 0.8) * 0.13;
      j.head.rotation.x = BR.damp(j.head.rotation.x, Math.sin(t * 0.7) * 0.05, 4, dt);
    }
    var br = amp < 0.08 ? 1 + Math.sin(t * 2.1) * 0.013 : 1;
    rig.scale.set(1, BR.damp(rig.scale.y, br, 4, dt), 1);
  }
})();
