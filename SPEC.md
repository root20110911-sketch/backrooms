# SPEC.md —— 模块接口规范（内部）

所有 JS 文件均为普通 `<script>` 引入（非 ES module），按顺序挂载到全局 `window.BR`。
Three.js r128（UMD，全局 `THREE`）。不要使用 r128 不存在的 API。

**脚本加载顺序**（index.html，Three.js r128 走 CDN 三重回退）：
`three.min.js(CDN) → config.js → utils.js → items.js → textures.js → audio.js → gen.js → gen_l4.js → gen_l188.js → gen_l37.js → gen_l372.js → gen_l7.js → gen_l11.js → gen_l25.js → gen_bang.js → gen_l6.js → world.js → player.js → input.js → entities.js → transitions.js → cutout.js → levels.js → levels2.js → lv_l4.js → lv_l188.js → lv_l37.js → lv_l372.js → lv_l7.js → lv_l11.js → lv_l25.js → lv_bang.js → lv_l6.js → sanityEvents.js → ui.js → dev.js → save.js → main.js`
（`gen_l94.js` / `lv_l94.js` 已退役，不再加载，保留作历史参考。）

## 全局约定
- `BR` 命名空间；`BR.log(...args)` 调试输出（`?debug=1` 或 localStorage `br_debug=1` 时进 console）。
- 坐标：tile `(tx,ty)`，`tx` 向东为 +x，`ty` 向南为 +z。世界坐标：`x=(tx+0.5)*T`，`z=(ty+0.5)*T`，`T=3`（米）。
- `BR.TILE = 3`。
- 关卡 id：`'L0','L1','L2','L3','FUN','L188','L37','L372','L7','L11','bang','L4','L6','L25'`（共 14 个；`'L94'` 已退役，老存档自动迁移到 `'bang'`）。
- 事件总线 `BR.bus = { on(ev,fn), emit(ev,data) }`（utils.js 提供）。
- 主循环由 main.js 驱动：`BR.Game.tick(dt)` 调用各模块 `update(dt)`。

## config.js
- `BR.Config = { TILE:3, EYE:1.62, CROUCH_EYE:1.0, RADIUS:0.35, WALK:3.4, RUN:5.4, CROUCH:1.7, qualities:{low,mid,high}, ... }`
- `BR.QUALITY` 当前画质档（main.js 根据设置/设备设置）。

## utils.js
- `BR.RNG` 类：`constructor(seed)`；`next()` [0,1)；`int(a,b)` 闭区间；`range(a,b)`；`pick(arr)`；`shuffle(arr)`；`chance(p)`。
- `BR.hashSeed(str)→uint32`；`BR.clamp(v,a,b)`；`BR.lerp(a,b,t)`；`BR.damp(a,b,k,dt)`。
- `BR.Bus`：`on(ev,fn)` / `emit(ev,data)`。
- `BR.$ (id)` 取 DOM；`BR.el(tag,cls,html)` 建元素。

## textures.js —— 程序化贴图（Canvas 生成，原创）
- `BR.Textures.init()` 预生成并缓存。
- `BR.Textures.get(name)→THREE.CanvasTexture`（wrap repeat，anisotropy 4）。
- 贴图名（必须全部提供）：`wallpaper`（泛黄墙纸+竖纹+污渍）、`carpet`（潮湿地毯+深色水迹）、`ceiling`（吊顶方格）、`fluor`（荧光灯面板）、`concrete`（混凝土墙）、`concreteFloor`（混凝土地面）、`pillar`（混凝土柱）、`brick`（棕色砖墙）、`tileFloor`（灰色瓷砖地）、`metal`（金属天花板/墙）、`doorMetal`（钢门）、`crate`（木板条箱）、`pipe`（管道）、`partyWall`（彩色派对墙）、`partyFloor`（格纹地）、`posterFun`（TIME 4 FUN 海报）、`smiley`（血笑脸）、`stain`（墙面异常斑痕）、`balloon`（气球）、`cake`（蛋糕）、`exitSign`（绿色应急灯牌）、`note`（纸条）、`rustFence`（铁栅栏）、`void`（纯黑）。
- `BR.Textures.makeWallMaterial(level)→THREE.MeshLambertMaterial` 供 world 使用（内部缓存，dispose 时不删共享）。

## audio.js —— WebAudio 合成音频
- `BR.Audio.init()`（首次用户手势调用；幂等）。
- `BR.Audio.setVolume(v)` 0..1；`BR.Audio.setMuted(m)`。
- 环境：`BR.Audio.setAmbient(level)` 切换关卡底噪，内部交叉淡化；各关卡经 `BR.Audio.registerAmbient(name, builderFn)` 注册（已注册：L0/L1/L2/L3/FUN 核心 + L188/L37/L37_channel/L37_uw/L7/L7_uw/L11/BANG/L4/L6/L25）。
- 位置循环声：`BR.Audio.addLoop(id, type, x, z, gain)` / `removeLoop(id)` / `updateListener(x,z,yaw)` 每帧调用。type: `'hum'`（荧光灯）、`'buzz'`、`'steam'`、`'machine'`、`'flicker'`。
- 一次性：`footstep(surface)` surface∈carpet/concrete/metal/tile/wood/water；`doorOpen()` `doorLocked()` `doorCreak()`；`pickup()` `drink()` `paper()` `valve()` `steamBurst()` `elevatorDing()` `elevatorRumble()` `glitch()` `stinger()` `heartbeat()` `giggle()` `growl()` `bark()` `whisper()` `whisperDeep()` `uiClick()` `checkpoint()` `splash()` `knock()`；游泳/划水/入水/出水系列音效；马尼拉钢琴 `manilaPianoStart/manilaPianoStop/manilaPianoLevel(v)`。
- 音乐：`BR.Audio.partyStart()` / `partyDegrade(stage)` / `partyStop()`；马尼拉钢琴曲（WebAudio 合成摇篮曲循环）。
- 闪烁事件：`BR.Audio.blackoutStart()` / `blackoutEnd()`。
- 全部合成，无外部音频文件。

