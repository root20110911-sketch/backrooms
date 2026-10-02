# 后室游戏大扩建计划（EXPANSION_PLAN）

> 状态：Phase 0 完成。本地开发，一次性完成后再统一推送 GitHub。**不要推送。**

## 1. 工程评估（2026-10-02 实测阅读结论）

### 架构
- 纯静态多文件站：`index.html` 按序加载 14 个 `<script>`，全部挂 `window.BR` 命名空间；Three.js r128 UMD 走 CDN 三重引用（bootcdn→cdnjs→unpkg，**不许改回本地 vendor，仓库里没有那个文件**）。
- 主循环：`main.js` G.init → `requestAnimationFrame(G.loop)`；状态机 `title/loading/playing/paused/dying/dead/ending`；dt 钳制 0.05。
- 坐标：`BR.TILE=3` 米/tile；`tileCX(tx)=(tx+0.5)*3`；tx 东+x，ty 南+z。

### 种子生成（gen.js，738行，纯逻辑，`node tools/test-gen.js` 可回归）
- `BR.Gen.generate(level, seed)` → map `{level,seed,w:56,h:56,tiles:Uint8Array,rooms:[{id,x,y,w,h,cx,cy,tag}],doors:[{id,tx,ty,axis,locked,label,exitTo}],pois:[{id,type,tx,ty,data}],wallH,meta}`。
- 流程：placeRooms（14~22 不重叠矩形）→ connectRooms（L 形走廊+回环）→ `PLACERS[level](map,rng)` 放 POI/门 → `ensureConnected`（CRITICAL POI 不可达则打通走廊兜底）。
- 铁律：只用传入的 `rng`（`BR.RNG` mulberry32），禁用 `Math.random`/`Date`；同种同关逐 tile 一致（`hashMap` 校验）；`spawn` POI 必须有。
- **已加扩建钩子**：`BR.Gen.registerLevel(id, cfg, placerFn, critical)`（cfg 形如 `{rw:[4,9],rh:[4,9],corrW:[1,2],loops:[2,4],wallH:3.0}`）。

### 区块加载/卸载（world.js，674行）
- 区块 8×8 tiles；加载半径玩家区块 ±2（5×5=25 区块）；每帧最多建 1 区块且总耗时 <10ms（启动 force 模式 9 个）；每帧最多拆 2 区块（超出 ±3 才拆）。
- `W.build(map, savedState)` → 建场景/灯光 → **`BR.Levels[map.level].buildContent(map, W)`** → `BR.Entities.spawnForMap` → force 预建出生点 → resolve。
- 内容必须经 `W.addChunkContent(tx,ty,fn)` 注册（卸载重建时重跑，恢复内容）；门用 `W.addDoor(def)`；交互用 `W.addInteractable({id,kind,meshes,pos,radius,prompt(),canUse(),use()})`；自定义对象必须 `W.reg(group,obj)` 登记否则泄漏。
- 灯光池 ≤5 PointLight；无实时阴影；每区块每材质 1 个 InstancedMesh。
- **坑**：`surfaceAt(x,z)` 忽略坐标（多材质脚步声需先修）；`W.mat()` 统一乘 `0xdbd5c2` 压暗（发光体别走它）。

### 实体 AI（entities.js）
- 三种：hound（L3，巡逻路线 POI）、lurker（L2，区域）、partygoer（FUN）；全部 POI 驱动生成（`spawnForMap`），**新关要怪必须先在 gen 放 POI**。
- 感应：视距 hound 20/13、lurker 11、partygoer 15（低理智<30 时 ×1.35）；状态 patrol→investigate→chase→search→attack；48m 外 AI 停跳（与 chunk 系统无联动）。
- 新实体 type 需在 entities.js 加 builder + spawnForMap 分支。

