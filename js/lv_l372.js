/* ============================================================
* Level 37.2「Sunlit Pools（阳光泳池）」—— 关卡内容（天空/水体/建筑/出入口）
* 独立 IIFE：只用 BR.*，不改动其它文件本体。
*
* [改编标注 —— 必读]
* 原著依据（Fandom 主站 Level 37.2 "Sunlit Pools"，见 docs/LORE_V21.md）：
* 白瓷砖永葆崭新、及膝清澈浅水、恒定微小涟漪、墙面矩形开口透粉色阳光
* （开口外是白色虚空、光源不可抵达）；Pinnicorns（充气浮具状无害实体）。
* 本关的以下视觉是用户明确要求的游戏化改编，原著没有：
* 露天蓝天、可见太阳、柔和云层、水面映天空的"天空之境"倒影、露天庭院。
* （Fandom 主站只有粉色开口光、无露天蓝天；liminality 同人版的天空无云无太阳。）
* 游戏内字条（buildLoreNote）同样如实标注为改编。
*
* v2.3（W-l372）：与 L37 的气质彻底区分 ——
*   L37：封闭/池核/静谧（雾近、光弱 0.55、无天空）；
*   L37.2：明亮/开阔/天空之境（光强 1.35、暖阳光色、雾远 120、露天庭院直见天）。
*   空间序列：粉色开口画廊（发现）→ 露天大庭院+柱廊（开阔）→ 镜面池（倒影，
*   静水+无源涟漪，原创异常）→ 裂纹区（异常：瓷砖裂纹+无粉色开口+深水更暗，
*   原创异常；原著称瓷砖"永远保持崭新"）→ 黑暗开口（返回 L37）。
*   镜面池/无源涟漪/裂纹/深水变暗均为原创设计，非原著，注释与字条如实标注。
*
* 实现要点：
* - 天空：渐变穹顶（canvas 程序化贴图）+ 太阳精灵 + 漂移云层（精灵），
* 无重型后处理；白色虚空 = 穹顶下半纯白 + 远景雾（bg 亮色）。
* - 水面"天空之境"：双层近似 —— 下层 sunlit_reflect（天空色+淡云+太阳光斑），
* 上层 pool_water 波纹（复用 L37 贴图）+ caustics 波光；另加太阳倒影光柱。
* - 建筑：白瓷砖 + 柱 + 廊 + 台阶（Poolrooms 语言，非海滨度假村）；
* 不同高度平台（0.55 / 0.9 干燥平台）、深水坑（-1.2，可游泳）、
* 异常长廊（水道两侧连续粉色开口）、露天庭院（setOpenCeil 无天花板）。
* - 出入口：L37"墙面异常发光开口" → 本关（W-l37 侧建门；本关只读
* BR.World.l37_sunlitGate 做一致性校验，见 buildArrivalGate 的 TODO）；
* 本关"黑暗开口" → 回 L37（原著出口），暴露 BR.World.l372_returnGate 供接线。
* - 不伪装通向未实现关卡的功能；无战斗怪物/追逐（Pinnicorns 为无害装饰实体）。
* - 存档：按关分桶由 save.js v2 自动处理（G._levelCache 以关 id 为 key）；
* 拾取（W.state.picked）与木箱（BR.Container）状态随关缓存持久化。
*
* 对 E 路接口（与 L37 同签名约定）：
* BR.Levels.L372.waterAt(x, z) -> null | {surface, floor, depth}
* BR.Levels.L372.isWater(x, z) -> bool
* BR.Levels.L372.floorYAt(x, z) -> 池底 Y（无水区 0）
* 纯逻辑在 gen_l372.js（BR.Gen.L372waterAt，Node 可测），这里绑定到当前地图。
* ============================================================ */
(function () {
var BR = window.BR;
var TILE = BR.TILE; // 3（米）
var SURF = (BR.Gen && BR.Gen.L372SURF) || 0.45; // 全关统一水面（gen_l372.js 定义；缺省兜底）
var CH = BR.CHUNK || 8;

/* ---------------- 贴图（lv 侧程序化 canvas） ---------------- */
function mkCanvas(w, h) {
var c = document.createElement('canvas');
c.width = w; c.height = h;
return c;
}
function lcg(seed) {
var s = seed >>> 0;
return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff;};
}

// 天空穹顶：天顶蓝 → 地平线近白 → 下半纯白（白色虚空）
BR.Textures.registerTex('sunlit_sky', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
var g = x.createLinearGradient(0, 0, 0, h);
g.addColorStop(0.00, '#2e6cd2');
g.addColorStop(0.28, '#6fa9e8');
g.addColorStop(0.46, '#c4e2f8');
g.addColorStop(0.52, '#f2f9ff');
g.addColorStop(0.56, '#ffffff');
g.addColorStop(1.00, '#ffffff');
x.fillStyle = g; x.fillRect(0, 0, w, h);
return c;
});
// 云：透明底 + 柔白云团（确定性）
BR.Textures.registerTex('sunlit_cloud', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
x.clearRect(0, 0, w, h);
var rnd = lcg(0x51cf);
var i;
for (i = 0; i < 16; i++) {
var cx = w * (0.15 + rnd() * 0.7), cy = h * (0.35 + rnd() * 0.3);
var rx = 18 + rnd() * 42, ry = rx * (0.35 + rnd() * 0.25);
var g = x.createRadialGradient(cx, cy, 1, cx, cy, rx);
var a = 0.55 + rnd() * 0.35;
g.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(2) + ')');
g.addColorStop(1, 'rgba(255,255,255,0)');
x.fillStyle = g;
x.save(); x.translate(cx, cy); x.scale(1, ry / rx); x.translate(-cx, -cy);
x.beginPath(); x.arc(cx, cy, rx, 0, 6.2832); x.fill();
x.restore();
}
return c;
});
// 水面天空反射层：浅天蓝底 + 淡云斑 + 太阳方向暖光斑
BR.Textures.registerTex('sunlit_reflect', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
var g = x.createLinearGradient(0, 0, 0, h);
g.addColorStop(0, '#b9ddf5');
g.addColorStop(1, '#d5ecfb');
x.fillStyle = g; x.fillRect(0, 0, w, h);
var rnd = lcg(0x2e72);
var i;
for (i = 0; i < 10; i++) { // 淡云斑
var cx = rnd() * w, cy = rnd() * h, r = 20 + rnd() * 46;
var cg = x.createRadialGradient(cx, cy, 1, cx, cy, r);
cg.addColorStop(0, 'rgba(255,255,255,' + (0.25 + rnd() * 0.3).toFixed(2) + ')');
cg.addColorStop(1, 'rgba(255,255,255,0)');
x.fillStyle = cg;
x.beginPath(); x.arc(cx, cy, r, 0, 6.2832); x.fill();
}
// 太阳暖光斑（与太阳方位对应，见 SUN_AZ）
var sg = x.createRadialGradient(w * 0.72, h * 0.30, 2, w * 0.72, h * 0.30, 60);
sg.addColorStop(0, 'rgba(255,246,220,0.85)');
sg.addColorStop(1, 'rgba(255,246,220,0)');
x.fillStyle = sg;
x.beginPath(); x.arc(w * 0.72, h * 0.30, 60, 0, 6.2832); x.fill();
return c;
});
// 粉色开口辉光：中心亮粉 → 透明
BR.Textures.registerTex('sunlit_pinkglow', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
x.clearRect(0, 0, w, h);
var g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
g.addColorStop(0, 'rgba(255,240,248,0.98)');
g.addColorStop(0.45, 'rgba(255,196,224,0.85)');
g.addColorStop(1, 'rgba(255,170,205,0)');
x.fillStyle = g; x.fillRect(0, 0, w, h);
return c;
});
// 白色开口辉光（入口对应）：纯白
BR.Textures.registerTex('sunlit_whiteglow', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
x.clearRect(0, 0, w, h);
var g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
g.addColorStop(0, 'rgba(255,255,255,1)');
g.addColorStop(0.5, 'rgba(240,250,255,0.9)');
g.addColorStop(1, 'rgba(230,244,255,0)');
x.fillStyle = g; x.fillRect(0, 0, w, h);
return c;
});
// 太阳：亮盘 + 光晕
BR.Textures.registerTex('sunlit_sun', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
x.clearRect(0, 0, w, h);
var g = x.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
g.addColorStop(0, 'rgba(255,253,244,1)');
g.addColorStop(0.18, 'rgba(255,250,230,1)');
g.addColorStop(0.30, 'rgba(255,244,214,0.55)');
g.addColorStop(1, 'rgba(255,240,200,0)');
x.fillStyle = g; x.fillRect(0, 0, w, h);
return c;
});
// v2.3 裂纹瓷砖（原创异常：原著称瓷砖"永远保持崭新"，裂纹即异常；非原著）
BR.Textures.registerTex('sunlit_crack', function (w, h) {
var c = mkCanvas(w, h), x = c.getContext('2d');
x.fillStyle = '#f2f7f8'; x.fillRect(0, 0, w, h);
x.strokeStyle = 'rgba(178,198,206,0.85)'; x.lineWidth = 2;
var i;
for (i = 0; i <= 2; i++) {
x.beginPath(); x.moveTo(i * w / 2, 0); x.lineTo(i * w / 2, h); x.stroke();
x.beginPath(); x.moveTo(0, i * h / 2); x.lineTo(w, i * h / 2); x.stroke();
}
var rnd = lcg(0xc4ac);
x.strokeStyle = 'rgba(42,56,63,0.92)';
for (var k = 0; k < 5; k++) {
x.lineWidth = 1 + rnd() * 1.6;
var px = rnd() * w, py = rnd() * h;
x.beginPath(); x.moveTo(px, py);
for (var s = 0; s < 6; s++) {
px += (rnd() - 0.5) * w * 0.32; py += (rnd() - 0.5) * h * 0.32;
x.lineTo(px, py);
}
x.stroke();
}
return c;
});
BR.Textures.registerWallTex('L372', 'pool_tile');

