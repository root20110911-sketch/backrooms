/* gen_l25.js —— Level 25「街机枢纽·Quarter Hub」地图生成
 * 原型：Wikidot Level 25 "The Quarter Hub"（废弃 80 年代街机厅，大回声房间 +
 *   穿插走廊 + 后场景储藏区；约 1/1500 的机器可用，投币玩 → 传送到预定层级，
 *   对面必有另一台机器；出口含 L37/L11（另见 Fandom 版出口列表））
 *   + Fandom Level 25 "Out of Order"（机身颜色密码：橙→L11；地毯房间；
 *   出口列表含 L188；霓虹星空装饰）。
 *   游戏内可达层级取交集：L37（Wikidot）、L11（Wikidot+Fandom 橙机）、
 *   L188（Fandom）。无原著依据的连接一律不做。
 * 布局（56×56，确定性雕刻，rng 只决定内容/机器状态）：
 *   入口厅（南，cols 24..31, rows 47..52）→ 走廊 → 机厅 A（rows 30..44）
 *   → 走廊 → 机厅 B（rows 12..28）→ 走廊 → 后场景储藏区（rows 2..10：
 *   西储藏/中锅炉房/东储藏）+ 西走廊/东走廊贯通。
 *   街机 = 占 1 tile 的"墙"（碰撞走 tile；渲染由 lv_l25 按 meta.l25.cabs 自建，
 *   默认墙体渲染对街机 tile 全部 skipWall），屏幕朝过道。
 * POI 类型（lv_l25.js 消费）：spawn / cab_t37 / cab_t11 / cab_t188 /
 *   cab_weird / quarter / note / crate / thin_wall
 * CRITICAL: spawn, cab_t37, cab_t11, cab_t188（POI 落在街机前方地板上，保证可达）
 * 铁律：只用传入的 rng，禁用 Math.random / Date / DOM / THREE（贴图绘制器除外）。
 */