## gen.js —— 随机地图生成（纯逻辑，可在 Node 测试）
- `BR.Gen.generate(level, seed)→map`。seed 为 uint32。
- map 结构：
  ```
  { level, seed, w, h, tiles:Uint8Array /*0墙 1地*/,
    rooms:[{id,x,y,w,h,cx,cy,tag}], // tag: 'spawn','exit','poi','party',...
    doors:[{id,tx,ty,axis,locked,label,exitTo}], // exitTo: 'L1'|'L2'|'L3'|null
    pois:[{id,type,tx,ty,data}], // 见下
    wallH:Number, // 本关墙高
    meta:{...} }
  ```
- POI type（gen 负责放置位置，levels.js 负责内容）：
  - L0: `spawn`, `anomaly_wall{tx,ty,dirx,dirz}`（异常墙位置+法线）, `red_room`, `note`
  - L1: `spawn`, `crate`（多个）, `note`, `blackout{cx,cy,r}` 触发区, `safe_room`, `exit_corridor{tx,ty,dirx,dirz}`（长走廊起点）, `fun_hole`, `landmark`（定居点地标）
  - L2: `spawn`, `steam{tx,ty,dirx,dirz,len}`, `valve`, `exit_door`（door.exitTo='L3',带marker）, `locked_door`×N, `void_door`, `crate`, `note`, `lurker_zone`
  - L3: `spawn`, `patrol`（一组waypoint pois，data:{route:0}), `elevator{tx,ty,dirx,dirz}`, `power_room`, `crate`, `note`, `fence_zone`
  - FUN: `spawn`, `partygoer`（多个出生点）, `clue`, `fun_exit`, `cake_table`
- `BR.Gen.reachable(map, sx, sy, tx, ty)→bool` BFS（门视为可通过）。
- 门位 axis 语义（v2.2 W-doors 修正；与 world.js `buildDoorMesh` 渲染语义一致，`gen.js:findDoorSpot` 注释即契约）：
  - 门扇与所在墙**共面**：南北墙（墙沿 X 走向）用 `'x'`（门扇不旋转），东西墙（墙沿 Z 走向）用 `'z'`（绕 Y 旋转 90°）。
  - 历史 bug：四面全写反（南北墙给'z'、东西墙给'x'），门侧着嵌进墙里。2026-10-17 玩家反馈「门全斜」即此因。
- `BR.Gen.assertConnected(map)→{ok, missing:[...]}` 检查 spawn 到所有关键 POI 可达。
- 生成器必须保证：同一种子同关卡结果完全一致；关键 POI 全部可达（否则打通走廊重连）。
- `BR.Gen.hashMap(map)→string` 用于测试比较（房间图+POI 的哈希）。

## items.js —— 道具注册表与部署物
- `BR.Items.CONFIG`：全部可调数值（策划调这里，不碰逻辑）；`BR.Items.DEFS`：9 种 v1.5 新增道具定义（能量棒/急救包/荧光棒/标记粉笔/便携氧气瓶/水下照明灯/救生衣/防水物资袋/肾上腺素）；13 种旧道具（杏仁水/绷带/手电/迁跃浆果/食物/香烟/口香糖/皇家口粮/笑魇驱散剂/火盐/痛液/腰果水/备用电池）在 ui.js 的 ITEM_INFO。
- kind：`'use'`（消耗）/ `'equip'`（装备开关）/ `'deploy'`（部署到世界：荧光棒/粉笔/腰果水陷阱）/ `'device'`（设备开关）。
- 跨关部署物恢复（P0-3）：`BR.Items.onTravel()`（跨关前：清运行时态，把 `_savedDeployed` 暂存；电量/装备/耐力保留）→ `BR.Items.onLevelBuilt()`（新关建完：消费 `_pendingDeployed` 恢复部署物）。读档路径：`loadState`（填）→ `onLevelBuilt`（消费）。调用顺序由 main.js 保证，顺序错则回滚保护。
- `BR.Container`：通用两段式容器（开柜→看内部→逐件拾取），L4 文件柜 / L7 舱室储物柜 / 马尼拉桌下柜共用，`autosave:true` 跨读档持久。

