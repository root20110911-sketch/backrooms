/* textures.js —— 程序化 Canvas 贴图（全部原创绘制，无外部素材）
* 材质工厂统一出口：BR.Textures.init / get / surface / matFor / finishMaterial /
* makeWallMaterial / worldUV / worldPlane / tileRepeat / roughness / graffiti /
* blobShadowMaterial / registerTex / registerRough / registerWallTex。
* 各关卡只从这里取材质，不许各关卡各搞一套贴图管线（W-materials v2.4 约定）。
*
*
* 根因排查（逐项确认）：
* 1) UV 重复：buildChunk 的墙/地/顶 = 共享 BoxGeometry(T,1,T)/PlaneGeometry(T,T)，
* 每面 UV 都是完整 0~1 → 1 张贴图正好铺 1 个 3m tile，UV 本身没问题；
* 画师也已按"真实米制"起稿（tile=3m，砖 0.2m、瓷砖 0.375m、吊顶 0.6m）。
* 真正的坑在各关卡自定义大平面（如 hPlane(qw,qh) 直接 PlaneGeometry(qw,qh)，
* UV 0~1 拉满整面 → 12m 的池底只铺 1 张贴图，特征被拉大 4 倍）。
* 修法：本文件新增 worldUV / worldPlane / tileRepeat，UV 按世界米数换算
* （每 BR.TILE 米重复一次），新写的大平面一律走 worldPlane。
* 2) 过滤：CanvasTexture 默认即 LinearMipmapLinear + generateMipmaps，
* 本文件显式写死 magFilter=LinearFilter / minFilter=LinearMipmapLinearFilter，
* 过滤从来不是问题（v1.4 结论延续）。
* 3) 各向异性：之前硬编码 anisotropy=8，且 init() 跑在 renderer 创建之前，
* 根本拿不到硬件上限。修法：applyRendererCaps() 延迟到第一次 get() 时
* （此时 BR.Game.renderer 必已建好）读取 capabilities.getMaxAnisotropy()，
* 按"硬件上限 ∩ 画质档上限（高/中 8，低 4）"回填全部已建贴图。
* 4) 跨关重复：makeWallMaterial 给每关 clone 的贴图按关卡名 hash 设 offset，
* 同为 concrete 的 L1/L2 污渍不再像素级对齐。
* 质感分级（三参数：底色 / 粗糙度变化 / 脏污层）：
* - 瓷砖：釉面低粗糙 + 缝污 + 水渍三件套（roughnessMap：水渍区更光滑）；
* - 地毯：全哑光 + 磨损方向（绒毛 strokes 沿主导方向、磨损带压光）；
* - 混凝土：斑驳 + 水渍竖流 + 霉斑（沿边聚集）+ 踢脚线重力语法；
* - 金属：拉丝横纹 + 锈蚀下淌 + 划痕高光（roughnessMap：锈=糙、划痕=光滑），
* 环境反射靠 MeshStandardMaterial 的直接光高光近似（无 envMap 时金属度
* 配中低粗糙即有点光源拉长高光；scene 级 envMap 属世界配置，不在本文件）；
* - 黄墙纸（L0）：纸纤维 + 竖条纹 + 污渍霉斑 + 踢脚线重力（配合 W-l0gen 的经典感）。
* 性能：大表面 512 / 小道具 256（低画质档大表面也降 256，见 pickSize）；
* roughnessMap 统一 256。全部生成期一次画完，运行时零成本。
* 存档：本文件不碰存档格式（backrooms_save_v2 不变）。
*/
(function () {
var BR = window.BR = window.BR || {};

var cache = {}; // name -> THREE.CanvasTexture（共享，永不释放）
var roughCache = {}; // name -> 粗糙度贴图（共享，永不释放）
var matCache = {}; // level -> 墙面材质（makeWallMaterial）

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

// ---------------- W-materials v2.4：脏污语法工具 ----------------
// 水渍三件套（AAA_REF 4.1）：深色不规则边缘环 + 中心略浅 + 内圈二次沉积线。
// tone='r,g,b'；yScale>1 纵向拉长（墙面竖流），<1 压扁（地面水洼）。
function waterStain(x, cx, cy, r, tone, yScale) {
tone = tone || '60,52,38';
yScale = yScale || 1;
var i, a, rr, px, py, n = 26;
x.strokeStyle = 'rgba(' + tone + ',0.42)';
x.lineWidth = Math.max(2, r * 0.10);
x.beginPath();
for (i = 0; i <= n; i++) {
a = (i / n) * 6.2832;
rr = r * (0.86 + Math.random() * 0.26);
px = cx + Math.cos(a) * rr; py = cy + Math.sin(a) * rr * yScale;
if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
}
x.closePath(); x.stroke();
blotch(x, cx, cy, r * 0.72, 'rgba(' + tone + ',0.16)'); // 中心略浅
x.strokeStyle = 'rgba(' + tone + ',0.22)'; // 内圈二次沉积线
x.lineWidth = Math.max(1, r * 0.04);
x.beginPath();
x.ellipse(cx, cy, r * 0.55, r * 0.55 * yScale, 0, 0, 6.2832);
x.stroke();
}

// 霉斑（AAA_REF 4.1）：深绿/黑不规则团块，70% 概率贴上下边缘聚集
// （墙角/天花板边缘/踢脚线是霉菌老巢）。
function mold(x, w, h, count, rMin, rMax) {
var cols = ['rgba(38,48,30,', 'rgba(22,28,18,', 'rgba(52,60,34,'];
for (var i = 0; i < count; i++) {
var px, py;
if (Math.random() < 0.7) {
px = Math.random() * w;
py = Math.random() < 0.6? Math.random() * h * 0.18: h - Math.random() * h * 0.18;
} else { px = Math.random() * w; py = Math.random() * h;}
var r = rMin + Math.random() * (rMax - rMin);
var col = cols[(Math.random() * cols.length) | 0];
for (var k = 0; k < 4; k++) {
blotch(x, px + (Math.random() - 0.5) * r, py + (Math.random() - 0.5) * r,
r * (0.35 + Math.random() * 0.4), col + (0.30 + Math.random() * 0.25).toFixed(2) + ')');
}
}
}

// 踢脚线/重力语法（AAA_REF 4.1）：墙根底部 18% 压暗 + 底部污渍密度加倍。
// 脏东西永远往下沉积——这是"重力"，不是装饰。
function gravityGrime(x, w, h, strength) {
strength = strength == null? 1: strength;
var g = x.createLinearGradient(0, h * 0.82, 0, h);
g.addColorStop(0, 'rgba(25,20,12,0)');
g.addColorStop(1, 'rgba(25,20,12,' + (0.30 * strength).toFixed(2) + ')');
x.fillStyle = g; x.fillRect(0, h * 0.82, w, h * 0.18);
x.save(); x.translate(0, h * 0.88);
stains(x, w, h * 0.12, 8, ['rgba(40,32,20,0.30)', 'rgba(20,18,14,0.32)'], 6, 22);
x.restore();
}

// 墙纸纸纤维：近水平的细短纤维，纸纹质感
function paperFiber(x, w, h) {
for (var i = 0; i < 900; i++) {
var px = Math.random() * w, py = Math.random() * h;
var len = 2 + Math.random() * 5, a = (Math.random() - 0.5) * 0.5;
x.strokeStyle = Math.random() < 0.5? 'rgba(255,250,235,0.10)': 'rgba(80,65,40,0.10)';
x.lineWidth = 1;
x.beginPath(); x.moveTo(px, py);
x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
}
}

// 垂流痕（锈水/水渍下淌）：上深下浅的不规则竖条。rgb='r,g,b'。
function streak(x, sx, y0, len, wdt, rgb) {
var g = x.createLinearGradient(0, y0, 0, y0 + len);
g.addColorStop(0, 'rgba(' + rgb + ',0.55)');
g.addColorStop(1, 'rgba(' + rgb + ',0)');
x.fillStyle = g;
var y;
x.beginPath();
x.moveTo(sx - wdt / 2, y0);
for (y = y0; y <= y0 + len; y += 8) x.lineTo(sx - wdt / 2 + (Math.random() - 0.5) * 4, y);
for (y = y0 + len; y >= y0; y -= 8) x.lineTo(sx + wdt / 2 + (Math.random() - 0.5) * 4, y);
x.closePath(); x.fill();
}

// 磨损带：椭圆柔光（地毯走道压光/磨损方向可视化）
function wearBand(x, cx, cy, rx, ry, color) {
x.save(); x.translate(cx, cy); x.scale(Math.max(0.2, rx / ry), 1);
blotch(x, 0, 0, ry, color);
x.restore();
}

  // ---------------- 各贴图绘制 ----------------
  // 质感三参数：底色（base）/ 粗糙度变化（见 roughPainters）/ 脏污层（本节）。
  var painters = {
    // L0 泛黄墙纸：竖条纹 + 纸纤维 + 污渍霉斑 + 踢脚线重力（W-l0gen 要的经典感）
    // 世界尺度：整张贴图 = 3m 宽墙面。条纹周期 ~0.125m（24 条/3m），轻微不规则。
    wallpaper: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#b3a061'; x.fillRect(0, 0, w, h);
      var n = 24, sw = w / n;
      for (var i = 0; i < n; i++) { // 竖条纹（宽度轻微抖动，弱化 3m 重复感）
        var wob = 1 + (Math.random() - 0.5) * 0.22;
        x.fillStyle = (i % 2) ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.045)';
        x.fillRect(i * sw, 0, sw * wob, h);
      }
      paperFiber(x, w, h); // 纸纹
      var vg = x.createLinearGradient(0, 0, 0, h); // 顶部略亮、底部发暗
      vg.addColorStop(0, 'rgba(255,250,230,0.10)');
      vg.addColorStop(1, 'rgba(40,30,10,0.22)');
      x.fillStyle = vg; x.fillRect(0, 0, w, h);
      // 污渍：小而多（3~12cm），大斑块最容易暴露"每 3m 重复"
      stains(x, w, h, 16, ['rgba(90,70,30,0.26)', 'rgba(60,50,25,0.28)', 'rgba(120,95,50,0.20)'], 8, 30);
      mold(x, w, h, 12, 6, 20); // 霉斑：沿上下边缘聚集
      gravityGrime(x, w, h, 1); // 踢脚线重力
      grain(x, w, h, 2600, 0.10);
      return c;
    },
    // L0 潮湿地毯：哑光 + 磨损方向（绒毛主导方向 + 走道磨损带）+ 深色水迹
    // 整张 = 3m×3m 地面
    carpet: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#9c8a5e'; x.fillRect(0, 0, w, h);
      var wearA = (Math.random() - 0.5) * 0.5; // 本张地毯的主导磨损方向（近水平）
      for (var i = 0; i < 5200; i++) { // 地毯绒毛短划：65% 沿磨损方向
        var a = Math.random() < 0.65 ? wearA + (Math.random() - 0.5) * 0.7 : Math.random() * 6.2832;
        x.strokeStyle = Math.random() < 0.5 ? 'rgba(60,50,30,0.25)' : 'rgba(220,200,150,0.20)';
        x.lineWidth = 1;
        var px = Math.random() * w, py = Math.random() * h;
        x.beginPath(); x.moveTo(px, py);
        x.lineTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3); x.stroke();
      }
      // 走道磨损带：沿磨损方向的压光条（哑光地毯上唯一的"光泽"变化）
      for (var b = 0; b < 3; b++) {
        wearBand(x, w * (0.25 + 0.25 * b) + (Math.random() - 0.5) * 40, h * (0.3 + Math.random() * 0.4),
          w * 0.28, h * 0.055, 'rgba(215,195,150,0.10)');
      }
      wearBand(x, w * 0.5, h * 0.52, w * 0.42, h * 0.10, 'rgba(50,42,26,0.12)'); // 中央走道积灰
      stains(x, w, h, 10, ['rgba(35,42,58,0.40)', 'rgba(30,36,50,0.42)', 'rgba(70,60,40,0.28)'], 16, 50); // 深色水迹
      stains(x, w, h, 8, ['rgba(50,40,25,0.28)'], 8, 24);
      grain(x, w, h, 1600, 0.08);
      return c;
    },
    // L0 吊顶方格（整张 = 3m×3m；标准矿棉板 0.6m → 5×5 格）
    ceiling: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#cfc9b8'; x.fillRect(0, 0, w, h);
      var n = 5, t = w / n;
      for (var ty = 0; ty < n; ty++) for (var tx = 0; tx < n; tx++) {
        var v = 196 + ((Math.random() * 22) | 0); // 每块板轻微色差
        x.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 24) + ')';
        x.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4);
      }
      x.strokeStyle = '#7d7768'; x.lineWidth = 3; // 龙骨缝
      for (var i = 0; i <= n; i++) {
        x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
        x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
      }
      // 吊顶水渍：黄褐色三件套（楼上漏水是后室经典死因）
      waterStain(x, w * 0.3, h * 0.35, 46, '120,95,55', 0.9);
      waterStain(x, w * 0.72, h * 0.68, 34, '110,88,52', 0.9);
      stains(x, w, h, 6, ['rgba(120,90,50,0.28)', 'rgba(90,70,40,0.26)'], 10, 28);
      grain(x, w, h, 1800, 0.08);
      return c;
    },
    // 荧光灯面板 256x128：灯管芯更亮一档 + 镇流器衰变黑环（AAA_REF 1.3）
    fluor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#2e2e2e'; x.fillRect(0, 0, w, h); // 灯框
      var g = x.createLinearGradient(0, 10, 0, h - 10);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#fafaf2'); g.addColorStop(1, '#e2e2d6');
      x.fillStyle = g; x.fillRect(10, 10, w - 20, h - 20);
      // 灯管芯：两道高光 + 周围柔光晕（辉光只做在贴图里，不碰后期）
      var halo = x.createLinearGradient(0, h * 0.18, 0, h * 0.82);
      halo.addColorStop(0, 'rgba(255,255,255,0)');
      halo.addColorStop(0.5, 'rgba(255,255,240,0.55)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = halo; x.fillRect(10, h * 0.18, w - 20, h * 0.64);
      x.fillStyle = 'rgba(255,255,255,0.95)'; // 灯管高光
      x.fillRect(10, h * 0.30, w - 20, 6); x.fillRect(10, h * 0.66, w - 20, 6);
      // 镇流器衰变：灯管两端黑环（阴极衰变）+ 轻微品红漂移
      var ringL = x.createLinearGradient(10, 0, 30, 0);
      ringL.addColorStop(0, 'rgba(45,32,42,0.60)'); ringL.addColorStop(1, 'rgba(45,32,42,0)');
      x.fillStyle = ringL; x.fillRect(10, 10, 20, h - 20);
      var ringR = x.createLinearGradient(w - 10, 0, w - 30, 0);
      ringR.addColorStop(0, 'rgba(45,32,42,0.60)'); ringR.addColorStop(1, 'rgba(45,32,42,0)');
      x.fillStyle = ringR; x.fillRect(w - 30, 10, 20, h - 20);
      x.fillStyle = 'rgba(170,110,150,0.10)'; x.fillRect(10, 10, 26, h - 20); x.fillRect(w - 36, 10, 26, h - 20);
      x.fillStyle = 'rgba(120,110,80,0.25)'; x.fillRect(10, 10, w - 20, 8); // 灯管旁积灰
      x.fillStyle = '#1c1c1c'; // 四角螺丝
      [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]].forEach(function (p) {
        x.beginPath(); x.arc(p[0], p[1], 3, 0, 6.2832); x.fill();
      });
      grain(x, w, h, 200, 0.05);
      return c;
    },
    // L1/L2 混凝土墙：斑驳 + 水渍竖流 + 霉斑 + 踢脚线重力
    // 整张 = 3m 宽；墙高按 ~3m 名义，随 wallH 轻微拉伸
    concrete: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#8d8d8c'; x.fillRect(0, 0, w, h);
      for (var m2 = 0; m2 < 8; m2++) { // 大斑驳：浇筑不均
        blotch(x, Math.random() * w, Math.random() * h, 60 + Math.random() * 70,
          Math.random() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)');
      }
      stains(x, w, h, 18, ['rgba(255,255,255,0.09)', 'rgba(0,0,0,0.11)', 'rgba(70,70,70,0.16)'], 14, 48);
      x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(0, h * 0.48, w, 3); // 模板接缝
      // 水渍竖流：墙面渗水的下淌痕（三件套纵向拉长）
      waterStain(x, w * 0.22, h * 0.30, 42, '70,66,58', 1.9);
      waterStain(x, w * 0.78, h * 0.62, 34, '66,62,54', 2.1);
      crack(x, w * 0.3, h * 0.2, 120, 7);
      crack(x, w * 0.7, h * 0.6, 90, 6);
      stains(x, w, h, 5, ['rgba(96,74,52,0.32)'], 6, 16); // 锈水渍
      mold(x, w, h, 8, 8, 22); // 霉斑（L2 管道区/L6 标配）
      gravityGrime(x, w, h, 1.2);
      grain(x, w, h, 3200, 0.10);
      return c;
    },
    // L1/L2 混凝土地面：水渍三件套 + 油渍 + 伸缩缝积污
    // 整张 = 3m×3m；伸缩缝间距 ~3m
    concreteFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#747474'; x.fillRect(0, 0, w, h);
      stains(x, w, h, 14, ['rgba(0,0,0,0.18)', 'rgba(255,255,255,0.06)', 'rgba(40,40,40,0.20)'], 12, 40);
      // 水渍三件套 ×4（深色边缘环 + 中心略浅，roughnessMap 里对应更光滑）
      waterStain(x, w * 0.28, h * 0.30, 52, '50,48,42', 0.85);
      waterStain(x, w * 0.70, h * 0.24, 38, '52,50,44', 0.9);
      waterStain(x, w * 0.62, h * 0.72, 62, '48,46,40', 0.8);
      waterStain(x, w * 0.18, h * 0.78, 30, '54,52,46', 0.9);
      x.strokeStyle = 'rgba(30,30,30,0.5)'; x.lineWidth = 3; // 伸缩缝
      x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
      x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      x.strokeStyle = 'rgba(15,14,12,0.30)'; x.lineWidth = 7; // 缝内积污
      x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
      x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      stains(x, w, h, 6, ['rgba(20,18,14,0.42)'], 8, 24); // 油渍
      grain(x, w, h, 2800, 0.10);
      return c;
    },
    // 混凝土柱：竖向水渍条 + 踢脚线重力
    pillar: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#969694'); g.addColorStop(1, '#6e6e6c');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 6; i++) { // 竖向水渍条
        streak(x, Math.random() * w, 0, h * (0.5 + Math.random() * 0.5), 3 + Math.random() * 6, '60,58,52');
      }
      stains(x, w, h, 5, ['rgba(0,0,0,0.16)'], 16, 44);
      gravityGrime(x, w, h, 1);
      grain(x, w, h, 1200, 0.10);
      return c;
    },
    // L3 棕色砖墙：砖缝积污 + 每块砖底阴影 + 稀疏霉斑 + 踢脚线重力
    // 整张 = 3m 宽；标准砖 0.2×0.075m → 约 15 块/行
    brick: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#4e423b'; x.fillRect(0, 0, w, h); // 灰缝
      var bw = w * 0.2 / 3, bh = h / 40; // 0.2m 宽，~0.075m 高（含缝）
      var row = 0;
      for (var yy = 0; yy < h + bh; yy += bh, row++) {
        var off = (row % 2) * bw / 2;
        for (var xx = -bw; xx < w + bw; xx += bw) {
          var r = 112 + ((Math.random() * 36) | 0), gg = 66 + ((Math.random() * 22) | 0), b = 46 + ((Math.random() * 16) | 0);
          x.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
          x.fillRect(xx + off + 1.5, yy + 1.5, bw - 3, bh - 3);
          x.fillStyle = 'rgba(255,255,255,0.06)';
          x.fillRect(xx + off + 1.5, yy + 1.5, bw - 3, 2.5); // 砖顶受光
          x.fillStyle = 'rgba(0,0,0,0.14)'; // 砖底阴影（重力：每块砖都在"沉"）
          x.fillRect(xx + off + 1.5, yy + bh - 4.5, bw - 3, 3);
        }
      }
      stains(x, w, h, 10, ['rgba(0,0,0,0.22)', 'rgba(60,40,25,0.26)'], 10, 32);
      mold(x, w, h * 0.5, 5, 6, 16); // 灰缝里的稀疏霉斑（只画下半部）
      gravityGrime(x, w, h, 1);
      grain(x, w, h, 2200, 0.10);
      return c;
    },
    // L3 灰色瓷砖地：釉面高光 + 缝污 + 水渍三件套
    // 整张 = 3m×3m；砖 0.375m → 8×8
    tileFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#3a3a3a'; x.fillRect(0, 0, w, h); // 缝（压暗一档，缝污）
      var n = 8, t = w / n;
      for (var ty = 0; ty < n; ty++) for (var tx = 0; tx < n; tx++) {
        var v = 148 + ((Math.random() * 26) | 0);
        x.fillStyle = 'rgb(' + v + ',' + (v + 3) + ',' + (v + 6) + ')';
        x.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4);
        x.fillStyle = 'rgba(255,255,255,0.10)'; // 釉面反光
        x.fillRect(tx * t + 6, ty * t + 6, t - 14, 4);
      }
      x.strokeStyle = 'rgba(18,16,14,0.35)'; x.lineWidth = 3; // 缝污：沿缝再压一道
      for (var i = 0; i <= n; i++) {
        x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
        x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
      }
      // 水渍三件套 ×3（瓷砖上的水洼：边缘环 + 更反光，见 roughnessMap）
      waterStain(x, w * 0.30, h * 0.32, 44, '70,68,60', 0.9);
      waterStain(x, w * 0.68, h * 0.62, 56, '68,66,58', 0.85);
      waterStain(x, w * 0.45, h * 0.80, 30, '72,70,62', 0.9);
      stains(x, w, h, 8, ['rgba(30,28,24,0.32)', 'rgba(90,70,45,0.22)'], 8, 26);
      grain(x, w, h, 1500, 0.07);
      return c;
    },
    // 金属天花板/墙：拉丝横纹 + 板缝 + 铆钉 + 锈蚀下淌 + 划痕
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
      var sy = h * 0.246; // 板缝（相对位置，低分辨率档也对齐）
      x.fillStyle = 'rgba(0,0,0,0.28)'; x.fillRect(0, sy, w, Math.max(2, h * 0.008));
      x.fillStyle = '#3d444c'; // 铆钉
      for (var rx = w * 0.03; rx < w; rx += w * 0.094) {
        x.beginPath(); x.arc(rx, sy - h * 0.016, Math.max(2, w * 0.008), 0, 6.2832); x.fill();
        x.beginPath(); x.arc(rx, sy + h * 0.024, Math.max(2, w * 0.008), 0, 6.2832); x.fill();
      }
      for (var rs = 0; rs < 5; rs++) { // 锈蚀：从板缝/铆钉处下淌
        streak(x, Math.random() * w, sy, h * (0.2 + Math.random() * 0.35), 4 + Math.random() * 8, '130,70,28');
      }
      stains(x, w, h, 6, ['rgba(110,70,35,0.30)'], 8, 26); // 锈点
      for (var s2 = 0; s2 < 14; s2++) { // 划痕：露金属底色，高光处更亮
        x.strokeStyle = 'rgba(225,232,238,0.40)'; x.lineWidth = 1;
        var sx = Math.random() * w, syy = Math.random() * h;
        x.beginPath(); x.moveTo(sx, syy);
        x.lineTo(sx + (Math.random() - 0.5) * 70, syy + (Math.random() - 0.5) * 18); x.stroke();
      }
      grain(x, w, h, 600, 0.07);
      return c;
    },
    // 钢门：凹陷门板 + 划痕 + 底部锈蚀（重力）+ 防撞板
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
      for (var i = 0; i < 14; i++) { // 划痕
        x.strokeStyle = 'rgba(220,225,230,0.35)'; x.lineWidth = 1;
        var sx = Math.random() * w, sy = Math.random() * h;
        x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (Math.random() - 0.5) * 60, sy + (Math.random() - 0.5) * 20); x.stroke();
      }
      x.fillStyle = '#39404a'; x.fillRect(0, h - 34, w, 34); // 底部防撞板
      for (var rs = 0; rs < 4; rs++) { // 底部锈蚀：从防撞板上沿下淌
        streak(x, Math.random() * w, h - 70 - Math.random() * 30, 30 + Math.random() * 40, 4 + Math.random() * 6, '125,68,28');
      }
      stains(x, w, h, 5, ['rgba(120,70,30,0.35)'], 6, 20); // 锈
      gravityGrime(x, w, h, 0.8);
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
    // 管道：锈蚀下淌
    pipe: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, h); // 横向管道的高光在中部
      g.addColorStop(0, '#3f464d'); g.addColorStop(0.28, '#7d8894');
      g.addColorStop(0.5, '#a9b4bf'); g.addColorStop(0.72, '#7d8894'); g.addColorStop(1, '#3f464d');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(40, 0, 10, h); x.fillRect(w - 50, 0, 10, h); // 管箍
      x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(44, 0, 3, h); x.fillRect(w - 46, 0, 3, h);
      streak(x, w * 0.3, 0, h * 0.7, 8, '130,75,30'); // 管箍处锈水下淌
      streak(x, w * 0.75, h * 0.1, h * 0.5, 6, '120,68,28');
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
    // FUN 格纹地（整张 = 3m×3m；格 0.375m → 8×8）
    partyFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var n = 8, t = w / n, cols = ['#f7f3ea', '#ff9ecb', '#f7f3ea', '#9ed8ff'];
      for (var ty = 0; ty < n; ty++) for (var tx = 0; tx < n; tx++) {
        x.fillStyle = cols[(tx + ty * 2) % 4];
        x.fillRect(tx * t, ty * t, t, t);
      }
      x.strokeStyle = 'rgba(120,90,110,0.35)'; x.lineWidth = 2;
      for (var i = 0; i <= n; i++) {
        x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
        x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
      }
      stains(x, w, h, 6, ['rgba(150,60,80,0.22)', 'rgba(80,60,40,0.20)'], 8, 24); // 饮料渍
      grain(x, w, h, 1100, 0.06);
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
    },
    // 接触阴影（blob）：径向黑渐变，用于箱/柜/桌/灌木底部，柔化"物体接触处"。
    // 注意这是贴在地面上的透明片，不是实时阴影，不遮材质。
    blob: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      var g = x.createRadialGradient(w / 2, h / 2, w * 0.08, w / 2, h / 2, w * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      return c;
    }
  };

  // ---------------- 粗糙度贴图（roughnessMap，统一 256px） ----------------
  // 语义：white=粗糙(×1.0)，black=光滑(×0)。MeshStandardMaterial 里
  // effectiveRoughness = material.roughness × texel，所以 FINISH.roughness 取
  // "该材质最糙处"，贴图里画"相对系数"（釉面砖体 ~0.5、水渍 ~0.2、锈 ~1.0）。
  // 位置与 albedo 不必像素对齐——粗糙度变化本身即质感，近似分布即可。
  var roughPainters = {
    // 瓷砖：砖体釉面半光滑，缝糙，水渍更光滑
    tileFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      var n = 8, t = w / n, tx, ty;
      for (ty = 0; ty < n; ty++) for (tx = 0; tx < n; tx++) {
        var v = 118 + ((Math.random() * 26) | 0); // 砖体 ~0.5
        x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        x.fillRect(tx * t + 2, ty * t + 2, t - 4, t - 4);
      }
      x.strokeStyle = '#ffffff'; x.lineWidth = 4; // 缝=最糙
      for (var i = 0; i <= n; i++) {
        x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, h); x.stroke();
        x.beginPath(); x.moveTo(0, i * t); x.lineTo(w, i * t); x.stroke();
      }
      stains(x, w, h, 3, ['rgba(40,40,40,0.85)'], 14, 34); // 水渍=光滑
      return c;
    },
    // 混凝土地面：水渍/油渍更光滑，伸缩缝最糙
    concreteFloor: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = 'rgb(242,242,242)'; x.fillRect(0, 0, w, h);
      stains(x, w, h, 4, ['rgba(100,100,100,0.85)'], 16, 40); // 水渍
      stains(x, w, h, 6, ['rgba(70,70,70,0.9)'], 8, 22);      // 油渍
      x.strokeStyle = '#ffffff'; x.lineWidth = 4;
      x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
      x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      return c;
    },
    // 混凝土墙：水渍竖流更光滑
    concrete: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = 'rgb(242,242,242)'; x.fillRect(0, 0, w, h);
      for (var i = 0; i < 4; i++) {
        blotch(x, Math.random() * w, Math.random() * h * 0.7, 26 + Math.random() * 30, 'rgba(120,120,120,0.8)');
      }
      return c;
    },
    // 金属：拉丝基底，锈=最糙，划痕=光滑
    metal: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = 'rgb(143,143,143)'; x.fillRect(0, 0, w, h); // ~0.42 @0.75
      for (var i = 0; i < 60; i++) {
        var v = 118 + ((Math.random() * 50) | 0);
        x.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)';
        x.lineWidth = 1;
        var yy = Math.random() * h;
        x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke();
      }
      stains(x, w, h, 6, ['rgba(255,255,255,0.9)'], 8, 24); // 锈=糙
      stains(x, w, h, 10, ['rgba(70,70,70,0.8)'], 2, 8);    // 划痕=光滑
      return c;
    },
    // 钢门：同金属逻辑
    doorMetal: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = 'rgb(150,150,150)'; x.fillRect(0, 0, w, h); // ~0.41 @0.7
      stains(x, w, h, 5, ['rgba(255,255,255,0.9)'], 6, 20);  // 锈
      stains(x, w, h, 12, ['rgba(70,70,70,0.8)'], 2, 10);    // 划痕
      var g = x.createLinearGradient(0, h * 0.8, 0, h);     // 底部锈带更糙
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.7)');
      x.fillStyle = g; x.fillRect(0, h * 0.8, w, h * 0.2);
      return c;
    },
    // 地毯：磨损带轻微压光（哑光基底上唯一的粗糙度变化）
    carpet: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
      for (var b = 0; b < 3; b++) {
        wearBand(x, w * (0.25 + 0.25 * b), h * (0.3 + Math.random() * 0.4),
          w * 0.28, h * 0.055, 'rgba(225,225,225,0.85)');
      }
      return c;
    },
    // 砖墙：砖体微糙，灰缝最糙
    brick: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = 'rgb(240,240,240)'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#ffffff'; x.lineWidth = 2;
      var bh = h / 40;
      for (var yy = 0; yy < h + bh; yy += bh) {
        x.beginPath(); x.moveTo(0, yy); x.lineTo(w, yy); x.stroke();
      }
      return c;
    },
    // 吊顶：水渍区更光滑
    ceiling: function (w, h) {
      var c = makeCanvas(w, h), x = c.getContext('2d');
      x.fillStyle = 'rgb(245,245,245)'; x.fillRect(0, 0, w, h);
      stains(x, w, h, 2, ['rgba(130,130,130,0.85)'], 16, 36);
      return c;
    }
  };

  // ---------------- 构建与缓存 ----------------
  // 大表面（墙/地/顶）高档 512 起稿，保证 3m tile 上特征是真实米制；
  // 小道具（门/箱/管/灯/海报）256 足够，省显存。低画质档大表面也降到 256。
  var RES512 = {
    wallpaper: 1, carpet: 1, ceiling: 1, concrete: 1, concreteFloor: 1,
    pillar: 1, brick: 1, tileFloor: 1, metal: 1, partyWall: 1, partyFloor: 1
  };
  function pickSize(name) {
    var big = !!RES512[name];
    var q = (window.BR && BR.QUALITY) || {};
    // 低档（pr<=1，多为手机）：大表面也用 256。注意 init() 跑在 applyQuality 之前，
    // 此时 BR.QUALITY 还不存在 → 首批按 512 建；懒生成（各关卡 registerTex 的贴图，
    // 在 world 构建期才 get）的才能吃到低档尺寸。行为确定，见文件头。
    if (big && q.pr != null && q.pr <= 1) return 256;
    return big ? 512 : 256;
  }

  // 各向异性：init() 跑在 renderer 创建之前，硬件上限只能延迟读取。
  // applyRendererCaps() 在每次 get()/finishMaterial() 入口调用（幂等，一次生效）。
  BR.Textures = BR.Textures || {};
  BR.Textures.maxAnisotropy = 8; // renderer 就绪前的保守默认值
  var capsApplied = false;
  function applyCaps() {
    if (capsApplied) return;
    var R = window.BR && BR.Game && BR.Game.renderer;
    if (!R || !R.capabilities || !R.capabilities.getMaxAnisotropy) return; // renderer 还没建好
    var hw = R.capabilities.getMaxAnisotropy() || 1;
    var q = (window.BR && BR.QUALITY) || {};
    var tierCap = (q.pr != null && q.pr <= 1) ? 4 : 8; // 低档压到 4
    var cap = Math.max(1, Math.min(hw, tierCap));
    BR.Textures.maxAnisotropy = cap;
    var apply = function (t) { if (t) { t.anisotropy = cap; t.needsUpdate = true; } };
    for (var n in cache) if (cache.hasOwnProperty(n)) apply(cache[n]);
    for (var r2 in roughCache) if (roughCache.hasOwnProperty(r2)) apply(roughCache[r2]);
    capsApplied = true;
    if (BR.log) BR.log('[textures] anisotropy 上限: 硬件=' + hw + ' 档位=' + tierCap + ' 实际=' + cap);
  }
  BR.Textures.applyRendererCaps = applyCaps;

  function build(name) {
    var p = painters[name];
    if (!p) { if (BR.log) BR.log('[textures] 缺少贴图: ' + name); return null; }
    var s = pickSize(name), w = s, h = s;
    if (name === 'fluor' || name === 'posterFun') h = 128;
    var tex = new THREE.CanvasTexture(p(w, h));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // 过滤显式声明（根因排查结论：过滤本就没问题，这里只是写死防回归）：
    // 远处用 mipmap 平滑缩小，近处线性放大，掠射角各向异性压条纹闪烁。
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = BR.Textures.maxAnisotropy;
    return tex;
  }

  function buildRough(name) {
    var p = roughPainters[name];
    if (!p) return null;
    var tex = new THREE.CanvasTexture(p(256, 256));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, BR.Textures.maxAnisotropy);
    return tex;
  }

  function getRough(name) {
    if (roughCache[name] === undefined) roughCache[name] = buildRough(name);
    return roughCache[name];
  }

  // 关卡 -> 墙面贴图映射（world.js 用 makeWallMaterial 取墙材质）
  var WALL_TEX = {
    L0: 'wallpaper',
    L1: 'concrete',
    L2: 'concrete',
    L3: 'brick',
    FUN: 'partyWall'
  };
  // 墙面贴图 -> 质感分级（makeWallMaterial 用）
  var WALL_FINISH = {
    wallpaper: 'wallpaper',
    concrete: 'concrete',
    brick: 'brick',
    partyWall: 'partyWall'
  };
  // 扩建钩子：新关卡注册墙面贴图映射（buildContent 里也可用 theme.wall/floor/ceil 指定）
  // （挂载点在文件末尾 BR.Textures 字面量赋值之后，避免被覆盖）

  // ---------------- 材质质感分级（W-materials v2.4 / W10 延续） ----------------
  // roughness = 该材质"最糙处"（有 roughnessMap 时贴图像素是相对系数）；
  // roughnessFlat = 无 roughnessMap 时的等效值（保证新旧调用点观感一致）。
  var FINISH = {
    wallpaper: { roughness: 1.0,  roughnessFlat: 0.92, metalness: 0.0 },
    carpet:    { roughness: 1.0,  roughnessFlat: 1.0,  metalness: 0.0 },
    concrete:  { roughness: 1.0,  roughnessFlat: 0.95, metalness: 0.0 },
    brick:     { roughness: 1.0,  roughnessFlat: 0.93, metalness: 0.0 },
    ceiling:   { roughness: 1.0,  roughnessFlat: 0.95, metalness: 0.0 },
    tile:      { roughness: 0.6,  roughnessFlat: 0.28, metalness: 0.05 }, // 釉面瓷砖
    metal:     { roughness: 0.75, roughnessFlat: 0.42, metalness: 0.8 },  // 拉丝金属
    rust:      { roughness: 1.0,  roughnessFlat: 0.96, metalness: 0.12 }, // 锈蚀
    water:     { roughness: 0.5,  roughnessFlat: 0.10, metalness: 0.15 }, // 水体
    wood:      { roughness: 1.0,  roughnessFlat: 0.80, metalness: 0.0 },
    partyWall: { roughness: 1.0,  roughnessFlat: 0.85, metalness: 0.0 }
  };

  var _pub = BR.Textures;
  _pub.FINISH = FINISH;
  _pub.finishOf = function (name) { return FINISH[name] || FINISH.concrete; };
  // 取某贴图的粗糙度贴图（无则 null；懒生成）
  _pub.roughness = getRough;
  // 扩建钩子：注册粗糙度画师（与 registerTex 配对）
  // 用法：BR.Textures.registerRough('pool_tile', function(ctx,w,h){ ... });
  _pub.registerRough = function (name, painter) { roughPainters[name] = painter; };

  var finishMatCache = {};
  // 材质工厂统一出口（matFor 为别名）。
  // finishMaterial(texName, finishName, extra)：extra={color, transparent, opacity, side}
  // 有 roughnessPainter 的贴图自动挂 roughnessMap；无则用 roughnessFlat 等效。
  _pub.finishMaterial = function (texName, finishName, extra) {
    applyCaps();
    extra = extra || {};
    var key = (texName || 'nocolor') + '|' + finishName + '|' +
      (extra.color != null ? extra.color.toString(16) : '-') + '|' +
      (extra.transparent ? ('t' + (extra.opacity != null ? extra.opacity : 1)) : 'o') + '|' +
      (extra.side != null ? extra.side : '-');
    if (finishMatCache[key]) return finishMatCache[key];
    var f = _pub.finishOf(finishName);
    var rm = texName ? getRough(texName) : null;
    var params = {
      roughness: rm ? f.roughness : (f.roughnessFlat != null ? f.roughnessFlat : f.roughness),
      metalness: f.metalness
    };
    if (texName) params.map = _pub.get(texName);
    if (rm) params.roughnessMap = rm;
    if (extra.color != null) params.color = extra.color;
    if (extra.transparent) {
      params.transparent = true;
      params.opacity = extra.opacity != null ? extra.opacity : 1;
      params.depthWrite = false;
    }
    if (extra.side != null) params.side = extra.side;
    var m = new THREE.MeshStandardMaterial(params);
    finishMatCache[key] = m;
    return m;
  };
  _pub.matFor = _pub.finishMaterial; // 统一出口别名
  // surface(texName) -> { map, roughnessMap }：需要手动组装材质时用
  _pub.surface = function (texName) {
    applyCaps();
    return { map: _pub.get(texName), roughnessMap: getRough(texName) };
  };

  // ---------------- 真实尺度铺贴（W-materials v2.4） ----------------
  // tileRepeat(wM, hM, tileM=BR.TILE)：wM×hM 米的平面需要重复几次
  _pub.tileRepeat = function (wM, hM, tileM) {
    tileM = tileM || (window.BR && BR.TILE) || 3;
    return [wM / tileM, hM / tileM];
  };
  // worldUV(geo, wM, hM, tileM)：把几何体 UV 缩放到"每 tileM 米重复一次"。
  // 解决自定义大平面（hPlane(qw,qh) 等）整面只铺 1 张贴图被拉大的问题。
  // 要求贴图 wrapS/wrapT = RepeatWrapping（本文件 build 的贴图默认即是）。
  _pub.worldUV = function (geo, wM, hM, tileM) {
    var rep = _pub.tileRepeat(wM, hM, tileM);
    var uv = geo.attributes && geo.attributes.uv;
    if (uv) {
      for (var i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * rep[0], uv.getY(i) * rep[1]);
      }
      uv.needsUpdate = true;
    }
    return geo;
  };
  // worldPlane(wM, hM, texName, finishName, opts)：wM×hM 米的成品平面，
  // UV 已按真实尺度换算。opts={tile, mat:{color,transparent,opacity,side}}。
  // 新写的大面积平面（池底/广场/外墙）一律走这里，不再手写 PlaneGeometry+UV。
  _pub.worldPlane = function (wM, hM, texName, finishName, opts) {
    opts = opts || {};
    var g = new THREE.PlaneGeometry(wM, hM);
    _pub.worldUV(g, wM, hM, opts.tile);
    return new THREE.Mesh(g, _pub.finishMaterial(texName, finishName || 'concrete', opts.mat || {}));
  };
  // tiled(texName, rx, ry)：返回带独立 repeat 的 clone，不污染共享贴图。
  // 各关卡之前"get(name).repeat.set(...)"直接改共享贴图的写法请迁移到这里——
  // 共享贴图的 repeat 是全局的，一处改、处处变（lv_l7 overcast / lv_l188 court_path
  // 曾因此互相污染）。clone 共享同一张 canvas 图像，只多一份 GPU 上传。
  _pub.tiled = function (texName, rx, ry) {
    applyCaps();
    var t = _pub.get(texName);
    if (!t) return null;
    var c = t.clone();
    c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(rx || 1, ry || 1);
    c.anisotropy = _pub.maxAnisotropy;
    return c;
  };

  _pub.init = function () {
    for (var n in painters) {
      if (painters.hasOwnProperty(n) && !cache[n]) cache[n] = build(n);
    }
    for (var r in roughPainters) { // 大表面粗糙度贴图预生成，避免游戏中期卡顿
      if (roughPainters.hasOwnProperty(r)) getRough(r);
    }
    applyCaps(); // renderer 此时还没建好，大概率 no-op；get() 入口会再试
  };
  // 取贴图（未预生成则懒生成）
  _pub.get = function (name) {
    applyCaps();
    if (!cache[name]) cache[name] = build(name);
    return cache[name];
  };
  // 关卡墙面材质：内部缓存。注意返回的材质共享 clone 出的贴图，
  // world 卸载区块时只 dispose 几何体，不得 dispose 这里的材质/贴图。
  // v2.4：Lambert → Standard（质感分级）+ roughnessMap（clone 一份并同步 offset）
  // + 按关卡名 hash 设 offset：同为 concrete 的 L1/L2 污渍不再像素级对齐。
  _pub.makeWallMaterial = function (level) {
    applyCaps();
    if (matCache[level]) return matCache[level];
    var texName = WALL_TEX[level] || WALL_TEX.L0;
    var tex = _pub.get(texName);
    var t2 = tex ? tex.clone() : null;
    if (t2) {
      t2.needsUpdate = true;
      t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
      var hsh = 0;
      for (var i = 0; i < level.length; i++) hsh = ((hsh * 31) + level.charCodeAt(i)) >>> 0;
      t2.offset.set((hsh % 89) / 89, (hsh % 67) / 67);
      t2.anisotropy = _pub.maxAnisotropy;
    }
    var f = _pub.finishOf(WALL_FINISH[texName] || 'concrete');
    var params = { map: t2, roughness: f.roughness, metalness: f.metalness };
    var rm = getRough(texName);
    if (rm && t2) {
      var r2 = rm.clone();
      r2.needsUpdate = true;
      r2.wrapS = r2.wrapT = THREE.RepeatWrapping;
      r2.offset.copy(t2.offset); // 粗糙度与底色对齐
      params.roughnessMap = r2;
    }
    if (!rm) params.roughness = (f.roughnessFlat != null ? f.roughnessFlat : f.roughness);
    var m = new THREE.MeshStandardMaterial(params);
    matCache[level] = m;
    return m;
  };

  // 扩建钩子：新关卡注册程序化贴图（painter(ctx, w, h) 在 256x256 canvas 上绘制，
  // 大表面贴图建议在 painter 注释里写清"整张 = Nm×Nm"以便按米起稿）
  // 用法：BR.Textures.registerTex('pool_tile', function(ctx,w,h){ ... });
  _pub.registerTex = function (name, painter) { painters[name] = painter; };
  // 扩建钩子：新关卡注册墙面贴图映射
  // 用法：BR.Textures.registerWallTex('L7', 'ocean_wall');
  _pub.registerWallTex = function (level, texName) { WALL_TEX[level] = texName; };

  // ---------------- H 路：接触阴影（blob shadow） ----------------
  // 实时点光源阴影 = 6 面 cube map，移动端/核显扛不住，设计为 0（见 world.js W.shadowLightCount）。
  // 转角/柱后/物体接触处的柔和变暗用 blob 阴影片 + 灯光衰减 + 雾来表现。
  // 材质共享（随关卡常驻，不释放）；几何体每次新建，由调用方的 W.reg 登记到区块 disposables，
  // 区块卸载时自动 dispose（见 world.js unloadChunkMeshes），不泄漏。
  var blobMat = null;
  _pub.blobShadowMaterial = function () {
    if (!blobMat) {
      blobMat = new THREE.MeshBasicMaterial({
        map: _pub.get('blob'),
        transparent: true, opacity: 0.5, depthWrite: false
      });
    }
    return blobMat;
  };
  // 在 (x, z) 地面铺一张半径 r 的接触阴影，返回 mesh（调用方自行定位 + W.reg）。
  // 画质档 blobShadow=0 时返回 null（调用方直接跳过）。
  _pub.makeBlobShadow = function (r) {
    var q = (window.BR && BR.QUALITY) || {};
    if (q.blobShadow === 0) return null;
    var m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), _pub.blobShadowMaterial());
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1; // 画在地面之后，避免 z-fighting
    return m;
  };

  // ---------------- Systems D：环境涂鸦文字贴图 ----------------
  // 透明底 Canvas：手绘字 + 手绘箭头 + 滴漆 + 磨损 + 喷溅晕。
  // 同 (text|sub|color|arrow) 复用同一张贴图与材质，避免材质/贴图爆炸。
  var graffitiTexCache = {};
  var graffitiMatCache = {};
  // 手绘箭头（避免字体缺 →← 字形）：dir=+1 朝右 / -1 朝左
  function drawGraffitiArrow(x, ax, y, dir, color, s) {
    var len = 36 * s;
    function j() { return (Math.random() - 0.5) * 4 * s; }
    x.strokeStyle = color; x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = 7 * s;
    x.beginPath();
    x.moveTo(ax, y + j());
    x.quadraticCurveTo(ax + dir * len * 0.5, y + j(), ax + dir * len, y + j());
    x.stroke();
    x.lineWidth = 6 * s;
    var hx = ax + dir * len, hy = y + j();
    x.beginPath();
    x.moveTo(hx, hy); x.lineTo(hx - dir * 15 * s, hy - 11 * s + j());
    x.moveTo(hx, hy); x.lineTo(hx - dir * 15 * s, hy + 11 * s + j());
    x.stroke();
  }
  function paintGraffiti(text, sub, color, arrow) {
    var c = makeCanvas(256, 128), x = c.getContext('2d');
    x.clearRect(0, 0, 256, 128);
    function font(px) {
      return 'italic bold ' + px + 'px "Comic Sans MS","Segoe Print",cursive,sans-serif';
    }
    x.font = font(46);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    var maxW = arrow ? 150 : 230; // 有箭头时给箭头留 100px
    var tw = x.measureText(text).width;
    if (tw > maxW) { x.font = font(Math.max(20, Math.floor(46 * maxW / tw))); tw = x.measureText(text).width; }
    var y = sub ? 48 : 64;
    // 喷溅晕（overspray）
    x.fillStyle = color;
    var i;
    for (i = 0; i < 44; i++) {
      x.globalAlpha = 0.05 + Math.random() * 0.08;
      x.fillRect(128 - tw / 2 - 8 + Math.random() * (tw + 16), y - 32 + Math.random() * 64, 2, 2);
    }
    x.globalAlpha = 1;
    // 主文字：描边 + 双层填充，双层营造喷漆边缘与浓度
    x.lineWidth = 5; x.strokeStyle = color;
    x.strokeText(text, 128, y);
    x.fillStyle = color;
    x.fillText(text, 128, y);
    x.fillText(text, 128, y);
    if (sub) {
      x.font = 'italic 23px "Comic Sans MS","Segoe Print",cursive,sans-serif';
      x.globalAlpha = 0.85;
      x.fillText(sub, 128, 100);
      x.globalAlpha = 1;
    }
    // 手绘箭头
    if (arrow === 'left') drawGraffitiArrow(x, 128 - tw / 2 - 10, y, -1, color, 1);
    else if (arrow === 'right') drawGraffitiArrow(x, 128 + tw / 2 + 10, y, 1, color, 1);
    // 滴漆
    x.fillStyle = color;
    for (i = 0; i < 3; i++) {
      var dx = 128 - tw / 2 + Math.random() * tw;
      var dl = 10 + Math.random() * 18;
      x.globalAlpha = 0.55 + Math.random() * 0.2;
      x.fillRect(dx, y + 20, 3, dl);
      x.beginPath(); x.arc(dx + 1.5, y + 20 + dl, 2.5, 0, 6.2832); x.fill();
    }
    x.globalAlpha = 1;
    // 磨损：擦掉几块（旧涂鸦感），力度保守以保证可读
    x.globalCompositeOperation = 'destination-out';
    for (i = 0; i < 6; i++) {
      x.globalAlpha = 0.10 + Math.random() * 0.10;
      x.beginPath();
      x.ellipse(128 - tw / 2 + Math.random() * tw, y - 24 + Math.random() * 48,
        3 + Math.random() * 7, 2 + Math.random() * 5, Math.random() * 3, 0, 6.2832);
      x.fill();
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    // 墙面污渍罩一层（融入墙面）
    stains(x, 256, 128, 2, ['rgba(0,0,0,0.14)', 'rgba(60,50,30,0.12)'], 20, 60);
    grain(x, 256, 128, 150, 0.06);
    return c;
  }
  _pub.graffiti = function (text, sub, color, arrow) {
    applyCaps();
    var key = text + '|' + (sub || '') + '|' + color + '|' + (arrow || '-');
    if (!graffitiTexCache[key]) {
      var tex = new THREE.CanvasTexture(paintGraffiti(text, sub, color, arrow));
      tex.anisotropy = Math.min(4, _pub.maxAnisotropy);
      graffitiTexCache[key] = tex;
    }
    return graffitiTexCache[key];
  };
  // 涂鸦共享材质（MeshBasicMaterial：黑暗走廊里也清晰可读，真提示是玩法信息）
  _pub.graffitiMaterial = function (text, sub, color, arrow) {
    var key = text + '|' + (sub || '') + '|' + color + '|' + (arrow || '-');
    if (!graffitiMatCache[key]) {
      graffitiMatCache[key] = new THREE.MeshBasicMaterial({
        map: _pub.graffiti(text, sub, color, arrow),
        transparent: true, opacity: 0.94
      });
    }
    return graffitiMatCache[key];
  };
})();
