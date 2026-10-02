/* textures.js —— 程序化 Canvas 贴图（全部原创绘制，无外部素材）
 * 提供 BR.Textures.init / get / makeWallMaterial，供 world.js 使用。
 * 纹理 256x256（荧光灯面板 / 海报 256x128），wrapS/T = RepeatWrapping。
 */
(function () {
  var BR = window.BR = window.BR || {};

  var cache = {};    // name -> THREE.CanvasTexture（共享，永不释放）
  var matCache = {}; // level -> MeshLambertMaterial

  // ---------------- 基础绘制工具 ----------------
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 随机噪点：n 个 1~3px 的黑/白点，模拟材质颗粒
  function grain(ctx, w, h, n, alpha) {
    for (var i = 0; i < n; i++) {
      var a = alpha * (0.4 + Math.random() * 0.6);
      ctx.fillStyle = Math.random() < 0.55
        ? 'rgba(0,0,0,' + a.toFixed(3) + ')'
        : 'rgba(255,255,255,' + (a * 0.7).toFixed(3) + ')';
      var s = 1 + (Math.random() * 2 | 0);
      ctx.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, s, s);
    }
  }

  // 柔和污渍斑块（径向渐变，边缘透明）
  function blotch(ctx, x, y, r, color) {
    var g = ctx.createRadialGradient(x, y, r * 0.12, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  function stains(ctx, w, h, count, colors, rMin, rMax) {
    for (var i = 0; i < count; i++) {
      blotch(ctx, Math.random() * w, Math.random() * h,
        rMin + Math.random() * (rMax - rMin), colors[(Math.random() * colors.length) | 0]);
    }
  }

  // 不规则裂缝
  function crack(ctx, x, y, len, segs) {
    ctx.strokeStyle = 'rgba(20,20,20,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y);
    var a = Math.random() * 6.2832;
    for (var i = 0; i < segs; i++) {
      a += (Math.random() - 0.5) * 1.2;
      x += Math.cos(a) * len / segs; y += Math.sin(a) * len / segs;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 木纹波浪线
  function woodGrain(ctx, x0, y0, w, base) {
    ctx.strokeStyle = base;
    ctx.lineWidth = 1;
    for (var r = 0; r < 4; r++) {
      ctx.beginPath();
      var yy = y0 + 6 + r * 12 + Math.random() * 4;
      ctx.moveTo(x0, yy);
      for (var x = 0; x <= w; x += 16) {
        ctx.lineTo(x0 + x, yy + Math.sin(x * 0.08 + r) * 3);
      }
      ctx.stroke();
    }
  }

  // ---------------- 各贴图绘制 ----------------
  var painters = {
    // L0 泛黄墙纸：竖条纹 + 污渍
    wallpaper: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#b3a061'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < w; i += 32) { // 竖条纹
        x.fillStyle = (i / 32) % 2 ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.045)';
        x.fillRect(i, 0, 16, h);
      }
      var vg = x.createLinearGradient(0, 0, 0, h); // 顶部略亮、底部发暗
      vg.addColorStop(0, 'rgba(255,250,230,0.10)');
      vg.addColorStop(1, 'rgba(40,30,10,0.22)');
      x.fillStyle = vg; x.fillRect(0, 0, w, h);
      stains(x, w, h, 9, ['rgba(90,70,30,0.28)', 'rgba(60,50,25,0.30)', 'rgba(120,95,50,0.22)'], 12, 46);
      x.fillStyle = 'rgba(50,40,20,0.35)'; x.fillRect(0, 0, w, 5); x.fillRect(0, h - 7, w, 7); // 踢脚线污边
      grain(x, w, h, 1100, 0.10);
      return c;
    },
    // L0 潮湿地毯：深色水迹
    carpet: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#9c8a5e'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 2600; i++) { // 地毯绒毛短划
        x.strokeStyle = Math.random() < 0.5 ? 'rgba(60,50,30,0.25)' : 'rgba(220,200,150,0.20)';
        x.lineWidth = 1;
        var px = Math.random() * w, py = Math.random() * h, a = Math.random() * 6.2832;
        x.beginPath(); x.moveTo(px, py);
        x.lineTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3); x.stroke();
      }
      stains(x, w, h, 7, ['rgba(35,42,58,0.42)', 'rgba(30,36,50,0.45)', 'rgba(70,60,40,0.30)'], 22, 70); // 深色水迹
      stains(x, w, h, 5, ['rgba(50,40,25,0.30)'], 10, 30);
      grain(x, w, h, 700, 0.08);
      return c;
    },
    // L0 吊顶方格
    ceiling: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#cfc9b8'; x.fillRect(0, 0, w, h);
      var t = 128;
      for (var ty = 0; ty < 2; ty++) for (var tx = 0; tx < 2; tx++) {
        var v = 196 + ((Math.random() * 22) | 0); // 每块板轻微色差
        x.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 24) + ')';
        x.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4);
      }
      x.strokeStyle = '#7d7768'; x.lineWidth = 4; // 龙骨缝
      for (var i = 0; i <= 2; i++) {
        x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
        x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
      }
      stains(x, w, h, 4, ['rgba(120,90,50,0.30)', 'rgba(90,70,40,0.28)'], 14, 40);
      grain(x, w, h, 800, 0.08);
      return c;
    },
    // 荧光灯面板 256x128
    fluor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#2e2e2e'; x.fillRect(0, 0, w, h); // 灯框
      var g = x.createLinearGradient(0, 10, 0, h - 10);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#f4f4ec'); g.addColorStop(1, '#dcdcd2');
      x.fillStyle = g; x.fillRect(10, 10, w - 20, h - 20);
      x.fillStyle = 'rgba(255,255,255,0.9)'; // 灯管高光
      x.fillRect(10, h * 0.30, w - 20, 6); x.fillRect(10, h * 0.66, w - 20, 6);
      x.fillStyle = 'rgba(120,110,80,0.25)'; x.fillRect(10, 10, w - 20, 8); // 灯管旁积灰
      x.fillStyle = '#1c1c1c'; // 四角螺丝
      [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]].forEach(function (p) {
        x.beginPath(); x.arc(p[0], p[1], 3, 0, 6.2832); x.fill();
      });
      grain(x, w, h, 200, 0.05);
      return c;
    },
    // L1/L2 混凝土墙
    concrete: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#8d8d8c'; x.fillRect(0, 0, w, h);
      stains(x, w, h, 12, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.12)', 'rgba(70,70,70,0.18)'], 20, 70);
      x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(0, h * 0.48, w, 3); // 模板接缝
      crack(x, w * 0.3, h * 0.2, 120, 7);
      crack(x, w * 0.7, h * 0.6, 90, 6);
      stains(x, w, h, 3, ['rgba(96,74,52,0.35)'], 8, 22); // 锈水渍
      grain(x, w, h, 1600, 0.10);
      return c;
    },
    // L1/L2 混凝土地面
    concreteFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#747474'; x.fillRect(0, 0, w, h);
      stains(x, w, h, 10, ['rgba(0,0,0,0.20)', 'rgba(255,255,255,0.07)', 'rgba(40,40,40,0.22)'], 18, 60);
      x.strokeStyle = 'rgba(30,30,30,0.5)'; x.lineWidth = 3; // 伸缩缝
      x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
      x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      stains(x, w, h, 4, ['rgba(20,18,14,0.45)'], 10, 34); // 油渍
      grain(x, w, h, 1400, 0.10);
      return c;
    },
    // 混凝土柱
    pillar: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#969694'); g.addColorStop(1, '#6e6e6c');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 6; i++) { // 竖向水渍条
        var sx = Math.random() * w;
        x.fillStyle = 'rgba(60,55,45,0.25)';
        x.fillRect(sx, 0, 3 + Math.random() * 6, h);
      }
      stains(x, w, h, 5, ['rgba(0,0,0,0.16)'], 16, 44);
      grain(x, w, h, 1200, 0.10);
      return c;
    },
    // L3 棕色砖墙
    brick: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#4e423b'; x.fillRect(0, 0, w, h); // 灰缝
      var bw = 64, bh = 32;
      for (var row = 0; row < h / bh; row++) {
        var off = (row % 2) * bw / 2;
        for (var col = -1; col < w / bw + 1; col++) {
          var r = 112 + ((Math.random() * 36) | 0), gg = 66 + ((Math.random() * 22) | 0), b = 46 + ((Math.random() * 16) | 0);
          x.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
          x.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
          x.fillStyle = 'rgba(255,255,255,0.06)';
          x.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, 5); // 砖顶受光
        }
      }
      stains(x, w, h, 6, ['rgba(0,0,0,0.25)', 'rgba(60,40,25,0.30)'], 16, 50);
      grain(x, w, h, 1000, 0.10);
      return c;
    },
    // L3 灰色瓷砖地
    tileFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#4c4c4c'; x.fillRect(0, 0, w, h); // 缝
      var t = 64;
      for (var ty = 0; ty < 4; ty++) for (var tx = 0; tx < 4; tx++) {
        var v = 148 + ((Math.random() * 26) | 0);
        x.fillStyle = 'rgb(' + v + ',' + (v + 3) + ',' + (v + 6) + ')';
        x.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4);
        x.fillStyle = 'rgba(255,255,255,0.10)'; // 釉面反光
        x.fillRect(tx * t + 8, ty * t + 8, t - 20, 6);
      }
      stains(x, w, h, 6, ['rgba(30,28,24,0.35)', 'rgba(90,70,45,0.25)'], 12, 40);
      grain(x, w, h, 700, 0.07);
      return c;
    },
    // 金属天花板/墙
    metal: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8a96a1'); g.addColorStop(0.5, '#6e7a85'); g.addColorStop(1, '#59636d');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 90; i++) { // 拉丝横纹
        x.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
        x.lineWidth = 1;
        var yy = Math.random() * h;
        x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke();
      }
      x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, 126, w, 4); // 板缝
      x.fillStyle = '#3d444c'; // 铆钉
      for (var rx = 16; rx < w; rx += 48) {
        x.beginPath(); x.arc(rx, 118, 4, 0, 6.2832); x.fill();
        x.beginPath(); x.arc(rx, 138, 4, 0, 6.2832); x.fill();
      }
      stains(x, w, h, 4, ['rgba(110,70,35,0.30)'], 8, 26); // 锈点
      grain(x, w, h, 600, 0.07);
      return c;
    },
    // 钢门
    doorMetal: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#5d6672'); g.addColorStop(0.5, '#7b8592'); g.addColorStop(1, '#5d6672');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 4; // 凹陷门板
      x.strokeRect(28, 20, w - 56, h * 0.40);
      x.strokeRect(28, h * 0.52, w - 56, h * 0.40);
      x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 2;
      x.strokeRect(32, 24, w - 64, h * 0.40 - 8);
      for (var i = 0; i < 12; i++) { // 划痕
        x.strokeStyle = 'rgba(220,225,230,0.35)'; x.lineWidth = 1;
        var sx = Math.random() * w, sy = Math.random() * h;
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (Math.random() - 0.5) * 60, sy + (Math.random() - 0.5) * 20); x.stroke();
      }
      x.fillStyle = '#39404a'; x.fillRect(0, h - 34, w, 34); // 底部防撞板
      stains(x, w, h, 5, ['rgba(120,70,30,0.35)'], 6, 20); // 锈
      grain(x, w, h, 700, 0.08);
      return c;
    },
    // 木板条箱
    crate: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#3a2c1c'; x.fillRect(0, 0, w, h); // 板缝底
      var ph = 64;
      for (var p = 0; p < 4; p++) {
        var r = 128 + ((Math.random() * 30) | 0), gg = 98 + ((Math.random() * 24) | 0), b = 62 + ((Math.random() * 18) | 0);
        x.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
        x.fillRect(0, p * ph + 2, w, ph - 4);
        woodGrain(x, 0, p * ph, w, 'rgba(70,50,28,0.5)');
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, p * ph, w, 3); // 板缝阴影
      }
      x.fillStyle = '#241a10'; // 钉子
      for (var nx = 14; nx < w; nx += 76) for (var ny = 12; ny < h; ny += 56) {
        x.beginPath(); x.arc(nx, ny, 3, 0, 6.2832); x.fill();
      }
      stains(x, w, h, 4, ['rgba(40,28,14,0.35)'], 14, 36);
      grain(x, w, h, 900, 0.09);
      return c;
    },
    // 管道
    pipe: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h); // 横向管道的高光在中部
      g.addColorStop(0, '#3f464d'); g.addColorStop(0.28, '#7d8894');
      g.addColorStop(0.5, '#a9b4bf'); g.addColorStop(0.72, '#7d8894'); g.addColorStop(1, '#3f464d');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(40, 0, 10, h); x.fillRect(w - 50, 0, 10, h); // 管箍
      x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(44, 0, 3, h); x.fillRect(w - 46, 0, 3, h);
      stains(x, w, h, 8, ['rgba(130,75,30,0.45)', 'rgba(90,50,22,0.45)'], 6, 22); // 锈斑
      grain(x, w, h, 500, 0.07);
      return c;
    },
    // FUN 彩色派对墙
    partyWall: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ff8fc7'); g.addColorStop(1, '#ff6aa8');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      var cols = ['#ffe14d', '#4dd2ff', '#7dff6a', '#c77dff', '#ff6a6a', '#ffffff'];
      for (var i = 0; i < 70; i++) { // 五彩纸屑
        x.fillStyle = cols[(Math.random() * cols.length) | 0];
        x.save();
        x.translate(Math.random() * w, Math.random() * h);
        x.rotate(Math.random() * 3.14);
        x.fillRect(-4, -2, 8, 4);
        x.restore();
      }
      for (var b = 0; b < 3; b++) { // 气球图案
        var bx = 30 + Math.random() * (w - 60), by = 40 + Math.random() * (h - 90);
        x.fillStyle = cols[(Math.random() * cols.length) | 0];
        x.beginPath(); x.ellipse(bx, by, 20, 26, 0, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.5)';
        x.beginPath(); x.ellipse(bx - 6, by - 8, 6, 9, -0.4, 0, 6.2832); x.fill();
        x.strokeStyle = 'rgba(80,40,60,0.7)'; x.lineWidth = 1.5;
        x.beginPath(); x.moveTo(bx, by + 26); x.quadraticCurveTo(bx + 8, by + 60, bx - 4, by + 90); x.stroke();
      }
      x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 5; // 彩带波浪
      for (var s = 0; s < 2; s++) {
        x.beginPath();
        for (var px = 0; px <= w; px += 8) x.lineTo(px, 30 + s * 90 + Math.sin(px * 0.09 + s * 2) * 14);
        x.stroke();
      }
      grain(x, w, h, 400, 0.05);
      return c;
    },
    // FUN 格纹地
    partyFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var t = 32, cols = ['#f7f3ea', '#ff9ecb', '#f7f3ea', '#9ed8ff'];
      for (var ty = 0; ty < 8; ty++) for (var tx = 0; tx < 8; tx++) {
        x.fillStyle = cols[(tx + ty * 2) % 4];
        x.fillRect(tx * t, ty * t, t, t);
      }
      x.strokeStyle = 'rgba(120,90,110,0.35)'; x.lineWidth = 2;
      for (var i = 0; i <= 8; i++) {
        x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
        x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
      }
      stains(x, w, h, 5, ['rgba(150,60,80,0.25)', 'rgba(80,60,40,0.22)'], 10, 30); // 饮料渍
      grain(x, w, h, 500, 0.06);
      return c;
    },
    // FUN 海报 256x128："TIME 4 FUN"
    posterFun: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#5b2a9d'); g.addColorStop(1, '#c22a7d');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 40; i++) {
        x.fillStyle = ['#ffe14d', '#4dd2ff', '#7dff6a', '#ffffff'][(Math.random() * 4) | 0];
        x.fillRect(Math.random() * w, Math.random() * h, 4, 4);
      }
      x.textAlign = 'center';
      x.font = 'bold 44px sans-serif';
      x.lineWidth = 6; x.strokeStyle = '#1c1030';
      x.strokeText('TIME 4 FUN', w / 2, 58);
      x.fillStyle = '#ffe14d'; x.fillText('TIME 4 FUN', w / 2, 58);
      x.font = 'bold 30px sans-serif';
      x.strokeText('=)', w / 2, 102);
      x.fillStyle = '#ffffff'; x.fillText('=)', w / 2, 102);
      grain(x, w, h, 250, 0.06);
      return c;
    },
    // 血笑脸
    smiley: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#191114'; x.fillRect(0, 0, w, h);
      stains(x, w, h, 6, ['rgba(0,0,0,0.4)'], 20, 60);
      x.fillStyle = '#e8c53a'; // 脸
      x.beginPath(); x.arc(w / 2, h / 2, 74, 0, 6.2832); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.15)';
      x.beginPath(); x.arc(w / 2, h / 2, 74, 0.6, 2.2); x.fill(); // 阴影让笑容诡异
      x.fillStyle = '#141414'; // 眼睛
      x.beginPath(); x.arc(w / 2 - 26, h / 2 - 16, 10, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(w / 2 + 26, h / 2 - 16, 10, 0, 6.2832); x.fill();
      x.strokeStyle = '#8f1d1d'; x.lineWidth = 9; x.lineCap = 'round'; // 血红大笑
      x.beginPath(); x.arc(w / 2, h / 2 + 8, 44, 0.35, 2.79); x.stroke();
      x.strokeStyle = '#a31616'; x.lineWidth = 4; // 眼角血泪
      [[-26, -6], [26, -6]].forEach(function (p) {
        x.beginPath(); x.moveTo(w / 2 + p[0], h / 2 + p[1]);
        x.lineTo(w / 2 + p[0] + (p[0] < 0 ? -6 : 6), h / 2 + 46); x.stroke();
        x.beginPath(); x.arc(w / 2 + p[0] + (p[0] < 0 ? -6 : 6), h / 2 + 50, 5, 0, 6.2832);
        x.fillStyle = '#a31616'; x.fill();
      });
      grain(x, w, h, 500, 0.08);
      return c;
    },
    // L0 异常墙斑痕：墙纸底 + 巨大的非自然深色有机斑痕
    stain: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#a3905c'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < w; i += 32) {
        x.fillStyle = (i / 32) % 2 ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.045)';
        x.fillRect(i, 0, 16, h);
      }
      // 中央异常斑痕：深紫褐色有机形状 + 触须
      var cx = w / 2, cy = h / 2;
      for (var b = 0; b < 26; b++) {
        var a = Math.random() * 6.2832, rr = 20 + Math.random() * 62;
        blotch(x, cx + Math.cos(a) * rr * 0.7, cy + Math.sin(a) * rr * 0.7,
          14 + Math.random() * 26, 'rgba(38,22,44,0.55)');
      }
      blotch(x, cx, cy, 52, 'rgba(20,12,26,0.85)');
      x.strokeStyle = 'rgba(30,18,38,0.6)'; x.lineWidth = 3; // 触须裂纹
      for (var t2 = 0; t2 < 9; t2++) {
        var aa = (t2 / 9) * 6.2832 + Math.random() * 0.4;
        x.beginPath(); x.moveTo(cx + Math.cos(aa) * 40, cy + Math.sin(aa) * 40);
        x.quadraticCurveTo(cx + Math.cos(aa) * 80, cy + Math.sin(aa) * 80,
          cx + Math.cos(aa + 0.3) * (105 + Math.random() * 20), cy + Math.sin(aa + 0.3) * (105 + Math.random() * 20));
        x.stroke();
      }
      x.strokeStyle = 'rgba(90,140,70,0.35)'; x.lineWidth = 6; // 边缘霉绿晕
      x.beginPath(); x.arc(cx, cy, 72, 0, 6.2832); x.stroke();
      grain(x, w, h, 800, 0.10);
      return c;
    },
    // 气球
    balloon: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#241a2e'; x.fillRect(0, 0, w, h);
      var cols = ['#ff4d4d', '#ffd24d', '#4da6ff'];
      for (var i = 0; i < 3; i++) {
        var bx = 52 + i * 76, by = 96;
        var g = x.createRadialGradient(bx - 10, by - 14, 6, bx, by, 44);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, cols[i]); g.addColorStop(1, 'rgba(40,10,20,0.9)');
        x.fillStyle = g;
        x.beginPath(); x.ellipse(bx, by, 34, 44, 0, 0, 6.2832); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.65)';
        x.beginPath(); x.ellipse(bx - 12, by - 16, 8, 13, -0.4, 0, 6.2832); x.fill();
        x.strokeStyle = 'rgba(220,200,220,0.8)'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(bx, by + 44);
        x.quadraticCurveTo(bx + 14, by + 90, bx - 8, by + 130); x.stroke();
      }
      grain(x, w, h, 300, 0.06);
      return c;
    },
    // 蛋糕
    cake: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#6e3f30'; x.fillRect(0, 0, w, h); // 桌面
      grain(x, w, h, 500, 0.08);
      x.fillStyle = '#d8d2c4'; // 盘子
      x.beginPath(); x.ellipse(w / 2, h * 0.68, 96, 30, 0, 0, 6.2832); x.fill();
      x.fillStyle = '#f2a0c0'; // 蛋糕侧面
      x.fillRect(w / 2 - 70, h * 0.40, 140, h * 0.28);
      x.fillStyle = '#c9759b';
      for (var i = 0; i < 5; i++) x.fillRect(w / 2 - 70, h * 0.40 + i * 16, 140, 5); // 层纹
      x.fillStyle = '#fff6ec'; // 顶面奶油
      x.beginPath(); x.ellipse(w / 2, h * 0.40, 70, 20, 0, 0, 6.2832); x.fill();
      x.fillStyle = '#e2546e'; // 奶油滴边
      for (var d = 0; d < 10; d++) {
        var dx = w / 2 - 66 + d * 14;
        x.beginPath(); x.arc(dx, h * 0.40 + 8, 7, 0, 3.1416); x.fill();
      }
      for (var k = 0; k < 3; k++) { // 蜡烛
        var kx = w / 2 - 34 + k * 34;
        x.fillStyle = ['#4dd2ff', '#ffe14d', '#7dff6a'][k];
        x.fillRect(kx - 4, h * 0.40 - 34, 8, 34);
        x.fillStyle = '#ffb13d'; // 火焰
        x.beginPath(); x.ellipse(kx, h * 0.40 - 42, 6, 10, 0, 0, 6.2832); x.fill();
        x.fillStyle = '#fff3b0';
        x.beginPath(); x.ellipse(kx, h * 0.40 - 40, 3, 5, 0, 0, 6.2832); x.fill();
      }
      return c;
    },
    // 绿色安全出口牌
    exitSign: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#0a7a2e'; x.fillRect(0, 0, w, h);
      var g = x.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, 160);
      g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#eafff0'; x.lineWidth = 6; x.strokeRect(10, 10, w - 20, h - 20);
      x.fillStyle = '#ffffff'; x.textAlign = 'center';
      x.font = 'bold 64px sans-serif';
      x.fillText('安全出口', w / 2, h / 2 + 10);
      x.font = 'bold 40px sans-serif';
      x.fillText('EXIT →', w / 2, h / 2 + 66);
      grain(x, w, h, 200, 0.05);
      return c;
    },
    // 纸条笔记
    note: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#e6dcbd'; x.fillRect(0, 0, w, h);
      var g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(120,90,40,0.25)'); g.addColorStop(1, 'rgba(120,90,40,0.05)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(90,110,150,0.5)'; x.lineWidth = 1; // 横线
      for (var ly = 44; ly < h - 20; ly += 28) {
        x.beginPath(); x.moveTo(20, ly); x.lineTo(w - 20, ly); x.stroke();
      }
      x.strokeStyle = 'rgba(30,30,60,0.75)'; x.lineWidth = 2; // 潦草手写
      for (var wy = 38; wy < h - 24; wy += 28) {
        x.beginPath();
        var wx = 26;
        x.moveTo(wx, wy);
        while (wx < w - 30) {
          wx += 8 + Math.random() * 14;
          x.quadraticCurveTo(wx - 6, wy - 10 + Math.random() * 6, wx, wy + (Math.random() - 0.5) * 8);
        }
        x.stroke();
      }
      x.strokeStyle = 'rgba(120,70,30,0.5)'; x.lineWidth = 5; // 咖啡渍圈
      x.beginPath(); x.arc(w - 60, h - 60, 26, 0, 6.2832); x.stroke();
      grain(x, w, h, 400, 0.06);
      return c;
    },
    // 铁栅栏（锈蚀竖条）
    rustFence: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#151312'; x.fillRect(0, 0, w, h); // 缝隙透黑
      for (var bx = 0; bx < w; bx += 32) {
        var g = x.createLinearGradient(bx, 0, bx + 22, 0);
        g.addColorStop(0, '#4a2c16'); g.addColorStop(0.5, '#9a5f2e'); g.addColorStop(1, '#4a2c16');
        x.fillStyle = g; x.fillRect(bx + 5, 0, 22, h);
        x.fillStyle = 'rgba(255,220,180,0.18)'; x.fillRect(bx + 8, 0, 3, h); // 金属反光
      }
      x.fillStyle = '#3a2312'; x.fillRect(0, h * 0.30, w, 14); x.fillRect(0, h * 0.66, w, 14); // 横档
      stains(x, w, h, 10, ['rgba(140,70,25,0.5)', 'rgba(80,40,15,0.55)'], 6, 20); // 重锈
      grain(x, w, h, 800, 0.10);
      return c;
    },
    // 纯黑
    void: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#000000'; x.fillRect(0, 0, w, h);
      grain(x, w, h, 120, 0.03);
      return c;
    }
  };

  // ---------------- 构建与缓存 ----------------
  function build(name) {
    var p = painters[name];
    if (!p) { if (BR.log) BR.log('[textures] 缺少贴图: ' + name); return null; }
    var w = 256, h = 256;
    if (name === 'fluor' || name === 'posterFun') h = 128;
    var tex = new THREE.CanvasTexture(p(w, h));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  // 关卡 -> 墙面贴图映射（world.js 用 makeWallMaterial 取墙材质）
  var WALL_TEX = {
    L0: 'wallpaper',
    L1: 'concrete',
    L2: 'concrete',
    L3: 'brick',
    FUN: 'partyWall'
  };
  // 扩建钩子：新关卡注册墙面贴图映射（buildContent 里也可用 theme.wall/floor/ceil 指定）
  // （挂载点在文件末尾 BR.Textures 字面量赋值之后，避免被覆盖）

  BR.Textures = {
    // 预生成全部贴图（游戏启动时调用一次）
    init: function () {
      for (var n in painters) {
        if (painters.hasOwnProperty(n) && !cache[n]) cache[n] = build(n);
      }
    },
    // 取贴图（未预生成则懒生成）
    get: function (name) {
      if (!cache[name]) cache[name] = build(name);
      return cache[name];
    },
    // 关卡墙面材质：内部缓存。注意返回的材质共享 clone 出的贴图，
    // world 卸载区块时只 dispose 几何体，不得 dispose 这里的材质/贴图。
    makeWallMaterial: function (level) {
      if (matCache[level]) return matCache[level];
      var texName = WALL_TEX[level] || WALL_TEX.L0;
      var tex = this.get(texName);
      var t2 = tex ? tex.clone() : null;
      if (t2) {
        t2.needsUpdate = true;
        t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
      }
      var m = new THREE.MeshLambertMaterial({ map: t2 });
      matCache[level] = m;
      return m;
    }
  };

  // 扩建钩子：新关卡注册程序化贴图（painter(ctx, w, h) 在 256x256 canvas 上绘制）
  // 用法：BR.Textures.registerTex('pool_tile', function(ctx,w,h){ ... });
  BR.Textures.registerTex = function (name, painter) { painters[name] = painter; };
  // 扩建钩子：新关卡注册墙面贴图映射
  // 用法：BR.Textures.registerWallTex('L7', 'ocean_wall');
  BR.Textures.registerWallTex = function (level, texName) { WALL_TEX[level] = texName; };
})();