/* ---------------- 环境音 ---------------- */
// L372：明亮浅水声 + 微风（比 L37 更开阔、混响更短）
BR.Audio.registerAmbient('L372', function () {
var self = this;
var rig = this._loopRig(function (R) {
var n = R.noise(), bp = R.filter('bandpass', 1600, 0.7), ng = R.gain(0.16);
n.connect(bp); bp.connect(ng); ng.connect(R.group);
var lfo = R.osc('sine', 0.35), lg = R.gain(0.08);
lfo.connect(lg); lg.connect(ng.gain); // 恒定微小涟漪的水声起伏
var w = R.noise(), hp = R.filter('highpass', 5000), wg = R.gain(0.065); // v2.3：更开阔，风声稍强
w.connect(hp); hp.connect(wg); wg.connect(R.group);
var wlfo = R.osc('sine', 0.09), wlg = R.gain(0.03);
wlfo.connect(wlg); wlg.connect(wg.gain); // 微风
try { // 短混响（露天感）：0.7s
var conv = self._ctx.createConvolver();
if (self._impulse) {
conv.buffer = self._impulse(0.7, 3.0);
var wet = R.gain(0.25);
ng.connect(conv); conv.connect(wet); wet.connect(R.group);
}
} catch (e) {}
});
rig.target = 0.30;
return rig;
});

/* ================= F：L372 关卡特效状态（模块级，buildContent 内重置） ================= */
var FX = {
t: 0,
skyGroup: null, // 穹顶/太阳/云（场景级，随关卡重建释放）
clouds: [], // [{spr, ang, r, y, speed}]
pins: [], // pinnicorn 漂浮物 [{g, phase, baseY, yaw0}]
pinkMat: null, // 粉色开口辉光材质（tick 微脉动）
whiteMat: null, // v2.3：入口白光开口材质（tick 呼吸）
phantom: null, // v2.3：镜面池无源涟漪 {mesh, t}
ladders: [],
laneGeo: null
};
// 太阳方位（世界方向单位向量；水面光斑/倒影光柱与之对应）
var SUN_DIR = (function () {
var v = new THREE.Vector3(0.55, 0.50, -0.68);
v.normalize();
return v;
})();

function travelTo(level, kind) {
if (BR.Cutout && typeof BR.Cutout.travel === 'function') {
BR.Cutout.travel(level, { kind: kind});
} else {
if (BR.log) BR.log('[L372] BR.Cutout 未就绪，走 gotoLevel 兜底: ' + level);
BR.Game.gotoLevel(level, {});
}
}

// 对 tile 矩形按 chunk 切分：fn(ax, ay, ix0, iy0, ix1, iy1)
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
m.rotation.x = faceUp? -Math.PI / 2: Math.PI / 2;
m.position.set(cx, y, cz);
return m;
}