## world.js —— 场景/区块管理
- `BR.World.build(map, savedState)`：清旧场景，建新场景；返回 Promise（分帧构建）。
- `BR.World.dispose()`：释放本关资源（几何体/实例/灯光/实体），**保留** Textures/Audio 共享资源。
- 区块：`CHUNK=8` tiles；`BR.World.update(dt, px, pz)` 按距离加载/卸载，每帧预算：建 ≤1 区块，拆 ≤2 区块。
- `BR.World.collide(pos, radius)→pos` 原地修正（pos 为 THREE.Vector3，脚底）。
- `BR.World.isWall(tx,ty)`；`BR.World.tileAt(x,z)→{tx,ty}`；`BR.World.surfaceAt(x,z)→surface名`。
- `BR.World.los(ax,az,bx,by)→bool` tile 网格视线（实体用）。
- 交互：`BR.World.interactables` 数组；`BR.World.rayInteract(o,d,maxD)→{it,dist,point}|null`；每项 `{id,kind,mesh,pos:Vector3,prompt(),canUse(),use()}`。**门交互 radius 3.2**（v2.3 W-hotfix：2.2→3.2。根因：`rayInteract` 按「射线命中点距离 > `it.radius`」过滤，而玩家站在门相邻 tile 瞄准门扇中心时命中距离恒为 ~2.94m；radius=2.2 时所有 `axis='z'` 的门永远被过滤掉、按 E 无反应。门扇 mesh 未动。）
  kind 含：`door/crate/pickup/note/valve/elevator_door/elevator_btn/anomaly_wall/fun_hole/fun_exit/cake` + 各关扩展（`l6_switch`、`cabinet`、`manila_cab`、`exit_door` 等，由 lv_*.js 注册；统一经 INTERACT_KINDS 分发）。
- L0 无限延伸（v1.5.1）：`W.tile` 越界 L0 走 `BR.Gen.l0InfiniteTile(seed,tx,ty)` 程序化生成；区块构建去掉 L0 的边界上限。
- 门：`BR.World.setDoor(id, open, instant)` 播动画；`BR.World.doorState(id)`。
- 门系统（v2.2 W-doors 重写，`world.js:doorStyleFor`/`buildDoorMesh`）：门框四边与墙共面、铰链轴取自 `door.axis`；9 种按关卡风格：L0 黄木门（`door_wood_yellow`）/ L1 混凝土（`door_concrete`）/ L2 管道金属（`door_metal_pipe`+铆钉）/ L188 深色雕花（`door_wood_dark`+carve）/ L4 玻璃（透明度 0.38+中轨）/ L37 白瓷推拉（`door_tile_white`，推拉动画）/ L6 钢（`l6_door_steel`）/ FUN 派对红（`door_party_red`）/ L3 锈蚀金属；未知层级回退灰色金属。纯视觉改编，无 lore 依据。
- L37 水下通道低板 3D 条件碰撞（v2.3 W-hotfix）：tile 碰撞系是 2D 的，低板是按 tile 的 Y 条件特例（`W._slabTiles`，跨关不残留）——头顶高于低板底（y 0.8~1.05）时水平进入低板 tile 视为撞墙；须下潜（头顶 < yBot）才能从下方穿过；已在低板下/外则不受限，不会困住玩家。
- `BR.World.getStats()→{fps,chunks,roomsVisible,entities,seed,drawCalls,tris}`。
- `BR.World.onChunk(fn)` 注册区块加载回调（levels 用来放事件触发器）。
- 状态恢复：`savedState={openedDoors:[ids],picked:[ids],openedCrates:[ids],events:[ids]}`；build 时跳过已拾取/已开。
- 状态上报：`BR.bus.emit('picked',{id})` 等，save.js 监听。

## player.js
- `BR.Player.reset(x,z,yaw)`；`BR.Player.update(dt, input, world)`。
- 属性：`pos`（Vector3 脚底）、`yaw/pitch`、`crouching/running`、`noise`（0..1 本帧噪音）、`hp`、`stamina`、`sanity`、`hunger`、`thirst`。
- 玩家状态机：步行 / 空中 / 浅水 / 游泳 / 水下 / 乘船 / 乘鸭子 / 转场 / 失去行动能力。游泳为三维自由游泳：俯仰斜游、平滑加减速、无输入中性浮力悬停；潜水服微下沉、救生衣缓上浮。
- 理智：安全屋 +5/s；断电 −2.5/s；真黑区（dark>0.55）−(1.2+dark×2.2)/s；dim 区（0.1–0.55）−0.25/s；明亮区（dark<0.1，手电开/灯下 5m 内）+0.3/s。
- `BR.Player.camera`（PerspectiveCamera）；`BR.Player.hasFlashlight`、`flashlightOn`（`toggleFlashlight()`，开灯耗电）。
- `BR.Player.hurt(n, cause)` → bus 'hurt'；`heal(n)`；`drainSanity(n)` / `restoreSanity(n)`（开发者模式无限理智时直接跳过）。
- 脚步：按移动距离触发 `BR.Audio.footstep(surface)`；surface 来自 world。
- 镜头：headbob、跑步 FOV、落地顿挫 `landDip()`、受击抖动 `shake(amt)`。

## input.js
- `BR.Input.init(canvas)`；`BR.Input.update()`。
- 默认键位：`fwd/back/left/right`=WASD+方向键，`run`=Shift，`dive`=C（蹲/下潜），`jump`=空格（跳/上浮），`interact`=E+鼠标左键，`backpack`=Tab/I，`flashlight`=F，`thirdperson`=V，`pause`=Esc。**快捷栏（数字键/Q）已于 v1.5.1 删除**，使用物品统一走背包。
- 改键系统：全部动作可改键，冲突处理，`localStorage` 持久化，`sanitizeBindings` 自动丢弃已删除动作的老键位。
- 触控：左摇杆（动态原点+死区0.15+滑出跟随）、右侧拖动视角；v2.1 分区：`#touch-sys`（右上 mini 横排常驻：暂停/背包/手电/疾跑开关/第三人称）+ `#touch-btns`（右下主操作区：交互大钮常驻但情境高亮，蹲下 land-only，下坐骑 mount-only）+ `#touch-jump-cluster`（跳跃/上浮 big，下潜 swim-only，坐骑时整簇隐藏）。v2.0 P1 情境化规则延续：用不到的按钮不长期占屏。**无"道具"按钮**（v1.5.1 起道具只走背包；`ui.js` 触屏键位文案已同步清理，不再提"道具"）。
- `BR.Input.setLocked(b)` 转场/菜单时锁定；多点触控按手指 ID 分配。