### 切出/转场（transitions.js）
- `BR.Trans.play(name, opts)`，name：intro/noclip_wall/corridor/ceiling/gate/elevator/fun_escape/fail/fade/drop；30 秒看门狗防黑屏；重叠调用静默吞掉。
- `drop`：1.5s 下坠（extDipY/extRoll/extPitch/extFov 通道）→落地 thud+shake+landDip。**新版统一切出状态机（Phase 2.6）将基于它扩展。**

### 存档（save.js）
- key `backrooms_save_v1`；`{v:1,t,seed,level,px,pz,yaw,hp,hasFlashlight,inv,flags,ws}`；settings 独立 key `br_settings`。**新增字段必须向后兼容（可选字段+默认值）。**
- **坑**：存档无 `sanity`（读档回满）；`gotoLevel(level, opts)` 会吞掉 opts（Phase 2.6 顺手修）。

### 输入/UI
- 触屏：左 38% 浮动摇杆（死区 0.15）、右 62% 视角、5 按钮（手电/蹲/跑开关/交互/暂停），≥44px；`ensureImmersive()` 全屏+锁横屏；`screen-orient` 竖屏遮罩。
- Screens：title/how/loading/pause/note/death/ending/trans；HUD：准星/目标/提示/物品栏/血条/理智条/toast/debug/双暗角。
- 物品：`ITEM_INFO` + `updateInv` keys + `useItem` 三处写死 almond/bandage/flashlight，**新物品三处同步改**。
- 设置：`sens/joySize/joySide/vol/quality/headbob`；**新增** `dropcam: 'full'|'soft'|'off'`（坠落镜头强度）。

### 纹理/音频扩建钩子（已加）
- `BR.Textures.registerTex(name, painterFn)`、`BR.Textures.registerWallTex(level, texName)`；`BR.Audio.registerAmbient(name, builderFn)`（builder 里用 `this._loopRig(R=>{...})`，设 `rig.target`）。

---

## 2. 十 Level 连接图

图例：`[Wiki 有记载]` = 中文维基原设定；`[本游戏改编]` = 游戏原创，LORE/README/游戏内三处注明。

### 现有连接（保留）
| 从 | 经由 | 到 | 依据 |
|---|---|---|---|
| L0 | 异常斑痕墙（触碰） | L1 | [Wiki 有记载] 切出 |
| L1 | 长走廊尽头门 | L2 | [Wiki 有记载] "更长的走廊" |
| L1 | 天花板破洞 | FUN | [本游戏改编] 派对客诱饵 |
| L2 | 未上锁刻痕门 | L3 | [Wiki 有记载] 前人标记的门 |
| L3 | 电梯（3 发电机） | 结局（暗示 L4） | [本游戏改编] |
| FUN | 员工通道（2 线索） | L1 | [本游戏改编] |
| 任意 | 薄墙挤压 1.4s | 同层随机房间 | [本游戏改编] |
| L0 | FUN 涂鸦洞口（极低概率） | FUN | [本游戏改编·新增] |

### 新增 Level 出口（每关 ≥1 可探索发现的离开方式）
| 从 | 经由 | 到 | 依据 | 备注 |
|---|---|---|---|---|
| L188 | 异常窗户（观察窗后灯光差异） | L1 | [本游戏改编] | 需观察，不许挨个试 |
| L188 | 员工室楼梯间 | L11 | [本游戏改编] | 稳定路线 |
| L188 | 休息室收音机调频 | L0 | [本游戏改编] | 静电线索 |
| L37 | 深水区水下通道 | L7 | [本游戏改编] | 水→水 |
| L37 | 浅水区拱洞 | L0 | [本游戏改编] | 观察水深/连接 |
| L94 | 白天老式汽车 | L11 | [本游戏改编] | 白天安全路线 |
| L94 | 夜晚城堡（高风险） | L188 | [本游戏改编] | 冒险路线 |
| L7 | 入口房间 | 返回来处 | [本游戏改编] | 安全参照，可逆 |
| L7 | 深处出口 | L37 | [本游戏改编] | 水→水 |
| L7 | 异常切出点 | L0 | [本游戏改编] | 观察发现 |
| L11 | MEG 指引 | L1 | [本游戏改编] | 对话后 |
| L11 | 地铁 | L2 | [本游戏改编] | 探索发现 |
| L11 | 流浪者信息 | L94 | [本游戏改编] | 信息交换 |
| FUN | 七色滑梯（固定映射） | 见下滑梯映射表 | [本游戏改编] | 原创出口机制 |

