/* items.js —— 道具注册表与 W9 新道具逻辑
* W9（v1.5）：背包修复 + 10 种新道具 + 精确交互。
* - BR.Items.CONFIG：全部可调数值（策划调这里，不碰逻辑）。
* - BR.Items.DEFS：9 种全新道具定义（id/名称/说明/图标/类型/堆叠）。
* 已有道具（绷带/电池/迁跃浆果等 13 种）不在此注册表，数值与行为保持原样。
* - 本文件顶层只做纯数据 + 函数定义，不碰 document/THREE（node 测试可直接加载）；
* 所有 BR.* 引用都在调用时惰性读取。
* 加载顺序：config.js → utils.js → items.js → … → ui.js（ui.js 把 DEFS 合并进 ITEM_INFO 显示）。
*/
(function () {
const BR = window.BR;

const svg = (inner) =>
'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"' +
' stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';

const IT = {
/* ================= 可调配置（数值只改这里） ================= */
CONFIG: {
inventoryMax: 40, // 背包总容量（单位数）；满时拾取拒绝、物品留世界
stamina: { max: 100, drain: 7, regen: 14, exhaustedAt: 30}, // 耐力：疾跑7/s耗，14/s回，耗尽后回30才能再跑
energy_bar: { stamina: 60, maxStack: 5}, // 能量棒：回耐力 60
medkit: { heal: 85, channel: 2.5, maxStack: 3},// 急救包：回血 85，读条 2.5s（可中断，中断不扣）
glowstick: { duration: 180, maxActive: 12, maxStack: 5}, // 荧光棒：微光 180s
chalk: { maxStack: 5, maxMarks: 200}, // 标记粉笔：每根 1 次标记
oxygen_tank: { oxygen: 100, seconds: 120, maxStack: 3}, // 便携氧气瓶：水下供氧约 120s/瓶
dive_light: { drain: 1.5, range: 18}, // 水下照明灯：开灯 1.5/s 耗电
life_vest: { buoyancy: 2.2}, // 救生衣：浮力系数（调 W8 的 buoyancyModifier 接口）
dry_bag: { wetIntervalMul: 5}, // 防水物资袋：浸水损坏间隔 ×5
adrenaline: { duration: 15, speedMul: 1.25, maxStack: 3}, // 肾上腺素：15s 加速 25%+不耗耐力+无视虚弱
wet: { vulnerable: ['cigarette', 'gum'], interval: 6} // 浸水：头部在水下每 6s 随机坏 1 件易损品
},

/* ================= 9 种新道具定义 =================
* kind: 'use'（消耗使用）/ 'equip'（装备开关）/ 'deploy'（部署到世界）/ 'device'（设备开关）
* 备用电池（battery）已存在：走 ui.js 原分支（+60），W9 只扩展"手电满时可给水下照明灯充电"。
* 跃迁浆果（berry）已存在：不计入新增。 */
DEFS: {
energy_bar: {
name: '能量棒', kind: 'use', stack: true,
desc: '高热量压缩能量棒：恢复耐力 60。疾跑耗尽耐力后来一根。',
icon: svg('<rect x="5" y="8" width="14" height="8" rx="2"/><path d="M9.7 8v8M14.3 8v8"/><path d="M12 4.5v3.5M12 16v3.5"/>')
},
medkit: {
name: '急救包', kind: 'use', stack: true,
desc: '比绷带更彻底的急救：恢复生命 85。使用需 2.5 秒包扎（移动/受伤会打断，打断不消耗）。',
icon: svg('<rect x="4" y="6.5" width="16" height="12" rx="2.5"/><path d="M12 10v5M9.5 12.5h5"/><path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5"/>')
},
glowstick: {
name: '荧光棒', kind: 'deploy', stack: true,
desc: '掰亮后丢在脚边：发出微光 180 秒，适合标记走过的路。位置与剩余时间会存档。',
icon: svg('<rect x="10.6" y="3.5" width="2.8" height="17" rx="1.4"/><path d="M4.5 8.5l2.6 1.2M4.5 15.5l2.6-1.2M19.5 8.5l-2.6 1.2M19.5 15.5l-2.6-1.2"/>')
},
chalk: {
name: '标记粉笔', kind: 'deploy', stack: true,
desc: '在准星所指的墙面/地面画一个方向箭头。标记永久保留，读档还在。',
icon: svg('<path d="M4.5 19.5l2.6-2.6L16 8l-2.8-2.8L4.3 14z"/><path d="M13.5 6.5l2.8 2.8"/><path d="M18.5 3.5l2 2"/>')
},
oxygen_tank: {
name: '便携氧气瓶', kind: 'equip', stack: true, charges: true,
desc: '装备后在水下呼吸瓶内氧气（约 120 秒/瓶），不再消耗闭气值。用完一瓶自动卸下。',
icon: svg('<rect x="9" y="7" width="6" height="13" rx="3"/><path d="M10.5 7V4.5h3V7"/><path d="M12 11v6M10 13.5h4"/>')
},
dive_light: {
name: '水下照明灯', kind: 'device', stack: false,
desc: '水下专用照明：开灯持续耗电（1.5/秒）。用"备用电池"充电。',
icon: svg('<circle cx="12" cy="12" r="4.6"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4"/><path d="M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" opacity="0.6"/>')
},
life_vest: {
name: '救生衣', kind: 'equip', stack: false,
desc: '装备后浮力大增：更容易浮上水面，但下潜要更用力按住。不提供氧气。',
icon: svg('<path d="M8.5 3.5h7V8l2.2 3.2V20.5h-4.4v-6h-2.6v6H6.3V11.2L8.5 8z"/><path d="M8.5 12h7"/>')
},
dry_bag: {
name: '防水物资袋', kind: 'equip', stack: false,
desc: '装备后：香烟、口香糖等易损品被水浸坏的速度大幅降低。',
icon: svg('<path d="M7 9h10v10a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19z"/><path d="M7 9c0-2.2 2.2-3.8 5-3.8s5 1.6 5 3.8"/><path d="M9.5 13.5c1 1 2 1 3 0s2-1 3 0" opacity="0.7"/>')
},
adrenaline: {
name: '肾上腺素', kind: 'use', stack: true,
desc: '注射：15 秒内移速 +25%、疾跑不耗耐力、无视饥饿虚弱减速。效果持续期间不可叠加。',
icon: svg('<path d="M5 19l7.5-7.5"/><rect x="11.5" y="8.5" width="5" height="8" rx="1" transform="rotate(-45 14 12.5)"/><path d="M17.5 4.5l2 2M19 3l1.5 3.5"/>')
}
},

/* ================= 运行时态（不直接存档，走 saveState/loadState） ================= */
charges: {}, // oxygen_tank: [剩余氧气%,...]（与 inv 数量对齐，charges[0] 为当前装备瓶）
equipped: {}, // { vest:bool, o2:bool, drybag:bool}
_glows: [], // [{key, mesh, light, x,y,z, remain}]
_chalks: [], // [{key, mesh, x,y,z, nx,ny,nz, ground}]
_drops: [], // [{key, item, mesh, x, z, charge}]
_dropSeq: 0,
_dropCharges: {}, // drop key -> 附带电量/氧气（拾取时恢复）
_channel: null, // {id, t, dur, el, bar}
_wetT: 0,
_pendingDeployed: null, // loadState 暂存，onLevelBuilt 时恢复
_chalkTex: null,

/* ================= 基础存取 ================= */
isNew: function (id) { return!!this.DEFS[id];},
count: function (id) {
const inv = (BR.Game && BR.Game.inv) || {};
if (id === 'dive_light') return (BR.Player && BR.Player.diveLight)? 1: 0;
return inv[id] || 0;
},
// 背包是否还能装下 n 个 id（总量上限 + 各自堆叠上限；dive_light/life_vest/dry_bag 唯一）
canAdd: function (id, n) {
n = n || 1;
const C = this.CONFIG, inv = (BR.Game && BR.Game.inv) || {};
if (id === 'dive_light') {
if (BR.Player && BR.Player.diveLight) return false;
return this.totalUnits() + 1 <= C.inventoryMax;
}
if (id === 'life_vest' || id === 'dry_bag') {
if ((inv[id] || 0) > 0) return false;
return this.totalUnits() + n <= C.inventoryMax;
}
const def = this.DEFS[id];
const maxStack = (def && C[id] && C[id].maxStack) || 99;
if ((inv[id] || 0) + n > maxStack) return false;
return this.totalUnits() + n <= C.inventoryMax;
},
totalUnits: function () {
const inv = (BR.Game && BR.Game.inv) || {};
let s = 0;
for (const k in inv) s += inv[k] || 0;
return s;
},
fullReason: function (id, n) {
const C = this.CONFIG, inv = (BR.Game && BR.Game.inv) || {};
if (id === 'dive_light' && BR.Player && BR.Player.diveLight) return '已经有一盏水下照明灯了';
if ((id === 'life_vest' || id === 'dry_bag') && (inv[id] || 0) > 0)
return '已经有一件了，物品留在原地';
const def = this.DEFS[id];
const maxStack = (def && C[id] && C[id].maxStack) || 99;
if ((inv[id] || 0) + (n || 1) > maxStack) return '这种道具叠放已满（' + maxStack + '），物品留在原地';
return '背包满了（' + C.inventoryMax + '），物品留在原地';
},
add: function (id, n) {
n = n || 1;
const G = BR.Game;
if (!G) return false;
if (id === 'dive_light') {
if (BR.Player.diveLight) return false;
BR.Player.diveLight = { charge: 100, on: false};
if (G.autosave) G.autosave();
return true;
}
G.inv[id] = (G.inv[id] || 0) + n;
if (id === 'oxygen_tank') {
this.charges.oxygen_tank = this.charges.oxygen_tank || [];
for (let i = 0; i < n; i++) this.charges.oxygen_tank.push(this.CONFIG.oxygen_tank.oxygen);
}
if (G.autosave) G.autosave();
return true;
},
// 扣 n 个；数量不足返回 false（不扣）
take: function (id, n) {
n = n || 1;
const G = BR.Game;
if (!G || (G.inv[id] || 0) < n) return false;
G.inv[id] -= n;
if (G.inv[id] <= 0) delete G.inv[id];
if (id === 'oxygen_tank' && this.charges.oxygen_tank) {
// 从末尾扣（charges[0] 是当前装备瓶，不动它）
this.charges.oxygen_tank.splice(Math.max(0, this.charges.oxygen_tank.length - n), n);
}
return true;
},
itemName: function (id) {
if (this.DEFS[id]) return this.DEFS[id].name;
return id;
},

/* ================= 统一使用入口（ui.js useItem 委托到这里） =================
* 返回 true = 新道具（已处理：成功或给出拒绝原因），ui.js 不再走旧分支；
* 返回 false = 非新道具，ui.js 走原有分支（老 13 种数值/行为不动）。 */
handle: function (id) {
const def = this.DEFS[id];
if (!def) return false;
const G = BR.Game, P = BR.Player, U = BR.UI;
if (!G ||!P ||!U || G.state!== 'playing') return true; // 非游玩态：静默消费（与旧链路一致）
if (this._channel) return true; // 读条中：忽略新的使用
try {
if (def.kind === 'use') this._useConsumable(id);
else if (def.kind === 'equip') this._toggleEquip(id);
else if (def.kind === 'deploy') this._deploy(id);
else if (def.kind === 'device') this._toggleDevice(id);
} catch (e) { if (BR.warn) BR.warn('items use err', id, e);}
return true;
},

_useConsumable: function (id) {
const C = this.CONFIG, P = BR.Player, U = BR.UI, G = BR.Game;
if (!(G.inv[id] > 0)) { U.toast('没有' + this.DEFS[id].name); return;}
if (id === 'energy_bar') {
if (P.stamina >= C.stamina.max) { U.toast('耐力已满，不需要补充'); return;}
this.take(id, 1);
P.stamina = Math.min(C.stamina.max, P.stamina + C.energy_bar.stamina);
BR.Audio.drink();
U.toast('吃下能量棒，耐力恢复 +' + C.energy_bar.stamina);
} else if (id === 'medkit') {
if (P.hp >= 100) { U.toast('生命已满，不需要急救'); return;}
this._startChannel(id, C.medkit.channel, () => {
// 完成时才扣（中断不扣）
if (!this.take(id, 1)) return;
P.heal(C.medkit.heal);
BR.Audio.heal();
U.toast('急救完成，恢复生命 +' + C.medkit.heal);
if (G.autosave) G.autosave();
U.updateInv();
});
U.toast('正在包扎……（移动/受伤会打断）', 2000);
return; // 读条分支自己负责 updateInv/autosave
} else if (id === 'adrenaline') {
if (P.adrenalineT > 0) { U.toast('肾上腺素效果还在持续'); return;}
this.take(id, 1);
P.adrenalineT = C.adrenaline.duration;
BR.Audio.uiClick();
U.toast('肾上腺素生效！' + C.adrenaline.duration + ' 秒内更快更持久', 2600);
}
if (G.autosave) G.autosave();
U.updateInv();
},

_toggleEquip: function (id) {
const P = BR.Player, U = BR.UI, G = BR.Game;
if (!(G.inv[id] > 0)) { U.toast('没有' + this.DEFS[id].name); return;}
if (id === 'life_vest') {
this.equipped.vest =!this.equipped.vest;
P.buoyancyModifier = this.equipped.vest? this.CONFIG.life_vest.buoyancy: 1;
BR.Audio.uiClick();
U.toast(this.equipped.vest? '穿上救生衣（浮力大增，下潜更费力）': '脱下救生衣');
} else if (id === 'dry_bag') {
this.equipped.drybag =!this.equipped.drybag;
BR.Audio.uiClick();
U.toast(this.equipped.drybag? '背上防水物资袋（易损品浸水变慢）': '取下防水物资袋');
} else if (id === 'oxygen_tank') {
if (this.equipped.o2) {
this.equipped.o2 = false;
if (P && typeof P.clearOxygenGear === 'function') P.clearOxygenGear();
this._o2GearOn = false;
U.toast('卸下氧气瓶');
} else {
const ch = this._chargesOf('oxygen_tank');
if (!ch.length || ch[0] <= 0) { U.toast('这瓶氧气瓶是空的'); return;}
this.equipped.o2 = true;
U.toast('装上氧气瓶（剩余 ' + Math.round(ch[0]) + '%）');
}
BR.Audio.uiClick();
}
this._syncEquipFlags();
if (G.autosave) G.autosave();
U.updateInv();
},

_toggleDevice: function (id) {
const P = BR.Player, U = BR.UI, G = BR.Game;
if (id === 'dive_light') {
if (!P.diveLight) { U.toast('没有水下照明灯'); return;}
if (!P.diveLight.on && P.diveLight.charge <= 0) { U.toast('照明灯没电了，找块备用电池'); return;}
P.diveLight.on =!P.diveLight.on;
BR.Audio.uiClick();
U.toast(P.diveLight.on? '水下照明灯：开': '水下照明灯：关');
this._syncDiveSpot();
if (G.autosave) G.autosave();
U.updateInv();
}
},

_deploy: function (id) {
const U = BR.UI, G = BR.Game;
if (!(G.inv[id] > 0)) { U.toast('没有' + this.DEFS[id].name); return;}
if (id === 'glowstick') this._placeGlowstick();
else if (id === 'chalk') this._placeChalk();
},

/* ================= 读条（急救包） ================= */
_startChannel: function (id, dur, onDone) {
this._cancelChannel(true); // 保险：旧读条先清
const wrap = document.createElement('div');
wrap.id = 'item-channel';
wrap.style.cssText = 'position:fixed;left:50%;bottom:26%;transform:translateX(-50%);' +
'width:220px;z-index:70;pointer-events:none;text-align:center;';
wrap.innerHTML = '<div style="font-size:12px;letter-spacing:3px;color:#e8e4d8;margin-bottom:6px">' +
this.DEFS[id].name + '使用中……</div>' +
'<div style="height:8px;background:rgba(10,11,14,0.8);border:1px solid #4a463a;border-radius:4px;overflow:hidden">' +
'<div class="ch-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#7ab648,#b8e07a)"></div></div>' +
'<div style="font-size:11px;color:#8f8b7d;margin-top:4px;letter-spacing:2px">移动/受伤/开菜单会打断</div>';
document.body.appendChild(wrap);
this._channel = { id, t: 0, dur, onDone, el: wrap, bar: wrap.querySelector('.ch-fill')};
BR.bus.on('hurt', this._onHurtCancel);
},
_onHurtCancel: function () {
if (BR.Items && BR.Items._channel) BR.Items._cancelChannel(false, '受伤打断了包扎');
},
_cancelChannel: function (silent, reason) {
const c = this._channel;
if (!c) return;
BR.bus.off('hurt', this._onHurtCancel);
if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
this._channel = null;
if (!silent && reason && BR.UI) BR.UI.toast(reason + '（未消耗' + this.DEFS[c.id].name + '）');
},

/* ================= 荧光棒 ================= */
_placeGlowstick: function () {
const C = this.CONFIG, P = BR.Player, W = BR.World, U = BR.UI, G = BR.Game;
if (this._glows.length >= C.glowstick.maxActive) {
U.toast('荧光棒太多（' + C.glowstick.maxActive + '），等旧的熄灭再放'); return;
}
if (!this.take('glowstick', 1)) return;
const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
let gx = P.pos.x + fx * 1.1, gz = P.pos.z + fz * 1.1;
// 落点找空位（绕一圈找 circleFree）
if (W && W.circleFree) {
let ok = W.circleFree(gx, gz, 0.2);
if (!ok) {
for (let a = 0; a < 6.2832 &&!ok; a += 0.5236) {
const nx = P.pos.x + Math.cos(a) * 1.1, nz = P.pos.z + Math.sin(a) * 1.1;
if (W.circleFree(nx, nz, 0.2)) { gx = nx; gz = nz; ok = true;}
}
}
if (!ok) { // 实在没空位：退回（不扣已扣？已扣了——退还）
this.add('glowstick', 1);
U.toast('脚边没有空位放荧光棒'); return;
}
}
const key = 'glow_' + G.level + '_' + (this._glows.length) + '_' + Date.now().toString(36);
this._spawnGlow(key, gx, 0.06, gz, C.glowstick.duration);
BR.Audio.uiClick();
U.toast('掰亮一根荧光棒，丢在地上（' + C.glowstick.duration + ' 秒）');
this._recordDeployed();
if (G.autosave) G.autosave();
U.updateInv();
},
_spawnGlow: function (key, x, y, z, remain) {
const W = BR.World;
if (!W ||!W.scene) return null;
const g = new THREE.Group();
const stick = new THREE.Mesh(
new THREE.CylinderGeometry(0.028, 0.028, 0.26, 8),
new THREE.MeshBasicMaterial({ color: 0x9dffb0})
);
stick.rotation.z = Math.PI / 2 - 0.15;
stick.position.y = 0.03;
g.add(stick);
const halo = new THREE.Mesh(
new THREE.SphereGeometry(0.16, 10, 8),
new THREE.MeshBasicMaterial({ color: 0x4fe87a, transparent: true, opacity: 0.28, depthWrite: false})
);
halo.position.y = 0.05;
g.add(halo);
const light = new THREE.PointLight(0x7dff9a, 0.75, 7, 2);
light.position.set(0, 0.35, 0);
g.add(light);
g.position.set(x, y, z);
W.scene.add(g);
const rec = { key, mesh: g, light, halo, x, y, z, remain};
this._glows.push(rec);
return rec;
},
_tickGlows: function (dt) {
for (let i = this._glows.length - 1; i >= 0; i--) {
const r = this._glows[i];
r.remain -= dt;
if (r.remain <= 0) {
if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
this._glows.splice(i, 1);
this._recordDeployed();
continue;
}
// 最后 10 秒渐暗
if (r.remain < 10) {
const k = r.remain / 10;
r.light.intensity = 0.75 * k;
r.halo.material.opacity = 0.28 * k;
}
}
},

/* ================= 标记粉笔 ================= */
_chalkTexture: function () {
if (this._chalkTex) return this._chalkTex;
const cv = document.createElement('canvas');
cv.width = cv.height = 128;
const ctx = cv.getContext('2d');
ctx.clearRect(0, 0, 128, 128);
ctx.strokeStyle = '#f2ecd8';
ctx.lineWidth = 13;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
// 箭头：指向 +x（贴图本地），放置时旋转到行进方向
ctx.beginPath();
ctx.moveTo(18, 64); ctx.lineTo(88, 64);
ctx.moveTo(66, 40); ctx.lineTo(94, 64); ctx.lineTo(66, 88);
ctx.stroke();
const tex = new THREE.CanvasTexture(cv);
this._chalkTex = tex;
return tex;
},
_placeChalk: function () {
const P = BR.Player, W = BR.World, U = BR.UI, G = BR.Game;
if (this._chalks.length >= this.CONFIG.chalk.maxMarks) {
U.toast('粉笔标记太多（' + this.CONFIG.chalk.maxMarks + '），先擦掉一些'); return;
}
// 沿视线步进找墙（0.1 步，3m 内）；同时检测先落地
const dir = new THREE.Vector3(0, 0, -1).applyEuler(P.camera.rotation);
const ox = P.pos.x, oy = P.eyeY(), oz = P.pos.z;
let hit = null; // {x,y,z, ground}
for (let d = 0.2; d <= 3.0; d += 0.1) {
const x = ox + dir.x * d, y = oy + dir.y * d, z = oz + dir.z * d;
if (y <= 0.03 && dir.y < -0.05) { hit = { x, y: 0.02, z, ground: true}; break;}
if (W && W.blocked && W.blocked(BR.worldTX(x), BR.worldTY(z)) && y < 2.6 && y > 0.15) {
hit = { x: ox + dir.x * (d - 0.08), y, z: oz + dir.z * (d - 0.08), ground: false};
break;
}
}
if (!hit) { U.toast('3 米内没有可画的墙面或地面'); return;}
if (!this.take('chalk', 1)) return;
const key = 'chalk_' + G.level + '_' + this._chalks.length + '_' + Date.now().toString(36);
// 法线：墙面=视线反方向（朝玩家），地面=朝上
const nx = hit.ground? 0: -dir.x, ny = hit.ground? 1: 0, nz = hit.ground? 0: -dir.z;
this._spawnChalk(key, hit.x, hit.y, hit.z, nx, ny, nz, hit.ground);
BR.Audio.uiClick();
U.toast('在' + (hit.ground? '地面': '墙面') + '画了个方向标记');
this._recordDeployed();
if (G.autosave) G.autosave();
U.updateInv();
},
_spawnChalk: function (key, x, y, z, nx, ny, nz, ground) {
const W = BR.World;
if (!W ||!W.scene) return null;
const m = new THREE.Mesh(
new THREE.PlaneGeometry(0.55, 0.55),
new THREE.MeshBasicMaterial({
map: this._chalkTexture(), transparent: true, depthWrite: false,
polygonOffset: true, polygonOffsetFactor: -2
})
);
m.position.set(x, y, z);
if (ground) {
m.rotation.x = -Math.PI / 2;
// 箭头指向玩家行进方向（yaw）
m.rotation.z = -BR.Player.yaw + Math.PI / 2;
} else {
// 朝向玩家：plane 默认 +z 法线
m.lookAt(x + nx, y + ny, z + nz);
m.rotateZ(-Math.PI / 2 + 0); // 箭头贴图 +x → 指向行进水平方向
// 让箭头指向玩家面朝方向在墙面上的投影
const yaw = Math.atan2(nx, nz);
m.rotation.set(0, yaw, 0);
m.rotateZ(Math.PI / 2); // 贴图箭头朝上→转成水平指向
}
W.scene.add(m);
const rec = { key, mesh: m, x, y, z, nx, ny, nz, ground:!!ground};
this._chalks.push(rec);
return rec;
},

/* ================= 丢弃（背包"丢弃"按钮） =================
* 从背包扣 1，在玩家面前合理位置生成真实拾取（走 chunk 内容钩子，
* 区块卸载/重建不丢失；跨层/刷新走存档恢复）。不复制：扣了才生成。 */
drop: function (id) {
const G = BR.Game, P = BR.Player, W = BR.World, U = BR.UI;
if (!G ||!P ||!W || G.state!== 'playing') return;
const def = this.DEFS[id];
if (!def) return;
if (id === 'dive_light') { U.toast('水下照明灯不能丢弃（贵重设备）'); return;}
if (this.equipped.vest && id === 'life_vest' ||
this.equipped.drybag && id === 'dry_bag' ||
this.equipped.o2 && id === 'oxygen_tank') {
U.toast('先卸下再丢弃'); return;
}
if (!(G.inv[id] > 0)) { U.toast('没有' + def.name); return;}
// 落点：面前 1.2m，找 circleFree
const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
let dx = P.pos.x + fx * 1.2, dz = P.pos.z + fz * 1.2, ok = false;
if (W.circleFree) {
ok = W.circleFree(dx, dz, 0.25);
for (let a = 0;!ok && a < 6.2832; a += 0.5) {
const nx = P.pos.x + Math.cos(a) * 1.2, nz = P.pos.z + Math.sin(a) * 1.2;
if (W.circleFree(nx, nz, 0.25)) { dx = nx; dz = nz; ok = true;}
}
} else ok = true;
if (!ok) { U.toast('身边没有空位可丢'); return;}
// 扣（氧气瓶带走对应电量：从末尾扣）
let charge = null;
if (id === 'oxygen_tank' && this.charges.oxygen_tank) {
charge = this.charges.oxygen_tank[this.charges.oxygen_tank.length - 1];
}
if (!this.take(id, 1)) return;
const key = 'drop_' + id + '_' + (++this._dropSeq) + '_' + Date.now().toString(36);
if (charge!= null) this._dropCharges[key] = charge;
this._spawnDrop(key, id, dx, dz, charge);
BR.Audio.uiClick();
U.toast('丢弃了' + def.name + '（可再拾取）');
this._recordDeployed();
if (G.autosave) G.autosave();
U.updateInv();
if (U._bpOpen) U.renderBackpack();
},
_spawnDrop: function (key, item, x, z, charge) {
const W = BR.World;
if (!W || typeof BR.itemMesh!== 'function') return null;
const tx = BR.worldTX(x), ty = BR.worldTY(z);
const build = (group) => {
if (this._dropPicked(key)) return;
const g = BR.itemMesh(item);
g.position.set(x, 0.02, z);
W.reg(group, g);
const proxy = new THREE.Mesh(
new THREE.BoxGeometry(0.7, 0.8, 0.7),
new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false})
);
proxy.position.set(0, 0.25, 0);
g.add(proxy);
const rec = { key, item, mesh: g, x, z, charge};
this._drops.push(rec);
W.addInteractable({
id: key, kind: 'pickup', chunkKey: W.chunkKeyOf(tx, ty),
meshes: g.children.slice(),
pos: new THREE.Vector3(x, 0.35, z), radius: 2.6,
prompt: () => BR.interactKeyLabel() + '拿起' + this.itemName(item),
canUse: () => true,
use: () => {
if (!this.canAdd(item, 1)) {
BR.UI.toast(this.fullReason(item, 1));
return; // 背包满：物品留世界（不标记拾取）
}
this.add(item, 1);
// 恢复丢弃时的独立电量/氧气
const ch = this._dropCharges[key];
if (item === 'oxygen_tank' && ch!= null && this.charges.oxygen_tank) {
this.charges.oxygen_tank[this.charges.oxygen_tank.length - 1] = ch;
}
delete this._dropCharges[key];
BR.Audio.pickup();
BR.UI.toast('拿起了' + this.itemName(item));
this._markDropPicked(key);
W.removeInteractable(key);
group.remove(g);
this._drops = this._drops.filter(r => r.key!== key);
this._recordDeployed();
if (BR.Game.autosave) BR.Game.autosave();
BR.UI.updateInv();
}
});
};
// 走 chunk 内容钩子：区块卸载/重建自动恢复
W.addChunkContent(tx, ty, build);
const ck = W.chunkKeyOf(tx, ty);
const chunk = W.chunks.get(ck);
if (chunk) build(chunk.group);
return key;
},
_dropPickedSet: null,
_dropPicked: function (key) {
return!!(this._dropPickedSet && this._dropPickedSet[key]);
},
_markDropPicked: function (key) {
this._dropPickedSet = this._dropPickedSet || {};
this._dropPickedSet[key] = true;
},

/* ================= 氧气瓶（调 W8 的氧气接口） =================
* W8 接口：P.setOxygenGear(max, drainMul) / P.clearOxygenGear()，
* 真值在 BR.Swim.breath（lv_l37.js tick 已按 oxygenDrainMul/oxygenMax 接入）。
* 氧气瓶装备且头部在水下时：调 setOxygenGear(100, 0.15)（闭气消耗降为 15%），
* 同时真实消耗瓶内氧气（约 120 秒/瓶）；耗尽则扣掉该瓶、clearOxygenGear、自动卸下。 */
_o2GearOn: false,
_tickOxygen: function (dt) {
const P = BR.Player, S = BR.Swim;
if (!P || typeof P.setOxygenGear !== 'function') return;
const supplying = !!(this.equipped.o2 && S && S.headUnder);
if (supplying) {
const ch = this._chargesOf('oxygen_tank');
if (ch.length && ch[0] > 0) {
P.setOxygenGear(100, 0.15);
this._o2GearOn = true;
const C = this.CONFIG.oxygen_tank;
ch[0] -= dt * (C.oxygen / C.seconds);
if (ch[0] <= 0) this._depleteOxygenBottle();
return;
}
}
if (this._o2GearOn) {
if (typeof P.clearOxygenGear === 'function') P.clearOxygenGear();
this._o2GearOn = false;
}
},
_depleteOxygenBottle: function () {
if (this.charges.oxygen_tank) this.charges.oxygen_tank.shift();
const G = BR.Game, P = BR.Player;
if (G && G.inv.oxygen_tank > 0) {
G.inv.oxygen_tank--;
if (G.inv.oxygen_tank <= 0) delete G.inv.oxygen_tank;
}
this.equipped.o2 = false;
if (P && typeof P.clearOxygenGear === 'function') P.clearOxygenGear();
this._o2GearOn = false;
this._syncEquipFlags();
if (BR.UI) {
BR.UI.toast('氧气瓶耗尽，已自动卸下', 2600);
BR.UI.updateInv();
}
if (G && G.autosave) G.autosave();
},
_chargesOf: function (id) {
this.charges[id] = this.charges[id] || [];
// 对齐：inv 有 n 个，charges 也补到 n 个（老存档/异常缺失时兜底）
const n = (BR.Game && BR.Game.inv && BR.Game.inv[id]) || 0;
while (this.charges[id].length < n) this.charges[id].push(this.CONFIG.oxygen_tank.oxygen);
return this.charges[id];
},

/* ================= 水下照明灯聚光 ================= */
_syncDiveSpot: function () {
const P = BR.Player, W = BR.World;
if (!W ||!W.scene) return;
const want =!!(P && P.diveLight && P.diveLight.on && P.diveLight.charge > 0);
if (want &&!this._diveSpot) {
this._diveSpot = new THREE.SpotLight(0x9fd8ff, 1.3, this.CONFIG.dive_light.range, 0.62, 0.5, 1.2);
W.scene.add(this._diveSpot);
W.scene.add(this._diveSpot.target);
}
if (this._diveSpot && this._diveSpot.parent!== W.scene && W.scene) {
W.scene.add(this._diveSpot);
W.scene.add(this._diveSpot.target);
}
if (this._diveSpot) this._diveSpot.visible = want;
},
_tickDiveLight: function (dt) {
const P = BR.Player;
if (!P ||!P.diveLight ||!P.diveLight.on) return;
P.diveLight.charge = Math.max(0, P.diveLight.charge - this.CONFIG.dive_light.drain * dt);
if (P.diveLight.charge <= 0) {
P.diveLight.on = false;
if (BR.UI) {
BR.UI.toast('水下照明灯没电了！');
BR.UI.updateInv();
}
}
this._syncDiveSpot();
if (this._diveSpot && this._diveSpot.visible && P.camera) {
this._diveSpot.position.set(P.pos.x, P.eyeY(), P.pos.z);
const d = new THREE.Vector3(0, 0, -1).applyEuler(P.camera.rotation);
this._diveSpot.target.position.set(P.pos.x + d.x * 9, P.eyeY() + d.y * 9, P.pos.z + d.z * 9);
}
},

/* ================= 浸水损坏 ================= */
_tickWet: function (dt) {
const S = BR.Swim, G = BR.Game, U = BR.UI;
if (!S ||!S.headUnder ||!G || G.state!== 'playing') { this._wetT = 0; return;}
const C = this.CONFIG;
const interval = C.wet.interval * (this.equipped.drybag? C.dry_bag.wetIntervalMul: 1);
this._wetT += dt;
if (this._wetT < interval) return;
this._wetT = 0;
const vuln = C.wet.vulnerable.filter(id => (G.inv[id] || 0) > 0);
if (!vuln.length) return;
const id = vuln[(Math.random() * vuln.length) | 0];
G.inv[id]--;
if (G.inv[id] <= 0) delete G.inv[id];
U.toast('被水浸坏了！' +
(this.equipped.drybag? '': '（防水物资袋可减缓）'), 2600);
U.updateInv();
if (G.autosave) G.autosave();
},

/* ================= 每帧（main.js 主循环调用） ================= */
tick: function (dt) {
const G = BR.Game;
if (!G || G.state!== 'playing') { return;}
// 急救包读条
const c = this._channel;
if (c) {
const I = BR.Input, P = BR.Player;
let cancel = null;
if (G.state!== 'playing') cancel = '状态变化';
else if (I) {
const mv = I.getMove? I.getMove(): { x: 0, z: 0};
if (Math.hypot(mv.x, mv.z) > 0.12) cancel = '移动打断了包扎';
}
if (!(G.inv[c.id] > 0)) cancel = '道具不足';
if (cancel) { this._cancelChannel(false, cancel);}
else {
c.t += dt;
if (c.bar) c.bar.style.width = Math.min(100, (c.t / c.dur) * 100) + '%';
if (c.t >= c.dur) {
const done = c.onDone;
this._cancelChannel(true);
if (done) done();
}
}
}
this._tickGlows(dt);
this._tickDiveLight(dt);
this._tickWet(dt);
this._tickOxygen(dt);
},

/* ================= 装备态同步 ================= */
_syncEquipFlags: function () {
const P = BR.Player;
if (!P) return;
P.buoyancyModifier = this.equipped.vest? this.CONFIG.life_vest.buoyancy: 1;
},
applyAll: function () {
// 读档/切关后重建派生状态
this._syncEquipFlags();
this._syncDiveSpot();
this._chargesOf('oxygen_tank');
},

/* ================= 背包详情行（ui.js renderBackpack 调用） ================= */
detailStatus: function (id) {
const P = BR.Player, G = BR.Game;
const rows = [];
const eq = (on) => on
? '<span style="color:#9fe87a">● 已装备</span>'
: '<span style="color:#6a675c">○ 未装备</span>';
if (id === 'oxygen_tank') {
rows.push('状态：' + eq(this.equipped.o2));
const ch = this._chargesOf('oxygen_tank');
rows.push('各瓶氧气：' + ch.map(v => Math.round(v) + '%').join(' / '));
} else if (id === 'life_vest') {
rows.push('状态：' + eq(this.equipped.vest));
rows.push('浮力系数：×' + (this.equipped.vest? this.CONFIG.life_vest.buoyancy: 1));
} else if (id === 'dry_bag') {
rows.push('状态：' + eq(this.equipped.drybag));
} else if (id === 'dive_light') {
const dl = P && P.diveLight;
rows.push('开关：' + (dl && dl.on? '<span style="color:#9fe87a">● 开</span>': '<span style="color:#6a675c">○ 关</span>'));
rows.push('电量：' + Math.round(dl? dl.charge: 0) + '%');
} else if (id === 'energy_bar') {
rows.push('耐力：' + Math.round(P? P.stamina: 0) + '/' + this.CONFIG.stamina.max);
} else if (id === 'medkit') {
rows.push('读条 ' + this.CONFIG.medkit.channel + ' 秒（可中断，中断不消耗）');
} else if (id === 'glowstick') {
rows.push('已放置：' + this._glows.length + '/' + this.CONFIG.glowstick.maxActive +
'（' + this.CONFIG.glowstick.duration + ' 秒）');
} else if (id === 'chalk') {
rows.push('已标记：' + this._chalks.length + '/' + this.CONFIG.chalk.maxMarks);
} else if (id === 'adrenaline') {
rows.push(P && P.adrenalineT > 0
? '生效中：剩余 ' + P.adrenalineT.toFixed(0) + ' 秒'
: '持续 ' + this.CONFIG.adrenaline.duration + ' 秒');
}
if (!rows.length) return '';
return '<div class="bp-dstatus" style="font-size:12px;color:#a8a496;line-height:1.9;margin-bottom:10px">' +
rows.join('<br>') + '</div>';
},

/* ================= 存档 ================= */
saveState: function () {
const P = BR.Player;
const dep = {};
// 本关运行时态 → 按关分桶
const lv = (BR.Game && BR.Game.level) || 'L0';
dep[lv] = {
glows: this._glows.map(r => ({ x: r.x, y: r.y, z: r.z, remain: Math.round(r.remain * 10) / 10})),
chalks: this._chalks.map(r => ({ x: r.x, y: r.y, z: r.z, nx: r.nx, ny: r.ny, nz: r.nz, ground: r.ground})),
drops: this._drops
.filter(r =>!this._dropPicked(r.key))
.map(r => ({ key: r.key, item: r.item, x: r.x, z: r.z, charge: this._dropCharges[r.key]}))
};
// 合并其它关已存的（跨关不丢）
const prev = (this._savedDeployed && typeof this._savedDeployed === 'object')? this._savedDeployed: {};
for (const k in prev) if (k!== lv) dep[k] = prev[k];
this._savedDeployed = dep;
return {
itemCharges: JSON.parse(JSON.stringify(this.charges)),
equipped: Object.assign({}, this.equipped),
stamina: P? Math.round(P.stamina): 100,
diveLight: P && P.diveLight? { charge: Math.round(P.diveLight.charge), on:!!P.diveLight.on}: null,
deployed: dep
};
},
loadState: function (d) {
d = d || {};
this.charges = d.itemCharges || {};
this.equipped = d.equipped || {};
this._savedDeployed = d.deployed || {};
this._pendingDeployed = d.deployed || {};
const P = BR.Player;
if (P) {
P.stamina = d.stamina!= null? d.stamina: 100;
P.adrenalineT = 0;
P.diveLight = d.diveLight? { charge: d.diveLight.charge, on:!!d.diveLight.on}: null;
}
// 运行时态清零（读档=新会话）
this._glows = []; this._chalks = []; this._drops = [];
this._dropSeq = 0; this._dropCharges = {};
this._dropPickedSet = {};
this._cancelChannel(true);
this._wetT = 0;
this.applyAll();
},
resetState: function () {
this.charges = {}; this.equipped = {};
this._glows = []; this._chalks = []; this._drops = [];
this._dropSeq = 0; this._dropCharges = {};
this._dropPickedSet = {};
this._savedDeployed = {}; this._pendingDeployed = null;
this._cancelChannel(true);
this._wetT = 0;
this._diveSpot = null;
this._o2GearOn = false;
},
_recordDeployed: function () {
// 部署物变化后立即刷新存档里的 deployed 桶（不整存，只更新内存；autosave 会落盘）
const st = this.saveState();
this._savedDeployed = st.deployed;
},
// 关卡 build 完成后调用（main.js）：恢复本关的荧光棒/粉笔/丢弃物
// 跨关（gotoLevel→loadLevel 无 saved）：autosave 已把旧关部署物并入 _savedDeployed；
// 这里只清运行时态、把 _savedDeployed 暂存待 onLevelBuilt 恢复；电量/装备/耐力保留。
onTravel: function () {
this._pendingDeployed = this._savedDeployed || {};
this._glows = []; this._chalks = []; this._drops = [];
this._dropPickedSet = {};
this._cancelChannel(true);
this._wetT = 0;
this._diveSpot = null;
if (this._o2GearOn && BR.Player && typeof BR.Player.clearOxygenGear === 'function') {
BR.Player.clearOxygenGear();
this._o2GearOn = false;
}
this.applyAll();
},
onLevelBuilt: function () {
const lv = (BR.Game && BR.Game.level) || 'L0';
const dep = (this._pendingDeployed && this._pendingDeployed[lv]) || null;
this._pendingDeployed = null;
if (!dep) return;
const W = BR.World;
if (!W ||!W.scene) return;
(dep.glows || []).forEach((g, i) => {
if (g.remain > 1) this._spawnGlow('glow_' + lv + '_r' + i, g.x, g.y, g.z, g.remain);
});
(dep.chalks || []).forEach((c, i) => {
this._spawnChalk('chalk_' + lv + '_r' + i, c.x, c.y, c.z, c.nx, c.ny, c.nz, c.ground);
});
(dep.drops || []).forEach((dr) => {
if (dr.charge!= null) this._dropCharges[dr.key] = dr.charge;
this._spawnDrop(dr.key, dr.item, dr.x, dr.z, dr.charge);
});
// 恢复后的 drop key 序号避免碰撞
this._dropSeq = (dep.drops || []).length + 1;
}
};

BR.Items = IT;
})();