## entities.js
- `BR.Entities.spawn(type, x, z, opts)→ent`；type: `hound`(L3)、`partygoer`(FUN)、`lurker`(L1/L2)。**观察者（watcher）已于 v2.3 明确退役**：buildWatcher / updateWatcher / watcherAggressive / 旧 buildLeviathan / updateLeviathan / watcher POI 分支全部删除（约 180 行死代码），`entities.js` 内已无 watcher/leviathan 运行时引用（`tools/test-entity-v23.js` Part 4 源码断言）。理由：观察者是 Level 94「动画」的标志性实体，L94 已于 v1.5 W6 退役，硬塞进其他关卡不符合原著定位。
- 遭遇光谱（v2.3 W-entity）：所有敌对实体共享 `alert` 0→1→2→3，**永不跳级**，脱离→search→hide 后 alert 归 0（平静恢复）。0 未察觉 / 1 环境痕迹·远处目击（潜伏者 28m 一次性耳语+抬头一瞥 1.8s + 巢穴 3 道抓痕 decal；猎犬 34m 远处低吼+停步注视 1.5s；派对客 26m 远处咯咯笑+歪头 1.2s）/ 2 警告（潜伏者 12m 目视→1.2s 凝视预警，退开作罢；猎犬 investigate 1.5s 窗口；派对客 stalk 可蹲伏 4s 劝退）/ 3 危险（stalk→追击；`hd > zoneR+8` 脱离→search→hide）。
- L1 潜伏者落点：出口走廊起点房间、走廊起点 tile 2~4 格环内（原为随机黑暗区房间，玩家直奔出口可能整关见不到）。L6/L4 不加怪（设计决议）。
- 七层之物（L7）：真 AI 状态机（dormant→lurk→stalk→strike→retreat），实现在 `js/lv_l7.js`（initEntity）；`nextLurk` 初值 55+40（55~95s，v2.3 提前首潜）；POI `leviathan_route` 仅作环境演出锚点。
- Level ! 追逐者：实现在 `js/lv_bang.js`（BFS 沿路线真追逐，非 entities.js 通用状态机）。
- ent: `{type, group, pos, state, update(dt, ctx)}`；ctx=`{playerPos, playerNoise, crouching, flashlightOn, los:boolean, dt}`。
- 状态机含：`patrol/suspicious/chase/search`（hound）；`idle/wander/notice/approach/attack/lose`（partygoer）；`watch/flee/hide`（lurker）。
- 程序化动画：行走摆腿/摆臂、转身（partygoer 头先转）、察觉（抬头/僵直）、攻击（前扑+手臂伸长）。
- `BR.Entities.update(dt, ctx)` 只更新活跃（与玩家 <45m 且所在区块已加载）；`BR.Entities.countActive()`。
- 抓到玩家 → `BR.bus.emit('caught',{by})`，transitions 接管失败演出。
- `BR.Entities.dispose()`。

## transitions.js —— 转场/事件演出（全部锁定输入、可跳过长演出、有看门狗防黑屏）
- `BR.Trans.play(name, data)→Promise`。name:
  - `intro` 开场切入（下坠→落地 L0）
  - `noclip_wall` L0 异常墙 → L1（含前兆→接触→穿透→落地）
  - `corridor` L1 长走廊尽头门 → L2（环境渐变+穿门）
  - `ceiling` L1 天花板破洞 → FUN（攀爬→坠落→彩带）
  - `gate` L2 出口门 → L3（开门→跨门槛）
  - `elevator` L3 电梯 → 主线结局动画（白光）
  - `fun_escape` FUN 员工通道 → L1（检查点）
  - `fail` 被抓/死亡 → 失败画面（transitions 只做演出，UI 由 ui.js 显示）
  - `fade` 通用淡入淡出 `play('fade',{dir:'in'|'out',dur})`
  - `drop` 切出坠落通用演出（`BR.Cutout.travel` 默认 kind）
  - 注：旧文档中的 `blackout`（L1 闪烁事件）已并入关卡内事件系统，不再是独立转场名。
- 每个演出：`BR.Input.setLocked(true)` 开始，结束恢复；`BR.Game` 负责关卡切换的实际 world 重建（transitions 发起 `bus.emit('level:switch',{to, spawnPOI})`）。
- 看门狗：演出超过 30s 未结束 → 强制淡入恢复控制并 log。

## 通风管 —— 固定映射切出点（v2.2 W-exits）
- 映射（`js/levels.js` `BR.VENT_ROUTES`，文档即契约）：L0→L1（绿）/ L1→L2（琥珀）/ L2→L3（蓝）；边框色即目标层，玩家可学。
- 实现：`buildVents(map, W, level)`（levels.js 共享，经 `BR._lvShare` 给 levels2.js 用）；种子确定性放置（`seed+':vent:'+level`）；
  格栅贴墙、不压 POI/门、离出生点 ≥5 格、从出生点可达；交互 `kind:'vent'` → `BR.Cutout.travelTo(dest, {mode:'door'})`。