/* ---------------- 关卡级共享材质 ---------------- */
function makeMats(W) {
var M = {};
// 水面双层：下层天空反射（天空之境近似）+ 上层波纹
var reflTex = BR.Textures.get('sunlit_reflect');
M.reflect = new THREE.MeshBasicMaterial({
map: reflTex, transparent: true, opacity: 0.55,
color: 0xd8ecfa, depthWrite: false, side: THREE.DoubleSide
});
var rippleTex = BR.Textures.get('pool_water') || reflTex; // lv_l37 未加载时的兜底
M.water = new THREE.MeshBasicMaterial({
map: rippleTex,
transparent: true, opacity: 0.34, color: 0xbfe6f5,
side: THREE.DoubleSide, depthWrite: false
});
var caTex = BR.Textures.get('caustics');
M.caust = caTex? new THREE.MeshBasicMaterial({
map: caTex, transparent: true, opacity: 0.18,
blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
}): null;
M.pitWall = new THREE.MeshLambertMaterial({
map: BR.Textures.get('pool_tile'), color: 0xe6eef0, side: THREE.DoubleSide
});
M.deepShade = new THREE.MeshBasicMaterial({
color: 0x2a7d9e, transparent: true, opacity: 0.18, depthWrite: false
});
M.deckTop = new THREE.MeshLambertMaterial({
map: BR.Textures.get('pool_floor'), color: 0xf2f6f7
});
var mozTex = BR.Textures.get('pool_mosaic');
M.pillar = new THREE.MeshLambertMaterial({
map: mozTex || BR.Textures.get('pool_tile'), color: 0xf5f1e8
});
M.trim = new THREE.MeshLambertMaterial({ map: BR.Textures.get('pool_trim') || BR.Textures.get('pool_tile')});
M.sunStreak = new THREE.MeshBasicMaterial({ // 太阳在水面的倒影光柱
color: 0xfff3d0, transparent: true, opacity: 0.22,
blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
M.pink = new THREE.MeshBasicMaterial({ // 粉色开口辉光（tick 微脉动）
map: BR.Textures.get('sunlit_pinkglow'), transparent: true, opacity: 0.92,
depthWrite: false, side: THREE.DoubleSide
});
M.pinkFloor = new THREE.MeshBasicMaterial({ // 开口洒在地面/水面的粉色光斑
map: BR.Textures.get('sunlit_pinkglow'), transparent: true, opacity: 0.30,
blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
M.whiteGlow = new THREE.MeshBasicMaterial({ // 入口白光开口
map: BR.Textures.get('sunlit_whiteglow'), transparent: true, opacity: 0.95,
depthWrite: false, side: THREE.DoubleSide
});
M.darkPanel = new THREE.MeshBasicMaterial({ color: 0x04070c}); // 返回门：黑暗开口
M.darkEdge = new THREE.MeshBasicMaterial({
color: 0x3d6a8a, transparent: true, opacity: 0.5,
blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
// v2.3 新增
var crackTex = BR.Textures.get('sunlit_crack');
M.crack = new THREE.MeshBasicMaterial({ // 裂纹瓷砖覆盖层（原创异常）
map: crackTex || null, transparent: true, opacity: 0.96, depthWrite: false
});
M.deepShadeDark = new THREE.MeshBasicMaterial({ // 异常厅深水：更暗（原创）
color: 0x0e3a50, transparent: true, opacity: 0.45, depthWrite: false
});
M.reflectStill = new THREE.MeshBasicMaterial({ // 镜面池静水：只留天空反射
map: reflTex, transparent: true, opacity: 0.72,
color: 0xe4f3fe, depthWrite: false, side: THREE.DoubleSide
});
M.phantom = new THREE.MeshBasicMaterial({ // 无源涟漪（原创异常；tick 动画）
color: 0xffffff, transparent: true, opacity: 0,
blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
M.whiteSpill = new THREE.MeshBasicMaterial({ // 入口地面光 spill
map: BR.Textures.get('sunlit_whiteglow'), transparent: true, opacity: 0.35,
blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
});
FX.pinkMat = M.pink;
FX.whiteMat = M.whiteGlow;
W._levelMats = W._levelMats || [];
[M.reflect, M.water, M.pitWall, M.deepShade, M.deckTop, M.pillar, M.trim,
M.sunStreak, M.pink, M.pinkFloor, M.whiteGlow, M.darkPanel, M.darkEdge,
M.crack, M.deepShadeDark, M.reflectStill, M.phantom, M.whiteSpill]
.forEach(function (m) { W._levelMats.push(m);});
if (M.caust) W._levelMats.push(M.caust);
return M;
}

/* ---------------- 天空：穹顶 + 太阳 + 云层 + 白色虚空 ---------------- */
function buildSky(W, map) {
// 先清上一关的（场景级对象，不在 chunk 里）
if (FX.skyGroup) {
W.scene.remove(FX.skyGroup);
FX.skyGroup.traverse(function (o) {
if (o.geometry && o.geometry.dispose) o.geometry.dispose();
// 材质为关卡级共享（_levelMats 释放），这里不 dispose
});
FX.skyGroup = null;
}
FX.clouds.length = 0;
var g = new THREE.Group();
var cx = map.w * TILE / 2, cz = map.h * TILE / 2;
g.position.set(cx, 0, cz);
var skyTex = BR.Textures.get('sunlit_sky');
var dome = new THREE.Mesh(
new THREE.SphereGeometry(380, 28, 18),
new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false})
);
dome.renderOrder = -10;
g.add(dome);
W._levelMats.push(dome.material);
// 太阳
var sunTex = BR.Textures.get('sunlit_sun');
var sun = new THREE.Sprite(new THREE.SpriteMaterial({
map: sunTex, transparent: true, blending: THREE.AdditiveBlending,
fog: false, depthWrite: false
}));
sun.position.copy(SUN_DIR).multiplyScalar(350);
sun.scale.set(90, 90, 1);
g.add(sun);
W._levelMats.push(sun.material);
// 云层：9 朵精灵（低画质减半）
var q = BR.QUALITY || {};
var cloudN = (q.maxLights && q.maxLights <= 3)? 5: 9;
var cloudTex = BR.Textures.get('sunlit_cloud');
var crng = new BR.RNG(BR.hashSeed(map.seed + ':l372cloud'));
for (var i = 0; i < cloudN; i++) {
var spr = new THREE.Sprite(new THREE.SpriteMaterial({
map: cloudTex, transparent: true, opacity: 0.75 + crng.next() * 0.2,
fog: false, depthWrite: false
}));
var ang = crng.range(0, 6.2832), r = 240 + crng.range(0, 90);
var y = 70 + crng.range(0, 90);
var s = 55 + crng.range(0, 70);
spr.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
spr.scale.set(s, s * 0.45, 1);
g.add(spr);
W._levelMats.push(spr.material);
FX.clouds.push({ spr: spr, ang: ang, r: r, y: y, speed: 0.004 + crng.next() * 0.006});
}
W.scene.add(g);
FX.skyGroup = g;
}

/* ---------------- 水面：双层（天空反射 + 波纹）+ 太阳倒影光柱 ---------------- */
function buildWaterPlanes(W, L, M) {
// v2.3：只有干平台（floorY>SURF）避水；下沉浅滩（0.2）在水下，水面漫过它
var deckPits = L.pits.filter(function (pt) { return pt.floorY > SURF;});
function inDeck(tx, ty) {
for (var i = 0; i < deckPits.length; i++) {
var d = deckPits[i];
if (tx >= d.tx0 && tx <= d.tx1 && ty >= d.ty0 && ty <= d.ty1) return true;
}
return false;
}
// v2.3 镜面池：这些 tile 只留天空反射层（静水），去掉波纹与 caustics
var mirror = L.mirrorRect || null;
function inMirrorT(tx, ty) {
return !!mirror && tx >= mirror.tx0 && tx <= mirror.tx1 && ty >= mirror.ty0 && ty <= mirror.ty1;
}
function runsOf(r) {
var runs = [], ty, x, x1;
for (ty = r.y0; ty <= r.y1; ty++) {
x = r.x0;
while (x <= r.x1) {
if (inDeck(x, ty)) { x++; continue;}
var mir = inMirrorT(x, ty);
x1 = x;
while (x1 + 1 <= r.x1 &&!inDeck(x1 + 1, ty) && inMirrorT(x1 + 1, ty) === mir) x1++;
runs.push({ x0: x, y0: ty, x1: x1, y1: ty, still: mir});
x = x1 + 1;
}
}
return runs;
}
L.rects.forEach(function (r) {
runsOf(r).forEach(function (run) {
eachChunkRect(run.x0, run.y0, run.x1, run.y1, function (ax, ay, ix0, iy0, ix1, iy1) {
W.addChunkContent(ix0, iy0, function (group) {
var w = (ix1 - ix0 + 1) * TILE, h = (iy1 - iy0 + 1) * TILE;
var cx = (ix0 + ix1 + 1) / 2 * TILE, cz = (iy0 + iy1 + 1) / 2 * TILE;
var still = !!run.still;
// 下层：天空反射（天空之境近似）；镜面池用更强的静水反射
W.reg(group, hPlane(w, h, still? M.reflectStill: M.reflect, cx, SURF - 0.015, cz, true));
if (!still) {
// 上层：波纹
W.reg(group, hPlane(w, h, M.water, cx, SURF + 0.01, cz, true));
if (M.caust) W.reg(group, hPlane(w, h, M.caust, cx, SURF + 0.025, cz, true));
}
});
});
});
});
// 太阳倒影光柱：在最大露天庭院水面上，沿太阳方位拉一条柔光带
var courts = (L.openRooms || []);
if (courts.length && M.sunStreak) {
var map = W.map;
var cr = null;
for (var i = 0; i < map.rooms.length; i++) {
if (map.rooms[i].id === courts[0]) { cr = map.rooms[i]; break;}
}
if (cr) {
var stx = Math.floor((cr.x + cr.w / 2)), sty = Math.floor((cr.y + cr.h / 2));
W.addChunkContent(stx, sty, function (group) {
var len = Math.min(cr.w, cr.h) * TILE * 0.8;
var sm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, len), M.sunStreak);
sm.rotation.x = -Math.PI / 2;
// 光柱朝向：太阳方位在 XZ 平面的投影
sm.rotation.z = -Math.atan2(SUN_DIR.x, SUN_DIR.z);
sm.position.set((cr.x + cr.w / 2) * TILE, SURF + 0.02, (cr.y + cr.h / 2) * TILE);
W.reg(group, sm);
});
}
}
}

/* ---------------- 坑/平台：深水坑 + 干燥平台 + 台阶 + 扶梯 ---------------- */
function stepEdgesOf(pit) {
var s = {};
var steps = pit.steps || null;
if (steps) for (var i = 0; i < steps.length; i++) s[steps[i].edge] = steps[i];
return s;
}
function buildPits(W, L, M, map) {
var wallH = (W.theme && W.theme.wallH) || 3.2;
L.pits.forEach(function (pit) {
var tx, ty;
for (ty = pit.ty0; ty <= pit.ty1; ty++)
for (tx = pit.tx0; tx <= pit.tx1; tx++) W.skipWall(tx, ty);
var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
var isDeck = pit.floorY > 0;
var topY = isDeck? pit.floorY: 0, botY = isDeck? 0: pit.floorY;
var stepEdges = stepEdgesOf(pit);
eachChunkRect(pit.tx0, pit.ty0, pit.tx1, pit.ty1, function (ax, ay, ix0, iy0, ix1, iy1) {
W.addChunkContent(ix0, iy0, function (group) {
var qx0 = ix0 * TILE, qx1 = (ix1 + 1) * TILE;
var qz0 = iy0 * TILE, qz1 = (iy1 + 1) * TILE;
var qw = qx1 - qx0, qh = qz1 - qz0;
var qcx = (qx0 + qx1) / 2, qcz = (qz0 + qz1) / 2;
if (isDeck) {
// 干燥平台：实心台体（顶面 pool_floor 瓷砖，侧面 pool_tile）
var plat = new THREE.Mesh(new THREE.BoxGeometry(qw, pit.floorY, qh), M.pitWall);
plat.position.set(qcx, pit.floorY / 2, qcz);
W.reg(group, plat);
W.reg(group, hPlane(qw, qh, M.deckTop, qcx, pit.floorY + 0.01, qcz, true));
} else {
// 深水坑：池底 + 深度 shade（v2.3：异常厅的深水更暗，原创）+ 池壁
W.reg(group, hPlane(qw, qh, W.mat('pool_floor'), qcx, pit.floorY, qcz, true));
W.reg(group, hPlane(qw, qh, pit.dark? M.deepShadeDark: M.deepShade, qcx, pit.floorY + 0.03, qcz, true));
var EPS = 0.01;
function wall(x0, z0, x1, z1) {
var len = Math.hypot(x1 - x0, z1 - z0);
if (len < 0.01 || topY - botY < 0.01) return;
var m = new THREE.Mesh(new THREE.PlaneGeometry(len, topY - botY), M.pitWall);
m.position.set((x0 + x1) / 2, (topY + botY) / 2, (z0 + z1) / 2);
m.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
W.reg(group, m);
}
if (Math.abs(qx0 - px0) < EPS &&!stepEdges.W) wall(qx0, qz0, qx0, qz1);
if (Math.abs(qx1 - px1) < EPS &&!stepEdges.E) wall(qx1, qz0, qx1, qz1);
if (Math.abs(qz0 - pz0) < EPS &&!stepEdges.N) wall(qx0, qz0, qx1, qz0);
if (Math.abs(qz1 - pz1) < EPS &&!stepEdges.S) wall(qx0, qz1, qx1, qz1);
// 顶面（tile=2 无默认天花板）
W.reg(group, hPlane(qw, qh, W.mat('pool_ceil'), qcx, wallH, qcz, false));
// 蓝小砖池沿（非台阶边）
function trim(x0, z0, x1, z1) {
var len = Math.hypot(x1 - x0, z1 - z0);
if (len < 0.05) return;
var m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.35), M.trim);
m.position.set((x0 + x1) / 2, 0.035, (z0 + z1) / 2);
m.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
W.reg(group, m);
}
var TW = 0.175;
if (Math.abs(qx0 - px0) < EPS &&!stepEdges.W) trim(qx0 - TW, qz0, qx0 - TW, qz1);
if (Math.abs(qx1 - px1) < EPS &&!stepEdges.E) trim(qx1 + TW, qz0, qx1 + TW, qz1);
if (Math.abs(qz0 - pz0) < EPS &&!stepEdges.N) trim(qx0, qz0 - TW, qx1, qz0 - TW);
if (Math.abs(qz1 - pz1) < EPS &&!stepEdges.S) trim(qx0, qz1 + TW, qx1, qz1 + TW);
}
// 台阶：每条 stepEdge 占 1 tile 宽带，n 级；从 fromY（默认甲板 0）走向 pit.floorY
// （可上：干燥平台；可下：深水坑）。每级做实，无悬空缝。
var steps = pit.steps || null;
if (steps) {
for (var si = 0; si < steps.length; si++) {
var st = steps[si], n = st.n;
var fromY = (st.fromY!= null? st.fromY: 0);
var riser = Math.abs(pit.floorY - fromY) / n;
var dir = pit.floorY < fromY? -1: 1;
var lo = Math.min(fromY, pit.floorY);
var edge = st.edge, k;
for (k = 0; k < n; k++) {
var skTop = fromY + dir * (k + 1) * riser;
var sx0, sx1, sz0, sz1;
if (edge === 'N') { sx0 = qx0; sx1 = qx1; sz0 = pz0 + k * TILE / n; sz1 = pz0 + (k + 1) * TILE / n;}
else if (edge === 'S') { sx0 = qx0; sx1 = qx1; sz0 = pz1 - (k + 1) * TILE / n; sz1 = pz1 - k * TILE / n;}
else if (edge === 'W') { sz0 = qz0; sz1 = qz1; sx0 = px0 + k * TILE / n; sx1 = px0 + (k + 1) * TILE / n;}
else { sz0 = qz0; sz1 = qz1; sx0 = px1 - (k + 1) * TILE / n; sx1 = px1 - k * TILE / n;}
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

/* ---------------- 瓷柱（tile=0 真实碰撞；skipWall + 自建） ---------------- */
function buildPillars(W, L, M) {
var wallH = (W.theme && W.theme.wallH) || 3.2;
L.pillars.forEach(function (pt) {
var tx = pt[0], ty = pt[1];
W.skipWall(tx, ty);
W.addChunkContent(tx, ty, function (group) {
var col = new THREE.Mesh(new THREE.BoxGeometry(0.8, wallH, 0.8), M.pillar);
col.position.set(BR.tileCX(tx), wallH / 2, BR.tileCZ(ty));
W.reg(group, col);
var cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 1.0), M.pillar);
cap.position.set(BR.tileCX(tx), wallH - 0.05, BR.tileCZ(ty));
W.reg(group, cap);
});
});
}

/* ---------------- v2.3 拱门：水道上跨水拱（装饰性，不改碰撞） ----------------
 * gen 侧已保证拱门 tile 两侧是实墙；柱础贴墙，拱跨过水道。 */
function buildArches(W, L, M) {
(L.arches || []).forEach(function (a) {
W.addChunkContent(a.tx, a.ty, function (group) {
var cx = BR.tileCX(a.tx), cz = BR.tileCZ(a.ty);
var g = new THREE.Group();
function pil(px, pz) {
var m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.1, 0.42), M.trim);
m.position.set(px, 1.05, pz); g.add(m);
var cap = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.58), M.pillar);
cap.position.set(px, 2.18, pz); g.add(cap);
}
var off = TILE / 2 - 0.28;
if (a.dir === 'NS') { pil(cx, cz - off); pil(cx, cz + off); }
else { pil(cx - off, cz); pil(cx + off, cz); }
// 半圆拱：默认在 XY 平面跨 E-W；跨 N-S 时转 90°
var arc = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.17, 8, 20, Math.PI), M.trim);
arc.position.set(cx, 2.1, cz);
if (a.dir === 'NS') arc.rotation.y = Math.PI / 2;
g.add(arc);
W.reg(group, g);
});
});
}

/* ---------------- v2.3 裂纹区：异常厅水下瓷砖裂纹 ----------------
 * [原创异常，非原著] 原著（Fandom 主站）称本层瓷砖"永远保持崭新"，
 * 因此裂纹本身就是异常。字条（buildAbyssNote）记录目击。 */
function buildCracks(W, L, M) {
var cr = L.crackRect;
if (!cr || !M.crack) return;
var w = (cr.tx1 - cr.tx0 + 1) * TILE, h = (cr.ty1 - cr.ty0 + 1) * TILE;
var cx = (cr.tx0 + cr.tx1 + 1) / 2 * TILE, cz = (cr.ty0 + cr.ty1 + 1) / 2 * TILE;
W.addChunkContent(cr.tx0, cr.ty0, function (group) {
var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.crack);
m.rotation.x = -Math.PI / 2;
m.position.set(cx, 0.015, cz);
W.reg(group, m);
});
}

/* ---------------- v2.3 无源涟漪：镜面池中央周期性扩散的光环 ----------------
 * [原创异常，非原著] 水面本该只有恒定微小涟漪（原著），这里却有一圈
 * 找不到源头的涟漪在缓慢扩散。纯视觉，无交互。 */
function buildPhantomRipple(W, L, M) {
FX.phantom = null;
var mr = L.mirrorRect;
if (!mr) return;
var cx = (mr.tx0 + mr.tx1 + 1) / 2 * TILE, cz = (mr.ty0 + mr.ty1 + 1) / 2 * TILE;
W.addChunkContent(mr.tx0, mr.ty0, function (group) {
var ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 40), M.phantom);
ring.rotation.x = -Math.PI / 2;
ring.position.set(cx, SURF + 0.015, cz);
W.reg(group, ring);
FX.phantom = { mesh: ring, t: 2.5 };
});
}

/* ---------------- v2.3 裂纹区字条：异常目击记录（游戏内虚构，非原著） ---------------- */
function buildAbyssNote(W, map, L, M) {
var cr = L.crackRect;
if (!cr) return;
// 裂缝旁找一个可行走 tile 放字条，面向裂缝
var ax = -1, ay = -1, fx = 0, fz = 1, found = false;
for (var yy = cr.ty0 - 1; yy <= cr.ty1 + 1 && !found; yy++)
for (var xx = cr.tx0 - 1; xx <= cr.tx1 + 1 && !found; xx++) {
if (xx >= cr.tx0 && xx <= cr.tx1 && yy >= cr.ty0 && yy <= cr.ty1) continue;
if (W.tile(xx, yy) !== 1) continue;
ax = xx; ay = yy; found = true;
var ccx = (cr.tx0 + cr.tx1 + 1) / 2 * TILE, ccz = (cr.ty0 + cr.ty1 + 1) / 2 * TILE;
fx = ccx - BR.tileCX(xx); fz = ccz - BR.tileCZ(yy);
}
if (!found) return;
W.addChunkContent(ax, ay, function (group) {
var n = new THREE.Mesh(
new THREE.PlaneGeometry(0.55, 0.75),
new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') })
);
n.position.set(BR.tileCX(ax), 1.5, BR.tileCZ(ay));
n.rotation.y = Math.atan2(fx, fz);
W.reg(group, n);
W.addInteractable({
id: 'note_l372_abyss', kind: 'note', chunkKey: W.chunkKeyOf(ax, ay),
meshes: [n], pos: n.position.clone(), radius: 2.4,
prompt: function () { return (BR.interactKeyLabel ? BR.interactKeyLabel() : 'E') + ' 阅读墙上的刻字'; },
canUse: function () { return true; },
use: function () {
BR.Audio.paper();
// [原创，非原著] 游戏内虚构的流浪者记录，用来点出"瓷砖不该裂"这一异常。
BR.UI.showNote('墙上的刻字',
'第四天。\n\n瓷砖裂了。\n这里的瓷砖永远是新的 —— 每一个进来的人都这么说。\n不该裂的。\n\n裂缝是从深水那边开始的。别往深处去。');
if (W.state.picked.indexOf('note_l372_abyss') < 0) {
W.state.picked.push('note_l372_abyss');
BR.bus.emit('picked', { id: 'note_l372_abyss' });
}
}
});
});
}

/* ---------------- 粉色阳光开口（原著核心元素；纯装饰，不可穿过） ----------------
* 开口之外只有白色虚空 —— 原著称试图穿过去查明光源的流浪者神秘失踪，
* 因此本关的开口一律不可交互（墙体碰撞本就挡住），只做视觉。 */
function buildPinkOpenings(W, L, M) {
(L.pinkOpenings || []).forEach(function (op, idx) {
var tx = op.tx, ty = op.ty, face = op.face;
W.addChunkContent(tx, ty, function (group) {
var cx = BR.tileCX(tx), cz = BR.tileCZ(ty);
var wallH = (W.theme && W.theme.wallH) || 3.2;
// 墙面上的发光矩形（1.7 x 1.15，中心高 1.7m）
var quad = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.15), M.pink);
var px, pz, rotY;
if (face === 'N') { px = cx; pz = ty * TILE + 0.04; rotY = 0;}
else if (face === 'S') { px = cx; pz = (ty + 1) * TILE - 0.04; rotY = Math.PI;}
else if (face === 'W') { px = tx * TILE + 0.04; pz = cz; rotY = Math.PI / 2;}
else { px = (tx + 1) * TILE - 0.04; pz = cz; rotY = -Math.PI / 2;}
quad.position.set(px, 1.7, pz);
quad.rotation.y = rotY;
W.reg(group, quad);
// 洒在地面/水面的粉色光斑
var spot = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.8), M.pinkFloor);
spot.rotation.x = -Math.PI / 2;
var off = 1.1; // 光斑落在开口前方 1.1m
var sx = px + (face === 'W'? off: face === 'E'? -off: 0);
var sz = pz + (face === 'N'? off: face === 'S'? -off: 0);
spot.position.set(sx, SURF + 0.03, sz);
W.reg(group, spot);
});
});
}

