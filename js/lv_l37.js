/* ============================================================
 * Level 37「泳池房」—— 关卡内容 + 共享游泳模块 BR.Swim
 * 独立 IIFE：只用 BR.*，不改动其它文件本体。
 *
 * v1.4 D 路重做：
 *   - 水体几何：全关统一水面 SURF=0.5（BR.Gen.L37SURF），深浅由池底几何形成
 *     （浅滩 0 / 泳池坑 -1.2 / 深水坑 -2.2 / 缓坡 / 台阶段），视觉与碰撞一致；
 *   - 坑 tile=2：buildContent 里全部 W.skipWall()，自建池底/池壁/顶面/台阶；
 *   - 瓷柱阵 tile=0：skipWall + 自建细柱（真实碰撞，同 L1 车库柱先例）；
 *   - 水面按 chunk 裁剪铺设（跨区块连续、无接缝消失）；
 *   - 对 E 路接口（本文件末尾绑定）：
 *       BR.Levels.L37.waterAt(x, z) -> null | {surface, floor, depth}
 *       BR.Levels.L37.isWater(x, z) -> bool
 *     纯逻辑在 gen_l37.js（BR.Gen.L37waterAt，Node 可测）。
 *
 * BR.Swim（供 L7 复用，保持 v1.3 API 不变）：
 *   BR.Swim.zones              水域数组（世界坐标），元素见 registerZone
 *   BR.Swim.registerZone(zone) 注册一片水域
 *   BR.Swim.clearZones()       清空水域，并复位 speedMul=1、移除 underwater 类
 *   BR.Swim.zoneAt(x,z)        查玩家所在水域
 *   BR.Swim.waterYFor(depth)   按水深算水面世界高度（L7 旧契约保留）
 *   BR.Swim.speedMul / inWater / headUnder / isSwimming() / isWading()
 *   BR.Swim.breath             0~100 闭气
 *   BR.Swim.tick(dt) / reset() / _dryAmb（关卡在 onEnter 里设环境音名）
 * ============================================================ */
