/* gen_l188.js —— Level 188「百窗庭」地图生成
 * 原型：Fandom Backrooms Wiki 的 Level 188 "The Windows"（酒店版）：
 *   酒店式围合建筑，中央大中庭，四周墙上布满方形小窗；多数窗被窗帘遮挡（"闭窗"），
 *   少数"开窗"望向异地；"开窗"对应的房门会被未知力量锁死；中庭一端有楼梯间通往
 *   环绕的走廊。本关为游戏改编实现，与 Wikidot 的 Level 881 无关。
 *   （Entities: 0/5，无敌对实体——本关走纯氛围路线，不放怪物。）
 *
 * v1.5 W7 重构：①中庭统一整体景观（草坪/交叉步道/左侧浅水池/中央圆形铺装/
 *   地面蓝色小地灯，四面高墙 wallH=12，四层窗，夜间无自然光；参考用户提供的参考图4）；
 *   ②真二层（二楼环廊+6 间客房+楼梯间上下连通，
 *   楼梯走关内淡入淡出换层）；③窗户四态进 map.meta.l188wins（窗帘遮挡/普通房间/
 *   异空间/事件窗+可穿越窗），确定性分配，卸载不重抽；④入口附近返回门（回来源层级）
 *   + 位置随机的紧急出口（目的地=已完成层级池）；⑤异空间窗对应房门强制锁死。
 *
 * 布局（56×56，确定性雕刻，rng 只决定内容/锁）：
 *   1F：出生小房间(26..29,16..19) → 敞开门框(27,20) → 阳台(20..35,21)俯瞰中庭
 *       → 西/东/南走廊环绕 → 10 间客房 + 休息室 + 员工室 + 楼梯间大厅(36..38,38..40)
 *   中庭(20..35,22..35)四周四层窗户（104 扇）；异常窗在南墙下（POI odd_window →L1）
 *   2F（南区 46..54 行，关内楼梯换层到达）：环廊(12..42,50) + 6 间客房 + 楼梯间大厅
 *
 * POI 类型（lv_l188.js 消费，见该文件头部的清单）：
 *   spawn / balcony / hotel_room / room_door / lounge / staff_room /
 *   radio / odd_window / stairwell / stair_up / return_door / emergency_exit /
 *   note / crate / thin_wall（走廊墙边 1~2 处，跨关切出）
 *   （2F 内容不走 POI——通用可达性抽查要求全部 POI 从 spawn 可达；
 *    2F 数据放 map.meta.l188.f2，lv_l188.js 按定坐标构建）
 * CRITICAL: spawn, odd_window, stairwell（均在连通的雕刻区内）
 */
