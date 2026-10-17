# 统一交互管线（Unified Interaction Pipeline）

> P1 A 工人交付。地位：以后任何新关卡加「玩家可交互的东西」，**只许调
> `W.addInteractable`，不许自己监听 keydown / touchstart / mousedown**。
> 违反者即管线分叉，code review 直接打回。

## 1. 模块职责

| 模块 | 职责 | 不许做的事 |
|---|---|---|
| `js/input.js` | 唯一的输入采集与分发：键盘/鼠标/触屏三路 → `actionForCode` 查改键表 → `dispatchAction(action)`。关卡级按键需求经 `BR.Input.levelKeyHandler` 钩子进入 | 不许出现关卡逻辑 |
| `js/player.js` | 目标检测：每 0.12s 从准星（屏幕中心）发 `world.rayInteract`，命中且 `canUse()` 时 `BR.UI.setPrompt(prompt())` 显示提示；收到 `input.consumeInteract()`（E/左键/触屏交互钮）且有当前目标时调 `it.use()` | 不许直接执行交互效果 |
| `js/world.js` | 交互物注册表：`W.addInteractable({id,kind,meshes,pos,radius,prompt(),canUse(),use()})`；`W.rayInteract` 做射线命中 + 距离 + 遮挡（`interactOccluded`）三重过滤；`W.INTERACT_KINDS` 登记 kind | 不许决定何时 use |
| 关卡文件（`lv_*.js`/`levels*.js`/`cutout.js`） | 只做一件事：把交互物**描述**出来（prompt/canUse/use 三个函数）。use 里写效果 + 音效 + UI 反馈 + 存档事件 | 不许监听按键/触屏/鼠标 |
| `js/ui.js` | 提示文案渲染（`setPrompt`）、道具**统一使用入口** `BR.UI.useItem(id)`（内部委托 `BR.Items.handle`） | — |
| `js/items.js` | 道具效果实现（`BR.Items.handle`） | — |

## 2. 调用链

```
输入                    目标检测                    动作分发
键盘/触屏/改键            player.update (每 0.12s)     状态校验            UI 反馈
─────────────           ─────────────────────        ──────────          ──────────
keydown/mousedown   ┐
touchstart 触屏按钮  ├→ actionForCode(code) → dispatchAction('interact')
摇杆/视角           ┘         │  (input.js，唯一分发点)        ┐
                             │                               │
                             ▼                               ▼
                    player._curIt：世界.rayInteract(眼位, 准星方向)  input.consumeInteract() ──→ _curIt.use()
                    过滤：mesh 命中 → radius 内 → interactOccluded   (player.js:993，      use() 内：
                    未挡 → it.canUse() ? it : null                   唯一调用点)          音效/动画/toast/
                    → BR.UI.setPrompt(it.prompt())                                       存档事件 push
```

### 链上每一步的门禁

1. **输入门禁**（input.js keydown）：改键捕获优先 → `e.repeat` 丢弃 → 非 `playing`/
   锁定态只响应暂停键 → 绑定动作走 `dispatchAction`，**未绑定 code 才走
   `levelKeyHandler`**（改键系统永远优先于关卡钩子）。
2. **目标门禁**（world.js `rayInteract`）：mesh 命中 → `radius`（或
   `INTERACT_DIST`）内 → 墙体/关门遮挡检查 → 返回最近候选。
3. **可用门禁**（player.js）：`hit.it.canUse()` 为 false 的目标不进 `_curIt`，
   准星提示直接消失。
4. **执行门禁**：`consumeInteract()` 为 true（一次按键只消费一次）且 `_curIt`
   非空 → `use()`。

### 道具链（与交互链并行，共用 UI 入口）

```
背包点击 / bang quickbar 触屏按钮 / Digit1·2 ──→ BR.UI.useItem(id)
      ──→ BR.Items.handle(id)（新道具）/ 旧分支（杏仁水/绷带/浆果）
      ──→ 数量/状态 guard → 扣道具 → 效果 → toast + autosave
```

## 3. 关卡级按键钩子 `BR.Input.levelKeyHandler`

唯一允许关卡「自己要按键」的通道（现实例子：Level ! 追逐中 Digit1=杏仁水、
Digit2=绷带——追逐中打不开背包，这是关卡设计）。

```js
// onEnter
BR.Input.levelKeyHandler = function (e) {
  if (!BR.Game || BR.Game.level !== 'bang') return; // 防御性守卫
  if (e.code === 'Digit1') BR.UI.useItem('almond');
};
// cleanup（只清自己挂的）
if (BR.Input.levelKeyHandler === myHandler) BR.Input.levelKeyHandler = null;
```

规则：

- input.js 只在「`playing` 且未锁定」时调用；`e.repeat` 已在 input.js 过滤。
- **只有未被全局改键绑定的 code 会送达**：用户把 Digit1 改绑到跳跃后，
  按 1 只跳跃，钩子自动让路——改键系统永远优先，关卡永远不与改键冲突。
- Digit1/Digit2 在 DEFAULT_BINDINGS 里是空闲的（v1.5.1 已删除全局数字键绑定），
  默认行为不受影响；E 等既有键位习惯不许动。
- 钩子内部仍要自己守 `BR.Levels` 级别（防异常切换路径下泄漏到别关）。
- 离开清理：框架没有 onExit 机制、切关后旧关 tick 不再跑，所以只靠
  cleanup() 会泄漏。lv_bang.js 用模块级 `watchLeave()`（400ms 轮询，
  onEnter 启动、cleanup 后自停）做兜底：发现 `BR.Game.level` 切走就调
  cleanup()，quickbar DOM + 钩子槽位 400ms 内清干净。钩子内部另有
  错关懒自清作为第二道防线。
- 触屏 quickbar 按钮保留：调统一入口 `BR.UI.useItem`；`touchstart` 用
  `passive:false` + `stopPropagation`，不干扰摇杆/视角触摸跟踪（它们监听的是
  joy-zone/canvas，与按钮 DOM 无交集）。

## 4. 新关卡 checklist

- [ ] 交互物：调 `W.addInteractable({id, kind, meshes, pos, radius, prompt(), canUse(), use()})`，
      kind 先在 `W.INTERACT_KINDS` 登记。
- [ ] `prompt()` 读 `BR.interactKeyLabel()` 而不是硬编码 "E"（改键后提示自动跟）。
- [ ] `canUse()` 写清门禁（切出中？坐骑上？已拾取？）。
- [ ] `use()` 里：音效 + `BR.UI.toast`/`showNote` + 存档事件（`W.state.picked/events`），
      幂等（重复 use 不崩）。
- [ ] 需要特殊按键 → 走 `levelKeyHandler`，enter 设、exit 清；**不许**
      `window.addEventListener('keydown'/'touchstart')`。
- [ ] 门类交互直接用 `W.addDoor(...)`（内部已走 addInteractable）。