### 七色滑梯映射（固定，可重复验证，游戏内留线索）
| 颜色 | 目的地 | 线索形式 |
|---|---|---|
| 红 | L0 | 滑梯旁褪色海报"回家" |
| 橙 | L37 | 梯口水渍 |
| 黄 | L11 | 梯口城市明信片 |
| 绿 | L1 | 梯口绿色荧光标记 |
| 青 | L7 | 梯口咸腥水渍+贝壳 |
| 蓝 | L94（夜间抵达） | 梯口星空贴纸——**危险落点**（夜晚） |
| 紫 | L188 | 梯口窗框碎片 |

### 随机系统
- **裂隙/地洞**：候选池 10 关，权重 L0:15 L1:15 L11:12 L37:12 L188:10 L94:10 L7:8 L2:8 L3:6 FUN:4；`seed + ':rift:' + eventCount` 派生 RNG（可复现）；排除当前关；落地=出生点附近+3s 恢复；[本游戏改编]
- **迁跃浆果**：同候选池；物品说明写"目标随机，可能更危险"；[本游戏改编]（Wiki Object 74 并非随机传送）
- L3 电梯结局保留（现有承诺）；L11 作为"类安全枢纽"承担新人指引职能。

---

## 3. 建造契约（给各 Level 建造者，逐字遵守）

### 文件分工（避免互相覆盖）
- 每关独立新文件：`js/gen_l188.js`（调用 `BR.Gen.registerLevel`）+ `js/lv_l188.js`（独立 IIFE，注册 `BR.Levels.L188`）。
- **不许直接改** `js/gen.js`（钩子已加）、`js/levels.js`（旧关不动）。
- textures/audio 用注册钩子（`registerTex/registerWallTex/registerAmbient`），在本关的 `gen_l*.js` 或 `lv_l*.js` 顶部调用。
- index.html 的 script 标签由 coordinator 统一加（顺序：gen.js 后加 `gen_l*.js`，levels.js 后加 `lv_l*.js`）。

### gen_l*.js 契约
```js
(function () {
  var BR = window.BR;
  // 1. 注册贴图/音频（顶层调用）
  BR.Textures.registerTex('pool_tile', function (ctx, w, h) { /* 256x256 canvas 绘制 */ });
  BR.Textures.registerWallTex('L37', 'pool_tile');
  BR.Audio.registerAmbient('L37', function () {
    var rig = this._loopRig(function (R) { /* R.osc/R.noise/R.filter/R.gain */ });
    rig.target = 0.35; return rig;
  });
  // 2. 注册关卡
  BR.Gen.registerLevel('L37',
    { rw: [5, 10], rh: [5, 10], corrW: [2, 2], loops: [2, 4], wallH: 3.2 },
    function placeL37(map, rng) {
      // 只用 rng！禁用 Math.random/Date！
      // 工具：map.rooms/doors/pois；POI: map.pois.push({id:'p'+map.pois.length, type:'xxx', tx, ty, data:{}});
      // 门：map.doors.push({id:'d'+map.doors.length, tx, ty, axis:'x'|'z', locked:false, label:'', exitTo:null});
      // 必须放 {type:'spawn'}；关键出口 POI 必须可达（ensureConnected 会兜底，但别依赖它）
      // 薄墙：如需，调用 placeThinWalls？——它是 gen.js 内部函数！用 BR.Gen.placeThinWalls？未暴露。
    },
    ['spawn', 'exit_pool'] // CRITICAL：assertConnected 必查可达
  );
})();
```
**注意**：`placeThinWalls` 未暴露——如需薄墙，在 `lv_l*.js` 的 buildContent 里调 `BR.buildThinWalls(map, W)`（已挂 BR），POI 由你自己的 placer 放 `thin_wall`（参考 gen.js placeThinWalls 逻辑：距 spawn≥6、两两≥8）。