(function () {
  var BR = window.BR;

  /* ============ 确定性绘制辅助（顶层；test-gen.js 对 mkCanvas/pr 豁免 document） ============ */
  function pr(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function grain(x, w, h, n, alpha, seed) {
    for (var i = 0; i < n; i++) {
      var a = alpha * (0.4 + pr(seed + i) * 0.6);
      x.fillStyle = pr(seed + 5000 + i) < 0.55
        ? 'rgba(0,0,0,' + a.toFixed(3) + ')'
        : 'rgba(255,255,255,' + (a * 0.7).toFixed(3) + ')';
      var s = 1 + ((pr(seed + 9000 + i) * 2) | 0);
      x.fillRect((pr(seed + 11000 + i) * w) | 0, (pr(seed + 13000 + i) * h) | 0, s, s);
    }
  }

  /* ================= 贴图 ================= */
  // arc_wall：暗酒红墙纸 + 金色菱形纹 + 霉斑污渍（Wikidot：maroon-painted walls）
  BR.Textures.registerTex('arc_wall', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#4a1f28'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(198,160,90,0.28)'; x.lineWidth = 3;
    var s = 64;
    for (var ry = -1; ry < h / s + 1; ry++)
      for (var rx = -1; rx < w / s + 1; rx++) {
        var cx = rx * s + (ry % 2 ? s / 2 : 0), cy = ry * s;
        x.beginPath();
        x.moveTo(cx, cy - s * 0.32); x.lineTo(cx + s * 0.32, cy);
        x.lineTo(cx, cy + s * 0.32); x.lineTo(cx - s * 0.32, cy);
        x.closePath(); x.stroke();
      }
    // 霉斑
    for (var i = 0; i < 26; i++) {
      var px = pr(100 + i) * w, py = pr(200 + i) * h, r = 8 + pr(300 + i) * 26;
      var g = x.createRadialGradient(px, py, 1, px, py, r);
      g.addColorStop(0, 'rgba(20,26,16,0.5)'); g.addColorStop(1, 'rgba(20,26,16,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    grain(x, w, h, 900, 0.10, 700);
    x.fillStyle = 'rgba(8,6,8,0.55)'; x.fillRect(0, h - 14, w, 14); // 踢脚线污边
    return c;
  });
  // arc_carpet：80 年代街机地毯（深底 + 霓虹色几何涂鸦纹）
  BR.Textures.registerTex('arc_carpet', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#191424'; x.fillRect(0, 0, w, h);
    var cols = ['rgba(255,80,180,0.5)', 'rgba(80,200,255,0.45)', 'rgba(255,200,60,0.4)', 'rgba(120,255,150,0.35)'];
    for (var i = 0; i < 46; i++) {
      x.strokeStyle = cols[i % 4]; x.lineWidth = 3 + pr(400 + i) * 3;
      var sx = pr(500 + i) * w, sy = pr(600 + i) * h;
      x.beginPath(); x.moveTo(sx, sy);
      x.bezierCurveTo(sx + (pr(700 + i) - 0.5) * 120, sy + (pr(800 + i) - 0.5) * 120,
        sx + (pr(900 + i) - 0.5) * 120, sy + (pr(1000 + i) - 0.5) * 120,
        sx + (pr(1100 + i) - 0.5) * 160, sy + (pr(1200 + i) - 0.5) * 160);
      x.stroke();
      // 小三角
      if (pr(1300 + i) < 0.5) {
        var tx = pr(1400 + i) * w, ty = pr(1500 + i) * h, r = 6 + pr(1600 + i) * 10;
        x.beginPath(); x.moveTo(tx, ty - r); x.lineTo(tx + r, ty + r); x.lineTo(tx - r, ty + r);
        x.closePath(); x.stroke();
      }
    }
    grain(x, w, h, 1600, 0.12, 1700);
    return c;
  });
  // arc_ceil：深色吸音吊顶板 + 水渍（Wikidot：polystyrene ceiling，滴水管道）
  BR.Textures.registerTex('arc_ceil', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#232028'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 4;
    for (var gx = 0; gx <= w; gx += 64) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, h); x.stroke(); }
    for (var gy = 0; gy <= h; gy += 64) { x.beginPath(); x.moveTo(0, gy); x.lineTo(w, gy); x.stroke(); }
    for (var i = 0; i < 14; i++) { // 水渍黄斑
      var px = pr(1800 + i) * w, py = pr(1900 + i) * h, r = 10 + pr(2000 + i) * 30;
      var g = x.createRadialGradient(px, py, 1, px, py, r);
      g.addColorStop(0, 'rgba(150,120,60,0.35)'); g.addColorStop(1, 'rgba(150,120,60,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    grain(x, w, h, 700, 0.08, 2100);
    return c;
  });
  // cab_side：机身侧面太空主题贴画（Fandom：outer space theme）
  BR.Textures.registerTex('cab_side', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#101018'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 90; i++) { // 星空
      x.fillStyle = 'rgba(255,255,255,' + (0.3 + pr(2200 + i) * 0.7).toFixed(2) + ')';
      var s = pr(2300 + i) < 0.85 ? 2 : 3;
      x.fillRect(pr(2400 + i) * w, pr(2500 + i) * h, s, s);
    }
    // 土星
    var px = w * 0.5, py = h * 0.38, r = w * 0.16;
    x.fillStyle = '#c9a86a'; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(220,200,160,0.8)'; x.lineWidth = 6;
    x.beginPath(); x.ellipse(px, py, r * 1.9, r * 0.5, -0.4, 0, Math.PI * 2); x.stroke();
    // 像素飞船
    x.fillStyle = '#7df0ff';
    for (var k = 0; k < 12; k++) x.fillRect(w * 0.2 + (k % 4) * 8, h * 0.66 + ((k / 4) | 0) * 8, 7, 7);
    x.fillStyle = '#ff5fa2';
    for (var k2 = 0; k2 < 8; k2++) x.fillRect(w * 0.68 + (k2 % 4) * 8, h * 0.72 + ((k2 / 4) | 0) * 8, 7, 7);
    grain(x, w, h, 500, 0.12, 2600);
    // 撕痕/褪色
    x.fillStyle = 'rgba(10,10,12,0.5)';
    for (var t = 0; t < 5; t++) x.fillRect(pr(2700 + t) * w, 0, 4 + pr(2800 + t) * 8, h * (0.2 + pr(2900 + t) * 0.5));
    return c;
  });
  // boiler：后场景锅炉（锈蚀金属 + 压力表）
  BR.Textures.registerTex('boiler', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#3a3430'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 40; i++) { // 锈斑
      var px = pr(3000 + i) * w, py = pr(3100 + i) * h, r = 6 + pr(3200 + i) * 22;
      var g = x.createRadialGradient(px, py, 1, px, py, r);
      g.addColorStop(0, 'rgba(140,70,30,0.45)'); g.addColorStop(1, 'rgba(140,70,30,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 5;
    for (var b = 1; b < 4; b++) { x.beginPath(); x.moveTo(0, h * b / 4); x.lineTo(w, h * b / 4); x.stroke(); }
    // 压力表
    x.fillStyle = '#d8d4c8'; x.beginPath(); x.arc(w * 0.5, h * 0.3, 26, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 4; x.beginPath(); x.arc(w * 0.5, h * 0.3, 26, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#a33'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(w * 0.5, h * 0.3); x.lineTo(w * 0.5 + 14, h * 0.3 - 10); x.stroke();
    grain(x, w, h, 600, 0.1, 3300);
    return c;
  });
  // neon_sign：霓虹招牌底板（"QUARTER HUB" 粉蓝霓虹）
  // v2.5 F9：原画布为贴图系统默认 256×256 方幅，64px 粗体 "QUARTER" 字宽溢出
  // 画布左右缘，首尾字母被裁。改用 512×256 宽幅画布（与招牌面 5.6×2.4 近比例），
  // 并按 measureText 实测字宽自适应缩字号，两侧各留 32px 给描边+辉光（shadowBlur 26），
  // 保证字样首尾完整不出界；颜色/辉光/底板/噪点等其余绘制不变。
  BR.Textures.registerTex('neon_sign', function (w, h) {
    var CW = 512, CH = 256;
    var c = mkCanvas(CW, CH), x = c.getContext('2d');
    x.fillStyle = '#0a0a12'; x.fillRect(0, 0, CW, CH);
    function neon(text, y, color, glow) {
      var size = 64;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'bold ' + size + 'px sans-serif';
      var maxW = CW - 64; // 两侧各留 32px：字本身 + 辉光都不出界
      var tw = x.measureText(text).width;
      if (tw > maxW) {
        size = Math.max(20, Math.floor(size * maxW / tw));
        x.font = 'bold ' + size + 'px sans-serif';
      }
      x.shadowColor = color; x.shadowBlur = 26;
      x.strokeStyle = color; x.lineWidth = 3;
      x.strokeText(text, CW / 2, y);
      x.shadowBlur = 0;
      x.strokeStyle = glow; x.lineWidth = 1.5;
      x.strokeText(text, CW / 2, y);
    }
    neon('QUARTER', CH * 0.32, '#ff5fa2', '#ffd9ec');
    neon('HUB', CH * 0.72, '#5fd4ff', '#d9f4ff');
    grain(x, CW, CH, 300, 0.08, 3400);
    return c;
  });

  /* ---------- 屏幕贴图（共享材质，lv 里按状态切换） ---------- */
  function scrBase(w, h, bg) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    return [c, x];
  }
  function scanlines(x, w, h) {
    x.fillStyle = 'rgba(0,0,0,0.28)';
    for (var y = 0; y < h; y += 4) x.fillRect(0, y, w, 2);
    var g = x.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
  function attractPainter(txt, fg) {
    return function (w, h) {
      var b = scrBase(w, h, '#0b1026'), c = b[0], x = b[1];
      // 像素星空
      for (var i = 0; i < 60; i++) {
        x.fillStyle = 'rgba(160,200,255,' + (0.3 + pr(3500 + i) * 0.6).toFixed(2) + ')';
        x.fillRect((pr(3600 + i) * w) | 0, (pr(3700 + i) * h) | 0, 2, 2);
      }
      x.fillStyle = fg; x.font = 'bold 26px monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(txt, w / 2, h * 0.36);
      x.font = 'bold 17px monospace'; x.fillStyle = '#ffe27a';
      x.fillText('INSERT COIN', w / 2, h * 0.62);
      x.font = '12px monospace'; x.fillStyle = '#8fa3c8';
      x.fillText('1 CREDIT = 1 PLAY', w / 2, h * 0.78);
      scanlines(x, w, h);
      return c;
    };
  }
  BR.Textures.registerTex('scr_attract0', attractPainter('STAR VOID', '#7df0ff'));
  BR.Textures.registerTex('scr_attract1', attractPainter('NEON MAZE', '#ff5fa2'));
  function staticPainter(seed) {
    return function (w, h) {
      var b = scrBase(w, h, '#101014'), c = b[0], x = b[1];
      for (var i = 0; i < w * h / 14; i++) {
        var v = (pr(seed + i) * 255) | 0;
        x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        x.fillRect((pr(seed + 4000 + i) * w) | 0, (pr(seed + 5000 + i) * h) | 0, 2, 2);
      }
      scanlines(x, w, h);
      return c;
    };
  }
  BR.Textures.registerTex('scr_static0', staticPainter(6000));
  BR.Textures.registerTex('scr_static1', staticPainter(6100));
  BR.Textures.registerTex('scr_static2', staticPainter(6200));
  BR.Textures.registerTex('scr_static3', staticPainter(6300));
  // scr_glitch：花屏（色块错位 + 撕裂）
  BR.Textures.registerTex('scr_glitch', function (w, h) {
    var b = scrBase(w, h, '#0c0c14'), c = b[0], x = b[1];
    var cols = ['#ff2d78', '#2dffc4', '#3d6bff', '#ffe93d', '#b44dff'];
    for (var i = 0; i < 9; i++) {
      x.fillStyle = cols[i % 5];
      var sy = pr(6400 + i) * h, sh = 8 + pr(6500 + i) * 26;
      x.fillRect(pr(6600 + i) * w * 0.4, sy, w * 0.7, sh);
    }
    x.fillStyle = 'rgba(255,255,255,0.75)'; x.font = 'bold 20px monospace';
    x.textAlign = 'center';
    x.fillText('S I G N A L   L O S T', w / 2, h * 0.5);
    scanlines(x, w, h);
    return c;
  });
  // scr_off：黑屏（微弱反光）
  BR.Textures.registerTex('scr_off', function (w, h) {
    var b = scrBase(w, h, '#050507'), c = b[0], x = b[1];
    var g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(120,140,180,0.10)'); g.addColorStop(0.5, 'rgba(120,140,180,0)');
    g.addColorStop(1, 'rgba(120,140,180,0.07)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return c;
  });
  // scr_weird：异常机器——扭曲的笑脸
  BR.Textures.registerTex('scr_weird', function (w, h) {
    var b = scrBase(w, h, '#0a0a12'), c = b[0], x = b[1];
    x.strokeStyle = '#ff3d5e'; x.lineWidth = 7;
    x.beginPath(); x.ellipse(w / 2, h / 2, w * 0.3, h * 0.36, 0.12, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#ff3d5e';
    x.beginPath(); x.arc(w * 0.4, h * 0.4, 9, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(w * 0.62, h * 0.44, 9, 0, Math.PI * 2); x.fill();
    x.lineWidth = 6; x.beginPath();
    x.arc(w / 2, h * 0.52, w * 0.2, 0.25 * Math.PI, 0.78 * Math.PI); x.stroke();
    // 撕裂
    x.fillStyle = 'rgba(10,10,14,0.85)';
    for (var i = 0; i < 4; i++) x.fillRect(pr(6700 + i) * w, 0, 5 + pr(6800 + i) * 10, h);
    scanlines(x, w, h);
    return c;
  });
  // scr_win：胜利闪屏
  BR.Textures.registerTex('scr_win', function (w, h) {
    var b = scrBase(w, h, '#061a10'), c = b[0], x = b[1];
    x.fillStyle = '#5dffb0'; x.font = 'bold 30px monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('YOU WIN!', w / 2, h * 0.4);
    x.font = 'bold 16px monospace'; x.fillStyle = '#ffe27a';
    x.fillText('>>> WARP <<<', w / 2, h * 0.66);
    scanlines(x, w, h);
    return c;
  });

  BR.Textures.registerWallTex('L25', 'arc_wall');

  /* ================= 环境音：街机厅嗡鸣 + 远处 8-bit 碎片 + 风机 ================= */
  BR.Audio.registerAmbient('L25', function () {
    var rig = this._loopRig(function (R) {
      // 荧光灯/镇流器嗡鸣
      var o1 = R.osc('sine', 118), g1 = R.gain(0.16);
      o1.connect(g1); g1.connect(R.group);
      var o2 = R.osc('sine', 236), g2 = R.gain(0.05);
      o2.connect(g2); g2.connect(R.group);
      // CRT 高频啸叫（很轻）
      var o3 = R.osc('sine', 15700), g3 = R.gain(0.008);
      o3.connect(g3); g3.connect(R.group);
      // 远处风机
      var n = R.noise(), f = R.filter('lowpass', 300, 0.4), g = R.gain(0.10);
      n.connect(f); f.connect(g); g.connect(R.group);
      // 偶发 8-bit 碎片旋律（慢速方波琶音，音量包络随机起伏）
      var arp = R.osc('square', 440), ag = R.gain(0.0);
      arp.connect(ag); ag.connect(R.group);
      var notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
      var ni = 0;
      var lfo = R.osc('sine', 0.11), lg = R.gain(1);
      lfo.connect(lg);
      // 用增益 LFO 做旋律门控的近似（确定性近似即可）
      var gate = R.osc('square', 0.9), gg = R.gain(0.028);
      gate.connect(gg); gg.connect(ag.gain);
      var step = R.osc('sine', 0.9), sf = R.gain(220);
      step.connect(sf); sf.connect(arp.frequency);
    });
    rig.target = 0.40;
    return rig;
  });

  /* ================= 关卡注册 ================= */
  BR.Gen.registerLevel('L25',
    { rw: [5, 10], rh: [5, 10], corrW: [2, 2], loops: [6, 10], wallH: 3.0 },
    placeL25,
    ['spawn', 'cab_t37', 'cab_t11', 'cab_t188']
  );

  /* ================= placer ================= */
  function placeL25(map, rng) {
    var W = map.w, H = map.h, MGN = 2;
    function T(x, y) { return y * W + x; }
    function tile(x, y) {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      return map.tiles[T(x, y)];
    }
    function setT(x, y, v) { if (x >= MGN && y >= MGN && x < W - MGN && y < H - MGN) map.tiles[T(x, y)] = v; }
    function carveRect(x0, y0, x1, y1) {
      for (var y = y0; y <= y1; y++)
        for (var x = x0; x <= x1; x++) setT(x, y, 1);
    }
    function wallRect(x0, y0, x1, y1, gaps) { // gaps: [[x,y],...] 留洞
      for (var y = y0; y <= y1; y++)
        for (var x = x0; x <= x1; x++) {
          var g = false;
          if (gaps) for (var i = 0; i < gaps.length; i++)
            if (gaps[i][0] === x && gaps[i][1] === y) { g = true; break; }
          if (!g) setT(x, y, 0);
        }
    }
    function addPOI(type, tx, ty, data) {
      var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
      map.pois.push(p);
      return p;
    }

    /* ---------- Stage 0：清空 ---------- */
    for (var ci = 0; ci < map.tiles.length; ci++) map.tiles[ci] = 0;
    map.rooms.length = 0;

    /* ---------- Stage 1：分区雕刻（确定性） ---------- */
    // 入口厅（南）
    carveRect(24, 47, 31, 52);
    carveRect(26, 44, 29, 46);          // C1 走廊
    // 机厅 A
    carveRect(6, 30, 49, 44);
    carveRect(26, 28, 29, 29);          // C2 走廊
    // 机厅 B
    carveRect(6, 12, 49, 28);
    carveRect(26, 10, 29, 11);          // C3 走廊
    // 后场景储藏区
    carveRect(6, 2, 49, 9);
    wallRect(21, 2, 21, 9, [[21, 6]]);  // 西/中隔墙
    wallRect(34, 2, 34, 9, [[34, 6]]);  // 中/东隔墙
    // 西走廊 / 东走廊
    carveRect(8, 10, 10, 44);
    carveRect(45, 30, 47, 52);
    carveRect(31, 48, 45, 49);          // 东走廊 ↔ 入口厅
    // 储藏区货架挡墙（确定性）
    wallRect(9, 4, 10, 5); wallRect(14, 6, 15, 7); wallRect(18, 3, 19, 4);
    wallRect(38, 4, 39, 5); wallRect(43, 6, 44, 7); wallRect(47, 3, 48, 4);

    /* ---------- Stage 2：街机行（tile=0 墙，lv 自建渲染） ---------- */
    var cabs = []; // {tx,ty,nx,nz} nx,nz = 屏幕朝向（指向过道）
    var reserved = {}; // 走廊零星机器占位，cabRow 避让
    function singleCab(tx, ty, nx, nz) {
      setT(tx, ty, 0);
      cabs.push({ tx: tx, ty: ty, nx: nx, nz: nz });
      reserved[tx + ',' + ty] = 1;
    }
    // 走廊里的零星机器（Wikidot：走廊也可摆一两台）——先占位，避开街机行前方
    singleCab(9, 17, 1, 0);    // 西走廊，朝东（避开 y=13/14/21/22 行的前方）
    singleCab(25, 50, 1, 0);   // 入口厅，朝东
    singleCab(46, 44, -1, 0);  // 东走廊，朝西（避开 y=39/40 行的前方）
    function cabRow(y, x0, x1, face) { // face: 'N' 屏幕朝北（玩家在 y-1）
      for (var x = x0; x <= x1; x++) {
        if ((x - x0) % 9 >= 7) continue; // 每 9 格留 2 格穿行口
        if (reserved[x + ',' + y]) continue;
        var fx = x, fy = y + (face === 'N' ? -1 : 1);
        if (reserved[fx + ',' + fy]) continue; // 前方被占位也不摆
        if (rng.chance(0.42)) continue;  // 空槽：渲染为普通墙（省 draw call）
        setT(x, y, 0);
        cabs.push({ tx: x, ty: y, nx: 0, nz: face === 'N' ? -1 : 1 });
      }
    }
    // 机厅 A（背靠背双行；行数克制，保证 draw call 预算）
    cabRow(31, 8, 47, 'N'); cabRow(32, 8, 47, 'S');
    cabRow(39, 8, 47, 'N'); cabRow(40, 8, 47, 'S');
    // 机厅 B
    cabRow(13, 8, 47, 'N'); cabRow(14, 8, 47, 'S');
    cabRow(21, 8, 47, 'N'); cabRow(22, 8, 47, 'S');

    /* ---------- Stage 3：机器状态（rng） ---------- */
    var COLORS = ['red', 'orange', 'blue', 'purple', 'teal', 'yellow'];
    var workCands = [];
    for (var i = 0; i < cabs.length; i++) {
      var cb = cabs[i], r = rng.next();
      cb.idx = i;
      cb.color = rng.pick(COLORS);
      cb.attr = rng.pick([0, 1]); // attract 屏版本
      if (r < 0.16) { cb.state = 'work'; workCands.push(cb); }
      else if (r < 0.26) cb.state = 'inspect'; // 可观察的故障机（花屏）
      else if (r < 0.44) cb.state = 'off';
      else cb.state = 'broken';
      cb.tipped = cb.state === 'broken' && rng.chance(0.3); // 推倒的残机
    }
    // 异常机器 ×1：从 inspect 里挑离出生最远的
    var spawnTx = 27, spawnTy = 50;
    var inspects = cabs.filter(function (c) { return c.state === 'inspect'; });
    inspects.sort(function (a, b) {
      return (Math.hypot(b.tx - spawnTx, b.ty - spawnTy) - Math.hypot(a.tx - spawnTx, a.ty - spawnTy));
    });
    var weird = inspects.length ? inspects[0] : cabs[0];
    weird.state = 'weird';
    // 3 台跨关机器：work 里 farthest-point 散布 + 离出生 > 12 格
    function farthest(pts, n, minD2) {
      var out = [];
      if (!pts.length) return out;
      out.push(rng.pick(pts));
      var guard = 0;
      while (out.length < n && guard++ < 300) {
        var best = null, bd = -1;
        for (var t = 0; t < 20; t++) {
          var c = rng.pick(pts), md = Infinity;
          for (var k = 0; k < out.length; k++)
            md = Math.min(md, (c.tx - out[k].tx) * (c.tx - out[k].tx) + (c.ty - out[k].ty) * (c.ty - out[k].ty));
          if (md > bd) { bd = md; best = c; }
        }
        if (minD2 && bd < minD2) break;
        if (out.indexOf(best) < 0) out.push(best);
      }
      return out;
    }
    var far = workCands.filter(function (c) {
      return Math.hypot(c.tx - spawnTx, c.ty - spawnTy) > 12;
    });
    if (far.length < 3) far = workCands.slice(); // 极端兜底
    var tethers = farthest(far, 3, 100);
    while (tethers.length < 3 && workCands.length > tethers.length) {
      var extra = rng.pick(workCands);
      if (tethers.indexOf(extra) < 0) tethers.push(extra);
    }
    var TETH = [
      { dest: 'L37', color: 'red', hint: '机身贴着褪色标签：「L37 —— 小心水」' },
      { dest: 'L11', color: 'orange', hint: '机身贴着褪色标签：「11」' },
      { dest: 'L188', color: 'blue', hint: '机身画满星星，贴着标签：「188」' }
    ];
    for (var ti = 0; ti < tethers.length; ti++) {
      var tc = tethers[ti];
      tc.state = 'tether';
      tc.dest = TETH[ti].dest;
      tc.color = TETH[ti].color;
      tc.hint = TETH[ti].hint;
    }
    // 保证至少 4 台普通可玩机（不含 tether）
    var plain = cabs.filter(function (c) { return c.state === 'work'; });
    var need = 4 - plain.length, guard2 = 0;
    while (need > 0 && guard2++ < 200) {
      var cand = rng.pick(cabs);
      if (cand.state === 'off' || cand.state === 'broken') { cand.state = 'work'; need--; }
    }
    map.meta.l25 = { cabs: cabs.map(function (c, idx) {
      return { tx: c.tx, ty: c.ty, nx: c.nx, nz: c.nz, state: c.state,
        color: c.color, attr: c.attr, tipped: !!c.tipped,
        dest: c.dest || null, hint: c.hint || null, idx: idx };
    }),
    shelves: [[9, 4, 10, 5], [14, 6, 15, 7], [18, 3, 19, 4],
              [38, 4, 39, 5], [43, 6, 44, 7], [47, 3, 48, 4]] };
    map.rooms = [
      { id: 'entry', x: 24, y: 47, w: 8, h: 6, cx: 27.5, cy: 49.5, tag: 'hall' },
      { id: 'hallA', x: 6, y: 30, w: 44, h: 15, cx: 28, cy: 37, tag: 'hall' },
      { id: 'hallB', x: 6, y: 12, w: 44, h: 17, cx: 28, cy: 20, tag: 'hall' },
      { id: 'storeW', x: 6, y: 2, w: 15, h: 8, cx: 13.5, cy: 6, tag: 'store' },
      { id: 'boiler', x: 22, y: 2, w: 12, h: 8, cx: 28, cy: 6, tag: 'store' },
      { id: 'storeE', x: 35, y: 2, w: 15, h: 8, cx: 42, cy: 6, tag: 'store' }
    ];

    /* ---------- Stage 4：POI ---------- */
    // 出生
    addPOI('spawn', spawnTx, spawnTy, {});
    function frontTile(cb) { return [cb.tx + cb.nx, cb.ty + cb.nz]; }
    // 3 台跨关机（POI 落在前方地板）
    tethers.forEach(function (tc) {
      var f = frontTile(tc);
      var type = tc.dest === 'L37' ? 'cab_t37' : (tc.dest === 'L11' ? 'cab_t11' : 'cab_t188');
      addPOI(type, f[0], f[1], { cabIdx: tc.idx, dest: tc.dest });
    });
    // 异常机
    (function () {
      var f = frontTile(weird);
      addPOI('cab_weird', f[0], f[1], { cabIdx: weird.idx });
    })();
    // 游戏币 ×7：储藏区为主（Wikidot：硬币常见于箱子与角落）
    var qSpots = [
      [8, 3], [18, 8],           // 西储藏
      [24, 4], [31, 8],           // 锅炉房
      [37, 3], [46, 8],           // 东储藏
      [12, 43]                    // 机厅 A 角落
    ];
    // 抖动到附近地板（确定性：rng）
    for (var qi = 0; qi < qSpots.length; qi++) {
      var qx = qSpots[qi][0], qy = qSpots[qi][1], qg = 0;
      while (tile(qx, qy) !== 1 && qg++ < 12) {
        qx += rng.int(-1, 1); qy += rng.int(-1, 1);
        if (qx < MGN) qx = MGN; if (qy < MGN) qy = MGN;
        if (qx >= W - MGN) qx = W - MGN - 1; if (qy >= H - MGN) qy = H - MGN - 1;
      }
      if (tile(qx, qy) === 1) addPOI('quarter', qx, qy, {});
    }
    // 字条 ×2
    addPOI('note', 30, 49, { noteId: 'L25_note0' });
    addPOI('note', 28, 3, { noteId: 'L25_note1' });
    // 补给箱 ×2（后场景，Wikidot：锅炉房常见杏仁水/零食）
    addPOI('crate', 12, 8, { item: 'almond' });
    addPOI('crate', 41, 8, { item: 'bandage' });
    // 薄墙 ×1（东储藏墙边，随机切出）
    (function () {
      var sts = [];
      for (var y = 3; y <= 8; y++)
        for (var x = 36; x <= 48; x++)
          if (tile(x, y) === 1) sts.push([x, y]);
      var guard3 = 0;
      while (sts.length && guard3++ < 60) {
        var t = rng.pick(sts);
        var dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        for (var d = 0; d < 4; d++) {
          var wx = t[0] + dirs[d][0], wy = t[1] + dirs[d][1];
          if (tile(wx, wy) === 0 && wx >= MGN && wy >= MGN && wx < W - MGN && wy < H - MGN) {
            addPOI('thin_wall', t[0], t[1], { dx: dirs[d][0], dz: dirs[d][1] });
            return;
          }
        }
      }
    })();
  }
})();