- 每层第一根管子旁有 "M.E.G. 通风管路图" 字条（三色→三层对照表）。
- v2.2 修复：`buildVentGrate` 把 interactable 的 `meshes:[Group]` 注册改成 `traverse` 展平成 mesh 数组——three r128 `Object3D.raycast` 为空且游戏 raycast 非递归，之前玩家实机永远瞄不中通风管（只能 `it.use()` 直调）。该 bug 在 W-play 真实瞄准+E 走线中暴露。
- 出口可发现性（同版本）：L1 长走廊——灯牌加大双面、走廊口绿光、尽头冷光+门缝光带、管线渐密（LORE 依据）、
  常驻双电流声引导（`buzz` 走廊口 + `machine` 尽头，60m 衰减）；L0 主出口——灯牌加大双面、绿色光柱、点光增强、常驻电流声。
  常驻循环声经 `ensureLoopCleanup(W, ids)` 包 `W.dispose` 做跨关清理（world.js 非本 worker 领地，不改其源码）。

## levels.js / levels2.js —— 各关内容装配
- `BR.Levels = { L0, L1, L2, L3, FUN, ... }`（lv_*.js 追加 L4/L6/L25/L7/L37/L11/L188/bang；L94 已摘除），每关：
  - `theme`：`{wall, floor, ceil, wallH, fog, fogNear, fogFar, bg, light, ambient, hum, surface, fixtureEvery, ...}`。
  - `buildContent(map, world)`：按 pois 生成内容，注册 interactables。
  - `objective(map)→string` HUD 目标提示；`notes` 笔记文本库；`onEnter()` 进入事件。
- L0（v1.5 W2 分区式重做，v1.5.1 无限延伸）：4×4 分区性格施工（开阔/隔断/柱密/狭窄）+ 56×56 外无限程序化生成；马尼拉房间（安全屋，钢琴 32m 可闻/14m 正常）；farRoom 主出口金属门（EXIT 灯牌→L1）；异常斑痕墙（→L1）；FUN 涂鸦洞口（8%）。
- L3 结局：电梯 → 主线结局演出（白光/现实），之后可继续探索或回主菜单。

## 扩建关卡（v2.0：L4 / L6 / L25）
三关均走标准 `BR.Gen.registerLevel` + `BR.Levels` + `BR.Cutout.registerRiftDest` 登记；
gen 在 `js/gen_l*.js`（纯逻辑，`node --check` + `tools/test-gen.js` 可验），内容装配在 `js/lv_l*.js`。

### Level 4「废弃办公室」（gen_l4.js / lv_l4.js）
- POI：`spawn` / `exit_elevator` / `exit_stair` / `exit_garage` / `cabinet` / `note`
  （critical 全可达）；另 `vending` / `window`（陷阱）/ `ornate_door` / `hum_zone` / `watercooler` / `thin_wall`。
- 机制：文件柜 `BR.Container` 两段式（开柜→逐件拾取，`autosave:true` 跨读档持久）；
  贩卖机（买杏仁水）；未封死窗户陷阱（靠近 3s 掉理智）；嗡鸣区；雕花木门（推开→走远 16m 消失，记 `l4_ornate_gone`）；
  耳语事件；电梯呼梯两段式（呼梯开门→走进）。
- 出入口：`exit_elevator`→L3（呼梯后走进，置 `flags.l4_completed`）；`exit_stair`→L2；`exit_garage`（B1 坡道）→L1。
  涂鸦真提示指向 `exit_elevator`；安全点涂鸦指向 `spawn`。随机裂隙权重 10。
- 存档：走按关 ws（`events`/`picked`/`openedDoors`/容器 `autosave` 自动持久）；`flags.l4_visited` / `flags.l4_completed`。

### Level 6「熄灯之时」（gen_l6.js / lv_l6.js）
- POI：`spawn` / `l6_stairwell`（critical，原著连接，保证可达）；
  另 `l6_switch`（停电开关）/ `l6_machine` / `l6_emlight` / `l6_flash` / `l6_glow` / `crate` / `note` / `thin_wall`。
- 机制：全关熄灯黑暗（`darkT` 计时）+ LED 指路；停电开关（`INTERACT_KINDS` 新增 `l6_switch`，
  拨动记 `ws.events['l6_switch']`）；模仿声音（mimic 区耳语，`stalkT` 追踪事件，掉理智）。
- 出入口：`l6_stairwell`→L7（原著连接，`travelTo('L7',{mode:'door'})`，置 `flags.l6Escaped`）。
  涂鸦真提示指向 `l6_stairwell`，真提示词表 `G_TRUE_EXIT_L6=['follow the waves','listen for the sea','down the stairs']`。
  随机裂隙权重 6。
- 存档：开关/逃脱状态走 `ws.events` + `flags` 透传，无新字段。

### Level 25「街机枢纽·Quarter Hub」（gen_l25.js / lv_l25.js）
- POI：`spawn` / `cab_t37` / `cab_t11` / `cab_t188`（critical：红/橙/蓝跨关机，POI 落前方地板保证可达）；
  另 `cab_weird` / `quarter`（游戏币）/ `note` / `crate` / `thin_wall`。