### lv_l*.js 契约
```js
(function () {
  var BR = window.BR;
  BR.Levels.L37 = {
    name: 'Level 37 ——「泳池房」',
    theme: { bg: 0x0a1420, fogNear: 8, fogFar: 60, ambient: 0xbfd8e0, ambInt: 0.75,
             sky: 0x9fc8d8, ground: 0x2a4a5a, light: 0xe8f4ff, lightInt: 0.5,
             wallH: 3.2, wall: 'pool_tile', floor: 'pool_floor', ceil: 'pool_ceil',
             surface: 'tile', fixtureEvery: 4, hum: 'water' },
    buildContent: function (map, W) {
      // 遍历 map.pois 按 type 建内容；所有对象经 W.addChunkContent(tx,ty,fn) 注册，fn 内 W.reg(group,obj)；
      // 门用 W.addDoor(def)；交互用 W.addInteractable({id,kind,meshes,pos,radius,prompt(),canUse(),use()})；
      // 出口 use() 里调 BR.Cutout.travel('L7', {kind:'water'})（统一切出状态机，见 §4）；
      // 结尾 W.objective = '...'; 如需薄墙调 BR.buildThinWalls(map, W);
    },
    onEnter: function () { BR.UI.setObjective(BR.World.objective || '...'); BR.Audio.setAmbient('L37'); },
    tick: function (dt) { /* playing 每帧；如需薄墙调 BR.thinWallTick(dt) */ }
  };
})();
```
- theme 字段全（见上）；`surface` 影响脚步音（carpet/concrete/metal/tile/wood）。
- **跨 IIFE 铁律**：新文件是独立 IIFE，只能用 `BR.*` 调共享函数（`BR.buildThinWalls`、`BR.thinWallTick` 可用；`addNote/addPickup/addCrate/buildDoors` 等在 levels.js 第一个 IIFE 里，**不许直接调用**——需要就在自己文件里重写小函数）。
- 出口必须用 `BR.Cutout.travel(to, opts)`（Systems A 提供），不要自己拼 Trans.play+gotoLevel。

### 通用约束
- 性能：区块制，禁止整图一次性建模；PointLight 靠 world 灯光池；新贴图走 Canvas 程序化（无外部素材）。
- 平板：所有玩法支持触屏（交互走 interactable，自动有触屏按钮）；横屏优先。
- 存档：沿用 `W.state`（picked/openedCrates/events）+ `BR.Game.flags`；新字段向后兼容。
- 测试：`tools/test-gen.js` 会加你关卡的断言（确定性+可达）；headless 会跑你关卡的进入/离开。

---

## 4. 系统任务契约

### Systems A：统一切出状态机 + 裂隙 + 滑梯 + 涂鸦（`js/cutout.js` 新文件）
- `BR.Cutout.travel(to, opts)`：opts `{kind: 'walk'|'rift'|'hole'|'berry'|'slide'|'drop', pre: 演出名|null, dropText}`。
  流程：`kind` 专属前段动画（slide=下滑演出/berry=食用眩晕/hole=坠入/rift=被吸入）→ `BR.Game.gotoLevel(to)`（修 opts 吞掉的 bug）→ **抵达演出**：空中出现→视角失衡（extRoll/extPitch 小幅）→地面接近→落地冲击（thud+shake+landDip+第一人称撑地 overlay 文字）→缓慢恢复→交还控制。海洋（to=L7/L37 且 kind 含 water）改坠水专属镜头+声音。
