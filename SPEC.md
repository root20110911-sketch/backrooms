# SPEC.md —— 模块接口规范（内部）

所有 JS 文件均为普通 `<script>` 引入（非 ES module），按顺序挂载到全局 `window.BR`。
Three.js r128（UMD，全局 `THREE`）。不要使用 r128 不存在的 API。

**脚本加载顺序**（index.html / bundle 拼接顺序）：
`three.min.js → config.js → utils.js → textures.js → audio.js → gen.js → world.js → player.js → input.js → entities.js → transitions.js → levels.js → ui.js → save.js → main.js`

## 全局约定
- `BR` 命名空间；`BR.log(...args)` 调试输出（`?debug=1` 或 localStorage `br_debug=1` 时进 console）。
- 坐标：tile `(tx,ty)`，`tx` 向东为 +x，`ty` 向南为 +z。世界坐标：`x=(tx+0.5)*T`，`z=(ty+0.5)*T`，`T=3`（米）。
- `BR.TILE = 3`。
- 关卡 id：`'L0','L1','L2','L3','FUN'`。
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
- 环境：`BR.Audio.setAmbient(level)` 切换关卡底噪（L0 嗡鸣+L1 管道+L2 蒸汽+L3 发电机+FUN 派对音乐），内部交叉淡化。
- 位置循环声：`BR.Audio.addLoop(id, type, x, z, gain)` / `removeLoop(id)` / `updateListener(x,z,yaw)` 每帧调用。type: `'hum'`（荧光灯）、`'buzz'`、`'steam'`、`'machine'`、`'flicker'`。
- 一次性：`footstep(surface)` surface∈carpet/concrete/metal/tile/wood；`doorOpen()` `doorLocked()` `doorCreak()`；`pickup()` `drink()` `paper()` `valve()` `steamBurst()` `elevatorDing()` `elevatorRumble()` `glitch()` `stinger()` `heartbeat()` `giggle()` `growl()` `bark()` `whisper()` `uiClick()` `checkpoint()` `splash()`。
- 音乐：`BR.Audio.partyStart()` / `partyDegrade(stage)` / `partyStop()`。
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
- `BR.Gen.assertConnected(map)→{ok, missing:[...]}` 检查 spawn 到所有关键 POI 可达。
- 生成器必须保证：同一种子同关卡结果完全一致；关键 POI 全部可达（否则打通走廊重连）。
- `BR.Gen.hashMap(map)→string` 用于测试比较（房间图+POI 的哈希）。

## world.js —— 场景/区块管理
- `BR.World.build(map, savedState)`：清旧场景，建新场景；返回 Promise（分帧构建）。
- `BR.World.dispose()`：释放本关资源（几何体/实例/灯光/实体），**保留** Textures/Audio 共享资源。
- 区块：`CHUNK=8` tiles；`BR.World.update(dt, px, pz)` 按距离加载/卸载，每帧预算：建 ≤1 区块，拆 ≤2 区块。
- `BR.World.collide(pos, radius)→pos` 原地修正（pos 为 THREE.Vector3，脚底）。
- `BR.World.isWall(tx,ty)`；`BR.World.tileAt(x,z)→{tx,ty}`；`BR.World.surfaceAt(x,z)→surface名`。
- `BR.World.los(ax,az,bx,by)→bool` tile 网格视线（实体用）。
- 交互：`BR.World.interactables` 数组；`BR.World.rayInteract(o,d,maxD)→{it,dist,point}|null`；每项 `{id,kind,mesh,pos:Vector3,prompt(),canUse(),use()}`。
  kind: `door/crate/pickup/note/valve/elevator_door/elevator_btn/anomaly_wall/fun_hole/fun_exit/cake`。
- 门：`BR.World.setDoor(id, open, instant)` 播动画；`BR.World.doorState(id)`。
- `BR.World.getStats()→{fps,chunks,roomsVisible,entities,seed,drawCalls,tris}`。
- `BR.World.onChunk(fn)` 注册区块加载回调（levels 用来放事件触发器）。
- 状态恢复：`savedState={openedDoors:[ids],picked:[ids],openedCrates:[ids],events:[ids]}`；build 时跳过已拾取/已开。
- 状态上报：`BR.bus.emit('picked',{id})` 等，save.js 监听。

## player.js
- `BR.Player.reset(x,z,yaw)`；`BR.Player.update(dt, input, world)`。
- 属性：`pos`（Vector3 脚底）、`yaw/pitch`、`crouching/running`、`noise`（0..1 本帧噪音）、`hp`、`stamina`。
- `BR.Player.camera`（PerspectiveCamera）；`BR.Player.hasFlashlight`、`flashlightOn`（`toggleFlashlight()`）。
- `BR.Player.hurt(n, cause)` → bus 'hurt'；`heal(n)`。
- 脚步：按移动距离触发 `BR.Audio.footstep(surface)`；surface 来自 world。
- 镜头：headbob、跑步 FOV、落地顿挫 `landDip()`、受击抖动 `shake(amt)`。

