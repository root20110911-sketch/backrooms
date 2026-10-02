/* ============================================================
 * Level 37「泳池房」—— 关卡内容 + 共享游泳模块 BR.Swim
 * 独立 IIFE：只用 BR.*，不改动其它文件本体。
 *
 * BR.Swim（供 L7 复用）API：
 *   BR.Swim.zones              水域数组（世界坐标），元素见 registerZone
 *   BR.Swim.registerZone(zone) 注册一片水域，zone 形状：
 *     { kind:'ocean'|'pool'|'deep',
 *       cx,cz,r（圆形）或 x0,z0,x1,z1（矩形），
 *       depth, waterY,
 *       holes:[{x0,z0,x1,z1}]（可选：干区洞，洞内不算水） }
 *   BR.Swim.clearZones()                       清空水域，并复位 speedMul=1、移除 underwater 类
 *   BR.Swim.zoneAt(x,z) -> zone|null           查玩家所在水域（含 holes 干区洞判定）
 *   BR.Swim.waterYFor(depth) -> number         按水深算水面世界高度
 *     （depth>=1.0 为深水：水面 1.85；否则浅水：水面 0.55）
 *   BR.Swim.speedMul       当前移速倍率（player.js 每帧读取）
 *     上岸 1 / 涉水 0.55 / 游泳（头部在水下）0.4
 *   BR.Swim.inWater        玩家是否在水域内
 *   BR.Swim.headUnder      镜头是否低于水面（潜水判定，出口可用它做 canUse）
 *   BR.Swim.isSwimming()   headUnder 的函数版
 *   BR.Swim.isWading()     在水里但头部在水上
 *   BR.Swim.breath         0~100；头部在水下 100→0 约 25s，归零后每 2s 扣 4hp
 *   BR.Swim.tick(dt)        各水关 tick 里每帧调用
 *   BR.Swim.reset()         重置全部游泳状态（含 fog/ambient/身体 class 恢复）
 *   BR.Swim._dryAmb         关卡在 onEnter 里设为环境音名（如 'L37'）；
 *                           头部入水自动切 dry+'_uw' 变体（需关卡自行注册）
 *
 * 切关清理：本文件在加载时给 BR.World.build 加一次性包装，
 * 每次建关前先 BR.Swim.reset()，防止 underwater class / fog / 减速残留到下一关。
 * （Systems A 接管转场后，可改为在 BR.Cutout.travel 里调 BR.Swim.reset()，
 *  届时删掉本包装即可——reset 本身保持可用。）
 * ============================================================ */