/* ---------------- 入口对应：发光开口（L37 侧"墙面异常发光开口"的本侧） ----------------
* 接线契约（W-l37）：W-l37 在其 buildContent 里暴露 BR.World.l37_sunlitGate
* （{tx,ty} 或 {wx,wz}，L37 侧开口位置）。
* 本关只读它做一致性校验（存 BR.World.l372_seenGate 备查）；出生落点用
* gen 侧 arrival_gate POI（出生房内贴墙处）。
* TODO(总协调)：若 W-l37 暴露的 gate 含朝向/房间信息，可据此微调本侧开口的
* 墙面选择与玩家出生朝向；当前为占位实现（出生房北墙，无 gate 信息时回退）。 */
function buildArrivalGate(W, L, M, map) {
var ag = (L.arrivalGate) || null;
if (!ag) return;
// 一致性校验：读 W-l37 暴露的 L37 侧开口（可能尚未暴露 —— 那是 W-l37 的任务）
var l37gate = BR.World.l37_sunlitGate ||
(BR.Levels.L37 && BR.Levels.L37.sunlitGate) || null;
if (l37gate) {
BR.World.l372_seenGate = l37gate; // 握手存证（总协调可见）
if (BR.log) BR.log('[L372] 检测到 L37 侧发光开口: ' + JSON.stringify(l37gate));
} else {
// TODO(总协调)：W-l37 尚未暴露 BR.World.l37_sunlitGate（或本关先于 L37 重建），
// 本侧开口暂用 gen 侧 arrival_gate POI（出生房贴墙处）占位。
if (BR.log) BR.log('[L372] BR.World.l37_sunlitGate 暂未暴露，使用占位开口（见 TODO）。');
}
W.addChunkContent(ag.tx, ag.ty, function (group) {
var cx = BR.tileCX(ag.tx), cz = BR.tileCZ(ag.ty);
var face = ag.face || 'N', px, pz, rotY;
if (face === 'N') { px = cx; pz = ag.ty * TILE + 0.04; rotY = 0;}
else if (face === 'S') { px = cx; pz = (ag.ty + 1) * TILE - 0.04; rotY = Math.PI;}
else if (face === 'W') { px = ag.tx * TILE + 0.04; pz = cz; rotY = Math.PI / 2;}
else { px = (ag.tx + 1) * TILE - 0.04; pz = cz; rotY = -Math.PI / 2;}
var quad = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2), M.whiteGlow);
quad.position.set(px, 1.35, pz);
quad.rotation.y = rotY;
W.reg(group, quad);
// v2.3：地面光 spill + 门槛拼花 —— 强调这是"空间之间的边界"，不是普通传送门
var spill = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), M.whiteSpill);
spill.rotation.x = -Math.PI / 2;
var spx = px, spz = pz;
if (face === 'N') spz += 1.3;
else if (face === 'S') spz -= 1.3;
else if (face === 'W') spx += 1.3;
else spx -= 1.3;
spill.position.set(spx, 0.02, spz);
W.reg(group, spill);
var sill = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.04, 0.35), M.trim);
sill.position.set(px, 0.02, pz);
W.reg(group, sill);
});
}