- 抵达前必须等 `loadLevel` 的 build 完成（gotoLevel 已保证 playing）；不许空白坠落/穿模。
- 镜头设置：`dropcam: 'full'|'soft'|'off'`（input settings + 暂停菜单 UI 由你加）；soft=幅度减半+无翻转，off=淡入淡出代替。
- 旧出口迁移：把现有 5 个转场里的 `gotoLevel` 改走 Cutout（小心 `elevator`→结局特殊）。
- **裂隙系统**：`BR.Rifts`：gen 侧各关 placer 放少量 `rift_spot` POI（概率由你定，极低）；levels tick 里按 `seed+':rift:'+count` 决定是否显形（count 存在 save events）；显形前 3-5s 视听征兆（按关卡主题选形式：墙角裂缝/地板洞/变样的门）；可主动进入（interact）可踩空；目的地按权重表；落地恢复 3s；记录 `events.push('rift_'+n+':'+from+'>'+to)`；限制连发（每关每 90s 最多 1 次）。
- **Fun 七色滑梯**：在 FUN buildContent 追加（改 `lv_*.js`？不——FUN 在旧 levels.js 里；给你开权改 levels.js 的 FUN IIFE，**只许追加滑梯区代码，不许动旧逻辑**）。7 条滑梯固定映射（见 §2 表），每条有形状/颜色/痕迹/声音区别 + 线索；`use` → Cutout kind:'slide' 完整过程。
- **L0 FUN 涂鸦**：gen.js 的 placeL0 你**可以**小改（加 8% 概率放 `fun_graffiti` POI + 附近 `fun_hole2` 可爬洞口），这是唯一允许的 gen.js 直接修改（小、局部）。

### Systems B：物品 + 难度 + 基建（改 world.js/ui.js/input.js/save.js/entities.js）
- **迁跃浆果**：`ITEM_INFO.berry` + `updateInv` keys + `useItem` 分支（食用前 toast 警告"目标随机，可能更危险"，确认后 Cutout kind:'berry'）；来源：crate 2% / MEG 赠送 / L94 藏匿点；稀有；存档 inv 本来就存整个对象，无需改 save。
- **world.js kind 注册**：检查 `addInteractable` 是否校验 kind；新关卡需要的 kind（如 `slide`、`npc`、`berry_bush`、`pool_exit`、`window_exit`）在此注册/放行。
- **L0–L3 难度调整**：先写 bot 脚本实际跑（`tools/e2e/diffbot.js`）：从出生走到出口，记录用时/遭遇/伤害/资源；再调：遭遇频率（lurker_zone/patrol POI 数量）、预警时间（hound investigate→chase 的 seen 阈值）、资源分布（crate 物品表）、实体搜索能力（search 时长/范围）、切出点可见度（anomaly_wall 提示距离）。**不许单纯加移速；L0 保持无怪孤独感。**
- **save 兼容**：`snapshot()`/`saveGame()` 加可选字段（`sanity` 也顺手补上——已知坑）；读档 `?? 默认值`。
- **test-gen.js**：扩展到 10 关（LEVEL_CFG 从 BR.Gen 读；CRITICAL 断言）。
- 修 `gotoLevel` 吞 opts 的 bug；修 `surfaceAt` 忽略坐标（多材质脚步声）。

### Docs（最后做，等连接表冻结）
- LORE.md：10 关逐项「原设定/游戏改编」，重点：L188（Fandom 酒店版依据，与 Wikidot 881 明确区分）、L0 FUN 洞口、滑梯、裂隙、浆果、未记载连接。
- README.md：玩法说明（新关卡目标/操作/物品/设置项）。

---

## 5. 测试计划（Phase 4，coordinator 执行）
1. `node --check` 全部 JS；`node tools/test-gen.js` 10 关全过。
2. headless：旧五关进入+主线出口；新五关进入/探索/离开；滑梯 7 色各一次（结果固定）；浆果 3 次（落点在候选池）；裂隙种子复现（同 seed 同 eventCount 同落点）；存档→重载→路线/物品保留；L2/L3/FUN 回归（防 IIFE  bug 重演）。
3. 截图存 `tools/e2e/shots/`。
4. 诚实报告：通过/失败/未测（真机未测必须写明）。