- 机制：街机状态机（work/inspect/weird/broken/off/tether）；投币玩小游戏（5 连击获胜）；
  跨关机必须先"看清机身标签"（观察→`seen` 置位）再投币获胜才传送；红机=「L37——小心水」→L37，
  橙机=「11」→L11，蓝机=星星标签「188」→L188。异常机（`cab_weird`）纯吓人。
- 出入口：`cab_t37`→L37、`cab_t11`→L11、`cab_t188`→L188（均为观察+投币+获胜三段式）。
  涂鸦真提示指向 `cab_t37`，固定文案「红机去 37，橙机去 11，蓝机去 188——先看清机身上的标签再投币」。
  随机裂隙权重 10。
- 存档：`ws.l25={coins, mach:{cabIdx:{seen,plays,wins,st}}}`；`save.js validate` 缺省回填 `{coins:0, mach:{}}`，
  `mach[idx].seen` 保证"看过标签"跨读档不丢失。

## ui.js
- `BR.UI.show(name, data)` / `hide(name)`。screens: `menu/loading/hud/pause/notes/fail/ending/toast/debug/backpack`。
- `BR.UI.setPrompt(text|null)` 交互提示（准星对准可操作对象时显示）；`BR.UI.setObjective(text)`；`BR.UI.toast(text)`。
- 背包（v1.5.1 起唯一使用入口）：空显示空白面板；单击道具直接使用（`use` 直接消耗并保留 guard、`equip/device` 切换、`deploy` 进放置模式）。HUD 快捷物品栏已删除。
- 物品使用经 `BR.UI.useItem(id)`（迁跃浆果：`seed+':berry:'+count` 派生 RNG，可复现）。
- 暂停菜单：设置项（灵敏度/音量/镜头晃动/减镜头震动/坠落镜头/低理智特效/摇杆大小/摇杆位置/画质）、改键列表、种子显示、存档操作、开发者选项入口。
- debug 面板：`BR.UI.debugStats(stats)` 每 500ms 更新（`?debug=1` 或 `br_debug=1`）。
- 所有按钮 ≥44px 触控目标；`touch-action:none`。

## save.js
- `BR.Save.save(slot)` / `load()` / `clear()` / `exists()`。写入 key：`backrooms_save_v2`（P0-2 按关卡持久化）；`backrooms_save_v1` 只读（迁移用）。
- v2 结构：`{seed, level, pos, hp/sanity/hunger/thirst, inv, flags, ws: {<levelId>: {openedDoors, picked, openedCrates, events, 容器/部署物/关卡私有字段}}}`。返回旧关时按关恢复。
- 老存档 `level='l94'/'L94'` 自动迁移到 `'bang'`；v1→v2 一次性迁移。
- checkpoint：进入每关/进入 FUN/电梯前 自动写检查点（内存+存档）。
- `BR.Save.respawn()` → 回到检查点（重建关卡+恢复状态）。
- `BR.Save.validate`：缺失字段缺省回填（如 `l25:{coins:0,mach:{}}`）。

## dev.js —— 开发者模式（v1.5.1；v2.2 W-dev 重写冻结语义）
- 暂停菜单底部「开发者选项」→ 密码框（密码 `muse`）→ 开发者面板。
- 面板三独立作弊开关：**无限体力** / **无限理智** / **无限生命**（v2.2 新增第三项）。冻结语义（用户原话「直接锁住，直接冻结 999 个」）：
  - 开启瞬间把对应数值设为 `999`（`Dev.FREEZE=999`）；`player.js` **每帧末尾** pin 住 999（`infStamina→stamina=999 & _staminaOut=false`、`infSanity→sanity=999`、`infHp→hp=999`），任何绕开钩子的直接扣减（腰果水、L4 未封窗、饥饿等）都在帧末被纠正；
  - 对应钩子同时短路：体力不扣不回、理智 drain/restore 跳过、伤害 `hurt()` 提前返回（**锁血，不是无敌穿墙/免死**）；
  - sanity=999 时低理智特效（耳语/暗角/视线游移）不触发。
- 14 关传送表（L0/L1/L2/L3/L4/L6/L7/L11/L25/L37/L37.2/L188/Level!/FUN，v2.1 加入 L372）：落点经 W-dev 逐一验证安全；走 `BR.Cutout.travelTo(level,{mode:'none'})`（面板内从暂停菜单直传时先 `togglePause(false)` 恢复 playing）。
- 作弊开关状态走 `localStorage`（key `br_dev_*`）持久化，刷新后仍保持；隐私模式等 localStorage 异常时静默降级为会话级。刷新后需重新输密码进入面板（密码本身会话级，不污染存档）。
- 回满状态按钮：体力/理智/生命/饥饿回 100（不是 999，区分冻结与回满）。

## main.js
- `BR.Game.init()`；`newGame(seed?)`；`continueGame()`；`switchLevel(to, opts)`；`gotoLevel(to, opts)` / `loadLevel`（P0：加载保护——失败/超时/重复切关有状态回滚与重试入口，不永久卡加载页）；`BR.Game.tick(t)` 主循环（dt clamp 0.05）。
- 跨关语义（P0）：新游戏初始化 / 死亡重生 / 读档恢复 / 普通跨关四者区分；**普通跨关保持生命/理智/饥饿/手电电量/装备连续性，不重置为满**。
- 状态：`menu/loading/playing/transition/paused/fail/ending`。
- `BR.Game.locked` 输入锁定；失焦自动暂停（visibilitychange）。
- 画质应用：pixelRatio、雾距离、灯光数；`?quality=low|mid|high` 覆盖；平板默认 mid。
- `window.BR.debug = { game, world, player, gen, tp(x,z), give(item), trigger(name) }` 供自动化测试。