/* ---------------- 返回 L37：黑暗开口（原著出口；真实功能） ---------------- */
function buildReturnGate(W, L, M, map) {
var rg = (L.returnGate) || null;
if (!rg) return;
// 暴露给总协调/W-l37 接线：玩家从本关返回 L37 时的位置
BR.World.l372_returnGate = { tx: rg.tx, ty: rg.ty, wx: rg.wx, wz: rg.wz, face: rg.face};
var aid = 'l372_return_gate';
W.addChunkContent(rg.tx, rg.ty, function (group) {
var cx = BR.tileCX(rg.tx), cz = BR.tileCZ(rg.ty);
var face = rg.face || 'S', px, pz, rotY;
if (face === 'N') { px = cx; pz = rg.ty * TILE + 0.04; rotY = 0;}
else if (face === 'S') { px = cx; pz = (rg.ty + 1) * TILE - 0.04; rotY = Math.PI;}
else if (face === 'W') { px = rg.tx * TILE + 0.04; pz = cz; rotY = Math.PI / 2;}
else { px = (rg.tx + 1) * TILE - 0.04; pz = cz; rotY = -Math.PI / 2;}
var g = new THREE.Group();
var panel = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.2), M.darkPanel);
panel.position.set(0, 1.25, 0);
g.add(panel);
var edge = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4), M.darkEdge);
edge.position.set(0, 1.25, -0.01);
g.add(edge);
g.position.set(px, 0, pz);
g.rotation.y = rotY;
W.reg(group, g);
W.addInteractable({
id: aid, kind: 'level_exit', chunkKey: W.chunkKeyOf(rg.tx, rg.ty),
meshes: [panel, edge], pos: new THREE.Vector3(px, 1.25, pz), radius: 3.0,
prompt: function () { return (BR.interactKeyLabel? BR.interactKeyLabel(): 'E') + ' 穿过黑暗的开口（回到 Level 37）';},
canUse: function () { return!BR.Cutout ||!BR.Cutout.busy;},
use: function () {
// CONNECTIONS 契约：L372 → L37（原著出口：黑暗开口 → 回 Level 37）
BR.Game._cameFrom = 'L372';
travelTo('L37', 'rift');
}
});
});
}