(function () {
  var BR = window.BR;
  var TILE = BR.TILE; // 3（米）
  var SURF = (BR.Gen && BR.Gen.L37SURF) || 0.5; // 全关统一水面高度（gen_l37.js 定义；缺省 0.5 兜底旧测试 stub）
  var CH = BR.CHUNK || 8;

  /* ---------------- 贴图（放 lv 侧，保持 gen_l37.js 纯逻辑） ---------------- */
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 白瓷砖墙面：亮白底 + 浅灰砖缝
  // v1.5 W5：按世界尺度铺设 —— 256px 画 12x12 块 = 每块 25cm（3m tile / 12），
  // 砖缝严格对齐网格，无随机错位、无涂脏（整齐瓷砖保持整齐）。
  BR.Textures.registerTex('pool_tile', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#e9f0f1'; x.fillRect(0, 0, w, h);
    var n = 12, s = w / n, i, j;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      x.fillStyle = 'rgba(255,255,255,0.14)';
      x.fillRect(i * s + 1, j * s + 1, s - 2, 2); // 上缘高光
      x.fillStyle = 'rgba(130,160,170,0.08)';
      x.fillRect(i * s + 1, j * s + s - 3, s - 2, 2); // 下缘暗部
    }
    x.strokeStyle = '#b3c6cc'; x.lineWidth = 2;
    for (i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo(i * s + 0.5, 0); x.lineTo(i * s + 0.5, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * s + 0.5); x.lineTo(w, i * s + 0.5); x.stroke();
    }
    return c;
  });

  // 池底瓷砖：浅青底 + 砖缝（深水区会被半透明深色层压暗）
  BR.Textures.registerTex('pool_floor', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#d3e8eb'; x.fillRect(0, 0, w, h);
    var n = 12, s = w / n, i, j;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      x.fillStyle = 'rgba(255,255,255,0.16)';
      x.fillRect(i * s + 1, j * s + 1, s - 2, 2);
      x.fillStyle = 'rgba(110,150,160,0.08)';
      x.fillRect(i * s + 1, j * s + s - 3, s - 2, 2);
    }
    x.strokeStyle = '#a4c3ca'; x.lineWidth = 2;
    for (i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo(i * s + 0.5, 0); x.lineTo(i * s + 0.5, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * s + 0.5); x.lineTo(w, i * s + 0.5); x.stroke();
    }
    return c;
  });

  // 池沿蓝小砖：局部池沿压边（~15cm 小砖，20x20 / tile）
  BR.Textures.registerTex('pool_trim', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#2b8ab5'; x.fillRect(0, 0, w, h);
    var n = 20, s = w / n, i, j;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      x.fillStyle = 'rgba(255,255,255,0.13)';
      x.fillRect(i * s + 1, j * s + 1, s - 2, 2);
      x.fillStyle = 'rgba(0,45,70,0.16)';
      x.fillRect(i * s + 1, j * s + s - 3, s - 2, 2);
    }
    x.strokeStyle = '#0e4e68'; x.lineWidth = 2;
    for (i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo(i * s + 0.5, 0); x.lineTo(i * s + 0.5, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * s + 0.5); x.lineTo(w, i * s + 0.5); x.stroke();
    }
    return c;
  });

  // 柱面马赛克：米黄小方砖（参考图1柱子）；轻微确定性色差，保持整齐
  BR.Textures.registerTex('pool_mosaic', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#cdbb96'; x.fillRect(0, 0, w, h);
    var n = 32, s = w / n, i, j;
    var seed = 0x105a;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var v = 196 + Math.floor(rnd() * 26); // 196..221 米黄
      x.fillStyle = 'rgb(' + v + ',' + (v - 24) + ',' + (v - 66) + ')';
      x.fillRect(i * s + 1, j * s + 1, s - 2, s - 2);
      x.fillStyle = 'rgba(255,255,255,0.10)';
      x.fillRect(i * s + 1, j * s + 1, s - 2, 2);
    }
    x.strokeStyle = '#a8946f'; x.lineWidth = 2;
    for (i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo(i * s + 0.5, 0); x.lineTo(i * s + 0.5, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * s + 0.5); x.lineTo(w, i * s + 0.5); x.stroke();
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

  // 水面：蓝绿底 + 白色不规则波纹亮带（参考图3样式：风吹水面的横向亮带）
  // 确定性伪随机（LCG，贴图稳定）；整数周期正弦保证横向无缝，
  // 纵向边缘淡出保证纵向无缝（水面按 chunk 逐块铺设）。
  BR.Textures.registerTex('pool_water', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    var seed = 0x37a5;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    // 蓝绿底
    var grd = x.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(52,148,160,0.88)');
    grd.addColorStop(1, 'rgba(38,124,142,0.88)');
    x.fillStyle = grd; x.fillRect(0, 0, w, h);
    // 主波纹亮带：横向不规则白色亮带（y(x) 用整数周期正弦 → 横向无缝）
    var bi;
    for (bi = 0; bi < 12; bi++) {
      var y0 = (bi + 0.5) * h / 12 + (rnd() - 0.5) * h / 14;
      var amp = 4 + rnd() * 9;
      var k = 2 + Math.floor(rnd() * 3); // 整数周期
      var ph = rnd() * 6.2832;
      var thick = 3 + rnd() * 8;
      var alpha = 0.30 + rnd() * 0.32;
      x.strokeStyle = 'rgba(238,252,255,' + alpha.toFixed(2) + ')';
      x.lineWidth = thick; x.lineCap = 'round';
      x.beginPath();
      var px;
      for (px = -8; px <= w + 8; px += 6) {
        var py = y0 + amp * Math.sin(6.2832 * k * px / w + ph);
        if (px === -8) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
      // 亮带上缘高光（更白更细）
      x.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.55).toFixed(2) + ')';
      x.lineWidth = Math.max(1.5, thick * 0.32);
      x.beginPath();
      for (px = -8; px <= w + 8; px += 6) {
        var py2 = y0 - thick * 0.30 + amp * 0.9 * Math.sin(6.2832 * k * px / w + ph + 0.6);
        if (px === -8) x.moveTo(px, py2); else x.lineTo(px, py2);
      }
      x.stroke();
    }
    // 细碎小波纹（短横向亮划线）
    var fi;
    for (fi = 0; fi < 36; fi++) {
      var sx = rnd() * w, sy = rnd() * h, sl = 10 + rnd() * 30;
      x.strokeStyle = 'rgba(242,252,255,' + (0.16 + rnd() * 0.24).toFixed(2) + ')';
      x.lineWidth = 1.5 + rnd() * 1.5; x.lineCap = 'round';
      x.beginPath(); x.moveTo(sx, sy);
      x.quadraticCurveTo(sx + sl / 2, sy + (rnd() - 0.5) * 7, sx + sl, sy + (rnd() - 0.5) * 5);
      x.stroke();
    }
    // 纵向边缘淡出 → 纵向无缝
    x.globalCompositeOperation = 'destination-in';
    var fm = x.createLinearGradient(0, 0, 0, h);
    fm.addColorStop(0, 'rgba(0,0,0,0)');
    fm.addColorStop(0.10, 'rgba(0,0,0,1)');
    fm.addColorStop(0.90, 'rgba(0,0,0,1)');
    fm.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = fm; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
    return c;
  });
  // 水下焦散：亮青白色网状光斑（透明底，加色混合叠在水面/池底上）
  // 确定性 LCG；9 宫格绘制保证无缝平铺；UV 滚动产生波光流动感。
  BR.Textures.registerTex('caustics', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    var seed = 0xc057;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var i, ox, oy;
    // 网状亮线：多组相交的亮弧
    for (i = 0; i < 26; i++) {
      var cx = rnd() * w, cy = rnd() * h, r = 18 + rnd() * 46;
      var a0 = rnd() * 6.2832, a1 = a0 + 1.2 + rnd() * 2.4;
      var lw = 2 + rnd() * 3.5, al = 0.25 + rnd() * 0.35;
      for (ox = -1; ox <= 1; ox++) for (oy = -1; oy <= 1; oy++) {
        x.strokeStyle = 'rgba(210,245,255,' + al.toFixed(2) + ')';
        x.lineWidth = lw; x.lineCap = 'round';
        x.beginPath();
        x.arc(cx + ox * w, cy + oy * h, r, a0, a1);
        x.stroke();
        x.strokeStyle = 'rgba(255,255,255,' + (al * 0.6).toFixed(2) + ')';
        x.lineWidth = Math.max(1, lw * 0.4);
        x.beginPath();
        x.arc(cx + ox * w, cy + oy * h, r * 0.97, a0 + 0.1, a1 - 0.1);
        x.stroke();
      }
    }
    // 细碎亮点
    for (i = 0; i < 40; i++) {
      var px = rnd() * w, py = rnd() * h, pr = 1 + rnd() * 2.5;
      for (ox = -1; ox <= 1; ox++) for (oy = -1; oy <= 1; oy++) {
        x.fillStyle = 'rgba(225,248,255,' + (0.20 + rnd() * 0.30).toFixed(2) + ')';
        x.beginPath(); x.arc(px + ox * w, py + oy * h, pr, 0, 6.2832); x.fill();
      }
    }
    return c;
  });
  // 湿脚印：透明底 + 深色湿鞋底印（一只脚，左右脚靠镜像区分）
  BR.Textures.registerTex('wet_footprint', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(25,45,58,0.60)';
    x.strokeStyle = 'rgba(25,45,58,0.35)';
    // 前脚掌：圆角矩形
    x.beginPath();
    if (x.roundRect) x.roundRect(w * 0.32, h * 0.08, w * 0.36, h * 0.42, 14);
    else x.rect(w * 0.32, h * 0.08, w * 0.36, h * 0.42);
    x.fill();
    // 脚后跟：小椭圆
    x.beginPath(); x.ellipse(w * 0.5, h * 0.72, w * 0.13, h * 0.14, 0, 0, 6.2832); x.fill();
    // 脚趾：5 个小点
    var ti;
    for (ti = 0; ti < 5; ti++) {
      x.beginPath();
      x.arc(w * (0.34 + ti * 0.08), h * 0.045, w * 0.028, 0, 6.2832);
      x.fill();
    }
    // 湿痕边缘晕染
    x.lineWidth = 6;
    x.beginPath();
    if (x.roundRect) x.roundRect(w * 0.30, h * 0.06, w * 0.40, h * 0.46, 16);
    else x.rect(w * 0.30, h * 0.06, w * 0.40, h * 0.46);
    x.stroke();
    return c;
  });
  BR.Textures.registerWallTex('L37', 'pool_tile');

  /* ---------------- 环境音 ---------------- */
  // 混响脉冲缓存（池厅长回响用；各关卡 builder 共享此约定）
  if (BR.Audio && !BR.Audio._impulse) {
    BR.Audio._impulse = function (dur, decay) {
      var key = '_impBuf_' + dur + '_' + decay;
      if (this[key]) return this[key];
      var ctx = this._ctx, rate = ctx.sampleRate, len = Math.floor(rate * dur);
      var buf = ctx.createBuffer(2, len, rate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        for (var i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
      }
      this[key] = buf;
      return buf;
    };
  }
  // L37：水声 + 空旷混响（缓慢起伏的带通噪声 + 低频空间感）
  // v1.5 W5：水声分一路进 2.4s 卷积混响 = 池厅长回响。
  //   [本游戏改编] 原著称 Level 37"声音被严重改变（急速衰减、无回声）、绝对寂静"；
  //   长回响是为可玩性（大空间感）做的改编，见 LORE.md。
  BR.Audio.registerAmbient('L37', function () {
    var self = this;
    var rig = this._loopRig(function (R) {
      var n = R.noise(), bp = R.filter('bandpass', 1400, 0.8), ng = R.gain(0.22);
      n.connect(bp); bp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.4), lg = R.gain(0.10);
      lfo.connect(lg); lg.connect(ng.gain); // 水声起伏
      var o = R.osc('sine', 90), og = R.gain(0.30);
      o.connect(og); og.connect(R.group);
      var lfo2 = R.osc('sine', 0.07), lg2 = R.gain(0.12);
      lfo2.connect(lg2); lg2.connect(og.gain); // 空旷呼吸
      try { // 池厅长回响：水声 → 卷积（2.4s 衰减）→ 湿声进总线
        var conv = self._ctx.createConvolver();
        conv.buffer = self._impulse(2.4, 2.0);
        var wet = R.gain(0.55);
        ng.connect(conv); conv.connect(wet); wet.connect(R.group);
      } catch (e) {}
    });
    rig.target = 0.34;
    return rig;
  });
  // L37_channel：水道集中版 —— 窄带水声 + 短混响（0.9s），更聚焦、少空间感
  BR.Audio.registerAmbient('L37_channel', function () {
    var self = this;
    var rig = this._loopRig(function (R) {
      var n = R.noise(), bp = R.filter('bandpass', 900, 1.6), ng = R.gain(0.26);
      n.connect(bp); bp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.5), lg = R.gain(0.12);
      lfo.connect(lg); lg.connect(ng.gain);
      try {
        var conv = self._ctx.createConvolver();
        conv.buffer = self._impulse(0.9, 2.6);
        var wet = R.gain(0.35);
        ng.connect(conv); conv.connect(wet); wet.connect(R.group);
      } catch (e) {}
    });
    rig.target = 0.30;
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
  // L37_channel_uw：水道水下变体
  BR.Audio.registerAmbient('L37_channel_uw', function () {
    var rig = this._loopRig(function (R) {
      var n = R.noise(), lp = R.filter('lowpass', 320, 0.7), ng = R.gain(0.5);
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
    });
    rig.target = 0.5;
    return rig;
  });

  /* ---- v1.5 W5：入水 / 出水 / 游泳划水 / 上岸 —— 四种不同声音 ----
   * 基于 BR.Audio._nz / _tone 合成（audio.js 公开的合成原语），全部带 ended 断开，
   * 无节点泄漏。BR.Swim.tick 的通用 splash 保留作为基底，这里叠加区分层。 */
  function l37Verb(dur) { // 一次性混响发送（用后定时断开，不常驻）
    var A = BR.Audio;
    if (!A || !A._ok || !A._ctx) return null;
    try {
      var ctx = A._ctx;
      var conv = ctx.createConvolver();
      conv.buffer = A._impulse(2.2, 2.4);
      var g = ctx.createGain(); g.gain.value = 0.55;
      conv.connect(g); g.connect(A._sfx);
      setTimeout(function () { try { conv.disconnect(); g.disconnect(); } catch (e) {} },
        Math.max(1000, (dur + 2.5) * 1000));
      return conv;
    } catch (e) { return null; }
  }
  BR.Audio.l37WaterEnter = function () { // 入水：大水花 + 低频闷响 + 混响尾
    if (!this._ok) return;
    this._nz({ f: 2600, f1: 300, ft: 'lowpass', dur: 0.7, vol: 0.5, a: 0.02, dest: l37Verb(0.7) || undefined });
    this._tone({ f: 120, f1: 55, type: 'sine', dur: 0.45, vol: 0.32 });
  };
  BR.Audio.l37WaterExit = function () { // 出水：轻水花 + 水滴上滑音
    if (!this._ok) return;
    this._nz({ f: 1800, f1: 900, ft: 'bandpass', q: 1.5, dur: 0.35, vol: 0.28, a: 0.02 });
    this._tone({ f: 900, f1: 1500, type: 'sine', dur: 0.12, vol: 0.10, at: 0.06 });
    this._tone({ f: 1200, f1: 1900, type: 'sine', dur: 0.10, vol: 0.07, at: 0.16 });
  };
  BR.Audio.l37SwimStroke = function () { // 游泳划水：柔和带通噪声
    if (!this._ok) return;
    this._nz({ f: 700, ft: 'bandpass', q: 0.8, dur: 0.45, vol: 0.15, a: 0.08 });
  };
  BR.Audio.l37ClimbOut = function () { // 上岸：蹭地 + 抖水
    if (!this._ok) return;
    this._tone({ f: 190, f1: 120, type: 'triangle', dur: 0.16, vol: 0.20 });
    this._nz({ f: 1200, f1: 500, ft: 'bandpass', q: 1.0, dur: 0.30, vol: 0.24, a: 0.03, at: 0.05 });
    this._tone({ f: 1500, f1: 900, type: 'sine', dur: 0.10, vol: 0.09, at: 0.18 });
  };

  /* ================= BR.Swim 共享游泳模块（v1.3 原样保留，L7 依赖） ================= */
  var WADE_Y = 0.55;   // 旧浅水水面（waterYFor 契约保留，供 L7 用）
  var SWIM_Y = 1.85;   // 旧深水水面（waterYFor 契约保留，供 L7 用）
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
      this._sndIn = false;   // v1.5 W5：游泳声音状态机复位
      this._strokeT = 0;
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
      // v1.5 W8：消耗倍率 / 上限走玩家氧气接口（W9 氧气瓶调用 setOxygenGear）
      if (headUnder) {
        var drainMul = (P.oxygenDrainMul != null && P.oxygenDrainMul > 0) ? P.oxygenDrainMul : 1;
        this.breath = Math.max(0, this.breath - 4 * drainMul * dt);
        if (this.breath <= 0) {
          this._drownT += dt;
          if (this._drownT >= 2) { this._drownT = 0; P.hurt(4, 'drown'); }
        } else this._drownT = 0;
      } else {
        var omax = (P.oxygenMax != null && P.oxygenMax > 0) ? P.oxygenMax : 100;
        this.breath = Math.min(omax, this.breath + 50 * dt);
        this._drownT = 0;
      }
      if (typeof document !== 'undefined') {
        var wrap = document.getElementById('breath-wrap');
        var fill = document.getElementById('breath-fill');
        if (wrap) wrap.classList.toggle('need', headUnder);
        // v1.5 W8：呼吸条按氧气上限归一化（氧气瓶时上限>100，条不满溢）
        if (fill) {
          var omax2 = (P.oxygenMax != null && P.oxygenMax > 0) ? P.oxygenMax : 100;
          fill.style.width = Math.min(100, this.breath / omax2 * 100).toFixed(1) + '%';
        }
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

  /* ================= F1：L37 关卡特效状态（模块级，buildContent 内重置） ================= */
  var FX37 = {
    t: 0,
    board: null,   // 跳水台站立区 {x0,z0,x1,z1,topY,dirx,dirz}
    dive: null,    // 跳水动画 {t,dur,x0,z0,y0,dx,dz}
    parts: [],     // 水花粒子 [{m,vx,vy,vz,life,max,ring}]
    splashGeo: null,
    splashMat: null,
    caustTex: null // caustics 贴图（buildContent 缓存；_test_l37.html 里可能缺 gen_l7）
  };

  function splashAssets() {
    if (!FX37.splashGeo) {
      FX37.splashGeo = new THREE.PlaneGeometry(0.14, 0.14);
      FX37.splashMat = new THREE.SpriteMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.9, depthWrite: false });
    }
  }
  // 水花：16 粒 sprite + 1 个扩散水环，加到场景（非 chunk 钩子，无重复风险）
  function spawnSplash(W, x, y, z) {
    splashAssets();
    var i, a, sp;
    for (i = 0; i < 16; i++) {
      var m = new THREE.Sprite(FX37.splashMat);
      a = Math.random() * 6.2832; sp = 0.8 + Math.random() * 1.8;
      var life = 0.55 + Math.random() * 0.25;
      m.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
      m.scale.set(1, 1, 1);
      W.scene.add(m);
      FX37.parts.push({ m: m, vx: Math.cos(a) * sp, vy: 2.2 + Math.random() * 2.2, vz: Math.sin(a) * sp, life: life, max: life, ring: false });
    }
    var ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.05, z);
    W.scene.add(ring);
    FX37.parts.push({ m: ring, life: 0.6, max: 0.6, ring: true });
  }

  /* ================= v1.4：水体几何建造 ================= */
  // 关卡级共享材质（buildContent 创建，随 W._levelMats 在 dispose 释放；chunk 卸载不碰）
  function makeMats(W) {
    var M = {};
    M.water = new THREE.MeshBasicMaterial({
      map: BR.Textures.get('pool_water'),
      transparent: true, opacity: 0.8, color: 0x8fd0e0,
      side: THREE.DoubleSide, depthWrite: false
    });
    var caTex = BR.Textures.get('caustics'); // gen_l7 注册；_test_l37.html 里无则为 null
    FX37.caustTex = caTex || null;
    M.caust = caTex ? new THREE.MeshBasicMaterial({
      map: caTex, transparent: true, opacity: 0.30,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }) : null;
    M.pitWall = new THREE.MeshLambertMaterial({
      map: BR.Textures.get('pool_tile'), color: 0xdfe8ea, side: THREE.DoubleSide
    });
    M.deepShade = new THREE.MeshBasicMaterial({
      color: 0x0d3a52, transparent: true, opacity: 0.32, depthWrite: false
    });
    // v1.5 W5：柱面改用马赛克小砖（参考图1）；~5cm/块（0.8m 柱面 16 块）
    var mozTex = BR.Textures.get('pool_mosaic');
    if (mozTex) {
      mozTex.wrapS = mozTex.wrapT = THREE.RepeatWrapping;
      mozTex.repeat.set(0.5, 2);
    }
    M.pillar = new THREE.MeshLambertMaterial({
      map: mozTex || BR.Textures.get('pool_tile'), color: 0xf2ece0
    });
    // v1.5 W5 新增材质
    M.trim = new THREE.MeshLambertMaterial({ map: BR.Textures.get('pool_trim') }); // 池沿蓝小砖
    M.midShade = new THREE.MeshBasicMaterial({ // 较暗深水区中层 shade
      color: 0x0a2f44, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide
    });
    M.streak = new THREE.MeshBasicMaterial({ // 水面灯带倒影（参考图1/2：顶部灯带明亮倒影）
      color: 0xd8f2ff, transparent: true, opacity: 0.20,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    M.streakCol = new THREE.MeshBasicMaterial({ // 柱倒影
      color: 0xbfe0f5, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    M.lightBar = new THREE.MeshBasicMaterial({ color: 0xf2fbff }); // 天花板灯带
    W._levelMats = W._levelMats || [];
    W._levelMats.push(M.water);
    if (M.caust) W._levelMats.push(M.caust);
    W._levelMats.push(M.pitWall); W._levelMats.push(M.deepShade); W._levelMats.push(M.pillar);
    W._levelMats.push(M.trim); W._levelMats.push(M.midShade);
    W._levelMats.push(M.streak); W._levelMats.push(M.streakCol); W._levelMats.push(M.lightBar);
    return M;
  }

  // 对 tile 矩形按 chunk 切分：fn(ax, ay, ix0, iy0, ix1, iy1)
  // (ax,ay) 为 addChunkContent 锚点 tile，(ix0..ix1, iy0..iy1) 为本 chunk 内裁剪范围
  function eachChunkRect(tx0, ty0, tx1, ty1, fn) {
    var cx0 = Math.floor(tx0 / CH), cx1 = Math.floor(tx1 / CH);
    var cy0 = Math.floor(ty0 / CH), cy1 = Math.floor(ty1 / CH);
    for (var cx = cx0; cx <= cx1; cx++) for (var cy = cy0; cy <= cy1; cy++) {
      var ix0 = Math.max(tx0, cx * CH), ix1 = Math.min(tx1, cx * CH + CH - 1);
      var iy0 = Math.max(ty0, cy * CH), iy1 = Math.min(ty1, cy * CH + CH - 1);
      fn(ix0, iy0, ix0, iy0, ix1, iy1);
    }
  }
  function hPlane(w, h, mat, cx, y, cz, faceUp) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.rotation.x = faceUp ? -Math.PI / 2 : Math.PI / 2;
    m.position.set(cx, y, cz);
    return m;
  }

  // 水面：按 chunk 裁剪铺设（跨区块连续；相邻块边精确对齐，无缝隙）
  // v1.5 W5：deck 平台（floorY>0）上方不铺水面；另加灯带倒影与柱倒影（性能分档）。
  function buildWaterPlanes(W, L, M) {
    var deckPits = L.pits.filter(function (pt) { return pt.floorY > 0; });
    function inDeck(tx, ty) {
      for (var i = 0; i < deckPits.length; i++) {
        var d = deckPits[i];
        if (tx >= d.tx0 && tx <= d.tx1 && ty >= d.ty0 && ty <= d.ty1) return true;
      }
      return false;
    }
    // 水域矩形减去 deck：按行合并连续 run（tile 对齐，无缝）
    function runsOf(r) {
      var runs = [], ty, x, x1;
      for (ty = r.y0; ty <= r.y1; ty++) {
        x = r.x0;
        while (x <= r.x1) {
          if (inDeck(x, ty)) { x++; continue; }
          x1 = x;
          while (x1 + 1 <= r.x1 && !inDeck(x1 + 1, ty)) x1++;
          runs.push({ x0: x, y0: ty, x1: x1, y1: ty });
          x = x1 + 1;
        }
      }
      return runs;
    }
    var q = BR.QUALITY || {};
    var streakOn = !(q.maxLights && q.maxLights <= 3); // 低画质关倒影
    L.rects.forEach(function (r) {
      runsOf(r).forEach(function (run) {
        eachChunkRect(run.x0, run.y0, run.x1, run.y1, function (ax, ay, ix0, iy0, ix1, iy1) {
          W.addChunkContent(ix0, iy0, function (group) {
            var w = (ix1 - ix0 + 1) * TILE, h = (iy1 - iy0 + 1) * TILE;
            var cx = (ix0 + ix1 + 1) / 2 * TILE, cz = (iy0 + iy1 + 1) / 2 * TILE;
            W.reg(group, hPlane(w, h, M.water, cx, SURF, cz, true));
            if (M.caust) W.reg(group, hPlane(w, h, M.caust, cx, SURF + 0.02, cz, true));
            if (streakOn && M.streak) {
              // 灯带倒影：沿水面长轴的柔光带（与天花板灯带对应，有层次）
              var n = Math.max(1, Math.min(3, Math.round(Math.max(w, h) / 9)));
              for (var s = 0; s < n; s++) {
                var off = (s - (n - 1) / 2) * 2.4;
                var sm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.streak);
                var alongX = w >= h;
                sm.scale.set(alongX ? w * 0.9 : 1.6, alongX ? 1.6 : h * 0.9, 1);
                sm.rotation.x = -Math.PI / 2;
                sm.position.set(cx + (alongX ? 0 : off), SURF + 0.015, cz + (alongX ? off : 0));
                W.reg(group, sm);
              }
            }
          });
        });
      });
    });
    // 柱倒影：每根水边柱子一条柔光倒影（水面拉长，性能分档）
    if (streakOn && M.streak) {
      L.pillars.forEach(function (pt) {
        W.addChunkContent(pt[0], pt[1], function (group) {
          var m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.streakCol);
          m.rotation.x = -Math.PI / 2;
          m.scale.set(1.3, 5.0, 1);
          m.position.set(BR.tileCX(pt[0]), SURF + 0.015, BR.tileCZ(pt[1]) + 1.2);
          W.reg(group, m);
        });
      });
    }
    // 天花板灯带（倒影的光源本体）：泳池上方沿长轴的发光条
    L.pits.forEach(function (pit) {
      if (pit.floorY > 0 || pit.kind === 'dip') return;
      var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
      var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
      var len = Math.max(px1 - px0, pz1 - pz0) - 1;
      if (len < 2) return;
      var wallH = (W.theme && W.theme.wallH) || 3.2;
      var tx = Math.floor((pit.tx0 + pit.tx1) / 2), ty = Math.floor((pit.ty0 + pit.ty1) / 2);
      W.addChunkContent(tx, ty, function (group) {
        var alongX = (px1 - px0) >= (pz1 - pz0);
        var bar = new THREE.Mesh(
          new THREE.BoxGeometry(alongX ? len : 0.5, 0.08, alongX ? 0.5 : len),
          M.lightBar);
        bar.position.set((px0 + px1) / 2, wallH - 0.06, (pz0 + pz1) / 2);
        W.reg(group, bar);
      });
    });
  }

  // 坑：池底 / 池壁 / 顶面 / 台阶 / 缓坡 / 平台 / 蓝小砖池沿 / 扶梯（几何在 buildLadders）
  // v1.5 W5：steps 数组 + fromY（台阶可上可下：平台/分层）；deck（floorY>0）为高出水面的
  //   临水平台；pit.dark 渲染双层深度 shade（光线深度过渡）；与相邻坑共边时不立墙。
  function stepEdgesOf(pit) {
    var s = {};
    var steps = pit.steps || (pit.step ? [pit.step] : null);
    if (steps) for (var i = 0; i < steps.length; i++) s[steps[i].edge] = steps[i];
    return s;
  }
  function isPitTile(pit, tx, ty) {
    return tx >= pit.tx0 && tx <= pit.tx1 && ty >= pit.ty0 && ty <= pit.ty1;
  }
  function buildPits(W, L, M, map) {
    var wallH = (W.theme && W.theme.wallH) || 3.2;
    var tileAt = function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return 0;
      return map.tiles[ty * map.w + tx];
    };
    L.pits.forEach(function (pit) {
      var tx, ty;
      for (ty = pit.ty0; ty <= pit.ty1; ty++)
        for (tx = pit.tx0; tx <= pit.tx1; tx++) W.skipWall(tx, ty);
      var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
      var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
      var topY = Math.max(0, pit.floorY), botY = Math.min(0, pit.floorY);
      var stepEdges = stepEdgesOf(pit);
      eachChunkRect(pit.tx0, pit.ty0, pit.tx1, pit.ty1, function (ax, ay, ix0, iy0, ix1, iy1) {
        W.addChunkContent(ix0, iy0, function (group) {
          var qx0 = ix0 * TILE, qx1 = (ix1 + 1) * TILE;
          var qz0 = iy0 * TILE, qz1 = (iy1 + 1) * TILE;
          var qw = qx1 - qx0, qh = qz1 - qz0;
          var qcx = (qx0 + qx1) / 2, qcz = (qz0 + qz1) / 2;
          if (!pit.ramp) {
            // 池底（tile=2 上引擎不渲染默认地板，这里自建；deck 平台同理）
            W.reg(group, hPlane(qw, qh, W.mat('pool_floor'), qcx, pit.floorY, qcz, true));
            if (pit.kind === 'deep' || pit.dark) {
              W.reg(group, hPlane(qw, qh, M.deepShade, qcx, pit.floorY + 0.03, qcz, true));
            }
            if (pit.dark) {
              // 较暗深水区：中层再压一层 shade（光线随深度过渡清楚）
              W.reg(group, hPlane(qw, qh, M.midShade, qcx, SURF - 1.1, qcz, true));
            }
          } else {
            // 缓坡：沿 ramp 轴的斜面（线性，裁剪后仍是平面四边形）
            var yAt = function (z, x) {
              var t = pit.ramp.axis === 'z'
                ? (pit.ramp.dir > 0 ? (z - pz0) / (pz1 - pz0) : (pz1 - z) / (pz1 - pz0))
                : (pit.ramp.dir > 0 ? (x - px0) / (px1 - px0) : (px1 - x) / (px1 - px0));
              return pit.floorY * Math.max(0, Math.min(1, t));
            };
            var g = new THREE.BufferGeometry();
            var vv = new Float32Array([
              qx0, yAt(qz0, qx0), qz0,
              qx1, yAt(qz0, qx1), qz0,
              qx1, yAt(qz1, qx1), qz1,
              qx0, yAt(qz1, qx0), qz1
            ]);
            g.setAttribute('position', new THREE.BufferAttribute(vv, 3));
            var uu = new Float32Array([qx0 / TILE, qz0 / TILE, qx1 / TILE, qz0 / TILE, qx1 / TILE, qz1 / TILE, qx0 / TILE, qz1 / TILE]);
            g.setAttribute('uv', new THREE.BufferAttribute(uu, 2));
            g.setIndex([0, 2, 1, 0, 3, 2]);
            g.computeVertexNormals();
            W.reg(group, new THREE.Mesh(g, W.mat('pool_floor')));
          }
          // 池壁：裁剪块的边若与坑外边界重合则立墙；
          //   跳过：台阶边 / 缓坡高边 / 与相邻坑共边（分层泳池不断墙）
          var highEdge = pit.ramp ? (pit.ramp.axis === 'z' ? (pit.ramp.dir > 0 ? 'N' : 'S') : (pit.ramp.dir > 0 ? 'W' : 'E')) : null;
          function wall(x0, z0, x1, z1) {
            var len = Math.hypot(x1 - x0, z1 - z0);
            if (len < 0.01 || topY - botY < 0.01) return;
            var m = new THREE.Mesh(new THREE.PlaneGeometry(len, topY - botY), M.pitWall);
            m.position.set((x0 + x1) / 2, (topY + botY) / 2, (z0 + z1) / 2);
            m.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
            W.reg(group, m);
          }
          // 邻边是否为别的坑 tile（是则不立墙）
          function adjPit(edge) {
            var txx = edge === 'W' ? pit.tx0 - 1 : edge === 'E' ? pit.tx1 + 1 : ix0;
            var tyy = edge === 'N' ? pit.ty0 - 1 : edge === 'S' ? pit.ty1 + 1 : iy0;
            if (edge === 'W' || edge === 'E') {
              for (var yy = iy0; yy <= iy1; yy++) if (tileAt(txx, yy) === 2 && !isPitTile(pit, txx, yy)) return true;
            } else {
              for (var xx = ix0; xx <= ix1; xx++) if (tileAt(xx, tyy) === 2 && !isPitTile(pit, xx, tyy)) return true;
            }
            return false;
          }
          var EPS = 0.01;
          if (Math.abs(qx0 - px0) < EPS && !stepEdges.W && highEdge !== 'W' && !adjPit('W')) wall(qx0, qz0, qx0, qz1);
          if (Math.abs(qx1 - px1) < EPS && !stepEdges.E && highEdge !== 'E' && !adjPit('E')) wall(qx1, qz0, qx1, qz1);
          if (Math.abs(qz0 - pz0) < EPS && !stepEdges.N && highEdge !== 'N' && !adjPit('N')) wall(qx0, qz0, qx1, qz0);
          if (Math.abs(qz1 - pz1) < EPS && !stepEdges.S && highEdge !== 'S' && !adjPit('S')) wall(qx0, qz1, qx1, qz1);
          // 蓝小砖池沿：非台阶边、非共边的坑沿压一条 0.35m 蓝砖压边（deck 平台临水边同理）
          function trim(x0, z0, x1, z1) {
            var len = Math.hypot(x1 - x0, z1 - z0);
            if (len < 0.05) return;
            var m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.35), M.trim);
            m.position.set((x0 + x1) / 2, 0.035, (z0 + z1) / 2);
            m.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
            W.reg(group, m);
          }
          var TW = 0.175; // 压边半宽（向坑外）
          if (Math.abs(qx0 - px0) < EPS && !stepEdges.W && !adjPit('W')) trim(qx0 - TW, qz0, qx0 - TW, qz1);
          if (Math.abs(qx1 - px1) < EPS && !stepEdges.E && !adjPit('E')) trim(qx1 + TW, qz0, qx1 + TW, qz1);
          if (Math.abs(qz0 - pz0) < EPS && !stepEdges.N && !adjPit('N')) trim(qx0, qz0 - TW, qx1, qz0 - TW);
          if (Math.abs(qz1 - pz1) < EPS && !stepEdges.S && !adjPit('S')) trim(qx0, qz1 + TW, qx1, qz1 + TW);
          // 顶面（tile=2 无默认天花板；坑上无灯具 → 自然暗区）
          W.reg(group, hPlane(qw, qh, W.mat('pool_ceil'), qcx, wallH, qcz, false));
          // 台阶：每条 stepEdge 占 1 tile 宽带，n 级；从 fromY（默认甲板 0）走向 pit.floorY
          //   （可上：deck 平台；可下：普通/分层）。每级做实到坑底（或 fromY），无悬空缝。
          var steps = pit.steps || (pit.step ? [pit.step] : null);
          if (steps) {
            for (var si = 0; si < steps.length; si++) {
              var st = steps[si], n = st.n;
              var fromY = (st.fromY != null ? st.fromY : 0);
              var riser = Math.abs(pit.floorY - fromY) / n;
              var dir = pit.floorY < fromY ? -1 : 1;
              var lo = Math.min(fromY, pit.floorY);
              var edge = st.edge, k;
              for (k = 0; k < n; k++) {
                var skTop = fromY + dir * (k + 1) * riser;
                var sx0, sx1, sz0, sz1;
                if (edge === 'N') { sx0 = qx0; sx1 = qx1; sz0 = pz0 + k * TILE / n; sz1 = pz0 + (k + 1) * TILE / n; }
                else if (edge === 'S') { sx0 = qx0; sx1 = qx1; sz0 = pz1 - (k + 1) * TILE / n; sz1 = pz1 - k * TILE / n; }
                else if (edge === 'W') { sz0 = qz0; sz1 = qz1; sx0 = px0 + k * TILE / n; sx1 = px0 + (k + 1) * TILE / n; }
                else { sz0 = qz0; sz1 = qz1; sx0 = px1 - (k + 1) * TILE / n; sx1 = px1 - k * TILE / n; }
                var cx0 = Math.max(sx0, qx0), cx1 = Math.min(sx1, qx1);
                var cz0 = Math.max(sz0, qz0), cz1 = Math.min(sz1, qz1);
                if (cx1 - cx0 < 0.01 || cz1 - cz0 < 0.01) continue;
                var bw = cx1 - cx0, bd = cz1 - cz0;
                var bTop = Math.max(skTop, lo), bBot = Math.min(skTop, lo);
                var bh = bTop - bBot;
                if (bh < 0.01) continue;
                var box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), M.pitWall);
                box.position.set((cx0 + cx1) / 2, (bTop + bBot) / 2, (cz0 + cz1) / 2);
                W.reg(group, box);
              }
            }
          }
        });
      });
    });
  }

  // 瓷柱阵：tile=0 真实碰撞；这里 skipWall + 自建 0.8m 细柱（从甲板升出水面）
  function buildPillars(W, L, M) {
    L.pillars.forEach(function (pt) {
      var tx = pt[0], ty = pt[1];
      W.skipWall(tx, ty);
      W.addChunkContent(tx, ty, function (group) {
        var col = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.2, 0.8), M.pillar);
        col.position.set(BR.tileCX(tx), 1.6, BR.tileCZ(ty));
        W.reg(group, col);
        var cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 1.0), M.pillar);
        cap.position.set(BR.tileCX(tx), 3.15, BR.tileCZ(ty));
        W.reg(group, cap);
      });
    });
  }

  /* ============ v1.5 W5：泳道线（参考图1：长条泳道中央浮球分道线） ============
   * lane 角色坑沿长轴中央一条浮球线（蓝白相间），随水面轻微浮动；
   * 纯装饰（无碰撞，避免游泳被卡住）。 */
  function laneDividerAssets() {
    if (!FX37.laneGeo) {
      FX37.laneGeo = new THREE.SphereGeometry(0.07, 10, 8);
      FX37.laneMatA = new THREE.MeshLambertMaterial({ color: 0xf4f9fb });
      FX37.laneMatB = new THREE.MeshLambertMaterial({ color: 0x2b8ab5 });
    }
  }
  function buildLaneDividers(W, L) {
    laneDividerAssets();
    FX37.laneBalls = FX37.laneBalls || [];
    L.pits.forEach(function (pit) {
      if (pit.role !== 'lane') return;
      var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
      var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
      var horiz = (px1 - px0) >= (pz1 - pz0);
      var len = (horiz ? px1 - px0 : pz1 - pz0) - 2.4 * TILE; // 两端避开入水台阶
      if (len < 2) return;
      var mid = horiz ? (pz0 + pz1) / 2 : (px0 + px1) / 2;
      var start = horiz ? px0 + 1.2 * TILE : pz0 + 1.2 * TILE;
      var n = Math.max(2, Math.floor(len / 0.35));
      var atx = Math.floor(pit.tx0 + (pit.tx1 - pit.tx0) / 2);
      var aty = Math.floor(pit.ty0 + (pit.ty1 - pit.ty0) / 2);
      W.addChunkContent(atx, aty, function (group) {
        for (var i = 0; i < n; i++) {
          var d = start + (i + 0.5) * (len / n);
          var m = new THREE.Mesh(FX37.laneGeo, i % 2 ? FX37.laneMatB : FX37.laneMatA);
          var bx = horiz ? d : mid, bz = horiz ? mid : d;
          m.position.set(bx, SURF + 0.06, bz);
          W.reg(group, m);
          FX37.laneBalls.push({ m: m, phase: d * 0.7, baseY: SURF + 0.06 });
        }
      });
    });
  }
  function tickLaneDividers() {
    if (!FX37.laneBalls) return;
    for (var i = 0; i < FX37.laneBalls.length; i++) {
      var b = FX37.laneBalls[i];
      if (!b.m.parent) continue; // chunk 已卸载则跳过
      b.m.position.y = b.baseY + Math.sin(FX37.t * 1.3 + b.phase) * 0.03;
      b.m.rotation.y += 0.004;
    }
  }
  // placer 在 pit.ladder = {edge} 指定位置；这里建双杆+横档几何，
  // 上岸走统一交互（E/左键）：落点检测最近的坑外甲板 tile，绝不放进墙里。
  function buildLadders(W, L, M, map) {
    FX37.ladders = [];
    L.pits.forEach(function (pit) {
      if (!pit.ladder) return;
      var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
      var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
      var e = pit.ladder.edge, lx, lz, rotY, dx, dz;
      if (e === 'N') { lx = (px0 + px1) / 2; lz = pz0 + 0.25; rotY = 0; dx = 0; dz = -1; }
      else if (e === 'S') { lx = (px0 + px1) / 2; lz = pz1 - 0.25; rotY = Math.PI; dx = 0; dz = 1; }
      else if (e === 'W') { lx = px0 + 0.25; lz = (pz0 + pz1) / 2; rotY = Math.PI / 2; dx = -1; dz = 0; }
      else { lx = px1 - 0.25; lz = (pz0 + pz1) / 2; rotY = -Math.PI / 2; dx = 1; dz = 0; }
      var botY = Math.min(0, pit.floorY);
      var railH = 0 - botY + 0.9; // 从坑底一直伸出水面 0.9m
      // 上岸落点：扶梯外侧 1.6m，优先 tile-1
      var sx = lx + dx * 1.6, sz = lz + dz * 1.6;
      var stx = Math.floor(sx / TILE), stz = Math.floor(sz / TILE);
      if (W.tile(stx, stz) !== 1) {
        var found = false, rr, xx, yy;
        for (rr = 1; rr <= 3 && !found; rr++)
          for (yy = stz - rr; yy <= stz + rr && !found; yy++)
            for (xx = stx - rr; xx <= stx + rr && !found; xx++)
              if (W.tile(xx, yy) === 1) { stx = xx; stz = yy; found = true; }
      }
      var spotX = BR.tileCX(stx), spotZ = BR.tileCZ(stz);
      var lid = 'ladder_' + pit.tx0 + '_' + pit.ty0;
      var tx = Math.floor(lx / TILE), ty = Math.floor(lz / TILE);
      W.addChunkContent(tx, ty, function (group) {
        var g = new THREE.Group();
        var railM = new THREE.MeshPhongMaterial({ // 金属扶梯（参考图2）
          color: 0xc3d2d8, specular: 0xaac4d0, shininess: 70
        });
        W._levelMats = W._levelMats || [];
        W._levelMats.push(railM);
        function box(bw, bh, bd, bx, by, bz) {
          var mm = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), railM);
          mm.position.set(bx, by, bz); g.add(mm); return mm;
        }
        box(0.07, railH, 0.07, -0.28, botY + railH / 2, 0); // 竖杆
        box(0.07, railH, 0.07, 0.28, botY + railH / 2, 0);
        var rungN = Math.max(2, Math.floor(railH / 0.35));
        for (var ri = 0; ri < rungN; ri++) box(0.56, 0.06, 0.06, 0, botY + 0.25 + ri * 0.35, 0);
        box(0.07, 0.07, 0.7, -0.28, 0.95, 0.35); // 顶部扶手
        box(0.07, 0.07, 0.7, 0.28, 0.95, 0.35);
        // 隐形命中盒（扶梯杆太细，方便对准交互）
        var proxy = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.6),
          new THREE.MeshBasicMaterial({ visible: false }));
        proxy.position.set(0, 0.6, 0.1); g.add(proxy);
        g.position.set(lx, 0, lz);
        g.rotation.y = rotY;
        W.reg(group, g);
        W.addInteractable({
          id: lid, kind: 'ladder', chunkKey: W.chunkKeyOf(tx, ty),
          meshes: g.children.slice(),
          pos: new THREE.Vector3(lx, 0.6, lz), radius: 3.0,
          prompt: function () { return '抓住扶梯爬上岸'; },
          canUse: function () {
            var P = BR.Player;
            if (!P || (BR.Cutout && BR.Cutout.busy)) return false;
            if (P.isMounted && P.isMounted()) return false; // 骑鸭时不上扶梯
            var ddx = P.pos.x - lx, ddz = P.pos.z - lz;
            if (ddx * ddx + ddz * ddz > 9) return false;
            return BR.Swim.inWater || P._mode === 'swim';
          },
          use: function () {
            var P = BR.Player;
            P.pos.set(spotX, 0, spotZ); P.vel.set(0, 0, 0);
            P._swim = false;
            if (BR.Audio && BR.Audio.l37ClimbOut) { try { BR.Audio.l37ClimbOut(); } catch (e) {} }
            BR.UI.toast('抓住扶梯爬上岸，抖了抖水', 1800);
          }
        });
      });
      FX37.ladders.push({ x: lx, z: lz });
    });
  }

  /* ============ v1.5 W5：小鸭子坐骑（本游戏原创） ============
   * 独立世界对象，不占背包道具名额；LORE.md 标注[本游戏原创]。
   * 经 BR.Mounts.register('duck', factory) 注册，handle 接口与船一致。 */
  var wakePool = []; // 水纹圆环（场景级，随 buildContent 清空）
  function spawnWakeRing(W, x, z) {
    var m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 20),
      new THREE.MeshBasicMaterial({
        color: 0xd8f2ff, transparent: true, opacity: 0.45,
        depthWrite: false, side: THREE.DoubleSide
      }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, SURF + 0.03, z);
    if (W.scene) W.scene.add(m);
    wakePool.push({ m: m, life: 1.1, max: 1.1 });
  }
  function tickWakeRings(W, dt) {
    for (var i = wakePool.length - 1; i >= 0; i--) {
      var wr = wakePool[i];
      wr.life -= dt;
      if (wr.life <= 0) {
        if (wr.m.parent) wr.m.parent.remove(wr.m);
        wr.m.geometry.dispose(); wr.m.material.dispose();
        wakePool.splice(i, 1);
        continue;
      }
      var s = 1 + (1 - wr.life / wr.max) * 2.2;
      wr.m.scale.set(s, s, 1);
      wr.m.material.opacity = 0.45 * (wr.life / wr.max);
    }
  }
  function buildDuckMesh() {
    var g = new THREE.Group();
    var yellow = new THREE.MeshLambertMaterial({ color: 0xffcf3f });
    var orange = new THREE.MeshLambertMaterial({ color: 0xff9040 });
    var dark = new THREE.MeshLambertMaterial({ color: 0xe0a92e });
    var black = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    function M(geo, mat, x, y, z) {
      var m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
    }
    var body = M(new THREE.SphereGeometry(0.62, 18, 14), yellow, 0, 0.05, 0);
    body.scale.set(1.05, 0.72, 1.35); // 充气鸭身体（-z 为前方）
    M(new THREE.SphereGeometry(0.34, 16, 12), yellow, 0, 0.52, -0.62); // 头
    var beak = M(new THREE.ConeGeometry(0.13, 0.28, 10), orange, 0, 0.48, -0.95);
    beak.rotation.x = -Math.PI / 2; // 喙
    M(new THREE.SphereGeometry(0.05, 8, 6), black, -0.14, 0.60, -0.85); // 眼睛
    M(new THREE.SphereGeometry(0.05, 8, 6), black, 0.14, 0.60, -0.85);
    var wgl = M(new THREE.SphereGeometry(0.30, 10, 8), yellow, -0.62, 0.12, 0.05);
    wgl.scale.set(0.35, 0.55, 1.0); // 翅膀
    var wgr = M(new THREE.SphereGeometry(0.30, 10, 8), yellow, 0.62, 0.12, 0.05);
    wgr.scale.set(0.35, 0.55, 1.0);
    var tail = M(new THREE.ConeGeometry(0.16, 0.35, 8), yellow, 0, 0.28, 0.85);
    tail.rotation.x = Math.PI / 2.3; // 尾巴
    var seat = M(new THREE.CircleGeometry(0.30, 16), dark, 0, 0.42, 0.05);
    seat.rotation.x = -Math.PI / 2; // 座位垫
    g.traverse(function (o) { o.frustumCulled = false; });
    return { group: g, mats: [yellow, orange, dark, black] };
  }
  /* ============ v1.5 W5：小鸭子坐骑（本游戏原创） ============
   * 独立世界对象，不占背包道具名额；LORE.md 标注[本游戏原创]。
   * 经 BR.Mounts.register('duck', factory) 注册（W8 player.js 的完整版框架），
   * handle 接口与船（lv_l7 boatFactory）一致：
   *   {update(dt,input,player), getSeatPos(), findDismountSpot()->{x,z}|null,
   *    getSave(), applySave(save), onMount/onDismount, idle(dt), dispose()}
   * 上骑/下骑走玩家侧 P.mount(handle) / P.dismount()（E 键统一入口见 input.js）。 */
  function duckFactory(W, opts) {
    opts = opts || {};
    var built = buildDuckMesh();
    var g = built.group;
    W._levelMats = W._levelMats || [];
    for (var mi = 0; mi < built.mats.length; mi++) {
      if (W._levelMats.indexOf(built.mats[mi]) < 0) W._levelMats.push(built.mats[mi]);
    }
    var h = {
      id: opts.id || 'duck_0', kind: 'duck', stateName: 'duck',
      x: opts.x || 0, z: opts.z || 0, yaw: opts.yaw || 0,
      group: g, _bobT: (opts.yaw || 0) * 3.7, _wakeT: 0, _moving: false,
      _meshes: [], _itId: null
    };
    g.position.set(h.x, SURF, h.z);
    g.rotation.y = h.yaw;
    g.traverse(function (o) { if (o.isMesh) h._meshes.push(o); });
    if (W.scene) W.scene.add(g);

    function saveNow() {
      if (W && W.state) {
        try { W.state['duckSave_' + h.id] = h.getSave(); } catch (e) {}
      }
    }

    h.getSeatPos = function () { return new THREE.Vector3(this.x, SURF + 0.42, this.z); };

    // 体积碰撞：不穿柱穿墙（0.7m 半径）/ 不可陆行与浅滩 / 不进窄水道
    h._moveOk = function (nx, nz) {
      var W2 = BR.World;
      if (!W2.circleFree(nx, nz, 0.7)) return false;
      var Lw = BR.Levels.L37;
      var w = (Lw && Lw.waterAt) ? Lw.waterAt(nx, nz) : null;
      if (!w || w.depth < 0.8) return false;
      var meta = W2.map && W2.map.meta && W2.map.meta.l37;
      var ch = meta && meta.chanRects;
      if (ch) for (var i = 0; i < ch.length; i++) {
        var r = ch[i];
        if (nx >= r.x0 * TILE && nx <= (r.x1 + 1) * TILE &&
            nz >= r.y0 * TILE && nz <= (r.y1 + 1) * TILE) return false;
      }
      return true;
    };

    // 骑乘中每帧（player.js mountHandle 分支调用；玩家位置由 getSeatPos 回写）
    h.update = function (dt, input, player) {
      var W2 = BR.World;
      var lk = input.consumeLook();
      player.yaw -= lk.dx * input.sens();
      player.pitch = BR.clamp(player.pitch - lk.dy * input.sens(), -1.45, 1.45);
      var mv = input.getMove();
      var turn = -mv.x, fwd = mv.z;
      this._moving = Math.abs(fwd) > 0.05;
      if (this._moving) this.yaw += turn * 1.9 * dt;
      var spd = (input.runHeld ? 4.0 : 2.6) * fwd;
      var fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (this._moving && spd !== 0) {
        var nx = this.x + fx * spd * dt, nz = this.z + fz * spd * dt;
        if (this._moveOk(nx, nz)) { this.x = nx; this.z = nz; }
      }
      // 随水浮动
      this._bobT += dt;
      var bobY = Math.sin(this._bobT * 1.7) * 0.05 +
        (this._moving ? Math.sin(this._bobT * 7) * 0.02 : 0);
      this.group.position.set(this.x, SURF + bobY, this.z);
      this.group.rotation.y = this.yaw;
      this.group.rotation.z = BR.damp(this.group.rotation.z || 0, -turn * 0.10, 6, dt);
      if (this._moving) { // 水纹
        this._wakeT -= dt;
        if (this._wakeT <= 0) { this._wakeT = 0.45; spawnWakeRing(W2, this.x, this.z); }
      }
      saveNow();
    };

    h.idle = function (dt) { // 未骑乘：原地随水浮动
      this._bobT += dt;
      this.group.position.y = SURF + Math.sin(this._bobT * 1.7) * 0.05;
      this.group.rotation.y = this.yaw + Math.sin(this._bobT * 0.4) * 0.06;
    };

    // 下骑落点：干岸优先，其次可站立浅水；墙内/深水/窄道一律不要
    h.findDismountSpot = function () {
      var W2 = BR.World, Lw = BR.Levels.L37;
      var best = null, bestScore = 1e9;
      var radii = [1.5, 2.2, 3.0];
      for (var ri = 0; ri < radii.length; ri++) {
        for (var a = 0; a < 12; a++) {
          var ang = a / 12 * Math.PI * 2;
          var x = this.x + Math.cos(ang) * radii[ri], z = this.z + Math.sin(ang) * radii[ri];
          var tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
          if (W2.blocked(tx, ty)) continue;
          if (!W2.circleFree(x, z, 0.35)) continue;
          var w = (Lw && Lw.waterAt) ? Lw.waterAt(x, z) : null;
          var score, y;
          if (!w) { score = radii[ri]; y = 0; }
          else if (w.depth >= 0.25 && w.depth <= 1.0) { score = radii[ri] + 5; y = Math.max(0, w.floor); }
          else continue;
          if (score < bestScore) { bestScore = score; best = { x: x, y: y, z: z }; }
        }
        if (best) break;
      }
      return best;
    };

    h.onMount = function () {
      if (BR.Audio && BR.Audio.splash) { try { BR.Audio.splash(); } catch (e) {} }
      saveNow();
    };
    h.onDismount = function () {
      if (BR.Audio && BR.Audio.l37ClimbOut) { try { BR.Audio.l37ClimbOut(); } catch (e) {} }
      saveNow();
    };

    h.getSave = function () { return { id: this.id, x: this.x, z: this.z, yaw: this.yaw }; };
    h.applySave = function (d) {
      if (!d) return;
      this.x = d.x; this.z = d.z; this.yaw = d.yaw || 0;
      this.group.position.set(this.x, SURF, this.z);
      this.group.rotation.y = this.yaw;
    };
    h.dispose = function () {
      if (this.group && this.group.parent) this.group.parent.remove(this.group);
      this.group.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      // 材质随 W._levelMats 统一释放，这里不碰
    };
    return h;
  }
  // 从 duck_spawn POI 建鸭（W8 框架：register('duck', duckFactory)；位置经 W.state 持久化，同 id 不复制）
  function buildDucks(W, map) {
    if (!BR.Mounts || typeof BR.Mounts.register !== 'function') {
      if (BR.warn) BR.warn('[L37] BR.Mounts 未加载，跳过小鸭子');
      return;
    }
    // 清理旧鸭（关卡重建/读档时不复制）
    if (FX37.duckHandles) {
      for (var oi = 0; oi < FX37.duckHandles.length; oi++) {
        var oh = FX37.duckHandles[oi];
        if (oh._itId) W.removeInteractable(oh._itId);
        try { oh.dispose(); } catch (e) {}
      }
    }
    FX37.duckHandles = [];
    wakePool.length = 0;
    if (BR.Mounts.kinds().indexOf('duck') < 0) BR.Mounts.register('duck', duckFactory);
    var pois = (map.pois || []).filter(function (p) { return p.type === 'duck_spawn'; });
    pois.forEach(function (p, idx) {
      var d = p.data || {};
      var hid = 'duck_' + idx;
      var h = duckFactory(W, {
        id: hid,
        x: (d.wx != null ? d.wx : BR.tileCX(p.tx)),
        z: (d.wz != null ? d.wz : BR.tileCZ(p.ty)),
        yaw: d.yaw || 0
      });
      if (!h) return;
      var saved = W.state && W.state['duckSave_' + hid]; // 读档恢复位置（不复制不消失）
      if (saved) h.applySave(saved);
      var itId = 'duck_mount_' + hid;
      var itDef = {
        id: itId, kind: 'mount_duck', chunkKey: 'duck:' + hid, // 场景级：永不随区块卸载
        meshes: h._meshes,
        pos: new THREE.Vector3(h.x, SURF + 0.5, h.z), radius: 3.4,
        prompt: function () {
          var P = BR.Player;
          return (P && P.isMounted() && P.mountHandle === h) ? '下鸭' : '骑上小黄鸭';
        },
        canUse: function () {
          var P = BR.Player;
          if (!P || (BR.Cutout && BR.Cutout.busy)) return false;
          return !P.isMounted() || P.mountHandle === h;
        },
        use: function () {
          var P = BR.Player;
          if (!P) return;
          if (P.isMounted() && P.mountHandle === h) P.dismount();
          else if (!P.isMounted()) P.mount(h);
        }
      };
      h._itId = itId;
      W.addInteractable(itDef);
      FX37.duckHandles.push(h);
    });
    W._l37fx = W._l37fx || {};
    W._l37fx.ducks = pois.length;
  }

  // BR.Swim zones：深水坑优先注册（zoneAt 按注册顺序返回）
  // v1.5 W5：deck 平台（floorY>0）记为干区洞 —— 站在平台上不算"在水里"
  function registerSwimZones(L) {
    var i, j;
    var deckHoles = [];
    for (i = 0; i < L.pits.length; i++) {
      var dp = L.pits[i];
      if (dp.floorY > 0) deckHoles.push({
        x0: dp.tx0 * TILE, z0: dp.ty0 * TILE,
        x1: (dp.tx1 + 1) * TILE, z1: (dp.ty1 + 1) * TILE
      });
    }
    for (i = 0; i < L.pits.length; i++) {
      var p = L.pits[i];
      if (p.floorY > 0) continue; // deck 平台：不注册水域（干区）
      BR.Swim.registerZone({
        kind: p.kind === 'deep' ? 'deep' : 'pool',
        x0: p.tx0 * TILE, z0: p.ty0 * TILE,
        x1: (p.tx1 + 1) * TILE, z1: (p.ty1 + 1) * TILE,
        depth: +(SURF - p.floorY).toFixed(2), waterY: SURF
      });
    }
    for (i = 0; i < L.rects.length; i++) {
      var r = L.rects[i], maxD = SURF; // 浅滩 0.5
      for (j = 0; j < L.pits.length; j++) {
        var q = L.pits[j];
        var pcx = (q.tx0 + q.tx1 + 1) / 2, pcy = (q.ty0 + q.ty1 + 1) / 2;
        if (pcx >= r.x0 && pcx <= r.x1 && pcy >= r.y0 && pcy <= r.y1) {
          var dd = SURF - q.floorY;
          if (dd > maxD) maxD = dd;
        }
      }
      BR.Swim.registerZone({
        kind: 'pool',
        x0: r.x0 * TILE, z0: r.y0 * TILE,
        x1: (r.x1 + 1) * TILE, z1: (r.y1 + 1) * TILE,
        depth: +maxD.toFixed(2), waterY: SURF,
        holes: deckHoles
      });
    }
  }

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

  // 水下通道：圆环在坑边水下（data.wx/wz，交互射线可达）；需头部在水下才能进入
  function buildTunnel(W, p) {
    var d = p.data || {};
    var wx = (d.wx != null) ? d.wx : BR.tileCX(p.tx);
    var wz = (d.wz != null) ? d.wz : BR.tileCZ(p.ty);
    var ry = SURF - 0.75; // 没入水下
    W.addChunkContent(p.tx, p.ty, function (group) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.85, 0.13, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0x54d8f0, transparent: true, opacity: 0.9 })
      );
      ring.position.set(wx, ry, wz);
      W.reg(group, ring);
      var disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 24),
        new THREE.MeshBasicMaterial({ color: 0x0a4a66, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
      );
      disc.position.set(wx, ry, wz);
      W.reg(group, disc);
      W.addInteractable({
        id: 'tunnel_' + p.tx + '_' + p.ty,
        kind: 'pool_exit',
        chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [ring, disc],
        pos: new THREE.Vector3(wx, ry, wz),
        radius: 3.5,
        prompt: function () { return BR.Swim.headUnder ? '潜入水下通道' : '水下通道（潜入水中才能进入）'; },
        canUse: function () { return BR.Swim.headUnder; },
        use: function () { travelTo('L7', 'water'); }
      });
    });
  }

  // 深水区标记：浮标漂在坑边水面，杆子直通坑底
  function buildDeepZone(W, p, map) {
    var d = p.data || {};
    var depth = (d.depth == null) ? 2.7 : d.depth;
    var wx = (d.wx != null) ? d.wx : BR.tileCX(p.tx);
    var wz = (d.wz != null) ? d.wz : BR.tileCZ(p.ty);
    var floorY = SURF - depth;
    W.addChunkContent(p.tx, p.ty, function (group) {
      var buoy = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xff5a3c })
      );
      buoy.position.set(wx, SURF + 0.15, wz);
      W.reg(group, buoy);
      var poleH = Math.max(0.5, SURF - floorY);
      var pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, poleH, 8),
        new THREE.MeshLambertMaterial({ color: 0xd8dee0 })
      );
      pole.position.set(wx, floorY + poleH / 2, wz);
      W.reg(group, pole);
      W.addInteractable({
        id: 'deepzone_' + p.tx + '_' + p.ty,
        kind: 'inspect',
        chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [buoy],
        pos: new THREE.Vector3(wx, SURF + 0.2, wz),
        radius: 3.5,
        prompt: function () { return '查看水深标记'; },
        canUse: function () { return true; },
        use: function () {
          BR.UI.toast('水深约 ' + depth.toFixed(1) + ' 米。沿台阶下潜，注意闭气，憋不住就上浮。', 3500);
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

  /* ================= F1：湿脚印 / 跳水台 / 异常门 ================= */

  // 湿脚印：一串 decal 从池边通向干燥区（位置规则同 v1.3；浅水厅按 data.depth<1.0 识别）
  function buildFootprints(W, map) {
    var pools = (map.pois || []).filter(function (p) { return p.type === 'pool'; });
    if (!pools.length) return;
    var shallow = pools.filter(function (p) { return (p.data.depth || 0) < 1.0; });
    var cand = (shallow.length ? shallow : pools).slice().sort(function (a, b) {
      return (b.data.rw * b.data.rh) - (a.data.rw * a.data.rh);
    });
    var d = cand[0].data;
    var rx0 = Math.round(d.wcx / TILE - d.rw / 2), rz0 = Math.round(d.wcz / TILE - d.rh / 2);
    var rx1 = rx0 + d.rw - 1, rz1 = rz0 + d.rh - 1;
    var midX = Math.round((rx0 + rx1) / 2), midZ = Math.round((rz0 + rz1) / 2);
    var dirs = [{ dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 }, { dx: 0, dz: -1 }];
    var best = null, di, s2;
    for (di = 0; di < dirs.length; di++) {
      var dd = dirs[di];
      var sx = dd.dx === 1 ? rx1 + 1 : dd.dx === -1 ? rx0 - 1 : midX;
      var sz = dd.dz === 1 ? rz1 + 1 : dd.dz === -1 ? rz0 - 1 : midZ;
      var run = [];
      for (s2 = 0; s2 < 8; s2++) {
        var gx = sx + dd.dx * s2, gz = sz + dd.dz * s2;
        if (gx < 1 || gz < 1 || gx > map.w - 2 || gz > map.h - 2) break;
        if (W.map.tiles[gz * W.map.w + gx] !== 1) break;
        run.push([gx, gz]);
      }
      if (!best || run.length > best.run.length) best = { dir: dd, run: run };
    }
    if (!best || !best.run.length) return;
    var rng = new BR.RNG(BR.hashSeed(map.seed + ':l37feet'));
    var n = Math.min(6, best.run.length);
    var ang = Math.atan2(-best.dir.dx, -best.dir.dz); // 脚尖朝行进方向
    var px = -best.dir.dz, pz = best.dir.dx; // 横向（左右脚错开）
    for (var fi = 0; fi < n; fi++) {
      (function (idx) {
        var ft = best.run[idx];
        var op = Math.max(0.25, 0.7 - idx * 0.07);
        W.addChunkContent(ft[0], ft[1], function (group) {
          for (var side = -1; side <= 1; side += 2) {
            var fp = new THREE.Mesh(
              new THREE.PlaneGeometry(0.55, 0.85),
              new THREE.MeshBasicMaterial({
                map: BR.Textures.get('wet_footprint'), transparent: true,
                opacity: op, depthWrite: false
              })
            );
            fp._ownMat = true; // chunk 卸载时释放（贴图共享，不释放）
            fp.rotation.x = -Math.PI / 2;
            fp.rotation.z = ang + (rng.next() - 0.5) * 0.3;
            fp.position.set(
              BR.tileCX(ft[0]) + px * 0.16 * side + best.dir.dx * 0.10 * side,
              0.025,
              BR.tileCZ(ft[1]) + pz * 0.16 * side + best.dir.dz * 0.10 * side
            );
            W.reg(group, fp);
          }
        });
      })(fi);
    }
    W._l37fx = W._l37fx || {};
    W._l37fx.feet = { n: n, dir: [best.dir.dx, best.dir.dz], tx: best.run[0][0], ty: best.run[0][1] };
  }

  // 跳水台：架在深水坑北缘，台面向南伸入坑上方；南腿按坑底高度；
  // 站立区 tick 做 pos.y 过渡；"跳水！"交互带水花（v1.3 保留）
  function buildDiveBoard(W, map) {
    var L = map.meta && map.meta.l37;
    if (!L) return;
    var pit = null, i;
    for (i = 0; i < L.pits.length; i++) if (L.pits[i].kind === 'deep') { pit = L.pits[i]; break; }
    if (!pit) return;
    var pz0 = pit.ty0 * TILE;
    var pcx = (pit.tx0 + pit.tx1 + 1) / 2 * TILE;
    var topY = 1.05;
    var bz0 = pz0 - 1.6, bz1 = pz0 + 1.6; // 北端在坑外甲板，南端伸入坑上
    var bcz = (bz0 + bz1) / 2;
    FX37.board = { x0: pcx - 0.75, x1: pcx + 0.75, z0: bz0, z1: bz1, topY: topY, dirx: 0, dirz: 1 };
    W._levelMats = W._levelMats || [];
    var deckM = new THREE.MeshLambertMaterial({ color: 0xdfe9ec });
    var railM = new THREE.MeshLambertMaterial({ color: 0x3d7f9e });
    W._levelMats.push(deckM); W._levelMats.push(railM);
    // 南腿高度：按落点坑底（台阶/坑底）用 waterAt 取真值
    var wS = BR.Gen.L37waterAt(map, pcx - 0.55, pz0 + 1.2);
    var wS2 = BR.Gen.L37waterAt(map, pcx + 0.55, pz0 + 1.2);
    var fS = Math.min(wS ? wS.floor : pit.floorY, wS2 ? wS2.floor : pit.floorY);
    var ptx = Math.floor(pcx / TILE), pty = Math.floor(pz0 / TILE);
    W.addChunkContent(ptx, pty, function (group) {
      var g = new THREE.Group();
      function box(bw, bh, bd, m, bx, by, bz) {
        var mm = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
        mm.position.set(bx, by, bz); g.add(mm); return mm;
      }
      var bl = bz1 - bz0;
      box(1.5, 0.12, bl, deckM, pcx, topY - 0.06, bcz);            // 台面
      box(1.5, 0.06, 0.3, railM, pcx, topY + 0.02, bz1 - 0.15);    // 台头防滑条
      box(0.18, topY, 0.18, deckM, pcx - 0.6, topY / 2, bz0 + 0.4);      // 北腿（甲板）
      box(0.18, topY, 0.18, deckM, pcx + 0.6, topY / 2, bz0 + 0.4);
      var legS = topY - fS;                                            // 南腿（坑内）
      box(0.18, legS, 0.18, deckM, pcx - 0.6, fS + legS / 2, bz1 - 0.4);
      box(0.18, legS, 0.18, deckM, pcx + 0.6, fS + legS / 2, bz1 - 0.4);
      var lz = bz0 - 0.35; // 梯（北端，视觉）
      box(0.08, topY + 0.5, 0.08, railM, pcx - 0.65, (topY + 0.5) / 2, lz);
      box(0.08, topY + 0.5, 0.08, railM, pcx + 0.65, (topY + 0.5) / 2, lz);
      for (var ri = 0; ri < 4; ri++) box(1.3, 0.06, 0.06, railM, pcx, 0.25 + ri * 0.28, lz);
      W.reg(group, g);
      W.addInteractable({
        id: 'l37_dive', kind: 'dive_board', chunkKey: W.chunkKeyOf(ptx, pty),
        meshes: g.children.slice(),
        pos: new THREE.Vector3(pcx, topY + 0.5, bz1 - 0.4), radius: 3.2,
        prompt: function () { return FX37.dive ? '……' : '跳水！'; },
        canUse: function () {
          return !FX37.dive && (!BR.Cutout || !BR.Cutout.busy) && BR.Player.pos.y > 0.5;
        },
        use: function () {
          var P = BR.Player, b = FX37.board;
          FX37.dive = {
            t: 0, dur: 0.9,
            x0: P.pos.x, z0: P.pos.z, y0: P.pos.y,
            dx: b.dirx * 3.0, dz: b.dirz * 3.0
          };
          BR.Audio.splash();
        }
      });
    });
    W._l37fx = W._l37fx || {};
    W._l37fx.board = { cx: pcx, cz: bcz, topY: topY };
  }

  // 异常门：干燥房间里不该存在的门（切出口 → 随机楼层，接入 Cutout）
  // 位置规则（确定性）：非出生房、非泳池房/水道厅的干燥房间按面积降序，
  // 取 hashSeed(seed+':l37anomdoor') % 数量；门立于房间中心 tile。
  // 目的地：['L1','L11','bang','L188']（排除本关与未加载；v1.5 W6：94→! 替换）按种子取其一，kind='rift'。
  function buildAnomDoor(W, map) {
    var rooms = map.rooms || [];
    var dry = [];
    for (var i = 1; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.tag && r.tag.indexOf('pool_') === 0) continue;
      dry.push(r);
    }
    if (!dry.length) return;
    dry.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });
    var room = dry[BR.hashSeed(map.seed + ':l37anomdoor') % dry.length];
    var tx = Math.round(room.cx), ty = Math.round(room.cy);
    if (W.map.tiles[ty * W.map.w + tx] !== 1) return;
    var dests = ['L1', 'L11', 'bang', 'L188'].filter(function (l) { return l !== 'L37' && !!BR.Levels[l]; });
    if (!dests.length) return;
    var dest = dests[BR.hashSeed(map.seed + ':l37anomdest') % dests.length];
    var aid = 'l37_anomdoor';
    // 关卡级材质（chunk 重建复用，随 _levelMats 释放）
    W._levelMats = W._levelMats || [];
    var frameM = new THREE.MeshLambertMaterial({ color: 0x3d4a52 });
    var panelM = new THREE.MeshBasicMaterial({ color: 0x050b10 });
    var seamM = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, depthWrite: false });
    W._levelMats.push(frameM); W._levelMats.push(panelM); W._levelMats.push(seamM);
    W.addChunkContent(tx, ty, function (group) {
      var g = new THREE.Group();
      var post = new THREE.BoxGeometry(0.28, 2.5, 0.28);
      var p1 = new THREE.Mesh(post, frameM); p1.position.set(-0.7, 1.25, 0);
      var p2 = new THREE.Mesh(post, frameM); p2.position.set(0.7, 1.25, 0);
      var beam = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.3, 0.3), frameM);
      beam.position.set(0, 2.55, 0);
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 2.3), panelM);
      panel.position.set(0, 1.2, 0.02);
      var seam = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.07), seamM);
      seam.position.set(0, 2.28, 0.03);
      g.add(p1); g.add(p2); g.add(beam); g.add(panel); g.add(seam);
      g.position.set(BR.tileCX(tx), 0, BR.tileCZ(ty));
      g.rotation.y = (BR.hashSeed(map.seed + ':l37anomrot') % 4) * Math.PI / 2;
      W.reg(group, g);
      W.addInteractable({
        id: aid, kind: 'anomaly_exit', chunkKey: W.chunkKeyOf(tx, ty),
        meshes: [panel, seam], pos: new THREE.Vector3(BR.tileCX(tx), 1.3, BR.tileCZ(ty)), radius: 3.0,
        prompt: function () { return '这扇门不应该出现在这里（异常门）'; },
        canUse: function () { return !BR.Cutout || !BR.Cutout.busy; },
        use: function () { travelTo(dest, 'rift'); }
      });
    });
    W._l37fx = W._l37fx || {};
    W._l37fx.anomDoor = { tx: tx, ty: ty, dest: dest, id: aid };
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
      W._l37fx = {}; // F1 测试钩子重置
      // F1：重置关卡特效状态（水花粒子/跳水/跳水台站立区）
      (function resetFX37() {
        for (var ri = 0; ri < FX37.parts.length; ri++) {
          var pt = FX37.parts[ri];
          if (pt.m) {
            if (W.scene) W.scene.remove(pt.m);
            if (pt.ring) { if (pt.m.geometry) pt.m.geometry.dispose(); if (pt.m.material) pt.m.material.dispose(); }
          }
        }
        FX37.parts.length = 0;
        FX37.dive = null;
        FX37.board = null;
        FX37.caustTex = null;
        FX37.ladders = [];
        FX37.laneBalls = [];
        if (FX37.splashGeo) { FX37.splashGeo.dispose(); FX37.splashGeo = null; }
        if (FX37.splashMat) { FX37.splashMat.dispose(); FX37.splashMat = null; }
      })();
      var L = map.meta && map.meta.l37;
      var M = makeMats(W);
      if (L) {
        buildWaterPlanes(W, L, M);
        buildPits(W, L, M, map);
        buildPillars(W, L, M);
        buildLadders(W, L, M, map);
        buildLaneDividers(W, L);
        buildDucks(W, map);
        registerSwimZones(L);
        // 测试钩子：暴露给 e2e（_test_l37.html 风格）
        W._l37fx = W._l37fx || {};
        W._l37fx.ladders = FX37.ladders;
        W._l37fx.laneBalls = FX37.laneBalls;
        W._l37fx.duckHandles = FX37.duckHandles;
      }
      var i, p;
      for (i = 0; i < map.pois.length; i++) {
        p = map.pois[i];
        // 'pool' POI：水体由 meta.l37 rects 统一建造，这里无需逐个处理
        if (p.type === 'archway') buildArchway(W, p);
        else if (p.type === 'tunnel') buildTunnel(W, p);
        else if (p.type === 'deep_zone') buildDeepZone(W, p, map);
        else if (p.type === 'shallow_exit') buildShallowExit(W, p);
      }
      // 无意义台阶：纯装饰，种子确定（干燥非泳池房）
      var srng = new BR.RNG(BR.hashSeed(map.seed + ':l37steps'));
      var steps = [];
      for (var ri = 1; ri < map.rooms.length && steps.length < 3; ri++) {
        var rr = map.rooms[ri];
        if (rr.tag && rr.tag.indexOf('pool_') === 0) continue;
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

      // F1：湿脚印 / 跳水台 / 异常门（切出口）
      buildFootprints(W, map);
      buildDiveBoard(W, map);
      buildAnomDoor(W, map);

      W.objective = '泳池房：浅水可涉行，深水沿台阶下潜；深水区藏着水下通道（→L7），浅水区有离开的出口（→L0）';
    },

    onEnter: function () {
      BR.Swim._dryAmb = 'L37';
      BR.UI.setObjective(BR.World.objective || '在泳池房里找到离开的方法');
      if (BR.Audio && BR.Audio.setAmbient) BR.Audio.setAmbient('L37');
    },

    tick: function (dt) {
      BR.Swim.tick(dt);
      var W = BR.World, P = BR.Player;
      if (!P || !W || !BR.Game || BR.Game.state !== 'playing') return;
      FX37.t += dt;
      // F1：池水波纹 —— 共享 pool_water 贴图 UV 滚动（轻量，无 chunk 重建泄漏风险）
      var pw = BR.Textures.get('pool_water');
      if (pw) { pw.offset.x = (FX37.t * 0.008) % 1; pw.offset.y = (FX37.t * 0.006) % 1; }
      // v1.4：caustics 波光层 UV 滚动（与 L7 同贴图，不在 L37 关时不跑）
      if (FX37.caustTex) {
        FX37.caustTex.offset.x = (FX37.t * 0.011) % 1;
        FX37.caustTex.offset.y = (FX37.t * 0.014) % 1;
      }
      // v1.5 W5：小鸭子待机浮动（骑乘中的由 player.js mountHandle 分支驱动 update）
      if (FX37.duckHandles) {
        for (var dhi = 0; dhi < FX37.duckHandles.length; dhi++) {
          var dh = FX37.duckHandles[dhi];
          var riding = P.isMounted() && P.mountHandle === dh;
          if (!riding && dh.idle) { try { dh.idle(dt); } catch (e) {} }
        }
      }
      tickWakeRings(W, dt);
      tickLaneDividers();
      // v1.5 W5：游泳声音状态机（入水/出水/划水）
      (function swimSounds() {
        var sw = BR.Swim, A = BR.Audio;
        if (!sw || !A) return;
        if (sw.inWater && !sw._sndIn) {
          sw._sndIn = true;
          if (A.l37WaterEnter) { try { A.l37WaterEnter(); } catch (e) {} }
        } else if (!sw.inWater && sw._sndIn) {
          sw._sndIn = false;
          if (A.l37WaterExit) { try { A.l37WaterExit(); } catch (e) {} }
        }
        if (sw.inWater && P._mode === 'swim') {
          sw._strokeT = (sw._strokeT || 0) - dt;
          var moving = Math.abs(P.vel.x) + Math.abs(P.vel.z) > 0.6;
          if (moving && sw._strokeT <= 0) {
            sw._strokeT = 1.6;
            if (A.l37SwimStroke) { try { A.l37SwimStroke(); } catch (e) {} }
          }
        } else sw._strokeT = 0;
      })();
      // v1.5 W5：水道↔池厅环境音切换（窄水道用集中版 L37_channel）
      (function channelAmbient() {
        var meta = W.map && W.map.meta && W.map.meta.l37;
        var ch = meta && meta.chanRects;
        var inChan = false;
        if (ch && P.pos) {
          for (var i = 0; i < ch.length; i++) {
            var r = ch[i];
            if (P.pos.x >= r.x0 * TILE && P.pos.x <= (r.x1 + 1) * TILE &&
                P.pos.z >= r.y0 * TILE && P.pos.z <= (r.y1 + 1) * TILE) { inChan = true; break; }
          }
        }
        var want = inChan ? 'L37_channel' : 'L37';
        var sw = BR.Swim;
        if (sw && sw._dryAmb !== want) {
          sw._dryAmb = want;
          var A = BR.Audio;
          if (A && A.setAmbient && A._ambientLevel !== want && A._ambientLevel !== want + '_uw') {
            try { A.setAmbient(want, 1.5); } catch (e) {}
          }
        }
      })();
      // v1.4：深水理智侵蚀（水深≥1.5m 区域，E 路下潜后可达；公式同 L7 系数）
      if (P.pos && typeof P.drainSanity === 'function' && BR.Levels.L37.waterAt) {
        var winfo = BR.Levels.L37.waterAt(P.pos.x, P.pos.z);
        if (winfo && winfo.depth >= 1.5) P.drainSanity(dt * (1.0 + 0.5 * winfo.depth));
      }
      // F1：跳水台站立 —— 站立区内 pos.y 平滑过渡到台高，离开则落回
      // （v1.4：只在非游泳时生效，避免把坑里游泳的玩家拽上台；
      //   起跳高于台面时不下拽，与 E 路跳跃物理兼容）
      var b = FX37.board;
      if (b && !FX37.dive) {
        var onB = P.pos.x > b.x0 && P.pos.x < b.x1 && P.pos.z > b.z0 && P.pos.z < b.z1;
        if ((onB && P.pos.y > -0.05) || (!onB && P.pos.y > 0.02))
          P.pos.y = BR.damp(P.pos.y, onB ? Math.max(b.topY, P.pos.y) : 0, 8, dt);
      }
      // F1：跳水动画（0.9s 抛物线入水）
      if (FX37.dive) {
        var dv = FX37.dive;
        dv.t += dt;
        var e = Math.min(1, dv.t / dv.dur);
        P.pos.x = dv.x0 + dv.dx * e;
        P.pos.z = dv.z0 + dv.dz * e;
        P.pos.y = Math.max(0, dv.y0 * (1 - e) - 0.25 * Math.sin(e * Math.PI));
        P.vel.set(0, 0, 0);
        if (e >= 1) {
          P.pos.y = 0; FX37.dive = null;
          BR.Audio.splash(); P.landDip();
          spawnSplash(W, P.pos.x, 1.0, P.pos.z);
          BR.UI.toast('噗通！', 1500);
        }
      }
      // F1：水花粒子更新
      for (var pi = FX37.parts.length - 1; pi >= 0; pi--) {
        var pt = FX37.parts[pi];
        pt.life -= dt;
        if (pt.life <= 0) {
          if (W.scene) W.scene.remove(pt.m);
          if (pt.ring) { if (pt.m.geometry) pt.m.geometry.dispose(); if (pt.m.material) pt.m.material.dispose(); }
          FX37.parts.splice(pi, 1);
          continue;
        }
        if (pt.ring) {
          var rs = 1 + (1 - pt.life / pt.max) * 5;
          pt.m.scale.set(rs, rs, 1);
          pt.m.material.opacity = 0.7 * (pt.life / pt.max);
        } else {
          pt.vy -= 9 * dt;
          pt.m.position.x += pt.vx * dt;
          pt.m.position.y = Math.max(0.05, pt.m.position.y + pt.vy * dt);
          pt.m.position.z += pt.vz * dt;
          var ps = Math.max(0.05, pt.life / pt.max);
          pt.m.scale.set(ps, ps, ps);
        }
      }
    }
  };

  /* ================= 与 E 路的接口约定（E 做游泳物理，本文件绑定） =================
   *   BR.Levels.L37.waterAt(x, z) -> null（无水）| {surface: 水面Y, floor: 池底Y, depth}
   *   BR.Levels.L37.isWater(x, z) -> bool（快捷）
   * 纯逻辑实现：gen_l37.js 的 BR.Gen.L37waterAt(map, x, z)（Node 可测）；
   * 这里绑定到当前关卡地图。签名已冻结，E 路直接调用，不许改。
   * ============================================================================ */
  BR.Levels.L37.waterAt = function (x, z) {
    var Wm = BR.World && BR.World.map;
    return Wm ? BR.Gen.L37waterAt(Wm, x, z) : null;
  };
  BR.Levels.L37.isWater = function (x, z) {
    return !!BR.Levels.L37.waterAt(x, z);
  };
  /* 附加（不改上面签名）：E 路 player.js _groundYAt 会探测 lvl.floorYAt，
   * 用于涉水/陆地模式的地面跟随（台阶/缓坡）。无水区返回 0。 */
  BR.Levels.L37.floorYAt = function (x, z) {
    var Wm = BR.World && BR.World.map;
    return Wm ? BR.Gen.L37floorAt(Wm, x, z) : 0;
  };
})();