## v2.1 机制（2026-10-17，审计整改）

### Level 188 真垂直二层（gen_l188.js / lv_l188.js）
- v2.0 的"二层"实为同平面远端 tile=2 区域 + 淡入淡出传送冒充（见 tools/AUDIT_V21.md §1a①），v2.1 改为**真垂直二层**：与 1F 同 footprint 的 f2t 层、二层楼板 3.57m、真实可走楼梯坡道（视觉 18 级台阶 + 弦杆 + 扶手 + 栏杆柱，`meta.l188f2.stair` 给出 z0/z1，`l188StairY` 按 z 插值 0→F2Y）。
- 楼层状态 `W._l188floor`（0/1）被碰撞/地面高度/交互遮挡**真实读取**（存档 `W.state.l188floor`，`save.js validate` 缺省回填）；`W._l188onF2` 保留为兼容别名（v2.0 时写而不读，现为真实楼层态）；楼层闩在坡道半高处翻转；老存档非法位置在 onEnter 安全回落。
- 阳台栏杆与庭院水池沿补碰撞（v2.0 审计：纯 decor 可穿过）；客房双吊顶清理（3.4m 降吊顶保留，12m 引擎吊顶不再叠加）；104 扇窗四态系统保留。

### Level 37 池核重制（gen_l37.js / lv_l37.js）
- 4 种新池核空间：下沉庭院 / 半淹没大厅 / 浸水台阶厅 / 水下连通水道（水深参与建筑生成，gen 纯逻辑 `BR.Gen.L37waterAt` Node 可测）。
- 水面接缝根本修复（v2.0 审计：相邻 chunk 共享边 destination-in 双重淡出形成细缝线）；水下仰视层；柱体水线圈；按深度分层水体 tint。
- **Sunlit Gate**：POI `sunlit_gate` + `meta.l37.gate`（墙上暖白发光开口）→ 传送到 L372「阳光泳池」；返回落点对应。

### Level 37.2「Sunlit Pools」（gen_l372.js / lv_l372.js，v2.1 新增）
- 原型：Fandom Backrooms Wiki Level 37.2 "Sunlit Pools"；**露天蓝天/可见太阳/天空之境倒影为本游戏改编**（原著只有墙面矩形开口的粉色光，开口外是白色虚空），文档与 LORE.md 明确标注为改编。
- 内容：白瓷砖浅水厅（及膝深清水）/ 干燥平台 / 粉色开口光；Pinnicorns（充气浮具状无害实体，纯装饰）；黑暗开口 → 返回 L37（Fandom 主站出口依据）。
- 跨关接线：`BR.Game._cameFrom` 契约——出发关在 `travelTo` 前置 `_cameFrom` 为自身 id，目的关 `onEnter` 读取并搬运到对应落点（L37↔L372 双向）。

### Level 7 四带按真实垂直深度（gen_l7.js / lv_l7.js）
- v2.0 的四带按到入口舱室中心的**水平** tile 距离划分（同心圆，审计 §3a），v2.1 改为按玩家**真实下潜深度**：日光 <12m / 暮光 12–30m / 午夜 30–55m / 深渊 ≥55m（游戏尺度改编，原著公里级深度压缩）。
- 连续海底地形（浅海台地 → 断崖 → 深沟 → 深渊），视觉与物理海床统一；游泳防穿海床（`player.js` 下潜下限按地形钳制）。
- v2.2 W-l7floor：`floorYAt` 高度查询新增**舱室内部 tile 分支**——`inTileRect(x,z,gm.entry)` 返回 0。根因：此前缺此分支，舱室 tile 落到开放水域分支返回海床高度（约 -3~-6m），而视觉地板钢板在 y=0.02，玩家出生瞬间穿过视觉地板掉进海床（地基箱体只是视觉遮挡，不承重）。**分支顺序固定**：船 > 甲板 > 门/平台 > 楼梯坡道 > 舱室 > 海床回退；舱室分支必须在平台/门/楼梯之后、海床之前。
- 水上：海雾近/中/远三层 + 阴天云层 + 阴云穹顶（两层灰云平面 + 大球体内壁渐变）；水下：透光层（独立朝下网格跟随波浪，海面 -0.22m，太阳透光斑）+ 按深度分档压暗（浅水透光）+ 散射颗粒。

### 移动端（input.js / ui.js / css/style.css）
- 情境化按钮分区：右上 `#touch-sys` mini 系统区（暂停/背包/手电/疾跑开关/第三人称，常驻不占主视野）+ 右下 `#touch-btns` 主操作区（只放当前情境真正需要的操作）+ `#touch-jump-cluster` 拇指区（乘船时整簇隐藏）。
- 教学 pill：替代原来与按钮列视觉重叠的常驻右下说明框（且旧文案提到不存在的"道具"按钮，已清理）；只在首次进入时顶部目标文本下方居中出现，点击或 30 秒后自动收起并持久化（`br_tut_seen`）。
- 目标文字移出状态条区；背包标题触屏适配（小屏不溢出）。