(function () {
  var BR = window.BR;

  /* ============ 确定性绘制辅助（顶层；test-gen.js 对 mkCanvas/lcg 豁免 document） ============ */
  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function mkCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  // 颗粒噪点（确定性）
  function dGrain(x, w, h, R, n, alpha) {
    for (var i = 0; i < n; i++) {
      var a = alpha * (0.4 + R() * 0.6);
      x.fillStyle = R() < 0.55
        ? 'rgba(0,0,0,' + a.toFixed(3) + ')'
        : 'rgba(255,255,255,' + (a * 0.7).toFixed(3) + ')';
      var s = 1 + ((R() * 2) | 0);
      x.fillRect((R() * w) | 0, (R() * h) | 0, s, s);
    }
  }
  // 污渍斑块（确定性）
  function dStains(x, w, h, R, count, colors, rMin, rMax) {
    for (var i = 0; i < count; i++) {
      var px = R() * w, py = R() * h, r = rMin + R() * (rMax - rMin);
      var g = x.createRadialGradient(px, py, r * 0.12, px, py, r);
      g.addColorStop(0, colors[(R() * colors.length) | 0]);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
    }
  }

  /* ============ 贴图（painter(w,h) 返回 canvas；绘制只用 lcg，不用 Math.random） ============ */
  // 酒店墙纸：暗黄竖条纹 + 腰线 + 污渍
  BR.Textures.registerTex('hotel_wall', function (w, h) {
    var R = lcg(18801);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#4e4438'; x.fillRect(0, 0, w, h); // 深色楼体（参考图4：夜间深色住宅楼）
    for (var i = 0; i < w; i += 32) {
      x.fillStyle = (i / 32) % 2 ? 'rgba(0,0,0,0.075)' : 'rgba(255,244,214,0.05)';
      x.fillRect(i, 0, 16, h);
    }
    x.fillStyle = 'rgba(255,240,200,0.06)'; // 暗纹圆点
    for (var dy = 16; dy < h; dy += 48)
      for (var dx = 8; dx < w; dx += 32) {
        x.beginPath(); x.arc(dx + ((dy / 48) % 2) * 16, dy, 5, 0, 6.2832); x.fill();
      }
    x.fillStyle = '#4a3a26'; x.fillRect(0, h - 44, w, 44); // 深色腰线
    x.fillStyle = 'rgba(255,230,180,0.10)'; x.fillRect(0, h - 44, w, 3);
    x.fillStyle = 'rgba(20,12,6,0.35)'; x.fillRect(0, h - 8, w, 8);
    dStains(x, w, h, R, 10,
      ['rgba(60,45,25,0.30)', 'rgba(40,32,20,0.32)', 'rgba(96,74,46,0.24)'], 12, 52);
    var vg = x.createLinearGradient(0, 0, 0, h);
    vg.addColorStop(0, 'rgba(255,246,220,0.08)');
    vg.addColorStop(1, 'rgba(30,22,12,0.20)');
    x.fillStyle = vg; x.fillRect(0, 0, w, h);
    dGrain(x, w, h, R, 1100, 0.10);
    return c;
  });

  // 酒店地毯：暗红棕 + 双线回纹边 + 磨损
  BR.Textures.registerTex('hotel_floor', function (w, h) {
    var R = lcg(18802);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#5a3d33'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 2400; i++) { // 绒毛
      x.strokeStyle = R() < 0.5 ? 'rgba(30,18,14,0.28)' : 'rgba(190,150,120,0.16)';
      x.lineWidth = 1;
      var px = R() * w, py = R() * h, a = R() * 6.2832;
      x.beginPath(); x.moveTo(px, py);
      x.lineTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3); x.stroke();
    }
    x.strokeStyle = 'rgba(28,17,12,0.85)'; x.lineWidth = 5; // 回纹边
    x.strokeRect(14, 14, w - 28, h - 28);
    x.strokeStyle = 'rgba(150,110,80,0.35)'; x.lineWidth = 2;
    x.strokeRect(26, 26, w - 52, h - 52);
    dStains(x, w, h, R, 8,
      ['rgba(20,14,10,0.40)', 'rgba(35,25,18,0.35)', 'rgba(70,50,35,0.25)'], 20, 64);
    dGrain(x, w, h, R, 700, 0.08);
    return c;
  });

  // 酒店吊顶：米黄矿棉板 + 水渍
  BR.Textures.registerTex('hotel_ceil', function (w, h) {
    var R = lcg(18803);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#a09a8c'; x.fillRect(0, 0, w, h);
    var t = 128;
    for (var ty = 0; ty < 2; ty++) for (var tx = 0; tx < 2; tx++) {
      var v = 150 + ((R() * 18) | 0);
      x.fillStyle = 'rgb(' + v + ',' + (v - 5) + ',' + (v - 18) + ')';
      x.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4);
    }
    x.strokeStyle = '#6e6a60'; x.lineWidth = 4;
    for (var i = 0; i <= 2; i++) {
      x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
    }
    dStains(x, w, h, R, 6,
      ['rgba(120,90,50,0.32)', 'rgba(90,70,40,0.30)'], 14, 44);
    dGrain(x, w, h, R, 700, 0.07);
    return c;
  });

  // 窗户绘制公用：外框 + 十字棂
  function winFrame(x, w, h) {
    x.fillStyle = '#241c12'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#171208'; x.fillRect(8, 8, w - 16, h - 16);
  }
  function winMullions(x, w, h) {
    x.fillStyle = '#241c12';
    x.fillRect(w / 2 - 7, 8, 14, h - 16);
    x.fillRect(8, h / 2 - 7, w - 16, 14);
  }
  // 暖黄窗（安全窗）：窗帘缝隙透出的暖光
  BR.Textures.registerTex('win_warm', function (w, h) {
    var R = lcg(18804);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fff3d0'); g.addColorStop(0.55, '#f7d996'); g.addColorStop(1, '#d8a45e');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(120,70,30,0.35)'; // 两侧窗帘阴影
    x.fillRect(0, 0, 26, h); x.fillRect(w - 26, 0, 26, h);
    for (var i = 0; i < 5; i++) { // 窗帘褶皱
      x.fillStyle = 'rgba(90,50,25,0.25)';
      x.fillRect(6 + i * 5, 0, 2, h); x.fillRect(w - 8 - i * 5, 0, 2, h);
    }
    winFrame(x, w, h);
    x.fillStyle = g; x.fillRect(14, 14, w - 28, h - 28);
    winMullions(x, w, h);
    dGrain(x, w, h, R, 150, 0.05);
    return c;
  });
  // 惨白窗（危险窗）：冷白光，棂后隐约人影
  BR.Textures.registerTex('win_cold', function (w, h) {
    var R = lcg(18805);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f2f6ff'); g.addColorStop(0.55, '#cfdcf2'); g.addColorStop(1, '#93a9c8');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(40,50,70,0.55)'; // 棂后的人影（氛围用，非跳脸）
    var sx = w * 0.62;
    x.beginPath(); x.arc(sx, h * 0.42, 20, 0, 6.2832); x.fill();
    x.fillRect(sx - 22, h * 0.42, 44, h * 0.5);
    winFrame(x, w, h);
    x.fillStyle = g; x.fillRect(14, 14, w - 28, h - 28);
    x.fillStyle = 'rgba(40,50,70,0.35)';
    x.beginPath(); x.arc(sx, h * 0.42, 20, 0, 6.2832); x.fill();
    x.fillRect(sx - 22, h * 0.42, 44, h * 0.5);
    winMullions(x, w, h);
    dGrain(x, w, h, R, 150, 0.05);
    return c;
  });
  // 异常色窗：明亮的蓝色亮窗（参考用户提供的参考图4，整院仅 1~2 扇）
  BR.Textures.registerTex('win_blue', function (w, h) {
    var R = lcg(188055);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#9fd0ff'); g.addColorStop(0.5, '#4a86e8'); g.addColorStop(1, '#1c3f9e');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(w * 0.44, 0, w * 0.12, h); // 中央竖向强光
    winFrame(x, w, h);
    x.fillStyle = g; x.fillRect(14, 14, w - 28, h - 28);
    x.fillStyle = 'rgba(255,255,255,0.75)'; x.fillRect(14 + (w - 28) * 0.44, 14, (w - 28) * 0.12, h - 28);
    winMullions(x, w, h);
    dGrain(x, w, h, R, 150, 0.05);
    return c;
  });
  // 闭窗：百叶窗紧闭（原著：别去拉窗帘）
  BR.Textures.registerTex('blinds', function (w, h) {
    var R = lcg(18806);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6a5638'); g.addColorStop(1, '#4a3a26');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 13) { // 百叶
      x.fillStyle = '#2e2620'; x.fillRect(0, y, w, 9);
      x.fillStyle = 'rgba(200,170,120,0.25)'; x.fillRect(0, y, w, 2);
    }
    x.fillStyle = 'rgba(30,22,14,0.8)'; x.fillRect(w / 2 - 2, 0, 4, h); // 拉绳
    winFrame(x, w, h);
    x.fillStyle = g; x.fillRect(14, 14, w - 28, h - 28);
    for (var y2 = 14; y2 < h - 14; y2 += 13) {
      x.fillStyle = '#2e2620'; x.fillRect(14, y2, w - 28, 9);
    }
    dGrain(x, w, h, R, 150, 0.06);
    return c;
  });
  // 暗窗：熄灯的房间
  BR.Textures.registerTex('win_dark', function (w, h) {
    var R = lcg(18807);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#0a0c10'; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(70,80,100,0.10)'; x.fillRect(0, 0, w, h * 0.3); // 微弱天光
    winFrame(x, w, h);
    x.fillStyle = '#0a0c10'; x.fillRect(14, 14, w - 28, h - 28);
    winMullions(x, w, h);
    dGrain(x, w, h, R, 120, 0.05);
    return c;
  });
  // 老式收音机前面板
  BR.Textures.registerTex('radio_front', function (w, h) {
    var R = lcg(18808);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#241c12'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#171208'; x.fillRect(8, 8, w - 16, h - 16);
    x.fillStyle = '#0d0a06'; // 喇叭网罩
    x.fillRect(24, 24, w - 48, h * 0.52);
    x.fillStyle = '#3a2f22';
    for (var dy = 30; dy < 24 + h * 0.52 - 4; dy += 8)
      for (var dx = 30; dx < w - 30; dx += 8) {
        x.beginPath(); x.arc(dx, dy, 2.4, 0, 6.2832); x.fill();
      }
    x.fillStyle = '#d8c690'; // 调谐窗
    x.fillRect(24, h * 0.62, w - 48, h * 0.16);
    x.fillStyle = '#8a2a1a'; x.fillRect(24, h * 0.62, w - 48, 3);
    x.strokeStyle = '#3a2f22'; x.lineWidth = 2; // 刻度
    for (var k = 0; k <= 10; k++) {
      x.beginPath(); x.moveTo(24 + k * (w - 48) / 10, h * 0.62);
      x.lineTo(24 + k * (w - 48) / 10, h * 0.62 + 10); x.stroke();
    }
    x.fillStyle = '#a02318'; // 红色指针
    x.fillRect(24 + (w - 48) * 0.72 - 2, h * 0.62, 4, h * 0.16);
    x.fillStyle = '#0d0a06'; // 旋钮
    x.beginPath(); x.arc(w * 0.3, h * 0.88, 14, 0, 6.2832); x.fill();
    x.beginPath(); x.arc(w * 0.7, h * 0.88, 14, 0, 6.2832); x.fill();
    x.fillStyle = '#5a4a36';
    x.beginPath(); x.arc(w * 0.3, h * 0.88, 9, 0, 6.2832); x.fill();
    x.beginPath(); x.arc(w * 0.7, h * 0.88, 9, 0, 6.2832); x.fill();
    dGrain(x, w, h, R, 200, 0.08);
    return c;
  });

  BR.Textures.registerWallTex('L188', 'hotel_wall');

  /* ============ v1.5 W7：庭院 / 窗景立体小场景贴图（全部 lcg 确定性） ============ */
  // 庭院夜草
  BR.Textures.registerTex('court_grass', function (w, h) {
    var R = lcg(18810);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#1d2b1a'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 2600; i++) {
      var g = 30 + ((R() * 40) | 0);
      x.strokeStyle = 'rgba(' + (g * 0.7 | 0) + ',' + g + ',' + (g * 0.6 | 0) + ',0.5)';
      var px = R() * w, py = R() * h;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 4, py - 2 - R() * 4); x.stroke();
    }
    dStains(x, w, h, R, 8, ['rgba(8,14,8,0.4)', 'rgba(30,44,26,0.3)'], 14, 46);
    dGrain(x, w, h, R, 500, 0.08);
    return c;
  });
  // 庭院石板路
  BR.Textures.registerTex('court_path', function (w, h) {
    var R = lcg(18811);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#3f3d38'; x.fillRect(0, 0, w, h);
    var s = 64;
    for (var ty = 0; ty < h; ty += s) for (var tx = 0; tx < w; tx += s) {
      var v = 58 + ((R() * 22) | 0);
      x.fillStyle = 'rgb(' + v + ',' + (v - 2) + ',' + (v - 6) + ')';
      x.fillRect(tx + 3, ty + 3, s - 6, s - 6);
      x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(tx + 3, ty + 3, s - 6, 4);
    }
    dStains(x, w, h, R, 10, ['rgba(16,20,14,0.35)', 'rgba(60,70,52,0.22)'], 10, 40);
    dGrain(x, w, h, R, 700, 0.09);
    return c;
  });
  // L37 式泳池瓷砖（窗景用）
  BR.Textures.registerTex('pool_tile', function (w, h) {
    var R = lcg(18812);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#cfe4e2'; x.fillRect(0, 0, w, h);
    var s = 16;
    for (var ty = 0; ty < h; ty += s) for (var tx = 0; tx < w; tx += s) {
      var v = 200 + ((R() * 40) | 0);
      x.fillStyle = 'rgb(' + (v - 30) + ',' + v + ',' + (v - 8) + ')';
      x.fillRect(tx + 1, ty + 1, s - 2, s - 2);
    }
    x.fillStyle = 'rgba(40,120,130,0.25)'; x.fillRect(0, h * 0.72, w, h * 0.28); // 下部水渍
    dGrain(x, w, h, R, 220, 0.05);
    return c;
  });
  // 暖黄客房墙纸（窗景用）
  BR.Textures.registerTex('room_warm', function (w, h) {
    var R = lcg(18813);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#8a6f4a'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < w; i += 24) {
      x.fillStyle = (i / 24) % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,240,200,0.07)';
      x.fillRect(i, 0, 12, h);
    }
    x.fillStyle = '#4a3a26'; x.fillRect(0, h - 26, w, 26);
    dGrain(x, w, h, R, 260, 0.07);
    return c;
  });
  // 夜城（L11 一角窗景用）
  BR.Textures.registerTex('city_night', function (w, h) {
    var R = lcg(18814);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#060a16'); g.addColorStop(1, '#0d1626');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (var b = 0; b < 7; b++) { // 远楼剪影
      var bw = 14 + R() * 22, bx = R() * w, bh = h * (0.4 + R() * 0.5);
      x.fillStyle = '#04060c'; x.fillRect(bx, h - bh, bw, bh);
      for (var wy = h - bh + 4; wy < h - 4; wy += 7)
        for (var wx = bx + 3; wx < bx + bw - 3; wx += 6)
          if (R() < 0.42) { x.fillStyle = R() < 0.7 ? '#ffd98a' : '#bcd4ff'; x.fillRect(wx, wy, 3, 4); }
    }
    return c;
  });
  // 深海渐变（L7 一角窗景用）
  BR.Textures.registerTex('deep_blue', function (w, h) {
    var R = lcg(18815);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a2036'); g.addColorStop(0.6, '#061423'); g.addColorStop(1, '#020608');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    dGrain(x, w, h, R, 300, 0.06);
    return c;
  });
  // 派对背景（Level Fun 窗景用）
  BR.Textures.registerTex('party_back', function (w, h) {
    var R = lcg(18816);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#241019'; x.fillRect(0, 0, w, h);
    var cols = ['#ff5b5b', '#ffd75b', '#5bff8a', '#5bb8ff', '#c97bff'];
    for (var i = 0; i < 90; i++) { // 五彩纸屑
      x.fillStyle = cols[(R() * cols.length) | 0];
      x.save(); x.translate(R() * w, R() * h); x.rotate(R() * 6.28);
      x.fillRect(-3, -1.5, 6, 3); x.restore();
    }
    dGrain(x, w, h, R, 200, 0.06);
    return c;
  });
  // 穿越窗走廊剪影（按目标层级）
  function corridorTex(base, wallC, floorC, lightC) {
    return function (w, h) {
      var R = lcg(base);
      var c = mkCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = wallC; x.fillRect(0, 0, w, h);
      x.fillStyle = floorC; x.fillRect(0, h * 0.62, w, h * 0.38);
      x.fillStyle = 'rgba(0,0,0,0.55)'; // 纵深灭点
      x.beginPath(); x.moveTo(w * 0.42, 0); x.lineTo(w * 0.58, 0);
      x.lineTo(w * 0.56, h); x.lineTo(w * 0.44, h); x.closePath(); x.fill();
      x.fillStyle = lightC; // 尽头光
      x.beginPath(); x.arc(w / 2, h * 0.46, 9, 0, 6.2832); x.fill();
      var g = x.createRadialGradient(w / 2, h * 0.46, 2, w / 2, h * 0.46, 30);
      g.addColorStop(0, lightC); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      dGrain(x, w, h, R, 200, 0.07);
      return c;
    };
  }
  BR.Textures.registerTex('corridor_l0', corridorTex(18817, '#a3905e', '#7a6a44', '#ffe9b0'));
  BR.Textures.registerTex('corridor_l1', corridorTex(18818, '#8d8d90', '#5a5a5e', '#dfe8ff'));
  BR.Textures.registerTex('corridor_l11', corridorTex(18819, '#1c2a44', '#101828', '#9fc0ff'));
  BR.Textures.registerTex('corridor_l37', corridorTex(18820, '#cfe4e2', '#7fb8bc', '#e8ffff'));
  BR.Textures.registerTex('corridor_fun', corridorTex(18821, '#7a3a52', '#4a2433', '#ffd75b'));
  // 窗帘（窗景通用）
  BR.Textures.registerTex('win_curtain', function (w, h) {
    var R = lcg(18822);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#4e1c20'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < w; i += 10) {
      x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(i, 0, 4, h);
      x.fillStyle = 'rgba(255,170,150,0.08)'; x.fillRect(i + 5, 0, 2, h);
    }
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 0, w, 12);
    dGrain(x, w, h, R, 160, 0.07);
    return c;
  });
  // 微光条纹（穿越窗用）
  BR.Textures.registerTex('shimmer', function (w, h) {
    var R = lcg(18823);
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.clearRect(0, 0, w, h);
    for (var i = 0; i < 26; i++) {
      var sx = R() * w;
      var g = x.createLinearGradient(sx - 8, 0, sx + 8, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,' + (0.25 + R() * 0.3).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(sx - 8, 0, 16, h);
    }
    return c;
  });
  // 紧急出口绿牌
  BR.Textures.registerTex('exit_sign', function (w, h) {
    var c = mkCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = '#0a3a1a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#2aff5a'; x.lineWidth = 5; x.strokeRect(5, 5, w - 10, h - 10);
    x.fillStyle = '#7dff9a'; x.font = 'bold 40px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('EXIT', w / 2, h / 2 + 2);
    return c;
  });

  /* ============ 环境音：深夜酒店（配电嗡鸣 + 窗缝风声 + 窗户静电） ============ */
  BR.Audio.registerAmbient('L188', function () {
    var self = this;
    var rig = this._loopRig(function (R) {
      var o = R.osc('sine', 55), g = R.gain(0.50); // 配电低频
      o.connect(g); g.connect(R.group);
      var o2 = R.osc('sine', 110), g2 = R.gain(0.14);
      o2.connect(g2); g2.connect(R.group);
      var n = R.noise(), lp = R.filter('lowpass', 320, 0.7), ng = R.gain(0.30);
      n.connect(lp); lp.connect(ng); ng.connect(R.group); // 窗缝风声
      var lfo = R.osc('sine', 0.09), lg = R.gain(0.12);
      lfo.connect(lg); lg.connect(ng.gain); // 风声缓慢起伏
      // 窗户静电：带通噪声；增益由 lv_l188.js 的 tick 按"与异常窗户距离"调制
      var n2 = R.noise(), bp = R.filter('bandpass', 1900, 1.1), sg = R.gain(0.0);
      n2.connect(bp); bp.connect(sg); sg.connect(R.group);
      self._l188static = sg;
      // v1.5 W7：窗景近场声——每种异空间窗一路带通噪声，
      // 增益由 tick 按"与最近同类窗户距离 + 遮挡"调制（仅靠近对应窗口轻微出现）
      var n3 = R.noise(), voices = {};
      [['pool', 700, 1.2], ['party', 1300, 0.9], ['city', 480, 0.7],
       ['deep', 200, 0.8], ['event', 1900, 1.1], ['travel', 2700, 1.6]].forEach(function (vd) {
        var fbp = R.filter('bandpass', vd[1], vd[2]), vg = R.gain(0.0);
        n3.connect(fbp); fbp.connect(vg); vg.connect(R.group);
        voices[vd[0]] = vg;
      });
      self._l188voices = voices;
    });
    rig.target = 0.40;
    return rig;
  });

  /* ============ placer ============ */
  function placeL188(map, rng) {
    var MW = map.w, MH = map.h;
    function setT(x, y, v) {
      if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1) map.tiles[y * MW + x] = v;
    }
    function carve(x0, y0, x1, y1) {
      for (var y = y0; y <= y1; y++)
        for (var x = x0; x <= x1; x++) setT(x, y, 1);
    }
    // carve2：二层地板（tile=2）：渲染/碰撞与 1 相同，但 gen 侧 BFS/缝线检查只认 1，
    // 因此二层天然"不可达"——只能经楼梯间换层到达，符合"楼梯真连楼层"。
    function setT2(x, y, v) {
      if (x > 0 && y > 0 && x < MW - 1 && y < MH - 1) map.tiles[y * MW + x] = v;
    }
    function carve2(x0, y0, x1, y1) {
      for (var y = y0; y <= y1; y++)
        for (var x = x0; x <= x1; x++) setT2(x, y, 2);
    }
    var poiN = 0, doorN = 0;
    function POI(type, tx, ty, data) {
      map.pois.push({ id: 'p' + (poiN++), type: type, tx: tx, ty: ty, data: data || {} });
    }
    // 门 axis 取视觉正确的约定（门扇与所在墙共面）：
    //   南北墙（墙沿 X 走向）用 'x'，东西墙（墙沿 Z 走向）用 'z'。
    // 实测注记：gen.js 的 findDoorSpot 对南北/东西墙给的轴是反的，
    // L2 里那些门在渲染时是侧着嵌在墙里的；本关不使用它，全部手放。
    function DOOR(tx, ty, axis, locked, label) {
      var id = 'd' + (doorN++);
      map.doors.push({ id: id, tx: tx, ty: ty, axis: axis, locked: !!locked, label: label, exitTo: null });
      return id;
    }
    // 门位兜底：若目标 tile 已被通用走廊挖穿，沿墙走向微调一格
    function doorTile(dx, dy, axis) {
      var cands = axis === 'z'
        ? [[dx, dy], [dx, dy - 1], [dx, dy + 1]]
        : [[dx, dy], [dx - 1, dy], [dx + 1, dy]];
      for (var i = 0; i < cands.length; i++) {
        var tx = cands[i][0], ty = cands[i][1];
        if (tx < 1 || ty < 1 || tx >= MW - 1 || ty >= MH - 1) continue;
        if (map.tiles[ty * MW + tx] !== 0) continue;
        var a = axis === 'z' ? map.tiles[ty * MW + tx - 1] : map.tiles[(ty - 1) * MW + tx];
        var b = axis === 'z' ? map.tiles[ty * MW + tx + 1] : map.tiles[(ty + 1) * MW + tx];
        if (a === 1 && b === 1) return [tx, ty];
      }
      return [dx, dy];
    }
    // doorTile2：二层门位（两侧为 tile=2 的二层地板）
    function doorTile2(dx, dy, axis) {
      var cands = axis === 'z'
        ? [[dx, dy], [dx, dy - 1], [dx, dy + 1]]
        : [[dx, dy], [dx - 1, dy], [dx + 1, dy]];
      for (var i2 = 0; i2 < cands.length; i2++) {
        var tx2 = cands[i2][0], ty2 = cands[i2][1];
        if (tx2 < 1 || ty2 < 1 || tx2 >= MW - 1 || ty2 >= MH - 1) continue;
        if (map.tiles[ty2 * MW + tx2] !== 0) continue;
        var a2 = axis === 'z' ? map.tiles[ty2 * MW + tx2 - 1] : map.tiles[(ty2 - 1) * MW + tx2];
        var b2 = axis === 'z' ? map.tiles[ty2 * MW + tx2 + 1] : map.tiles[(ty2 + 1) * MW + tx2];
        if (a2 === 2 && b2 === 2) return [tx2, ty2];
      }
      return [dx, dy];
    }

    /* —— 中庭 / 阳台 / 出生房 —— */
    carve(20, 22, 35, 35);   // 中庭 16×14
    carve(20, 21, 35, 21);   // 阳台：中庭北侧，俯瞰
    carve(26, 16, 29, 19);   // 狭窄破旧的出生房
    setT(27, 20, 1);         // 敞开的门框（无门扇）
    POI('spawn', 27, 17, {});
    POI('balcony', 30, 21, {});

    /* —— 环绕走廊 —— */
    carve(17, 22, 17, 35);   // 西走廊
    carve(38, 22, 38, 35);   // 东走廊
    carve(17, 37, 44, 37);   // 南走廊
    carve(17, 21, 19, 21);   // 阳台 → 西走廊
    carve(36, 21, 38, 21);   // 阳台 → 东走廊
    setT(17, 36, 1);         // 西走廊 → 南走廊
    setT(38, 36, 1);         // 东走廊 → 南走廊

    /* —— 10 间客房 —— */
    var guests = [
      { x: 11, y: 23, w: 5, h: 4, num: '201', dx: 16, dy: 24, axis: 'z' },
      { x: 11, y: 28, w: 5, h: 4, num: '202', dx: 16, dy: 29, axis: 'z' },
      { x: 11, y: 33, w: 5, h: 3, num: '203', dx: 16, dy: 34, axis: 'z' },
      { x: 40, y: 23, w: 5, h: 4, num: '205', dx: 39, dy: 24, axis: 'z' },
      { x: 40, y: 28, w: 5, h: 4, num: '206', dx: 39, dy: 29, axis: 'z' },
      { x: 40, y: 33, w: 5, h: 3, num: '207', dx: 39, dy: 34, axis: 'z' },
      { x: 21, y: 39, w: 4, h: 4, num: '208', dx: 22, dy: 38, axis: 'x' },
      { x: 31, y: 39, w: 4, h: 4, num: '209', dx: 32, dy: 38, axis: 'x' },
      { x: 20, y: 16, w: 4, h: 4, num: '210', dx: 21, dy: 20, axis: 'x' },
      { x: 31, y: 16, w: 4, h: 4, num: '211', dx: 33, dy: 20, axis: 'x' }
    ];
    var i, g;
    for (i = 0; i < guests.length; i++) {
      g = guests[i];
      carve(g.x, g.y, g.x + g.w - 1, g.y + g.h - 1);
    }
    /* —— 休息室 / 员工室 —— */
    carve(25, 39, 32, 44);
    carve(40, 39, 44, 43);

    /* —— 1F 楼梯间大厅（真连二层）：南走廊东侧 —— */
    carve(36, 38, 38, 40);

    /* —— 2F（南区；关内楼梯换层到达，不走 POI 以免可达性抽查失败） —— */
    carve2(12, 50, 42, 50);   // 2F 环廊
    var f2rooms = [
      { x: 14, y: 46, w: 5, h: 3, num: '301', dx: 16, dy: 49, axis: 'x' },
      { x: 21, y: 46, w: 5, h: 3, num: '302', dx: 23, dy: 49, axis: 'x' },
      { x: 28, y: 46, w: 5, h: 3, num: '303', dx: 30, dy: 49, axis: 'x' },
      { x: 14, y: 52, w: 5, h: 3, num: '304', dx: 16, dy: 51, axis: 'x' },
      { x: 21, y: 52, w: 5, h: 3, num: '305', dx: 23, dy: 51, axis: 'x' },
      { x: 28, y: 52, w: 5, h: 3, num: '306', dx: 30, dy: 51, axis: 'x' }
    ];
    for (var fi = 0; fi < f2rooms.length; fi++) {
      var fr = f2rooms[fi];
      carve2(fr.x, fr.y, fr.x + fr.w - 1, fr.y + fr.h - 1);
    }
    carve2(36, 52, 38, 53);   // 2F 楼梯间大厅

    /* —— 门：约 70% 上锁（休息室/员工室/楼梯间常开，保证出口可达） —— */
    var shuffled = rng.shuffle(guests.slice());
    for (i = 0; i < guests.length; i++) guests[i].locked = true;
    shuffled[0].locked = false;
    shuffled[1].locked = false;
    // 异空间窗/事件窗/可穿越窗对应的房门会被未知力量锁死（后算，先占位）
    var coupledNums = {}; // room num -> true（窗户状态分配后回填）
    for (i = 0; i < guests.length; i++) {
      g = guests[i];
      var spot = doorTile(g.dx, g.dy, g.axis);
      g.doorId = DOOR(spot[0], spot[1], g.axis, g.locked, g.num + ' 房门');
      g.winKind = rng.pick(['warm', 'warm', 'warm', 'cold', 'cold', 'dark', 'blinds']);
      POI('hotel_room', Math.round(g.x + (g.w - 1) / 2), Math.round(g.y + (g.h - 1) / 2),
        { num: g.num, winKind: g.winKind, locked: g.locked, w: g.w, h: g.h, x0: g.x, y0: g.y });
      POI('room_door', spot[0], spot[1], { doorId: g.doorId, num: g.num, locked: g.locked });
    }
    var loungeSpot = doorTile(28, 38, 'x');
    var staffSpot = doorTile(42, 38, 'x');
    var stairSpot = doorTile(37, 38, 'x'); // 1F 楼梯间大厅门
    var loungeDoor = DOOR(loungeSpot[0], loungeSpot[1], 'x', false, '休息室');
    var staffDoor = DOOR(staffSpot[0], staffSpot[1], 'x', false, '员工室');
    var stairDoor = DOOR(stairSpot[0], stairSpot[1], 'x', false, '楼梯间');
    POI('room_door', loungeSpot[0], loungeSpot[1], { doorId: loungeDoor, num: '休息室', locked: false });
    POI('room_door', staffSpot[0], staffSpot[1], { doorId: staffDoor, num: '员工室', locked: false });
    POI('room_door', stairSpot[0], stairSpot[1], { doorId: stairDoor, num: '楼梯间', locked: false });
    POI('stair_up', 37, 39, {});   // 1F 楼梯间大厅内：上楼交互点
    POI('return_door', 27, 16, {}); // 出生房北墙：返回来时的门

    /* —— 2F 门（进 meta，不走 map.doors/POI；lv 按定坐标构建） —— */
    var f2doors = [];
    var f2shuf = rng.shuffle(f2rooms.slice());
    for (fi = 0; fi < f2rooms.length; fi++) f2rooms[fi].locked = true;
    f2shuf[0].locked = false;
    f2shuf[1].locked = false;
    for (fi = 0; fi < f2rooms.length; fi++) {
      fr = f2rooms[fi];
      var fspot = doorTile2(fr.dx, fr.dy, fr.axis);
      f2doors.push({ id: 'd2_' + fi, tx: fspot[0], ty: fspot[1], axis: fr.axis,
        locked: fr.locked, label: fr.num + ' 房门', num: fr.num, room: fr });
    }
    var f2stairSpot = doorTile2(37, 51, 'x');
    f2doors.push({ id: 'd2_stair', tx: f2stairSpot[0], ty: f2stairSpot[1], axis: 'x',
      locked: false, label: '楼梯间', num: '楼梯间', room: null });

    /* —— 紧急出口：5 个候选位 rng 选 1（位置不定；目的地=已完成层级池） —— */
    var EMERG_CANDS = [
      { tx: 44, ty: 37, dx: 1, dz: 0 },   // 南走廊东端头
      { tx: 17, ty: 37, dx: -1, dz: 0 },  // 南走廊西端头
      { tx: 20, ty: 21, dx: 0, dz: -1 },  // 阳台西端
      { tx: 24, ty: 37, dx: 0, dz: 1 },   // 南走廊中段南墙
      { tx: 30, ty: 37, dx: 0, dz: 1 }    // 南走廊中段南墙
    ];
    var EMERG_DESTS = ['L0', 'L1', 'L11', 'L37', 'bang', 'L7', 'L2', 'L3', 'FUN']; // 已完成层级池（v1.5 W6：94→! 替换）
    var emerg = rng.pick(EMERG_CANDS);
    POI('emergency_exit', emerg.tx, emerg.ty,
      { dx: emerg.dx, dz: emerg.dz, dest: rng.pick(EMERG_DESTS) });

    /* —— 功能区 POI —— */
    POI('lounge', 28, 41, {});
    POI('staff_room', 41, 42, {});
    POI('radio', 30, 42, {});                       // 休息室收音机 → L0
    POI('odd_window', 28, 35, { num: '209' });       // 中庭南墙下的异常窗 → L1
    POI('stairwell', 42, 41, {});                   // 员工室楼梯间 → L11

    /* —— 字条 / 板条箱 —— */
    POI('note', 26, 43, { noteId: 'L188_note0' });
    POI('note', 44, 40, { noteId: 'L188_note1' });
    POI('note', 17, 30, { noteId: 'L188_note2' });
    POI('crate', 31, 43, { item: 'almond' });
    POI('crate', 40, 40, { item: 'bandage' });
    POI('crate', 33, 21, { item: 'empty' });

    /* —— 薄墙 1~2 处：走廊墙边（距出生≥6 格、两两≥8 格；贴墙挤压后跨关切出） —— */
    (function () {
      var cands = [];
      for (var cy = 15; cy <= 45; cy++) {
        for (var cx = 10; cx <= 45; cx++) {
          if (map.tiles[cy * MW + cx] !== 1) continue;
          var adj = map.tiles[cy * MW + cx - 1] === 0 || map.tiles[cy * MW + cx + 1] === 0 ||
                    map.tiles[(cy - 1) * MW + cx] === 0 || map.tiles[(cy + 1) * MW + cx] === 0;
          if (!adj) continue;
          if (Math.hypot(cx - 27, cy - 17) < 6) continue; // 出生房 (27,17)
          cands.push([cx, cy]);
        }
      }
      var order = rng.shuffle(cands), picked = [];
      for (var q = 0; q < order.length && picked.length < 2; q++) {
        var c = order[q], ok = true;
        for (var j = 0; j < picked.length; j++) {
          if (Math.hypot(c[0] - picked[j][0], c[1] - picked[j][1]) < 8) { ok = false; break; }
        }
        if (ok) picked.push(c);
      }
      if (!picked.length && cands.length) picked.push(cands[0]); // 兜底：至少 1 处
      var wdirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var p2 = 0; p2 < picked.length; p2++) {
        var t2 = picked[p2], w = wdirs[0];
        for (var d2 = 0; d2 < 4; d2++) {
          if (map.tiles[(t2[1] + wdirs[d2][1]) * MW + t2[0] + wdirs[d2][0]] === 0) { w = wdirs[d2]; break; }
        }
        POI('thin_wall', t2[0], t2[1], { dx: w[0], dz: w[1] });
      }
    })();
    /* —— 窗户四态元数据（map.meta.l188wins；确定性分配，卸载不重抽） ——
     * 共 104 扇（南/北各 28，西/东各 24，四层 tier，y=2.2/5.0/7.8/10.6）。
     * state: 'plain'(普通亮/黑窗，sub: warm/cold/dark/blinds/blue，blue 仅 1~2 扇异常色亮窗)
     *        'curtain'(①窗帘遮挡普通窗) / 'room'(②可观察普通房间)
     *        'pool'/'party'/'city'/'deep'(③异空间：L37泳池/L Fun派对/L11一角/L7深海，均本游戏改编)
     *        'event'(④事件窗) / 'travel'(可穿越窗，dest=目标层级)
     * 209 房南墙首层窗固定为 travel→L1（即 POI odd_window，老逻辑保留）。
     * 异空间/事件/穿越窗若带有房号，其房门强制锁死（回填 coupledNums）。
     */
    (function buildWindowMeta() {
      var T3 = 3; // BR.TILE（gen 侧硬编码 3，与 config.js 一致）
      var wrng = new BR.RNG(BR.hashSeed(map.seed + ':l188wins'));
      var wins = [];
      var TIERS = [2.2, 5.0, 7.8, 10.6]; // 四层窗高（wallH=12，参考图4 高大压迫感）
      function pushWin(id, side, tier, x, z, ry, ctx, num) {
        wins.push({ id: id, side: side, tier: tier, y: TIERS[tier], x: x, z: z, ry: ry,
          tx: ctx[0], ty: ctx[1], num: num || null,
          state: 'plain', sub: 'warm', dest: null, magic: false, variant: null });
      }
      var sx, wy, nx, k;
      for (k = 0; k < 4; k++) {
        for (sx = 22; sx <= 34; sx += 2) {
          var numS = k === 0 ? (sx === 22 ? '208' : sx === 28 ? '209' : sx === 32 ? 'lounge' : null) : null;
          pushWin('s' + k + '_' + sx, 'S', k, (sx + 0.5) * T3, 36 * T3 - 0.07, Math.PI, [sx, 36], numS);
        }
        for (nx = 22; nx <= 34; nx += 2) {
          var numN = k === 0 ? (nx === 22 ? '210' : nx === 34 ? '211' : null) : null;
          pushWin('n' + k + '_' + nx, 'N', k, (nx + 0.5) * T3, 22 * T3 + 0.07, 0, [nx, 21], numN);
        }
        for (wy = 24; wy <= 34; wy += 2) {
          var numW = k === 0 ? (wy === 24 ? '201' : wy === 30 ? '202' : wy === 34 ? '203' : null) : null;
          var numE = k === 0 ? (wy === 24 ? '205' : wy === 30 ? '206' : wy === 34 ? '207' : null) : null;
          pushWin('w' + k + '_' + wy, 'W', k, 20 * T3 + 0.07, (wy + 0.5) * T3, Math.PI / 2, [19, wy], numW);
          pushWin('e' + k + '_' + wy, 'E', k, 36 * T3 - 0.07, (wy + 0.5) * T3, -Math.PI / 2, [36, wy], numE);
        }
      }
      // 209 房南墙首层窗 = 可穿越窗 →L1（老 odd_window 逻辑）
      var w209 = null;
      for (var q = 0; q < wins.length; q++)
        if (wins[q].id === 's0_28') { w209 = wins[q]; break; }
      w209.state = 'travel'; w209.dest = 'L1'; w209.variant = 'corridor_l1';
      coupledNums['209'] = true;
      // 再强制指定：1 扇可穿越窗（目标从已完成层级池随机）+ 2 扇事件窗 + 1 扇"消失"窗帘
      function pickPlain(filter) {
        var c = wins.filter(function (w) {
          return w.state === 'plain' && (!filter || filter(w));
        });
        return c.length ? wrng.pick(c) : null;
      }
      var wt = pickPlain(function (w) { return w.id !== 's0_28' && w.tier === 0; });
      if (wt) {
        wt.state = 'travel';
        wt.dest = wrng.pick(['L0', 'L11', 'L37', 'FUN']);
        wt.variant = 'corridor_' + wt.dest.toLowerCase();
        if (wt.num && /^\d+$/.test(wt.num)) coupledNums[wt.num] = true;
      }
      var evVariants = ['figure', 'flicker'];
      for (var e = 0; e < 2; e++) {
        var we = pickPlain(function (w) { return w.tier === 0; }); // 首层：够得着交互
        if (we) {
          we.state = 'event'; we.variant = evVariants[e];
          if (we.num && /^\d+$/.test(we.num)) coupledNums[we.num] = true;
        }
      }
      var wc = pickPlain(function (w) { return w.state === 'plain' && w.tier === 0; });
      if (wc) { wc.state = 'curtain'; wc.magic = true; }
      // 其余按权重分配；同侧相邻异空间不重复（避免"全通同一场景"）
      var lastAnom = {};
      var anomKinds = ['pool', 'party', 'city', 'deep'];
      for (var v = 0; v < wins.length; v++) {
        var w = wins[v];
        if (w.state !== 'plain') continue;
        var r = wrng.next();
        var st;
        if (r < 0.55) st = 'plain';
        else if (r < 0.68) st = 'curtain';
        else if (r < 0.80) st = 'room';
        else {
          st = wrng.pick(['pool', 'pool', 'party', 'party', 'city', 'deep']);
          if (lastAnom[w.side] === st) st = 'room'; // 同侧相邻不重复
        }
        w.state = st;
        if (anomKinds.indexOf(st) >= 0) lastAnom[w.side] = st;
        else if (st === 'room' || st === 'curtain') lastAnom[w.side] = null;
        if (st === 'plain') {
          var r2 = wrng.next();
          w.sub = r2 < 0.35 ? 'warm' : r2 < 0.55 ? 'cold' : r2 < 0.90 ? 'dark' : 'blinds';
        }
      }
      // 异常色亮窗（参考图4：混入 1~2 扇蓝色亮窗）
      var bluePicked = 0;
      var guard = 0;
      while (bluePicked < 2 && guard++ < 200) {
        var wb = pickPlain();
        if (wb && wb.sub !== 'blue') { wb.sub = 'blue'; bluePicked++; }
      }
      // 锁耦合回填：异空间/事件/穿越窗对应的房门强制锁死
      for (var d2 = 0; d2 < map.doors.length; d2++) {
        var dd = map.doors[d2];
        var mnum = /^(\d+) 房门$/.exec(dd.label || '');
        if (mnum && coupledNums[mnum[1]]) dd.locked = true;
      }
      for (var p2 = 0; p2 < map.pois.length; p2++) {
        var pp = map.pois[p2];
        if ((pp.type === 'hotel_room' || pp.type === 'room_door') && coupledNums[pp.data.num])
          pp.data.locked = true;
      }
      // 兜底：耦合锁死后仍保证至少 2 间非耦合客房可进（不许只剩空走廊）
      var openCount = 0;
      for (var g2 = 0; g2 < guests.length; g2++) {
        var gn = guests[g2];
        if (!coupledNums[gn.num] && !map.doors.some(function (d) { return d.id === gn.doorId && d.locked; }))
          openCount++;
      }
      if (openCount < 2) {
        for (var g3 = 0; g3 < guests.length && openCount < 2; g3++) {
          var gn3 = guests[g3];
          if (coupledNums[gn3.num]) continue;
          (function (gid) {
            for (var d3 = 0; d3 < map.doors.length; d3++)
              if (map.doors[d3].id === gid) map.doors[d3].locked = false;
            for (var p3 = 0; p3 < map.pois.length; p3++) {
              var ppp = map.pois[p3];
              if ((ppp.type === 'hotel_room' || ppp.type === 'room_door') &&
                  ppp.data.doorId === gid) ppp.data.locked = false;
            }
          })(gn3.doorId);
          openCount++;
        }
      }
      map.meta.l188wins = wins;
      map.meta.l188f2 = { rooms: f2rooms, doors: f2doors, stairDown: { tx: 37, ty: 52 } };
    })();
  }

  BR.Gen.registerLevel('L188',
    { rw: [4, 10], rh: [4, 8], corrW: [1, 2], loops: [2, 4], wallH: 12 }, // 高墙：抬头有高度压迫感（参考图4）
    placeL188,
    ['spawn', 'odd_window', 'stairwell']);
})();
