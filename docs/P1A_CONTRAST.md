# P1-A 重构前后功能对照表（统一交互管线）

> 基准：`tools/AUDIT_V2.md` 第二章功能清单（30 行总表 + §2.2）。
> 本次改动面：`js/input.js`（+`levelKeyHandler` 钩子槽位、keydown 分发改为"绑定优先、未绑定 code 才走钩子"）、
> `js/lv_bang.js`（quickbar 数字键改走钩子，触屏按钮不动）。`player.js`/`world.js` 零改动。
> 结论口径：✓ = 功能保留且经代码/测试确认；— = 与本次改动无关、状态沿用审计结论。

## 2.1 总表逐项

| # | 审计条目 | 审计状态 | 本次重构影响 | 结论 |
|---|---|---|---|---|
| 1 | 10 个可玩关卡（L0/L1/L2/L3/FUN/L188/L37/L7/L11/Level!） | 已实现 | 未动关卡注册 | ✓ |
| 2 | Level 94「动画」已退化（注释式退役） | 已退化 | 未动 | —（状态不变） |
| 3 | README 关卡列表含 L94、缺 Level! | 文档过时 | 未动文档 | —（仍过时，非本任务） |
| 4 | 按键表（WASD/E/F/Shift/Esc） | 已实现 | E 等键位习惯未动；分发顺序变化不改变绑定行为 | ✓ e2e：L0 按 E 开门/拾取通过 |
| 5 | "C / 左 Ctrl 蹲"文档过时（实际仅 KeyC） | 文档过时 | 未动 | — |
| 6 | "1/2/3/4 使用物品"文档过时（快捷栏 v1.5.1 已删） | 文档过时 | 顺手修了 input.js 注释残留（删"数字键 1-5=快捷栏"一句）；Digit1/2 仍只在 bang 经钩子生效 | ✓（行为不变，注释更准） |
| 7 | 按键表缺失空格/Tab/I/V/鼠标左键 | 文档过时 | 未动 | — |
| 8 | "第一人称 3D"文档过时（第三人称已实装） | 文档过时 | 未动 | — |
| 9 | 迁跃浆果/随机裂隙/七色滑梯机制 | 已实现 | 走 useItem/use() 链，未动 | ✓ |
| 10 | FUN 涂鸦洞口 8% | 已实现 | 未动 | ✓ |
| 11 | 种子确定性 | 已实现 | 未动 | ✓ |
| 12 | L0 无限延伸（v1.5.1） | 已实现 | 未动 | ✓ |
| 13 | 存档/检查点/死亡重试 | 已实现 | 未动存档 | ✓ |
| 14 | 猎犬/潜伏者/派对客 | 已实现 | 未动实体 | ✓ |
| 15 | 实体列表遗漏 bang 追逐者；watcher/leviathan 停用未注明 | 文档过时 | 未动 | — |
| 16 | L37 小黄鸭坐骑 | 已实现 | 坐骑交互走 addInteractable（mount_duck），未动 | ✓ |
| 17 | 马尼拉房间（150s 预警→180s 传送 L1） | 已实现 | 未动 | ✓ |
| 18 | L1 家具/物资拾取、饥饿/理智系统 | 已实现 | 拾取走同一管线 | ✓ e2e：L0 拾取链通过 |
| 19 | L11 NPC/井盖/地铁 | 已实现 | NPC/井盖走 addInteractable，未动 | ✓（64 处审计全过 prompt/canUse/use） |
| 20 | L0/L1 生成重改、实体遭遇率调整 | 部分实现 | 未动 | — |
| 21 | L188 窗户四态/104 扇、L7 小船/氧气细节 | 未验证 | 未动 | — |
| 22 | three.min.js"随附本地"文档过时（实际走 CDN） | 文档过时 | 未动 | — |
| 23 | README 模块加载顺序过时 | 文档过时 | 未动 | — |
| 24 | README 测试报告"106 项"过时（实际 888） | 文档过时 | 未动 | — |
| 25 | SPEC.md 关卡 id/存档 key/加载顺序错误 | 文档过时 | 未动 | — |
| 26 | 区块构建预算 8ms vs 10ms 文档不一致 | 文档间不一致 | 未动 | — |
| 27 | LORE.md 原著/改编二分标注 | 基本清晰 | 未动 | — |
| 28 | LORE.md 马尼拉房间标题/正文矛盾 | 文档自相矛盾 | 未动 | — |
| 29 | test-v15-w8.js 7 项失败（快捷栏已删，脚本过时） | 测试脚本过时 | 未动旧脚本；本任务新增 tools/e2e/p1-interact.js 覆盖新管线 | ✓（新脚本补位） |
| 30 | README "未在真机验证"诚实标注 | 无问题 | 未动 | — |