## input.js
- `BR.Input.init(canvas)`；`BR.Input.update()`。
- `move {x,z}`（-1..1，已合成为世界方向？不——返回以玩家 yaw 为基准的前/右分量，由 player 换算）、`lookDX/lookDY`（本帧增量，消费制）、`runHeld`、`crouchToggled`。
- `consumeInteract()→bool`（E/触控交互按钮/鼠标点击？鼠标点击用于交互需射线在屏幕中心——桌面端 E 为主）。
- `BR.Input.isTouch` 自动识别；`BR.Input.settings={joyX,joyY,joySize,sens,vol}` 持久化 `br_settings`。
- 触控：左摇杆（动态原点+死区0.15+滑出跟随）、右侧拖动视角、按钮：interact/run/crouch/use(pause 在 HUD)。
- `BR.Input.setLocked(b)` 转场/菜单时锁定。
- 桌面：WASD+鼠标（pointer lock，点击画布进入）、Shift 跑、Ctrl/C 蹲、E 交互、F 手电、Esc 暂停。

## entities.js
- `BR.Entities.spawn(type, x, z, opts)→ent`；type: `hound`(L3)、`partygoer`(FUN)、`lurker`(L2)。
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
  - `elevator` L3 电梯 → 主线结局动画（暗示 Level 4）
  - `fun_escape` FUN 员工通道 → L1（检查点）
  - `blackout` L1 闪烁事件（前兆→全黑→恢复）
  - `fail` 被抓/死亡 → 失败画面（transitions 只做演出，UI 由 ui.js 显示）
  - `fade` 通用淡入淡出 `play('fade',{dir:'in'|'out',dur})`
- 每个演出：`BR.Input.setLocked(true)` 开始，结束恢复；`BR.Game` 负责关卡切换的实际 world 重建（transitions 发起 `bus.emit('level:switch',{to, spawnPOI})`）。
- 看门狗：演出超过 30s 未结束 → 强制淡入恢复控制并 log。

## levels.js —— 各关内容装配
- `BR.Levels = { L0:{...}, L1:{...}, ... }`，每关：
  - `theme`：`{wall:'wallpaper', floor:'carpet', ceil:'ceiling', wallH:3, fog:0x..., fogNear, fogFar, bg:0x..., light:0x..., ambient:0x..., hum:'hum', surface:'carpet'}`。
  - `buildContent(map, world)`：按 pois 生成板条箱/笔记/拾取物/门/阀门/电梯/派对道具/实体出生点等，注册 interactables。
  - `objective(map)→string` HUD 目标提示。
  - `notes`：`{id: {title, body}}` 笔记文本库。
  - `onEnter()`：关卡进入事件（检查点、环境音频、目标提示）。
- 物品：`almond`（杏仁水：+hp/体力）、`flashlight`（手电）、`bandage`（绷带）、`note_*`。

## ui.js
- `BR.UI.show(name, data)` / `hide(name)`。screens: `menu/loading/hud/pause/notes/fail/ending/toast/debug`。
- `BR.UI.setPrompt(text|null)` 交互提示；`BR.UI.setObjective(text)`；`BR.UI.toast(text)`。
- 物品栏：`BR.UI.setInventory(items, active)`；笔记阅读 `BR.UI.readNote(title, body)`。
- 暂停菜单：设置项（摇杆位置/大小、灵敏度、音量、画质），种子显示，存档操作。
- debug 面板：`BR.UI.debugStats(stats)` 每 500ms 更新。
- 所有按钮 ≥44px 触控目标；`touch-action:none`。

## save.js
- `BR.Save.save(slot)` / `load()` / `clear()` / `exists()`。key: `br_save_v1`。
- 存：`{seed, level, pos:[x,z,yaw], hp, inv:[], openedDoors:[], picked:[], openedCrates:[], events:[], checkpoint:{level,pos}, time}`。
- checkpoint：进入每关/进入 FUN/电梯前 自动写检查点（内存+存档）。
- `BR.Save.respawn()` → 回到检查点（重建关卡+恢复状态）。

## main.js
- `BR.Game.init()`；`newGame(seed?)`；`continueGame()`；`switchLevel(to, opts)`；`BR.Game.tick(t)` 主循环（dt clamp 0.05）。
- 状态：`menu/loading/playing/transition/paused/fail/ending`。
- `BR.Game.locked` 输入锁定；失焦自动暂停（visibilitychange）。
- 画质应用：pixelRatio、雾距离、灯光数；`?quality=low|mid|high` 覆盖；平板默认 mid。
- `window.BR.debug = { game, world, player, gen, tp(x,z), give(item), trigger(name) }` 供自动化测试。

## 性能铁律
- 每区块每材质 1 个 InstancedMesh；fixture 灯光用对象池（≤6 个 PointLight）；无实时阴影（low/mid），high 可选 1 个。
- 单帧区块构建预算 8ms；`world.update` 内计时，超时即停。
- 卸载：`geometry.dispose()`（实例几何体共享的不删）、移除监听、停循环音、实体冻结。
- 共享贴图/材质永不释放（Textures 缓存）。

## 代码风格
- 中文注释关键逻辑；函数短小；防御性检查（chunk 越界、POI 缺失时 log 而不是崩）。
- 任何"本应存在但缺失"的关键 POI → `BR.log` + 就近生成兜底，保证可通关。