## 6. 任务分工
| # | 任务 | 交付物 |
|---|---|---|
| 1 | Level 188 百窗庭 | `js/gen_l188.js`、`js/lv_l188.js` |
| 2 | Level 37 泳池房 | `js/gen_l37.js`、`js/lv_l37.js`（+游泳机制，见备注） |
| 3 | Level 94 动画 | `js/gen_l94.js`、`js/lv_l94.js`（+昼夜系统+新实体） |
| 4 | Level 7 深海 | `js/gen_l7.js`、`js/lv_l7.js`（+复用游泳机制） |
| 5 | Level 11 城市 | `js/gen_l11.js`、`js/lv_l11.js`（+NPC 对话） |
| 6 | Systems A | `js/cutout.js`、rifts、滑梯、涂鸦、旧出口迁移 |
| 7 | Systems B | berries、kinds、难度 bot+调整、save、test-gen 扩展 |
| 8 | Docs | LORE.md、README.md |

备注：游泳机制（L37/L7 共用）由任务 2 实现为 `BR.Swim` 共享模块（放 `js/lv_l37.js` 里挂 BR 上），任务 4 复用。昼夜系统由任务 3 实现。NPC 对话由任务 5 实现（用 showNote/toast 组合，不新增 screen）。

## §8 追加需求队列（2026-10-02 用户追加，按序执行，全部完成后统一汇报，不推送 GitHub）

### 批次 A（Phase 1-4 完成后）
- A1 桌面端按键提示：HUD 角落常驻精简键位 + 玩法说明完整键位表；覆盖 移动WASD/疾跑/蹲伏/交互/手电/物品使用/暂停；触屏端不显示。
- A2 L0 生成逻辑重改：经典后室观感（开阔半开放空间、黄墙纸+地毯+荧光灯、柱子/半墙遮挡非迷宫走廊），保留孤独感；保持 `BR.Gen.generate('L0', seed)` 接口兼容（pois 类型、返回结构），马尼拉房间/薄墙/FUN涂鸦洞口 POI 不丢；test-gen 全过；截图放 tools/e2e/shots/。

### 批次 B（批次 A 完成后）
- B1 L1 切出点太少：增加数量/可见性，更易发现去路。
- B2 L1 家具与物资拾取：桌子/柜子家具；杏仁水等物资放家具上拾取（拾取交互+物品栏联动），与现有 POI/拾取接口兼容。
- B3 Bug：理智值不掉——先排查根因（drain 逻辑没跑/速率太慢/v1.2 改坏），再修复，实测验证黑暗掉理智+低理智效果触发。
- B4 饥饿值系统：HUD 饥饿条；随时间缓慢下降；食物物资补充；过低负面效果（回血慢/体力降，数值自定）；杏仁水保持回血+回理智；存档保存饥饿值（老存档缺字段给默认值）。

### 最高优先级修复批（2026-10-02 15:04 用户线上实测反馈，Phase 4 测试已暂停、修完重测）
- F1 马尼拉房间无墙之bug：gen carve 真封闭房间（1门）+ levels 建内饰（暖光/地毯/桌子+杏仁水/柜子+绷带/字条）+ 实测截图。
- F2 理智不掉：根因 world.js darknessAt 灯具太密致 dark<0.3 持续回理智；改 dim 区缓掉、回san 更苛刻、断电更快掉；60 秒实测可见变化。
- F3 血量不掉：entities.js 索敌/遭遇率提升（预警保留、不单纯加移速）。
- F4 吃东西没反应：修好 F2/F3 后实测非满状态可喝；饥饿系统（HUD 条/衰减/食物/过低 debuff/存档兼容）一并做，食物拾取→食用链路完整（物品栏点击+数字键）。
- F5 L0/L1 生成重改：先 GitHub 调研后室生成思路（开阔黄房间+柱子+半墙），L0 重写、L1 看一眼；B1（L1 切出点更多更可见）并入；B2（L1 家具）并入 F1；test-gen 全过；改前改后截图对比。
- 之后：重派 Phase 4 集成测试 → A1 桌面按键提示 → 统一汇报（仍不推送）。