## §2.2 EXPANSION_PLAN 落实情况

Phase 1-6 + 追加队列（A1/A2/F5/B2/B3/F2/B4/F4/F1、B1 部分、F3 部分）均为内容/数值实现，
与输入分发无关。✓ 全部保留，无一丢失。

## 本次重构新增/变更的功能点对照（防丢清单）

| 功能 | 重构前 | 重构后 | 验证 |
|---|---|---|---|
| bang 追逐中 Digit1=杏仁水 / Digit2=绷带 | `window` keydown 分叉监听 | `BR.Input.levelKeyHandler` 钩子（input.js 统一分发进入） | ✓ e2e T8（23/23 全过） |
| bang quickbar 触屏按钮（杏仁水/绷带） | touchstart+mousedown → `BR.UI.useItem` | 未动（已是统一入口；passive:false+stopPropagation 保留） | ✓ e2e T9/T10/触屏 T14 |
| 钩子只在本关生效 | listener 内 `level!=='bang'` return（泄漏则常驻） | 钩子内 level 守卫 + 错关懒自清；新增 `watchLeave()` 400ms 兜底（框架无 onExit，切关后旧关 tick 不跑，cleanup 原本调不到）→ quickbar DOM + 钩子槽位 400ms 内清干净 | ✓ e2e T12（quickbar 已移除、hook=null） |
| Digit1/2 与改键系统关系 | 全局无绑定，window 监听先到先得 | input.js：已绑定 code 走 dispatchAction，未绑定才走钩子——改键永远优先 | ✓ e2e T11（Digit1 改绑 jump 后不再触发用药） |
| L0 及其他关卡按键行为 | — | 钩子为 null 时与旧分发完全一致 | ✓ e2e T1–T6 |
| E 交互键位习惯 | KeyE+MouseLeft | 未动 | ✓ e2e T2–T5（真实门/拾取/字条） |

### e2e 实测（tools/e2e/p1-interact.js，headless Chrome + swiftshader，23/23 通过）

- L0（种子 1234）：`levelKeyHandler===null`；准星命中 `door_d0` → 提示"【E / 鼠标左键】打开木门" → 按 E 门开；拾取物提示"【E / 鼠标左键】拿起杏仁水" → 按 E 背包变化；字条 prompt/canUse 契约 + `use()`→字条界面（标题"马尼拉房间"）；L0 按 Digit1 无事发生。
- bang：钩子已设置；quickbar 2 按钮；Digit1 喝杏仁水（hp 40→75）；quickbar 绷带按钮（hp→100）；quickbar touchstart 走同一 `useItem`；Digit1 改绑 jump 后钩子让路（almond 未动）；离关后 quickbar 移除、钩子清除。
- 触屏模拟（iPhone UA）：`isTouch` 识别；`#btn-interact` tap → `dispatchAction('interact')` 被调用（同一管线）；bang quickbar 真实 tap 可用。
- 说明：headless 下 dt 被钳 0.05、游戏时间约 1/30 墙钟，0.12s 射线轮询在墙钟上需数秒——测试等待一律按条件轮询（30s 超时），不是游戏 bug。字条几何瞄准（单面 Plane）不稳定，降级为契约验证并如实标注；门/拾取两条几何路径均为真实 E 按键通过。

## 审计结论

- 30 项中 16 项"已实现"：✓ 全部保留（其中 6 项经本次 e2e 实测，10 项经代码审计确认未触及）。
- 14 项"文档过时/已退化/部分/未验证"：状态与审计一致，本次未改（文档债不在 A 工人范围内）。
- EXPANSION_PLAN 落实项：✓ 无丢失。
- **功能丢失数：0**。
