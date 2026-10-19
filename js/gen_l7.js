/* gen_l7.js —— Level 7「深海恐惧症」地图生成（v2.0 P3 海洋重制）
 * 结构：金属舱室（entry_room：出生点/字条/补给/舱盖门/楼梯/平台）
 *       → 舱盖门外是露天阴天海洋（开放水域 + 四深度带 + 七层之物巢穴 + L37 门）
 * 版本依据：Fandom 版 Level 7（金属舱室入口 + 露天阴天海洋 + 深海）。
 *   v2.0 P3：四深度带按玩家真实下潜深度划分（日光 <12m / 暮光 12~30m /
 *   午夜 30~55m / 深渊 ≥55m）；海底是连续高度场（浅海台地→三级断崖→
 *   深海平原→海沟），障碍物/POI 按所在位置的海床深度归带。
 *   距离/深度均为游戏尺度改编（见 LORE.md），非原著数值。
 * 铁律：placer 只用传入的 rng；禁用 Math.random / Date / DOM / 3D 库。
 */
(function () {
  var BR = window.BR;

  /* ================= 1. 贴图注册（顶层调用） ================= */
  function mkc(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // 确定性伪随机（贴图绘制用，不触碰 Math.random）
  function lcg(seed) {
    var s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // 锈蚀金属墙面：深灰底 + 纵向锈 streak + 铆钉 + 划痕（舱室墙体用）
  BR.Textures.registerTex('rust_metal', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(3101);
    var i, k;
    x.fillStyle = '#4a4d4f'; x.fillRect(0, 0, w, h);
    for (i = 0; i < 900; i++) { // 金属噪点
      var g = 58 + R() * 34;
      x.fillStyle = 'rgba(' + g + ',' + (g - 2) + ',' + (g - 6) + ',0.5)';
      x.fillRect(R() * w, R() * h, 2 + R() * 3, 2 + R() * 3);
    }
    for (i = 0; i < 34; i++) { // 纵向锈 streak
      var sx = R() * w, sw = 3 + R() * 14, sh = h * (0.2 + R() * 0.8);
      var gg = x.createLinearGradient(0, 0, 0, sh);
      var rust = 90 + R() * 50;
      gg.addColorStop(0, 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.25) + ',0.75)');
      gg.addColorStop(1, 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.25) + ',0)');
      x.fillStyle = gg;
      x.fillRect(sx, R() * h * 0.3, sw, sh);
    }
    x.fillStyle = 'rgba(20,18,16,0.9)'; // 铆钉行
    for (k = 0; k < 2; k++) {
      var ry = h * (0.12 + k * 0.76);
      for (i = 0; i < 8; i++) {
        x.beginPath(); x.arc((i + 0.5) * w / 8, ry, 4, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(120,116,110,0.5)';
        x.beginPath(); x.arc((i + 0.5) * w / 8 - 1, ry - 1, 1.6, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(20,18,16,0.9)';
      }
    }
    x.strokeStyle = 'rgba(15,14,13,0.6)'; x.lineWidth = 1.5; // 划痕
    for (i = 0; i < 12; i++) {
      x.beginPath();
      var px = R() * w, py = R() * h;
      x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 90, py + (R() - 0.5) * 30); x.stroke();
    }
    return c;
  });
  BR.Textures.registerWallTex('L7', 'rust_metal');

  // 锈蚀金属（暗版）：舱室天花板
  BR.Textures.registerTex('rust_dark', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(7707);
    x.fillStyle = '#2c2e30'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 500; i++) {
      var g = 34 + R() * 26;
      x.fillStyle = 'rgba(' + g + ',' + g + ',' + (g - 4) + ',0.5)';
      x.fillRect(R() * w, R() * h, 2 + R() * 4, 2 + R() * 4);
    }
    for (i = 0; i < 16; i++) { // 锈斑
      var rust = 70 + R() * 40;
      x.fillStyle = 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.28) + ',' + (0.25 + R() * 0.3).toFixed(2) + ')';
      x.beginPath(); x.arc(R() * w, R() * h, 4 + R() * 16, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 甲板钢板：深色板缝 + 防滑条纹（舱外甲板/楼梯用）
  BR.Textures.registerTex('deck_plate', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(5515);
    x.fillStyle = '#33363a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(12,12,14,0.8)'; x.lineWidth = 3; // 板缝
    for (var i = 0; i <= 4; i++) {
      x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.stroke();
      x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke();
    }
    x.fillStyle = 'rgba(140,140,135,0.16)'; // 防滑凸点
    for (i = 0; i < 260; i++) x.fillRect(R() * w, R() * h, 3, 2);
    for (i = 0; i < 10; i++) { // 锈蚀边缘
      var rust = 80 + R() * 40;
      x.fillStyle = 'rgba(' + rust + ',' + (rust * 0.45) + ',' + (rust * 0.28) + ',0.35)';
      x.beginPath(); x.arc(R() * w, R() * h, 3 + R() * 9, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 阴天云层：低饱和灰 + 柔和团块（天空穹顶/云层平面用）
  BR.Textures.registerTex('overcast', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(9090);
    x.fillStyle = '#7d858c'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 130; i++) { // 云团：径向渐变灰块
      var bx = R() * w, by = R() * h, br = 20 + R() * 70;
      var v = 96 + R() * 56;
      var g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(' + v + ',' + (v + 3) + ',' + (v + 6) + ',' + (0.20 + R() * 0.30).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + (v + 3) + ',' + (v + 6) + ',0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, 6.2832); x.fill();
    }
    for (i = 0; i < 40; i++) { // 暗部
      var dx = R() * w, dy = R() * h, dr = 24 + R() * 60, dv = 60 + R() * 30;
      var g2 = x.createRadialGradient(dx, dy, 0, dx, dy, dr);
      g2.addColorStop(0, 'rgba(' + dv + ',' + (dv + 4) + ',' + (dv + 8) + ',' + (0.18 + R() * 0.22).toFixed(2) + ')');
      g2.addColorStop(1, 'rgba(' + dv + ',' + (dv + 4) + ',' + (dv + 8) + ',0)');
      x.fillStyle = g2;
      x.beginPath(); x.arc(dx, dy, dr, 0, 6.2832); x.fill();
    }
    return c;
  });

  // 深渊：近黑蓝灰 + 微噪（海洋 tile 地板贴图；正常海域不铺可辨认的平坦地板，
  // 透过水面只看到深色，读作"深不见底"而非"脚下有地板"）
  BR.Textures.registerTex('abyss', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(31337);
    x.fillStyle = '#04070b'; x.fillRect(0, 0, w, h);
    for (var i = 0; i < 320; i++) {
      var g = 6 + R() * 16;
      x.fillStyle = 'rgba(' + g + ',' + (g + 4) + ',' + (g + 9) + ',0.5)';
      x.fillRect(R() * w, R() * h, 2 + R() * 5, 2 + R() * 5);
    }
    return c;
  });

  // 海面细节：大尺度深色斑块（单张大贴图铺整片海面，跨区块无接缝）
  BR.Textures.registerTex('sea_detail', function (w, h) {
    var c = mkc(w, h), x = c.getContext('2d'), R = lcg(2718);
    x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, w, h); // 中性灰底（与材质色相乘）
    for (var i = 0; i < 90; i++) {
      var bx = R() * w, by = R() * h, br = 12 + R() * 46;
      var v = 110 + R() * 60;
      var g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',' + (0.25 + R() * 0.35).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, 6.2832); x.fill();
    }
    return c;
  });

  /* ================= 2. 环境音：深海低频 + 水声（v1.5：阴天海面版） ================= */
  BR.Audio.registerAmbient('L7', function () {
    var rig = this._loopRig(function (R) {
      var o = R.osc('sine', 38), og = R.gain(0.55); // 深海低频
      o.connect(og); og.connect(R.group);
      var o2 = R.osc('sine', 76), g2 = R.gain(0.14);
      o2.connect(g2); g2.connect(R.group);
      var n = R.noise(), lp = R.filter('lowpass', 500, 0.7), ng = R.gain(0.20); // 水声涌动
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      var n2 = R.noise(), bp = R.filter('bandpass', 2400, 0.6), wg = R.gain(0.05); // 海面风声
      n2.connect(bp); bp.connect(wg); wg.connect(R.group);
      var lfo = R.osc('sine', 0.11), lg = R.gain(0.10); // 缓慢涌动调制
      lfo.connect(lg); lg.connect(ng.gain);
    });
    rig.target = 0.40;
    return rig;
  });
  // L7_uw：水下闷声变体（头部入水时 BR.Swim 按 dry+'_uw' 约定切换）
  BR.Audio.registerAmbient('L7_uw', function () {
    var rig = this._loopRig(function (R) {
      var o = R.osc('sine', 30), og = R.gain(0.7); // 更深的闷响
      o.connect(og); og.connect(R.group);
      var n = R.noise(), lp = R.filter('lowpass', 220, 0.9), ng = R.gain(0.5); // 水下闷水声
      n.connect(lp); lp.connect(ng); ng.connect(R.group);
      var lfo = R.osc('sine', 0.07), lg = R.gain(0.16);
      lfo.connect(lg); lg.connect(ng.gain);
    });
    rig.target = 0.5;
    return rig;
  });

  /* ================= 3. 关卡生成 ================= */
  var OX0 = 2, OY0 = 2, OX1 = 53, OY1 = 53; // 海洋矩形（tile 坐标，含边界）
  var DECK_H = 0.72;   // 甲板/舱盖平台高度（米；相对舱内地面）
  var DECK_OUT = 2;    // 甲板向外延伸 tile 数
  var DECK_HALF = 1;   // 甲板半宽 tile 数

  function tileAt(map, x, y) { return map.tiles[y * map.w + x]; }
  function setTile(map, x, y, v) {
    if (x >= 1 && y >= 1 && x <= map.w - 2 && y <= map.h - 2) map.tiles[y * map.w + x] = v;
  }
  function addPOI(map, type, tx, ty, data) {
    var p = { id: 'p' + map.pois.length, type: type, tx: tx, ty: ty, data: data || {} };
    map.pois.push(p);
    return p;
  }
  function inRoom(entry, tx, ty) {
    return tx >= entry.x && tx < entry.x + entry.w && ty >= entry.y && ty < entry.y + entry.h;
  }

  // 甲板 2×3 tile 是否全部落在海洋矩形内（门朝地图边缘时不可用）
  function deckOk(tx, ty, nx, ny) {
    for (var k = 1; k <= DECK_OUT; k++)
      for (var p = -DECK_HALF; p <= DECK_HALF; p++) {
        var dtx = tx + nx * k - ny * p, dty = ty + ny * k + nx * p;
        if (dtx < OX0 || dtx > OX1 || dty < OY0 || dty > OY1) return false;
      }
    return true;
  }

  // 入口舱室某面墙上找舱盖门位：墙 tile（0）+ 内侧地板（1）；返回 {tx,ty,fx,fy,axis}
  // 优先保证甲板能伸出去（deckOk）；都不满足时选朝向地图中心的一扇
  function pickEntryDoor(map, rng, entry) {
    var cands = [];
    function tryWall(tx, ty, fx, fy, axis) {
      if (tx < 1 || ty < 1 || tx > map.w - 2 || ty > map.h - 2) return;
      if (tileAt(map, tx, ty) !== 0) return; // 必须是墙
      if (tileAt(map, fx, fy) !== 1) return; // 内侧必须是地板
      var nx = 0, ny = 0;
      if (axis === 'z') ny = (ty < entry.y) ? -1 : 1;
      else nx = (tx < entry.x) ? -1 : 1;
      cands.push({ tx: tx, ty: ty, fx: fx, fy: fy, axis: axis, nx: nx, ny: ny });
    }
    var x, y;
    for (x = entry.x; x < entry.x + entry.w; x++) {
      tryWall(x, entry.y - 1, x, entry.y, 'z');
      tryWall(x, entry.y + entry.h, x, entry.y + entry.h - 1, 'z');
    }
    for (y = entry.y; y < entry.y + entry.h; y++) {
      tryWall(entry.x - 1, y, entry.x, y, 'x');
      tryWall(entry.x + entry.w, y, entry.x + entry.w - 1, y, 'x');
    }
    if (!cands.length) return { tx: entry.x, ty: entry.y - 1, fx: entry.x, fy: entry.y, axis: 'z', nx: 0, ny: -1 }; // 终极兜底
    var good = cands.filter(function (c) { return deckOk(c.tx, c.ty, c.nx, c.ny); });
    if (good.length) return rng.pick(good);
    // 兜底：选外法线最朝向地图中心的一扇
    var mcx = (OX0 + OX1) / 2, mcy = (OY0 + OY1) / 2;
    var rcx = entry.x + entry.w / 2, rcy = entry.y + entry.h / 2;
    var best = cands[0], bs = -1e9;
    for (var i = 0; i < cands.length; i++) {
      var s = (mcx - rcx) * cands[i].nx + (mcy - rcy) * cands[i].ny;
      if (s > bs) { bs = s; best = cands[i]; }
    }
    return best;
  }

  // 海洋地板 tile 候选（排除入口舱室外扩一圈）
  function collectOcean(map, entry) {
    var out = [], x, y;
    for (y = OY0; y <= OY1; y++)
      for (x = OX0; x <= OX1; x++) {
        if (x >= entry.x - 1 && x <= entry.x + entry.w && y >= entry.y - 1 && y <= entry.y + entry.h) continue;
        if (tileAt(map, x, y) === 1) out.push([x, y]);
      }
    return out;
  }

  // 最远点散布取点（确定性，只用 rng）
  function spreadPick(rng, cands, n, minGap, sx, sy, minSpawn, avoidPts, avoidGap) {
    var ok = [], i, a;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (Math.hypot(c[0] - sx, c[1] - sy) < minSpawn) continue;
      var bad = false;
      if (avoidPts) for (a = 0; a < avoidPts.length; a++) {
        if (Math.hypot(c[0] - avoidPts[a][0], c[1] - avoidPts[a][1]) < avoidGap) { bad = true; break; }
      }
      if (!bad) ok.push(c);
    }
    if (!ok.length) ok = cands.slice(); // 实在没有也保证返回
    var pts = [rng.pick(ok)];
    var guard = 0;
    while (pts.length < n && guard++ < 60) {
      var best = null, bd = -1, t, j;
      for (t = 0; t < 40; t++) {
        var cc = rng.pick(ok), md = Infinity;
        for (j = 0; j < pts.length; j++) {
          var d = Math.hypot(cc[0] - pts[j][0], cc[1] - pts[j][1]);
          if (d < md) md = d;
        }
        if (md > bd) { bd = md; best = cc; }
      }
      if (best && (bd >= minGap || pts.length === 0)) pts.push(best);
      else if (best && guard > 30) pts.push(best); // 多次尝试后放宽间距要求
    }
    return pts;
  }

  // 在 (tx,ty) 附近 rMin..rMax 格内找一个海洋地板 tile
  function nudgeInOcean(map, entry, tx, ty, rng, rMin, rMax) {
    for (var t = 0; t < 40; t++) {
      var ang = rng.next() * 6.2832, r = rMin + rng.next() * (rMax - rMin);
      var nx = Math.round(tx + Math.cos(ang) * r), ny = Math.round(ty + Math.sin(ang) * r);
      if (nx < OX0 || nx > OX1 || ny < OY0 || ny > OY1) continue;
      if (nx >= entry.x - 1 && nx <= entry.x + entry.w && ny >= entry.y - 1 && ny <= entry.y + entry.h) continue;
      if (tileAt(map, nx, ny) === 1) return [nx, ny];
    }
    return [tx, ty];
  }

  /* ================= 3a. 海底地形（v2.0 P3）：连续高度场（纯函数） =================
   * 地貌（世界米，相对海平面 SURF=0.15）：
   *   浅海台地：舱室周围 r<shelfR（多种子 32~40m），海床 -4m → -12m（缓坡）；
   *   大陆坡：r shelfR~85m，三级断崖 -12m → -48m（台地/陡坎交替）；
   *   深海平原：r>85m，-48m → -58m，叠加噪声起伏与岩脊（幅度/相位多种子）；
   *   海沟：两条种子走向的线状深沟（深水区下切 14~22m，最深约 -78m），
   *     ~55% 种子另有一条第三分支（走向/偏移/宽度/深度全多种子）。
   * 四深度带按玩家真实下潜深度划分（米）：日光 <12 / 暮光 12~30 /
   * 午夜 30~55 / 深渊 ≥55。地形最深处保证深渊带可达。
   * 全部确定性整数哈希噪声；只用 Math.*，不碰随机/DOM/3D 库。
   * v2.3 W-l7：海沟宽度/下切/第三分支、岩脊幅度/相位、台地半径全部多种子，
   *   只增字段不改签名；老种子地形有微调（同 map.seed 的 POI 锚点位置不变，
   *   见 placeL7 的 obRng 隔离）。 */
  var L7_SURF = 0.15; // 海平面基准（与 lv_l7 一致）
  function l7ihash(ix, iz, s) {
    var h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function l7vnoise(x, z, s) {
    var ix = Math.floor(x), iz = Math.floor(z);
    var fx = x - ix, fz = z - iz;
    var ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    var a = l7ihash(ix, iz, s), b = l7ihash(ix + 1, iz, s);
    var c = l7ihash(ix, iz + 1, s), d = l7ihash(ix + 1, iz + 1, s);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz; // 0..1
  }
  function l7ss(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }

  BR.L7Terrain = {
    SURF: L7_SURF,
    BAND_EDGES: [0, 12, 30, 55, 1e9], // 下潜深度带边界（米）
    bandOfDepth: function (d) {
      var E = BR.L7Terrain.BAND_EDGES;
      for (var i = 0; i < 4; i++) if (d < E[i + 1]) return i;
      return 3;
    },
    // ter = {seed, ccx, ccy（世界米）, a1,a2（海沟走向弧度）, o1,o2（海沟偏移米）,
    //        w1,w2（海沟半宽米）, cut1,cut2（海沟下切米）, has3,a3,o3,w3,cut3（第三海沟分支）,
    //        ridgeAmp（岩脊隆起米）, ridgePh（岩脊相位）, shelfR（浅海台地半径米）}
    // v2.3 W-l7：多种子海底变化度 —— 海沟宽度/深度/第三分支、岩脊幅度/相位、
    // 台地半径全部按种子哈希，全纯函数，确定性不变。
    make: function (seed, ccx, ccy) {
      return {
        seed: seed | 0, ccx: ccx, ccy: ccy,
        a1: l7ihash(11, 77, seed) * Math.PI,
        a2: l7ihash(11, 77, seed) * Math.PI + 0.9 + l7ihash(13, 79, seed) * 1.2,
        o1: (l7ihash(17, 83, seed) - 0.5) * 60,
        o2: (l7ihash(19, 89, seed) - 0.5) * 60,
        w1: 10 + l7ihash(21, 91, seed) * 10,               // 海沟半宽 10..20m
        w2: 10 + l7ihash(23, 93, seed ^ 0x1b3d) * 10,
        cut1: 14 + l7ihash(25, 95, seed ^ 0x2c4e) * 8,     // 海沟下切 14..22m
        cut2: 14 + l7ihash(27, 97, seed ^ 0x3d5f) * 8,
        has3: l7ihash(29, 101, seed ^ 0x4e6a) < 0.55,      // ~55% 种子有第三海沟分支
        a3: l7ihash(31, 103, seed ^ 0x5f7b) * Math.PI,
        o3: (l7ihash(33, 107, seed ^ 0x6a8c) - 0.5) * 80,
        w3: 8 + l7ihash(35, 109, seed ^ 0x7b9d) * 8,
        cut3: 10 + l7ihash(37, 111, seed ^ 0x8cae) * 8,
        ridgeAmp: 4 + l7ihash(39, 113, seed ^ 0x9dbf) * 4, // 岩脊隆起 4..8m
        ridgePh: l7ihash(41, 115, seed ^ 0xaed0) * 40 - 20,
        shelfR: 32 + l7ihash(43, 117, seed ^ 0xbfe1) * 8  // 浅海台地半径 32..40m
      };
    },
    // 世界坐标 → 海床 y（米）
    seabedY: function (x, z, ter) {
      var dx = x - ter.ccx, dz = z - ter.ccy;
      var r = Math.sqrt(dx * dx + dz * dz);
      var s = ter.seed, y;
      var sr = ter.shelfR || 35; // v2.3：浅海台地半径多种子（32..40m；缺省 35 兼容旧参）
      if (r < sr) { // 浅海台地：-4 → -12
        y = -4 + (-12 + 4) * l7ss(r / sr);
      } else if (r < 85) { // 大陆坡：三级断崖 -12 → -48
        var u = (r - sr) / (85 - sr), steps = 3;
        var f = u * steps, fl = Math.floor(f), fr = f - fl;
        var k = (fl + l7ss((fr - 0.72) / 0.28)) / steps;
        y = -12 + (-48 + 12) * k;
      } else { // 深海平原：-48 → -58
        y = -48 + (-58 + 48) * l7ss((r - 85) / 40);
      }
      // 噪声起伏（越深越颠簸）
      var amp = r < sr ? 1.2 : (r < 85 ? 2.5 : 4.0);
      y += (l7vnoise(x * 0.045, z * 0.045, s) - 0.5) * 2 * amp
         + (l7vnoise(x * 0.11 + 31.7, z * 0.11 - 11.3, s ^ 0x9e37) - 0.5) * 2 * amp * 0.45;
      // 岩脊：深水区隆起（脊状噪声；v2.3 幅度/相位多种子）
      if (r > sr) {
        var rph = ter.ridgePh || 0, ramp = ter.ridgeAmp || 6;
        var rn = l7vnoise(x * 0.02 + 7.3 + rph, z * 0.02 - 3.1 - rph * 0.6, s ^ 0x51f3);
        y += Math.pow(1 - Math.abs(rn * 2 - 1), 3) * ramp * Math.min(1, (r - sr) / 30);
      }
      // 海沟：两条走向 + v2.3 第三分支（~55% 种子）；宽度/下切多种子，深水区下切
      if (r > 55) {
        var cut = 0, q, dd;
        var w1 = ter.w1 || 16, w2 = ter.w2 || 16;
        var c1 = ter.cut1 || 16, c2 = ter.cut2 || 16;
        dd = Math.abs(-Math.sin(ter.a1) * dx + Math.cos(ter.a1) * dz - ter.o1);
        if (dd < w1) { q = 1 - dd / w1; cut += q * q * c1; }
        dd = Math.abs(-Math.sin(ter.a2) * dx + Math.cos(ter.a2) * dz - ter.o2);
        if (dd < w2) { q = 1 - dd / w2; cut += q * q * c2; }
        if (ter.has3) {
          var w3 = ter.w3 || 12, c3 = ter.cut3 || 14;
          dd = Math.abs(-Math.sin(ter.a3) * dx + Math.cos(ter.a3) * dz - ter.o3);
          if (dd < w3) { q = 1 - dd / w3; cut += q * q * c3; }
        }
        y -= Math.min(24, cut) * Math.min(1, (r - 55) / 25);
      }
      if (y > -3) y = -3;
      if (y < -78) y = -78;
      return y;
    },
    depthAt: function (x, z, ter) { return L7_SURF - BR.L7Terrain.seabedY(x, z, ter); },
    bandAt: function (x, z, ter) { return BR.L7Terrain.bandOfDepth(BR.L7Terrain.depthAt(x, z, ter)); }
  };

  /* ---- 四深度带（v2.0 P3）：按真实下潜深度划分 ----
   * 日光带 / 暮光带 / 午夜带 / 深渊带；每带真实环境差异由 lv_l7.js 按
   * 玩家下潜深度判定（水色/能见度/生物/七层之物行为）。 */
  var BAND_DEFS = [
    { name: 'sunlight', cn: '日光带', kind: 'ocean', d0: 0,  d1: 12 },
    { name: 'twilight', cn: '暮光带', kind: 'ocean', d0: 12, d1: 30 },
    { name: 'midnight', cn: '午夜带', kind: 'deep',  d0: 30, d1: 55 },
    { name: 'abyssal',  cn: '深渊带', kind: 'deep',  d0: 55, d1: 1e9 }
  ];
  // (ter, tx, ty) → 带索引 0..3（按该 tile 中心海床深度）
  function bandOf(ter, tx, ty) {
    return BR.L7Terrain.bandAt((tx + 0.5) * 3, (ty + 0.5) * 3, ter);
  }

  function placeL7(map, rng) {
    var entry = map.rooms[0];
    entry.tag = 'entry_room';
    var ecx = Math.round(entry.cx), ecy = Math.round(entry.cy);

    /* ---- 海洋：挖空大矩形，入口舱室外扩一圈保留为墙 ---- */
    var x, y;
    for (y = OY0; y <= OY1; y++)
      for (x = OX0; x <= OX1; x++) {
        if (x >= entry.x - 1 && x <= entry.x + entry.w && y >= entry.y - 1 && y <= entry.y + entry.h) continue;
        setTile(map, x, y, 1);
      }

    /* ---- 海底地形（v2.0 P3）：连续高度场 + 按下潜深度归带 ---- */
    var ccx = entry.x + entry.w / 2, ccy = entry.y + entry.h / 2; // 舱室中心（tile 浮点）
    var ter = BR.L7Terrain.make(BR.hashSeed(map.seed + ':l7terrain'), ccx * 3, ccy * 3);
    function bandAt(tx, ty) { return bandOf(ter, tx, ty); }
    var bands = BAND_DEFS.map(function (b) {
      return { name: b.name, cn: b.cn, kind: b.kind, d0: b.d0, d1: b.d1 };
    });
    var ocean = collectOcean(map, entry);

    /* ---- 海洋障碍物：按带布设（tile 级真实碰撞；视觉由 lv_l7 按 POI 建造） ----
     * 日光带：无（开阔明亮）；暮光带：礁石 + 沉船残骸 + 礁群 + 出水暗礁；
     * 午夜带：岩柱 + 遗迹断墙 + 海蚀拱（l7_arch 独立 POI，不封 tile，可游过）；
     * 深渊带：结构残片（稀疏，不封死 deep_exit）。
     * v2.3 W-l7：数量/种类多种子可变；障碍物走独立随机流 obRng。
     * v2.3 W-l7fixup 实测（tools/cmp 脚本，5 种子）：门/字条/补给在障碍物
     * 之前布设，同种子与 v2.2 位置一致；动静点/巢穴/深处出口/异常点在障碍物
     * 之后布设（主 rng 不再被障碍物消耗），同种子与 v2.2 位置不同——属 v2.3
     * 预期行为。存档按种子重建地图，加载不崩溃（位置恢复为世界坐标）。 */
    var placedOb = [];
    // v2.3：障碍物独立随机流（见上）
    var obRng = new BR.RNG(BR.hashSeed(map.seed + ':l7obv23'));
    function obClear(tx, ty, gap) {
      for (var i = 0; i < placedOb.length; i++)
        if (Math.hypot(tx - placedOb[i][0], ty - placedOb[i][1]) < gap) return false;
      return true;
    }
    function tryPlaceOb(kind, band, count, gap, cluster, avoidPts, avoidGap, opts) {
      opts = opts || {};
      var bands = Array.isArray(band) ? band : [band];
      var cands = ocean.filter(function (c) { return bands.indexOf(bandAt(c[0], c[1])) >= 0; });
      if (!cands.length) return;
      var pts = spreadPick(obRng, cands, count, gap, ccx, ccy, 6, avoidPts || null, avoidGap || 0);
      for (var i = 0; i < pts.length; i++) {
        var t = pts[i], cells = [[t[0], t[1]]];
        if (cluster > 1) { // 簇形：相邻 tile 扩展（沉船/遗迹/残片）
          var dirs = obRng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
          for (var k = 0; k < dirs.length && cells.length < cluster; k++) {
            var nx = t[0] + dirs[k][0], ny = t[1] + dirs[k][1];
            if (nx < OX0 || nx > OX1 || ny < OY0 || ny > OY1) continue;
            if (tileAt(map, nx, ny) !== 1) continue;
            cells.push([nx, ny]);
          }
        }
        var okAll = true, c;
        for (c = 0; c < cells.length; c++)
          if (!obClear(cells[c][0], cells[c][1], gap)) { okAll = false; break; }
        if (!okAll) continue;
        for (c = 0; c < cells.length; c++) {
          setTile(map, cells[c][0], cells[c][1], 0);
          placedOb.push(cells[c]);
        }
        addPOI(map, 'l7_obstacle', t[0], t[1], {
          kind: kind, band: bandAt(t[0], t[1]), rot: obRng.next() * 6.2832,
          cells: cells.map(function (cc) { return [cc[0] - t[0], cc[1] - t[1]]; })
        });
      }
    }
    // v2.3 W-l7：礁群 —— band 内选中心，half 半径内 ~55% tile 成暗礁（墙）
    function placeReefPatch(band, half, avoidPts) {
      var cands = ocean.filter(function (c) { return bandAt(c[0], c[1]) === band; });
      if (!cands.length) return;
      var ctr = spreadPick(obRng, cands, 1, 0, ccx, ccy, 8, avoidPts || null, 4)[0];
      var cells = [], dx, dy, nx, ny, i;
      for (dy = -half; dy <= half; dy++)
        for (dx = -half; dx <= half; dx++) {
          if (obRng.next() < 0.45) continue;
          nx = ctr[0] + dx; ny = ctr[1] + dy;
          if (nx < OX0 || nx > OX1 || ny < OY0 || ny > OY1) continue;
          if (tileAt(map, nx, ny) !== 1) continue;
          var clear = true;
          for (i = 0; i < placedOb.length; i++)
            if (Math.hypot(nx - placedOb[i][0], ny - placedOb[i][1]) < 1.5) { clear = false; break; }
          if (!clear) continue;
          setTile(map, nx, ny, 0);
          placedOb.push([nx, ny]);
          cells.push([dx, dy]);
        }
      // 中心锚点强制成墙（l7_obstacle 的 POI 中心须为墙 tile）
      if (tileAt(map, ctr[0], ctr[1]) === 1) {
        setTile(map, ctr[0], ctr[1], 0);
        placedOb.push([ctr[0], ctr[1]]);
        cells.push([0, 0]);
      }
      if (cells.length)
        addPOI(map, 'l7_obstacle', ctr[0], ctr[1], {
          kind: 'reef', band: band, rot: obRng.next() * 6.2832, cells: cells
        });
    }
    // v2.3 W-l7：海蚀拱 —— 午夜带岩拱（独立 POI 类型 l7_arch，不封 tile，
    // 玩家可从拱下/拱间游过；只占间距，不参与 l7_obstacle 的"全在墙 tile"断言）
    function placeArch(avoidPts) {
      var cands = ocean.filter(function (c) { return bandAt(c[0], c[1]) === 2; });
      if (!cands.length) return;
      var pts = spreadPick(obRng, cands, 1 + obRng.int(0, 2), 12, ccx, ccy, 12, avoidPts || null, 4);
      for (var i = 0; i < pts.length; i++) {
        var t = pts[i];
        if (!obClear(t[0], t[1], 6)) continue;
        placedOb.push([t[0], t[1]]);
        addPOI(map, 'l7_arch', t[0], t[1], {
          kind: 'arch', band: 2, rot: obRng.next() * 6.2832
        });
      }
    }
    // 注：tryPlaceOb 的调用在 boat_mooring 确定之后（避开停靠 tile）；调用后刷新 ocean 候选。

    /* ---- 舱盖门：舱室墙上，通向甲板/海洋 ---- */
    var door = pickEntryDoor(map, rng, entry);
    // 外法线（tile 空间；pickEntryDoor 已算好）
    var dnx = door.nx || 0, dny = door.ny || 0;
    if (dnx === 0 && dny === 0) { // 兜底重算
      if (door.axis === 'z') dny = (door.ty < entry.y) ? -1 : 1;
      else dnx = (door.tx < entry.x) ? -1 : 1;
    }

    /* ---- 楼梯：门内侧 tile 为平台（0.72m），再向内一格为楼梯坡道 ---- */
    var lx = door.fx, ly = door.fy; // 平台 tile（门内侧）
    var stairCands = [
      [lx - dnx, ly - dny],
      [lx + dny, ly + dnx],
      [lx - dny, ly - dnx]
    ];
    var stair = null;
    for (var si = 0; si < stairCands.length; si++) {
      var stx = stairCands[si][0], sty = stairCands[si][1];
      if (inRoom(entry, stx, sty) && tileAt(map, stx, sty) === 1 &&
          !(stx === lx && sty === ly)) { stair = { tx: stx, ty: sty }; break; }
    }
    if (!stair) stair = { tx: lx, ty: ly, flat: true }; // 极小房间兜底：无坡道，平台即台阶

    /* ---- 甲板：门外 2 格深 × 3 格宽（tile 矩形，供 floorYAt/栏杆/积水判定） ---- */
    var deckTiles = [];
    for (var k = 1; k <= DECK_OUT; k++)
      for (var p = -DECK_HALF; p <= DECK_HALF; p++) {
        var dtx = door.tx + dnx * k - dny * p, dty = door.ty + dny * k + dnx * p;
        deckTiles.push([dtx, dty]);
      }
    var deckTx = deckTiles.map(function (t) { return t[0]; });
    var deckTy = deckTiles.map(function (t) { return t[1]; });
    var deckRect = {
      x0: Math.min.apply(null, deckTx), y0: Math.min.apply(null, deckTy),
      x1: Math.max.apply(null, deckTx), y1: Math.max.apply(null, deckTy)
    };

    /* ---- 小船停靠点：甲板侧方（世界坐标；船头朝外） ---- */
    // 甲板中心 + 侧向偏移（甲板半宽+2 tile，从甲板边缘起算，保证避开甲板浮在水面）
    var dcx = (deckRect.x0 + deckRect.x1 + 1) / 2, dcy = (deckRect.y0 + deckRect.y1 + 1) / 2;
    var side = (BR.hashSeed(map.seed + ':l7boatside') % 2 === 0) ? 1 : -1;
    var sideOff = DECK_HALF + 2;
    var bx = (dcx - dny * side * sideOff), bz = (dcy + dnx * side * sideOff); // tile 中心坐标（浮点）
    // 钳制进海洋矩形（1 格边距），保证船始终在可玩水域
    bx = Math.max(OX0 + 1, Math.min(OX1 - 1, bx));
    bz = Math.max(OY0 + 1, Math.min(OY1 - 1, bz));
    var boatYaw = Math.atan2(-dnx, -dny); // 船头朝外（yaw=0 面向 -z）

    /* ---- 入口舱室：出生点 / entry_room / 字条 / 补给（干燥安全区） ---- */
    addPOI(map, 'spawn', ecx, ecy, {});
    addPOI(map, 'entry_room', ecx, ecy, {});
    // 字条/补给：避开楼梯/平台/门内侧 2 格
    var avoidC = [[lx, ly], [stair.tx, stair.ty], [door.fx, door.fy]];
    var freeTiles = [];
    for (y = entry.y; y < entry.y + entry.h; y++)
      for (x = entry.x; x < entry.x + entry.w; x++) {
        if (tileAt(map, x, y) !== 1) continue;
        var bad = false;
        for (var ai = 0; ai < avoidC.length; ai++)
          if (Math.hypot(x - avoidC[ai][0], y - avoidC[ai][1]) < 2) { bad = true; break; }
        if (!bad) freeTiles.push([x, y]);
      }
    if (!freeTiles.length) { // 兜底：房间太小就用任意地板
      for (y = entry.y; y < entry.y + entry.h; y++)
        for (x = entry.x; x < entry.x + entry.w; x++)
          if (tileAt(map, x, y) === 1) freeTiles.push([x, y]);
    }
    var noteT = rng.pick(freeTiles);
    var cacheT = rng.pick(freeTiles);
    addPOI(map, 'note', noteT[0], noteT[1], { noteId: 'L7_entry' });
    addPOI(map, 'cache', cacheT[0], cacheT[1],
      { items: ['almond', 'almond', 'bandage'] });

    /* ---- 舱盖门 / 小船 POI ---- */
    var dd = {
      id: 'd' + map.doors.length, tx: door.tx, ty: door.ty, axis: door.axis,
      locked: false, label: '舱盖', exitTo: null
    };
    map.doors.push(dd);
    addPOI(map, 'entry_door', door.tx, door.ty,
      { doorId: dd.id, fx: door.fx, fy: door.fy, nx: dnx, ny: dny });
    addPOI(map, 'boat_mooring',
      Math.max(OX0, Math.min(OX1, Math.round(bx))),
      Math.max(OY0, Math.min(OY1, Math.round(bz))),
      { x: (bx + 0.5) * 3, z: (bz + 0.5) * 3, yaw: boatYaw, side: side });

    /* ---- 海洋障碍物（v2.0 P3）：停靠点已定，避开它 3 格；按海床深度归带 ----
     * 日光带无（开阔明亮）；暮光带礁石+沉船残骸+礁群+出水暗礁；午夜带岩柱+遗迹断墙+海蚀拱；
     * 深渊带结构残片（稀疏，不封死 deep_exit）。
     * v2.3 W-l7：数量多种子可变（obRng 独立流；门/字条/补给同种子稳定，
     *   障碍物之后的海洋 POI 同种子位置有变化，见上）。 */
    var moorT = [Math.max(OX0, Math.min(OX1, Math.round(bx))),
                 Math.max(OY0, Math.min(OY1, Math.round(bz)))];
    tryPlaceOb('rock', 1, 6 + obRng.int(0, 4), 5, 1, [moorT], 3);                 // 暮光带礁石 ×6-10
    tryPlaceOb('wreck', 1, 1 + obRng.int(0, 2), 9, 2 + obRng.int(0, 2), [moorT], 3); // 暮光带沉船残骸 ×1-3
    tryPlaceOb('column', 2, 5 + obRng.int(0, 3), 6, 1, [moorT], 3);               // 午夜带岩柱 ×5-8
    tryPlaceOb('ruin', 2, 1 + obRng.int(0, 2), 10, 3 + obRng.int(0, 2), [moorT], 3); // 午夜带遗迹断墙 ×1-3
    tryPlaceOb('frag', 3, 2 + obRng.int(0, 3), 8, 2, [moorT], 3);                 // 深渊带结构残片 ×2-5
    // v2.3 新增：礁群（暮光带成片暗礁）/ 出水暗礁（暮光带，导航地标）/ 海蚀拱（午夜带）
    var _reefAvoid = [[moorT[0], moorT[1]]];
    var _nReef = 1 + obRng.int(0, 2);
    for (var _ri = 0; _ri < _nReef; _ri++) placeReefPatch(1, 1 + obRng.int(0, 1), _reefAvoid);
    tryPlaceOb('skerry', 1, 2 + obRng.int(0, 2), 10, 1, [moorT], 3); // 出水暗礁 ×2-4（暮光带，窜出水面）
    placeArch([moorT]); // 海蚀拱 ×1-3（l7_arch 独立 POI，不封 tile）
    // 障碍物挖除后刷新海洋候选（POI 不许落在障碍物上）
    ocean = ocean.filter(function (c) { return tileAt(map, c[0], c[1]) === 1; });

    /* ---- 海洋 POI（v2.0 P3：按下潜深度带重布） ---- */
    function bandCands(wanted) {
      return ocean.filter(function (c) { return wanted.indexOf(bandAt(c[0], c[1])) >= 0; });
    }
    function depthOfT(tx, ty) {
      return BR.L7Terrain.depthAt((tx + 0.5) * 3, (ty + 0.5) * 3, ter);
    }

    // 动静点 ×3：暮光/午夜/深渊带各一（七层之物活动锚点）
    var distPts = [];
    [1, 2, 3].forEach(function (b) {
      var bc = bandCands([b]);
      if (!bc.length) bc = bandCands([1, 2, 3]); // 兜底：深渊带 tile 极少时放宽
      var pt = spreadPick(rng, bc, 1, 0, ccx, ccy, 12, distPts, 8)[0];
      addPOI(map, 'disturbance', pt[0], pt[1], { band: bandAt(pt[0], pt[1]) });
      distPts.push(pt);
    });

    // 七层之物巢穴：午夜带 / 深渊带（原著栖息带；真 AI 的 lurk 起点）
    var homeCands = bandCands([2, 3]);
    if (!homeCands.length) homeCands = bandCands([1, 2, 3]);
    var home = spreadPick(rng, homeCands, 1, 0, ccx, ccy, 14, distPts, 6)[0];
    addPOI(map, 'leviathan', home[0], home[1], { band: bandAt(home[0], home[1]) });

    // 深处出口：深水区（海床 40m 以下）的瓷砖结构残片 + 光柱 →L37，需潜入内部触发；
    // 开阔海域（障碍物已避开）+ 多级兜底，保证可达
    var exitCands = ocean.filter(function (c) { return depthOfT(c[0], c[1]) >= 40; });
    if (!exitCands.length) exitCands = ocean.filter(function (c) { return depthOfT(c[0], c[1]) >= 30; });
    if (!exitCands.length) { // 终极兜底：取最深的 20 个 tile
      var byDepth = ocean.slice().sort(function (a, b) { return depthOfT(b[0], b[1]) - depthOfT(a[0], a[1]); });
      exitCands = byDepth.slice(0, 20);
    }
    var de = spreadPick(rng, exitCands, 1, 0, ccx, ccy, 10, [home].concat(distPts), 6)[0];
    addPOI(map, 'deep_exit', de[0], de[1], { band: bandAt(de[0], de[1]), depth: 3 });

    // 异常切出点：日光 / 暮光带隐蔽处（水面不反光 →L0，需观察发现）
    var an = spreadPick(rng, bandCands([0, 1]), 1, 0, ccx, ccy, 12, [home, de].concat(distPts), 6)[0];
    addPOI(map, 'anomaly_exit', an[0], an[1], { band: bandAt(an[0], an[1]) });

    // buildContent 用的元数据（不参与 hashMap）
    map.meta.l7 = {
      ocean: { x0: OX0, y0: OY0, x1: OX1, y1: OY1 },
      entryRoom: { x: entry.x, y: entry.y, w: entry.w, h: entry.h },
      door: { tx: door.tx, ty: door.ty, fx: door.fx, fy: door.fy, nx: dnx, ny: dny, axis: door.axis },
      landing: { tx: lx, ty: ly, h: DECK_H },
      stair: { tx: stair.tx, ty: stair.ty, flat: !!stair.flat },
      deck: deckRect,
      deckH: DECK_H,
      boat: { x: (bx + 0.5) * 3, z: (bz + 0.5) * 3, yaw: boatYaw },
      bands: bands, // v2.0 P3 四深度带：{name,cn,kind,d0,d1}，按下潜深度（米）划分
      terrain: ter   // v2.0 P3 海底高度场参数 {seed,ccx,ccy,a1,a2,o1,o2}（世界米）
    };
  }

  BR.Gen.registerLevel('L7',
    { rw: [4, 6], rh: [4, 6], corrW: [1, 2], loops: [2, 4], wallH: 3.2 },
    placeL7,
    ['spawn', 'entry_room', 'deep_exit']);
})();
