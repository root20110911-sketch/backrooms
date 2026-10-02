/* gen_l188.js —— Level 188「百窗庭」地图生成
 * 原型：Fandom Backrooms Wiki 的 Level 188 "The Windows"（酒店版）：
 *   酒店式围合建筑，中央大中庭，四周墙上布满方形小窗；多数窗被窗帘遮挡（"闭窗"），
 *   少数"开窗"望向异地；"开窗"对应的房门会被未知力量锁死；中庭一端有楼梯间通往
 *   环绕的走廊（五层楼的感觉）。本关为游戏改编实现，与 Wikidot 的 Level 881 无关。
 *   （Entities: 0/5，无敌对实体——本关走纯氛围路线，不放怪物。）
 *
 * 布局（56×56，确定性雕刻，rng 只决定内容/锁）：
 *   出生小房间(26..29,16..19) → 敞开门框(27,20) → 阳台(20..35,21)俯瞰中庭
 *   → 西/东/南走廊环绕 → 10 间客房 + 休息室 + 员工室（楼梯间）
 *   中庭(20..35,22..35)四周两层窗户；异常窗在南墙下（POI odd_window）
 *
 * POI 类型（lv_l188.js 消费，见该文件头部的清单）：
 *   spawn / balcony / hotel_room / room_door / lounge / staff_room /
 *   radio / odd_window / stairwell / note / crate
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
    x.fillStyle = '#7d6b4f'; x.fillRect(0, 0, w, h);
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

    /* —— 门：约 70% 上锁（休息室/员工室常开，保证两条出口可达） —— */
    var shuffled = rng.shuffle(guests.slice());
    for (i = 0; i < guests.length; i++) guests[i].locked = true;
    shuffled[0].locked = false;
    shuffled[1].locked = false;
    for (i = 0; i < guests.length; i++) {
      g = guests[i];
      var spot = doorTile(g.dx, g.dy, g.axis);
      g.doorId = DOOR(spot[0], spot[1], g.axis, g.locked, g.num + ' 房门');
      g.winKind = rng.pick(['warm', 'warm', 'warm', 'cold', 'cold', 'dark', 'blinds']);
      POI('hotel_room', Math.round(g.x + (g.w - 1) / 2), Math.round(g.y + (g.h - 1) / 2),
        { num: g.num, winKind: g.winKind, locked: g.locked });
      POI('room_door', spot[0], spot[1], { doorId: g.doorId, num: g.num, locked: g.locked });
    }
    var loungeSpot = doorTile(28, 38, 'x');
    var staffSpot = doorTile(42, 38, 'x');
    var loungeDoor = DOOR(loungeSpot[0], loungeSpot[1], 'x', false, '休息室');
    var staffDoor = DOOR(staffSpot[0], staffSpot[1], 'x', false, '员工室');
    POI('room_door', loungeSpot[0], loungeSpot[1], { doorId: loungeDoor, num: '休息室', locked: false });
    POI('room_door', staffSpot[0], staffSpot[1], { doorId: staffDoor, num: '员工室', locked: false });

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
  }

  BR.Gen.registerLevel('L188',
    { rw: [4, 10], rh: [4, 8], corrW: [1, 2], loops: [2, 4], wallH: 7.5 },
    placeL188,
    ['spawn', 'odd_window', 'stairwell']);
})();