### 存档（save.js）
- 存档键 **`backrooms_save_v2` 不变**；v2.1 无新顶层字段、无 key 升级。L372 状态走按关 `ws` 通透桶（`validate` 未知字段透传，无需新字段）；L188 `W.state.l188floor` 走 `ws.l188floor`（`validate` 缺省回填 0）。

## v2.3 机制（2026-10-18，v2.0+ 整合委托）

### Level 37 池核重制（gen_l37.js 重写 / lv_l37.js，HEADLINE）
- 弃掉「后室+水池」混合思路，改为**独立 Poolrooms 空间生成逻辑**：9 个固定空间类型（placer 摆放）：`dry_spawn` 出生庭（干燥）/ `dry_gate` 门厅（干燥，Sunlit Gate + 异常门）/ `grand_pool` 异常开阔大池室 / `colonnade` 柱廊大厅 / `arch_pool` 拱门池室 ×2 / `sink` 深水沉降区（带通往深处的宽大楼梯）/ `submerged` 半淹没大厅（v2.1 保留）/ `court` 下沉庭院（v2.1 保留，修嵌套坑视觉遮挡）。
- 水下通道：低板（y 0.8~1.05）压顶的水道，高出水面（0.5）——须潜水从下方穿过（板下水深不够站立）。低板是按 tile 的 Y 条件碰撞特例（`W._slabTiles`，见 world.js 节）。
- 三档水深：0.4 / 1.2 / 2.0m（sink 最深，court 最浅），水深参与建筑生成。
- **零怪物**（原著依据：L37 无活物记录）。
- 双向契约保留：`sunlit_gate` ↔ L37.2 / `tunnel`/`deep_zone` ↔ L7 / `shallow_exit` → L0；小黄鸭坐骑保留（`BR.Gen.L37DUCK`）。

### Level 37.2 气质拉开（gen_l372.js / lv_l372.js）
- 与 L37 气质一眼可辨：L37.2 有**露天庭院**（天空+云+阳光），L37 是封闭室内 Poolrooms。
- 空间角色序列：发现（arrival 粉色开口画廊）→ 开阔（opencourt 露天庭院）→ 倒影（mirror 镜面池）→ 异常（crack 水下裂纹区）→ 返回（return 黑暗开口）；POI 去随机化。

### Level 7 冒险感（gen_l7.js / lv_l7.js）
- 海底多种子变化度：礁群 / 暗礁 / 海蚀拱（双柱+门楣岩拱，-30m 海床）；海面天空（海天交界线清晰）；游泳涟漪/气泡。
- 四带玩法挂钩：穿海蚀拱心 +4 理智 / 擦礁 -2（钩子在代码中，实机待验证）。
- 利维坦首潜提前：`nextLurk` 初值 150+150 → **55+40（55~95s）**；后续重置仍 150~290s 低频。只提前「演出」，stalk/strike 触发条件、38s 上限、反制全部未动，不刷怪。

### Level 188（gen_l188.js / lv_l188.js）
- 1 处真残留修复：休息室在 gen 侧收窄，吊顶覆盖居中（x 78..90 / y 117..135），不再伸进 208/209 吊顶；南墙 209 窗移到 sx=32（x=97.5 落进 209 房范围）。根因：v2.1 的 `_l188dropCeil` 范围会伸进 208/209 吊顶造成 z-fighting。
- 魔术窗帘（其中一扇交互后「消失」→随机切出）新增线索字条。

### 遭遇光谱 + 观察者退役（entities.js）
- 见 entities.js 节（alert 0→3 永不跳级、L1 潜伏者落点、L6/L4 不加怪、观察者退役）。

### 切出框架（cutout.js）
- `Cutout.registerType(name, def)` 注册表：既有 10 种切出类型（walk/manila/water/door/drop/slide/berry/hole/rift/none）逐字搬运注册，逻辑不变；接入新类型只许走注册表。
- duct 管道爬行 / dive 深水潜游**原型已落地**（身体感演出实现，未接入真实出口，控制台可调）。
- 设计文档 `docs/CUTOUT_DESIGN.md`：七种切出身体感设计 + 时长红线 ≤6s（硬性）。

### 架构规划（纯文档）
- `docs/ARCHITECTURE.md`（文件职责/`window.BR` 命名空间归属/耦合点/关卡契约/接口速查/模块化路线 P0→P2）+ `docs/MODULE_GRAPH.md`（分层图/依赖矩阵/耦合热点）。**零逻辑改动**。

### 存档（save.js）
- 存档键 **`backrooms_save_v2` 不变**；v2.3 无新顶层字段、无 key 升级。

## 性能铁律
- 每区块每材质 1 个 InstancedMesh；fixture 灯光用对象池（≤6 个 PointLight）；无实时阴影（low/mid），high 可选 1 个。
- 单帧区块构建预算 8ms；`world.update` 内计时，超时即停。
- 卸载：`geometry.dispose()`（实例几何体共享的不删）、移除监听、停循环音、实体冻结。
- 共享贴图/材质永不释放（Textures 缓存）。

## 代码风格
- 中文注释关键逻辑；函数短小；防御性检查（chunk 越界、POI 缺失时 log 而不是崩）。
- 任何"本应存在但缺失"的关键 POI → `BR.log` + 就近生成兜底，保证可通关。