(function () {
  var BR = window.BR;

  /* ---------------- 贴图（放 lv 侧，保持 gen_l37.js 纯逻辑） ---------------- */
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 白瓷砖墙面：亮白底 + 浅灰砖缝 + 每块砖轻微明暗
  BR.Textures.registerTex('pool_tile', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#edf2f3'; x.fillRect(0, 0, w, h);
    var s = 64, i, j;
    for (i = 0; i < w; i += s) for (j = 0; j < h; j += s) {
      x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(i + 4, j + 4, s - 8, 10);
      x.fillStyle = 'rgba(120,150,160,0.07)'; x.fillRect(i + 4, j + s - 14, s - 8, 10);
    }
    x.strokeStyle = '#b7c8ce'; x.lineWidth = 4;
    for (i = 0; i <= w; i += s) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke(); }
    for (j = 0; j <= h; j += s) { x.beginPath(); x.moveTo(0, j + 0.5); x.lineTo(w, j + 0.5); x.stroke(); }
    return c;
  });

  // 池底瓷砖：浅青底 + 砖缝（深水区会被半透明深色层压暗）
  BR.Textures.registerTex('pool_floor', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#d5e9ec'; x.fillRect(0, 0, w, h);
    var s = 64, i, j;
    x.strokeStyle = '#a9c6cc'; x.lineWidth = 4;
    for (i = 0; i <= w; i += s) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke(); }
    for (j = 0; j <= h; j += s) { x.beginPath(); x.moveTo(0, j + 0.5); x.lineTo(w, j + 0.5); x.stroke(); }
    for (i = 0; i < w; i += s) for (j = 0; j < h; j += s) {
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(i + 4, j + 4, s - 8, 8);
    }
    return c;
  });

  // 明亮天花板：米白面板 + 细缝
  BR.Textures.registerTex('pool_ceil', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#f4f7f7'; x.fillRect(0, 0, w, h);
    var s = 128, i;
    x.strokeStyle = '#cfdbdd'; x.lineWidth = 3;
    for (i = 0; i <= w; i += s) { x.beginPath(); x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, h); x.stroke(); }
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(0, 0, w, 20);
    return c;
  });

  // 水面：透明底 + 浅蓝波纹（MeshBasicMaterial transparent 使用）
  BR.Textures.registerTex('pool_water', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(150,210,228,0.55)'; x.fillRect(0, 0, w, h);
    var i;
    for (i = 0; i < 26; i++) {
      var y = (i * 47) % h;
      x.strokeStyle = i % 2 ? 'rgba(255,255,255,0.30)' : 'rgba(90,170,200,0.30)';
      x.lineWidth = 2 + (i % 3);
      x.beginPath();
      x.moveTo(0, y);
      x.bezierCurveTo(w * 0.3, y - 9, w * 0.6, y + 9, w, y - 4);
      x.stroke();
    }
    return c;
  });
  BR.Textures.registerWallTex('L37', 'pool_tile');

  /* ---------------- 环境音 ---------------- */
  // L37：水声 + 空旷混响（缓慢起伏的带通噪声 + 低频空间感）
  BR.Audio.registerAmbient('L37', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), bp = R.filter('bandpass', 1400, 0.8), ng = R.gain(0.22);
      n.connect(bp); bp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.4), lg = R.gain(0.10);
      lfo.connect(lg); lg.connect(ng.gain); // 水声起伏
      var o = R.osc('sine', 90), og = R.gain(0.30);
      o.connect(og); og.connect(R.group);
      var lfo2 = R.osc('sine', 0.07), lg2 = R.gain(0.12);
      lfo2.connect(lg2); lg2.connect(og.gain); // 空旷呼吸
    });
    rig.target = 0.34;
    return rig;
  });
  // L37_uw：水下闷声变体（BR.Swim 头部入水时切换，命名约定 dry+'_uw'）
  BR.Audio.registerAmbient('L37_uw', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), lp = R.filter('lowpass', 380, 0.7), ng = R.gain(0.5);
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
    });
    rig.target = 0.5;
    return rig;
  });

  /* ================= BR.Swim 共享游泳模块 ================= */
  var WADE_Y = 0.55;   // 浅水水面世界高度（涉水，镜头在水上）
  var SWIM_Y = 1.85;   // 深水水面世界高度（站立镜头 1.62 < 水面 → 头部在水下）
  var DEEP_LINE = 1.0; // depth >= 此值视为深水

  BR.Swim = {
    zones: [],
    speedMul: 1,
    breath: 100,
    inWater: false,
    headUnder: false,
    _dryAmb: null,
    _fogSaved: null,
    _drownT: 0,
    _wasIn: false,
    _wasHead: false,

    waterYFor: function (depth) { return depth >= DEEP_LINE ? SWIM_Y : WADE_Y; },

    // 注册一片水域（对象形式，L7 与 L37 通用）：
    //   { kind:'ocean'|'pool'|'deep',
    //     cx,cz,r（圆形）或 x0,z0,x1,z1（矩形），
    //     depth, waterY, holes:[{x0,z0,x1,z1}]（干区洞，洞内不算水） }
    registerZone: function (zone) {
      var z = {
        kind: zone.kind || 'pool',
        depth: zone.depth == null ? 0.7 : zone.depth,
        waterY: zone.waterY,
        holes: zone.holes || []
      };
      if (zone.x0 != null && zone.z0 != null && zone.x1 != null && zone.z1 != null) {
        z.x0 = Math.min(zone.x0, zone.x1); z.z0 = Math.min(zone.z0, zone.z1);
        z.x1 = Math.max(zone.x0, zone.x1); z.z1 = Math.max(zone.z0, zone.z1);
      } else {
        z.cx = zone.cx; z.cz = zone.cz; z.r = zone.r || 0;
      }
      if (z.waterY == null) z.waterY = this.waterYFor(z.depth);
      this.zones.push(z);
      return z;
    },
    // 清空水域；同时复位移速与水下视觉（离开水关卡/切关时不残留）
    clearZones: function () {
      this.zones.length = 0;
      this.speedMul = 1;
      this.inWater = false;
      this.headUnder = false;
      if (typeof document !== 'undefined') {
        document.body.classList.remove('underwater');
        var wrap = document.getElementById('breath-wrap');
        if (wrap) wrap.classList.remove('need');
      }
    },

    _inRect: function (x, z, r) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; },

    zoneAt: function (x, z) {
      for (var i = 0; i < this.zones.length; i++) {
        var zn = this.zones[i];
        var inside;
        if (zn.x0 != null) inside = this._inRect(x, z, zn);
        else { var dx = x - zn.cx, dz = z - zn.cz; inside = dx * dx + dz * dz <= zn.r * zn.r; }
        if (!inside) continue;
        // 干区洞：洞内不算水，继续找其它水域
        var dry = false;
        for (var h = 0; h < zn.holes.length; h++) {
          if (this._inRect(x, z, zn.holes[h])) { dry = true; break; }
        }
        if (!dry) return zn;
      }
      return null;
    },

    isSwimming: function () { return this.headUnder; },
    isWading: function () { return this.inWater && !this.headUnder; },

    reset: function () {
      this.zones.length = 0;
      this.speedMul = 1;
      this.breath = 100;
      this.inWater = false;
      this.headUnder = false;
      this._drownT = 0;
      this._wasIn = false;
      this._wasHead = false;
      if (typeof document !== 'undefined') {
        document.body.classList.remove('underwater');
        var wrap = document.getElementById('breath-wrap');
        if (wrap) wrap.classList.remove('need');
      }
      var W = BR.World;
      if (W && W.scene && W.scene.fog && this._fogSaved) {
        W.scene.fog.near = this._fogSaved.near;
        W.scene.fog.far = this._fogSaved.far;
        W.scene.fog.color.setHex(this._fogSaved.color);
        this._fogSaved = null;
      }
      if (this._dryAmb && BR.Audio && BR.Audio.setAmbient &&
          BR.Audio._ambientLevel === this._dryAmb + '_uw') {
        try { BR.Audio.setAmbient(this._dryAmb, 1.0); } catch (e) {}
      }
    },

    tick: function (dt) {
      var P = BR.Player, W = BR.World;
      if (!P || !W || !BR.Game || BR.Game.state !== 'playing') return;
      var zn = (P.pos && this.zones.length) ? this.zoneAt(P.pos.x, P.pos.z) : null;
      var inWater = !!zn;
      var camY = (P.camera && P.camera.position) ? P.camera.position.y : 1.62;
      var headUnder;
      if (!inWater) headUnder = false;
      else if (this.headUnder) headUnder = camY < zn.waterY + 0.08; // 滞后：抬头需高出水面才算出水
      else headUnder = camY < zn.waterY - 0.05;

      // 进出水 / 入潜音效
      if (BR.Audio && BR.Audio.splash) {
        if ((inWater && !this._wasIn) || (!inWater && this._wasIn) ||
            (headUnder && !this._wasHead)) {
          try { BR.Audio.splash(); } catch (e) {}
        }
      }
      this._wasIn = inWater;
      this._wasHead = headUnder;
      this.inWater = inWater;
      this.headUnder = headUnder;
      this.speedMul = inWater ? (headUnder ? 0.4 : 0.55) : 1;

      if (typeof document !== 'undefined') document.body.classList.toggle('underwater', headUnder);

      // 闭气：头部在水下 100→0 约 25s；归零后每 2s 扣 4hp；出水快速恢复
      if (headUnder) {
        this.breath = Math.max(0, this.breath - 4 * dt);
        if (this.breath <= 0) {
          this._drownT += dt;
          if (this._drownT >= 2) { this._drownT = 0; P.hurt(4, 'drown'); }
        } else this._drownT = 0;
      } else {
        this.breath = Math.min(100, this.breath + 50 * dt);
        this._drownT = 0;
      }
      if (typeof document !== 'undefined') {
        var wrap = document.getElementById('breath-wrap');
        var fill = document.getElementById('breath-fill');
        if (wrap) wrap.classList.toggle('need', headUnder);
        if (fill) fill.style.width = this.breath.toFixed(1) + '%';
      }

      // 水下视线：fog 拉近；出水恢复
      var fog = W.scene && W.scene.fog;
      if (fog) {
        if (headUnder && !this._fogSaved) {
          this._fogSaved = { near: fog.near, far: fog.far, color: fog.color.getHex() };
          fog.near = 0.5; fog.far = 13; fog.color.setHex(0x0e3d52);
        } else if (!headUnder && this._fogSaved) {
          fog.near = this._fogSaved.near;
          fog.far = this._fogSaved.far;
          fog.color.setHex(this._fogSaved.color);
          this._fogSaved = null;
        }
      }

      // 水下环境音变体（关卡在 onEnter 设 _dryAmb；变体名固定 dry+'_uw'，需关卡注册）
      if (this._dryAmb && BR.Audio && BR.Audio.setAmbient) {
        var want = headUnder ? this._dryAmb + '_uw' : this._dryAmb;
        var ext = BR.Audio._extAmbient || {};
        if (ext[want] && BR.Audio._ambientLevel !== want) {
          try { BR.Audio.setAmbient(want, 1.2); } catch (e) {}
        }
      }
    }
  };

  // 切关前重置游泳状态（每关加载必经 BR.World.build）
  (function hookSwimReset() {
    var W = BR.World;
    if (W && W.build && !W._swimResetHooked) {
      W._swimResetHooked = true;
      var _build = W.build;
      W.build = function (map, saved) {
        try { BR.Swim.reset(); } catch (e) {}
        return _build.call(this, map, saved);
      };
    }
  })();

  /* ================= Level 37 内容 ================= */
  function travelTo(level, kind) {
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
      BR.Cutout.travel(level, { kind: kind });
    } else {
      // Systems A 的 cutout.js 尚未落地时的兜底
      if (BR.log) BR.log('[L37] BR.Cutout 未就绪，走 gotoLevel 兜底: ' + level);
      BR.Game.gotoLevel(level, {});
    }
  }

  function buildPool(W, p) {
    var d = p.data || {};
    var depth = (d.depth == null) ? 0.7 : d.depth;
    var rw = d.rw || 5, rh = d.rh || 5;
    // 精确房间中心（placer 已算好），回退到 POI tile 中心
    var cx = (d.wcx != null) ? d.wcx : BR.tileCX(p.tx);
    var cz = (d.wcz != null) ? d.wcz : BR.tileCZ(p.ty);
    var w = rw * BR.TILE, h = rh * BR.TILE;
    var wy = BR.Swim.waterYFor(depth);
    // 矩形水域（对象形式契约），与水面平面 (w-0.4)x(h-0.4) 对齐
    BR.Swim.registerZone({
      kind: depth >= 1.0 ? 'deep' : 'pool',
      x0: cx - w / 2 + 0.3, z0: cz - h / 2 + 0.3,
      x1: cx + w / 2 - 0.3, z1: cz + h / 2 - 0.3,
      depth: depth, waterY: wy
    });
    W.addChunkContent(p.tx, p.ty, function (group) {
      var wm = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 0.4, h - 0.4),
        new THREE.MeshBasicMaterial({
          map: BR.Textures.get('pool_water'),
          transparent: true, opacity: 0.68, color: 0xd8f0f8,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      wm.rotation.x = -Math.PI / 2;
      wm.position.set(cx, wy, cz);
      W.reg(group, wm);
      if (depth >= 1.0) {
        // 深水：半透明深色底层，显得更深
        var dm = new THREE.Mesh(
          new THREE.PlaneGeometry(w - 0.4, h - 0.4),
          new THREE.MeshBasicMaterial({ color: 0x0d3a52, transparent: true, opacity: 0.35, depthWrite: false })
        );
        dm.rotation.x = -Math.PI / 2;
        dm.position.set(cx, 0.04, cz);
        W.reg(group, dm);
      }
    });
  }

  function buildArchway(W, p) {
    var x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
    var marksTunnel = !!(p.data && p.data.tunnel);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      var white = new THREE.MeshLambertMaterial({ color: 0xf4f8f9 });
      var pg = new THREE.BoxGeometry(0.5, 2.9, 0.5);
      var p1 = new THREE.Mesh(pg, white); p1.position.set(-1.5, 1.45, 0);
      var p2 = new THREE.Mesh(pg, white); p2.position.set(1.5, 1.45, 0);
      // 标记水下通道的拱洞横梁是青色的——观察水深/拱洞标记找路
      var beam = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.5, 0.7),
        marksTunnel ? new THREE.MeshBasicMaterial({ color: 0x7fd4e8 }) : white
      );
      beam.position.set(0, 3.0, 0);
      g.add(p1); g.add(p2); g.add(beam);
      g.position.set(x, 0, z);
      W.reg(group, g);
    });
  }

  function buildTunnel(W, p) {
    var d = p.data || {};
    var depth = (d.depth == null) ? 1.8 : d.depth;
    var wy = BR.Swim.waterYFor(depth);
    var x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
    var ry = Math.max(0.6, wy - 0.75); // 没入水下
    W.addChunkContent(p.tx, p.ty, function (group) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.13, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0x54d8f0, transparent: true, opacity: 0.9 })
      );
      ring.position.set(x, ry, z);
      W.reg(group, ring);
      var disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 24),
        new THREE.MeshBasicMaterial({ color: 0x0a4a66, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
      );
      disc.position.set(x, ry, z);
      W.reg(group, disc);
      W.addInteractable({
        id: 'tunnel_' + p.tx + '_' + p.ty,
        kind: 'pool_exit',
        chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [ring, disc],
        pos: new THREE.Vector3(x, ry, z),
        radius: 3.2,
        prompt: function () { return BR.Swim.headUnder ? '潜入水下通道' : '水下通道（潜入水中才能进入）'; },
        canUse: function () { return BR.Swim.headUnder; },
        use: function () { travelTo('L7', 'water'); }
      });
    });
  }

  function buildDeepZone(W, p) {
    var d = p.data || {};
    var depth = (d.depth == null) ? 1.8 : d.depth;
    var wy = BR.Swim.waterYFor(depth);
    var x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var buoy = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xff5a3c })
      );
      buoy.position.set(x, wy + 0.15, z);
      W.reg(group, buoy);
      var pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, wy, 8),
        new THREE.MeshLambertMaterial({ color: 0xd8dee0 })
      );
      pole.position.set(x, wy / 2, z);
      W.reg(group, pole);
      W.addInteractable({
        id: 'deepzone_' + p.tx + '_' + p.ty,
        kind: 'inspect',
        chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [buoy],
        pos: new THREE.Vector3(x, wy + 0.2, z),
        radius: 3.0,
        prompt: function () { return '查看水深标记'; },
        canUse: function () { return true; },
        use: function () {
          BR.UI.toast('水深约 ' + depth.toFixed(1) + ' 米。潜水注意闭气，憋不住就上浮。', 3500);
        }
      });
    });
  }

  function buildShallowExit(W, p) {
    var x = BR.tileCX(p.tx), z = BR.tileCZ(p.ty);
    W.addChunkContent(p.tx, p.ty, function (group) {
      var g = new THREE.Group();
      var mat = new THREE.MeshLambertMaterial({ color: 0xe8eef0 });
      var s;
      for (s = 0; s < 3; s++) {
        var st = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.5), mat);
        st.position.set(0, 0.09 + s * 0.18, -0.5 + s * 0.5);
        g.add(st);
      }
      var pl = new THREE.BoxGeometry(0.3, 1.9, 0.4);
      var q1 = new THREE.Mesh(pl, mat); q1.position.set(-1.0, 0.95, 0.6);
      var q2 = new THREE.Mesh(pl, mat); q2.position.set(1.0, 0.95, 0.6);
      var beam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.35, 0.5), mat);
      beam.position.set(0, 1.95, 0.6);
      g.add(q1); g.add(q2); g.add(beam);
      g.position.set(x, 0, z);
      W.reg(group, g);
      W.addInteractable({
        id: 'shallowexit_' + p.tx + '_' + p.ty,
        kind: 'pool_exit',
        chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: g.children.slice(),
        pos: new THREE.Vector3(x, 1.2, z),
        radius: 3.2,
        prompt: function () { return '爬出浅水区，离开泳池房'; },
        canUse: function () { return true; },
        use: function () { travelTo('L0', 'walk'); }
      });
    });
  }

  BR.Levels.L37 = {
    name: 'Level 37 ——「泳池房」',
    theme: {
      bg: 0xd7e6ec, fogNear: 12, fogFar: 60, ambient: 0xf2f7f9, ambInt: 0.9,
      sky: 0xeaf3f6, ground: 0xa9c6d2, light: 0xffffff, lightInt: 0.55,
      wallH: 3.2, wall: 'pool_tile', floor: 'pool_floor', ceil: 'pool_ceil',
      surface: 'tile', fixtureEvery: 5, hum: 0
    },

    buildContent: function (map, W) {
      BR.Swim.clearZones();
      var i, p;
      for (i = 0; i < map.pois.length; i++) {
        p = map.pois[i];
        if (p.type === 'pool') buildPool(W, p);
        else if (p.type === 'archway') buildArchway(W, p);
        else if (p.type === 'tunnel') buildTunnel(W, p);
        else if (p.type === 'deep_zone') buildDeepZone(W, p);
        else if (p.type === 'shallow_exit') buildShallowExit(W, p);
      }
      // 无意义台阶：纯装饰，种子确定（先算好位置再注册，避免重建时 rng 漂移）
      var srng = new BR.RNG(BR.hashSeed(map.seed + ':l37steps'));
      var steps = [];
      for (var ri = 1; ri < map.rooms.length && steps.length < 3; ri++) {
        var rr = map.rooms[ri];
        if (rr.tag === 'pool_deep' || rr.tag === 'pool_shallow') continue;
        if (srng.next() < 0.5) continue;
        steps.push({
          tx: rr.x + 1 + Math.floor(srng.next() * Math.max(1, rr.w - 2)),
          ty: rr.y + 1 + Math.floor(srng.next() * Math.max(1, rr.h - 2)),
          rot: Math.floor(srng.next() * 4) * Math.PI / 2
        });
      }
      steps.forEach(function (sp) {
        W.addChunkContent(sp.tx, sp.ty, function (group) {
          var g = new THREE.Group();
          var m = new THREE.MeshLambertMaterial({ color: 0xe4ebec });
          for (var s2 = 0; s2 < 3; s2++) {
            var st2 = new THREE.Mesh(new THREE.BoxGeometry(1.4 - s2 * 0.35, 0.16, 1.0), m);
            st2.position.set(0, 0.08 + s2 * 0.16, s2 * 0.28);
            g.add(st2);
          }
          g.position.set(BR.tileCX(sp.tx), 0, BR.tileCZ(sp.ty));
          g.rotation.y = sp.rot;
          W.reg(group, g);
        });
      });

      W.objective = '观察水深：深水区藏着水下通道，浅水区有离开的出口';
    },

    onEnter: function () {
      BR.Swim._dryAmb = 'L37';
      BR.UI.setObjective(BR.World.objective || '在泳池房里找到离开的方法');
      if (BR.Audio && BR.Audio.setAmbient) BR.Audio.setAmbient('L37');
    },

    tick: function (dt) { BR.Swim.tick(dt); }
  };
})();