/* ---------------- Pinnicorns：无害漂浮实体（原著；孤证趣味设定，纯装饰） ---------------- */
function buildPinnicorns(W, map) {
FX.pins.length = 0;
for (var i = 0; i < map.pois.length; i++) {
(function (p) {
if (p.type!== 'pinnicorn') return;
var d = p.data || {};
var wx = (d.wx!= null)? d.wx: BR.tileCX(p.tx);
var wz = (d.wz!= null)? d.wz: BR.tileCZ(p.ty);
W.addChunkContent(p.tx, p.ty, function (group) {
var g = new THREE.Group();
var bodyM = new THREE.MeshLambertMaterial({ color: 0xf6f0f7});
var hornM = new THREE.MeshLambertMaterial({ color: 0xf2c86e});
var body = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 10, 22), bodyM);
body.rotation.x = Math.PI / 2;
g.add(body);
var horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.42, 8), hornM);
horn.position.set(0, 0.42, 0.30);
horn.rotation.x = 0.5;
g.add(horn);
g.position.set(wx, SURF + 0.12, wz);
g.rotation.y = d.yaw || 0;
W.reg(group, g);
W._levelMats.push(bodyM); W._levelMats.push(hornM);
FX.pins.push({ g: g, phase: (d.yaw || 0) * 3, baseY: SURF + 0.12, yaw: d.yaw || 0});
// 风味交互（非功能）：说明它是无害的
W.addInteractable({
id: 'pinnicorn_' + p.tx + '_' + p.ty, kind: 'flavor',
chunkKey: W.chunkKeyOf(p.tx, p.ty),
meshes: g.children.slice(), pos: g.position.clone(), radius: 3.2,
prompt: function () { return (BR.interactKeyLabel? BR.interactKeyLabel(): 'E') + ' 观察充气独角兽';},
canUse: function () { return true;},
use: function () {
// [改编标注] Pinnicorns 为 Fandom 主站条目作者的孤证趣味设定（见 LORE_V21.md），
// 本游戏仅作无害装饰实体，无战斗、无追逐。
BR.UI.toast('一只 Pinnicorn 慢悠悠地漂着 —— 充气浮具般的生物，完全无害。', 2600);
}
});
});
})(map.pois[i]);
}
}

/* ---------------- 拾取（状态进 W.state.picked，随关分桶存档） ---------------- */
var ITEM_NAME = {
almond: '杏仁水', bandage: '绷带', battery: '电池',
glowstick: '荧光棒', cashew: '腰果水', medkit: '急救包'
};
function buildPickups(W, map) {
function kl() { return (BR.interactKeyLabel? BR.interactKeyLabel(): 'E') + ' ';}
for (var i = 0; i < map.pois.length; i++) {
(function (p) {
if (p.type!== 'pickup') return;
var item = (p.data && p.data.item) || 'almond';
var n = (p.data && p.data.n) || 1;
var id = 'pick_l372_' + item + '_' + p.tx + '_' + p.ty;
W.addChunkContent(p.tx, p.ty, function (group) {
if (W.state.picked.indexOf(id) >= 0) return; // 已拾取：读档不再出现
var g = BR.itemMesh(item);
if (!g) return;
var rng = new BR.RNG(BR.hashSeed(id));
// 浅水区拾取：放在小干燥托盘上（视觉上不沉水底）
var tray = new THREE.Mesh(
new THREE.BoxGeometry(0.5, 0.06, 0.5),
new THREE.MeshLambertMaterial({ color: 0xe8eef0})
);
W._levelMats.push(tray.material);
tray.position.set(BR.tileCX(p.tx) + (rng.next() - 0.5) * 1.2, SURF + 0.28, BR.tileCZ(p.ty) + (rng.next() - 0.5) * 1.2);
var pole = new THREE.Mesh(
new THREE.CylinderGeometry(0.03, 0.03, SURF + 0.28, 6),
tray.material
);
pole.position.set(tray.position.x, (SURF + 0.28) / 2, tray.position.z);
W.reg(group, tray); W.reg(group, pole);
g.position.set(tray.position.x, SURF + 0.34, tray.position.z);
W.reg(group, g);
W.addInteractable({
id: id, kind: 'pickup', chunkKey: W.chunkKeyOf(p.tx, p.ty),
meshes: g.children.slice(), pos: g.position.clone().add(new THREE.Vector3(0, 0.3, 0)), radius: 2.6,
prompt: function () { return kl() + '拾取' + (ITEM_NAME[item] || item) + (n > 1? ' ×' + n: '');},
canUse: function () { return true;},
use: function () {
if (BR.Items &&!BR.Items.canAdd(item, n)) {
BR.UI.toast(BR.Items.fullReason(item, n));
if (BR.Audio.doorLocked) BR.Audio.doorLocked();
return;
}
BR.Game.inv[item] = (BR.Game.inv[item] || 0) + n;
BR.UI.toast('拾取了' + (ITEM_NAME[item] || item) + (n > 1? ' ×' + n: ''));
BR.Audio.pickup();
W.state.picked.push(id);
BR.bus.emit('picked', { id: id});
W.removeInteractable(id);
group.remove(g); group.remove(tray); group.remove(pole);
BR.UI.updateInv();
}
});
});
})(map.pois[i]);
}
}

/* ---------------- 木箱（容器；BR.Container 处理开关与存档） ---------------- */
function buildCrates(W, map) {
for (var i = 0; i < map.pois.length; i++) {
(function (p) {
if (p.type!== 'crate') return;
var id = 'crate_l372_' + p.tx + '_' + p.ty;
W.addChunkContent(p.tx, p.ty, function (group) {
var cm = BR.buildCrateMesh(W);
cm.group.position.set(BR.tileCX(p.tx), 0, BR.tileCZ(p.ty));
W.reg(group, cm.group);
var item = (p.data && p.data.item) || 'almond';
BR.wireCrateTwoStage(W, group, cm, { id: id, tx: p.tx, ty: p.ty, item: item});
});
})(map.pois[i]);
}
}

/* ---------------- 游戏内字条：如实标注改编 ---------------- */
function buildLoreNote(W, map) {
// 出生房墙上字条：交代本层身份 + 改编声明（原著党可见）
var spawnPoi = null;
for (var i = 0; i < map.pois.length; i++) {
if (map.pois[i].type === 'spawn') { spawnPoi = map.pois[i]; break;}
}
if (!spawnPoi) return;
var tx = spawnPoi.tx, ty = spawnPoi.ty;
W.addChunkContent(tx, ty, function (group) {
var n = new THREE.Mesh(
new THREE.PlaneGeometry(0.55, 0.75),
new THREE.MeshBasicMaterial({ map: BR.Textures.get('note')})
);
n.position.set(BR.tileCX(tx) - 1.1, 1.5, BR.tileCZ(ty));
n.rotation.y = Math.PI / 2;
W.reg(group, n);
W.addInteractable({
id: 'note_l372_intro', kind: 'note', chunkKey: W.chunkKeyOf(tx, ty),
meshes: [n], pos: n.position.clone(), radius: 2.4,
prompt: function () { return (BR.interactKeyLabel? BR.interactKeyLabel(): 'E') + ' 阅读字条';},
canUse: function () { return true;},
use: function () {
BR.Audio.paper();
BR.UI.showNote('流浪者字条 —— Level 37.2',
'这里是 Level 37.2，"Sunlit Pools"。\n' +
'白瓷砖永远崭新，及膝的清水，墙上的矩形开口透着粉色的阳光 —— ' +
'别想着穿过去查明光源，之前这么干的人都没回来。\n\n' +
'本层在游戏里能看到露天蓝天和太阳，是制作者按玩家要求加的' +
'改编；按原书记载，这里只有粉色开口光，开口之外是白色虚空。\n\n' +
'往粉色开口多的方向走，穿过水道，能看到天。');
if (W.state.picked.indexOf('note_l372_intro') < 0) {
W.state.picked.push('note_l372_intro');
BR.bus.emit('picked', { id: 'note_l372_intro'});
}
}
});
});
}

/* ---------------- 游泳区域注册 ---------------- */
function registerSwimZones(L) {
BR.Swim.clearZones();
// v2.3：只有干平台（floorY>SURF）是 holes；下沉浅滩（0.2）在水下，水面漫过它
var deckPits = L.pits.filter(function (pt) { return pt.floorY > SURF;});
L.rects.forEach(function (r) {
var holes = [];
deckPits.forEach(function (d) {
holes.push({
x0: d.tx0 * TILE, z0: d.ty0 * TILE,
x1: (d.tx1 + 1) * TILE, z1: (d.ty1 + 1) * TILE
});
});
var maxD = SURF;
L.pits.forEach(function (p) {
if (p.tx1 >= r.x0 && p.tx0 <= r.x1 && p.ty1 >= r.y0 && p.ty0 <= r.y1) {
var dd = SURF - p.floorY;
if (dd > maxD) maxD = dd;
}
});
BR.Swim.registerZone({
kind: 'pool',
x0: r.x0 * TILE, z0: r.y0 * TILE,
x1: (r.x1 + 1) * TILE, z1: (r.y1 + 1) * TILE,
depth: +maxD.toFixed(2), waterY: SURF,
holes: holes
});
});
// 明亮浅水的水下雾（沿用 L37 的浅水配置思路）
BR.Swim._fogCfg = { near: 1.0, far: 18, color: 0x2a7d9e};
}

/* ---------------- 扶梯（深水坑上岸；E/左键交互） ---------------- */
function buildLadders(W, L, M, map) {
FX.ladders = [];
L.pits.forEach(function (pit) {
if (!pit.ladder || pit.floorY > 0) return;
var px0 = pit.tx0 * TILE, px1 = (pit.tx1 + 1) * TILE;
var pz0 = pit.ty0 * TILE, pz1 = (pit.ty1 + 1) * TILE;
var e = pit.ladder.edge, lx, lz, rotY, dx, dz;
if (e === 'N') { lx = (px0 + px1) / 2; lz = pz0 + 0.25; rotY = 0; dx = 0; dz = -1;}
else if (e === 'S') { lx = (px0 + px1) / 2; lz = pz1 - 0.25; rotY = Math.PI; dx = 0; dz = 1;}
else if (e === 'W') { lx = px0 + 0.25; lz = (pz0 + pz1) / 2; rotY = Math.PI / 2; dx = -1; dz = 0;}
else { lx = px1 - 0.25; lz = (pz0 + pz1) / 2; rotY = -Math.PI / 2; dx = 1; dz = 0;}
var botY = Math.min(0, pit.floorY);
var railH = 0 - botY + 0.9;
var sx = lx + dx * 1.6, sz = lz + dz * 1.6;
var stx = Math.floor(sx / TILE), stz = Math.floor(sz / TILE);
if (W.tile(stx, stz)!== 1) {
var found = false, rr, xx, yy;
for (rr = 1; rr <= 3 &&!found; rr++)
for (yy = stz - rr; yy <= stz + rr &&!found; yy++)
for (xx = stx - rr; xx <= stx + rr &&!found; xx++)
if (W.tile(xx, yy) === 1) { stx = xx; stz = yy; found = true;}
}
var spotX = BR.tileCX(stx), spotZ = BR.tileCZ(stz);
var lid = 'ladder_l372_' + pit.tx0 + '_' + pit.ty0;
var tx = Math.floor(lx / TILE), ty = Math.floor(lz / TILE);
W.addChunkContent(tx, ty, function (group) {
var g = new THREE.Group();
var railM = new THREE.MeshPhongMaterial({
color: 0xc3d2d8, specular: 0xaac4d0, shininess: 70
});
W._levelMats = W._levelMats || [];
W._levelMats.push(railM);
function box(bw, bh, bd, bx, by, bz) {
var mm = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), railM);
mm.position.set(bx, by, bz); g.add(mm); return mm;
}
box(0.07, railH, 0.07, -0.28, botY + railH / 2, 0);
box(0.07, railH, 0.07, 0.28, botY + railH / 2, 0);
var rungN = Math.max(2, Math.floor(railH / 0.35));
for (var ri = 0; ri < rungN; ri++) box(0.56, 0.06, 0.06, 0, botY + 0.25 + ri * 0.35, 0);
var proxy = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.6),
new THREE.MeshBasicMaterial({ visible: false}));
proxy.position.set(0, 0.6, 0.1); g.add(proxy);
g.position.set(lx, 0, lz);
g.rotation.y = rotY;
W.reg(group, g);
W.addInteractable({
id: lid, kind: 'ladder', chunkKey: W.chunkKeyOf(tx, ty),
meshes: g.children.slice(),
pos: new THREE.Vector3(lx, 0.6, lz), radius: 3.0,
prompt: function () { return (BR.interactKeyLabel? BR.interactKeyLabel(): 'E') + ' 抓住扶梯爬上岸';},
canUse: function () {
var P = BR.Player;
if (!P || (BR.Cutout && BR.Cutout.busy)) return false;
var ddx = P.pos.x - lx, ddz = P.pos.z - lz;
if (ddx * ddx + ddz * ddz > 9) return false;
return BR.Swim.inWater;
},
use: function () {
var P = BR.Player;
P.pos.set(spotX, 0.02, spotZ);
P.vel.set(0, 0, 0);
if (BR.Audio.l37ClimbOut) { try { BR.Audio.l37ClimbOut();} catch (e2) {}}
BR.UI.toast('爬上了岸。', 1500);
}
});
});
FX.ladders.push({ x: lx, z: lz});
});
}

/* ================= BR.Levels.L372 ================= */
BR.Levels.L372 = {
name: 'Level 37.2 ——「Sunlit Pools」',
theme: {
  // v2.3：与 L37（lightInt 0.55 / fogFar 60 / 无天空）拉开气质差距 ——
  // 更亮、更暖、看得更远，一眼即知不是 L37。
  bg: 0xe8f4fd, fogNear: 22, fogFar: 120, ambient: 0xf6fbff, ambInt: 1.15,
  sky: 0xcfe8fa, ground: 0xa9cfe4, light: 0xfff3da, lightInt: 1.35,
  wallH: 3.2, wall: 'pool_tile', floor: 'pool_floor', ceil: 'pool_ceil',
  surface: 'tile', fixtureEvery: 6, hum: 0
},

buildContent: function (map, W) {
BR.Swim.clearZones();
FX.t = 0;
FX.ladders = [];
FX.pins.length = 0;
FX.phantom = null; // v2.3
var L = map.meta && map.meta.l372;
var M = makeMats(W);
// 露天庭院：跳过天花板实例（直接见天）
if (L && L.openRooms) {
for (var oi = 0; oi < map.rooms.length; oi++) {
var or = map.rooms[oi];
if (L.openRooms.indexOf(or.id) < 0) continue;
for (var oy = or.y; oy < or.y + or.h; oy++)
for (var ox = or.x; ox < or.x + or.w; ox++)
W.setOpenCeil(ox, oy);
}
}
buildSky(W, map);
if (L) {
buildWaterPlanes(W, L, M);
buildPits(W, L, M, map);
buildPillars(W, L, M);
buildArches(W, L, M); // v2.3
buildCracks(W, L, M); // v2.3
buildPhantomRipple(W, L, M); // v2.3
buildLadders(W, L, M, map);
buildPinkOpenings(W, L, M);
buildArrivalGate(W, L, M, map);
buildReturnGate(W, L, M, map);
buildPinnicorns(W, map);
buildAbyssNote(W, map, L, M); // v2.3
registerSwimZones(L);
}
buildPickups(W, map);
buildCrates(W, map);
buildLoreNote(W, map);
// 测试钩子
W._l372fx = {
ladders: FX.ladders,
cloudCount: FX.clouds.length,
pinCount: FX.pins.length,
returnGate: (L && L.returnGate) || null,
arrivalGate: (L && L.arrivalGate) || null,
roles: (L && L.roles) || null, // v2.3
archCount: (L && L.arches ? L.arches.length : 0), // v2.3
hasMirror: !!(L && L.mirrorRect), // v2.3
hasCrack: !!(L && L.crackRect) // v2.3
};
W.objective = '阳光泳池：穿过粉色开口的长廊，去大庭院看天，在镜面池边歇一会；墙上的黑暗开口可以回到 Level 37';
},

onEnter: function () {
BR.Swim._dryAmb = 'L372';
BR.UI.setObjective(BR.World.objective || '在洒满阳光的水域中找到回去的路');
if (BR.Audio && BR.Audio.setAmbient) BR.Audio.setAmbient('L372');
// 从 L37 的发光开口过来 → 落在出生房的开口旁（而非默认出生点），水→陆连续。
// 只在"刚被放到出生点"时搬运，读档/死亡重试（存档坐标）不动。
try {
var cf = BR.Game && BR.Game._cameFrom;
var from = (typeof cf === 'string')? cf: (cf && cf.from);
if (from === 'L37' && BR.World && BR.World.map && BR.Player) {
var sp0 = BR.World.spawnOf(BR.World.map);
var P0 = BR.Player;
if (Math.hypot(P0.pos.x - sp0.x, P0.pos.z - sp0.z) < 0.6) {
var L = BR.World.map.meta && BR.World.map.meta.l372;
var ag = L && L.arrivalGate;
if (ag) {
// 开口前方 1.2m（房间内侧）
var off = 1.2, nx = ag.wx, nz = ag.wz;
if (ag.face === 'N') nz += off;
else if (ag.face === 'S') nz -= off;
else if (ag.face === 'W') nx += off;
else nx -= off;
P0.pos.set(nx, 0.02, nz);
P0.vel.set(0, 0, 0);
// 面向房间中心
var rcx = BR.World.map.w * TILE / 2, rcz = BR.World.map.h * TILE / 2;
P0.yaw = Math.atan2(-(rcx - nx), -(rcz - nz));
setTimeout(function () {
if (BR.Game.state === 'playing')
BR.UI.toast('你穿过墙上发光的开口，来到一片洒满阳光的水域。', 3200);
}, 1200);
}
}
}
} catch (e) { if (BR.warn) BR.warn('[L372] arrival failed', e);}
},

tick: function (dt) {
BR.Swim.tick(dt);
var W = BR.World, P = BR.Player;
if (!P ||!W ||!BR.Game || BR.Game.state!== 'playing') return;
FX.t += dt;
// 云层漂移
for (var i = 0; i < FX.clouds.length; i++) {
var cl = FX.clouds[i];
cl.ang += cl.speed * dt;
cl.spr.position.x = Math.cos(cl.ang) * cl.r;
cl.spr.position.z = Math.sin(cl.ang) * cl.r;
}
// 水面 UV 滚动（波纹 + 天空反射层微动）
var pw = BR.Textures.get('pool_water');
if (pw) { pw.offset.x = (FX.t * 0.006) % 1; pw.offset.y = (FX.t * 0.008) % 1;}
var rf = BR.Textures.get('sunlit_reflect');
if (rf) { rf.offset.x = (FX.t * 0.002) % 1;}
var ca = BR.Textures.get('caustics');
if (ca && W.map && W.map.level === 'L372') {
ca.offset.x = (FX.t * 0.011) % 1; ca.offset.y = (FX.t * 0.014) % 1;
}
// 粉色开口辉光微脉动
if (FX.pinkMat) FX.pinkMat.opacity = 0.88 + Math.sin(FX.t * 1.1) * 0.07;
// v2.3：入口白光开口呼吸（空间过渡感）
if (FX.whiteMat) FX.whiteMat.opacity = 0.90 + Math.sin(FX.t * 0.7) * 0.08;
// v2.3：镜面池无源涟漪 —— 7 秒一圈，缓慢扩散后消散（原创异常）
if (FX.phantom && FX.phantom.mesh) {
FX.phantom.t += dt;
var cyc = FX.phantom.t % 7, kk = cyc / 7;
var psc = 0.6 + kk * 3.4;
FX.phantom.mesh.scale.set(psc, psc, 1);
FX.phantom.mesh.material.opacity = 0.30 * (1 - kk);
}
// Pinnicorn 漂浮
for (var j = 0; j < FX.pins.length; j++) {
var pn = FX.pins[j];
if (!pn.g.parent) continue;
pn.g.position.y = pn.baseY + Math.sin(FX.t * 0.9 + pn.phase) * 0.06;
pn.g.rotation.y = pn.yaw + Math.sin(FX.t * 0.25 + pn.phase) * 0.25;
}
}
};

/* ================= 与 E 路的接口约定（E 做游泳物理，本文件绑定） =================
* BR.Levels.L372.waterAt(x, z) -> null（无水）| {surface: 水面Y, floor: 池底Y, depth}
* BR.Levels.L372.isWater(x, z) -> bool（快捷）
* BR.Levels.L372.floorYAt(x, z) -> 池底 Y（player.js _groundYAt 用；无水区 0）
* 纯逻辑实现：gen_l372.js 的 BR.Gen.L372waterAt/map（Node 可测）；
* 这里绑定到当前关卡地图。签名冻结，不许改。
* ============================================================================ */
BR.Levels.L372.waterAt = function (x, z) {
var Wm = BR.World && BR.World.map;
return Wm? BR.Gen.L372waterAt(Wm, x, z): null;
};
BR.Levels.L372.isWater = function (x, z) {
return!!BR.Levels.L372.waterAt(x, z);
};
BR.Levels.L372.floorYAt = function (x, z) {
var Wm = BR.World && BR.World.map;
return Wm? BR.Gen.L372floorAt(Wm, x, z): 0;
};
})();
