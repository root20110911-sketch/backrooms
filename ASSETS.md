# 素材授权说明（ASSETS.md）

本游戏**所有视觉与音频素材均为程序化生成**，无任何外部下载资源（除随附的 Three.js 库外）。

## 第三方库

| 文件 | 来源 | 许可 |
|---|---|---|
| `js/vendor/three.min.js` | Three.js r128（https://threejs.org） | MIT License |

Three.js r128 的 MIT 许可文本见 https://github.com/mrdoob/three.js/blob/r128/LICENSE（随附文件头内亦有版权声明）。

## 程序化纹理（`js/textures.js`）

全部由 Canvas 2D 在运行时绘制生成，著作权归本项目所有：

- `wallpaper` 黄色墙纸、`carpet` 潮湿地毯、`ceiling` 天花板、`fluor` 荧光灯
- `concrete` / `concreteFloor` 混凝土、`brick` 砖墙、`tileFloor` 瓷砖地
- `metal` / `doorMetal` 金属、`crate` 木箱、`pipe` 管道
- `partyWall` / `partyFloor` 派对墙纸与地板、`posterFun` 派对海报、`smiley` 笑脸
- `cake` 蛋糕、`note` 字条、`rustFence` 锈铁栅栏、`stain` 墙面污渍、`void` 虚空

无外部图片、无 AI 生成图片、无网络字体。

## 程序化音频（`js/audio.js`）

全部由 WebAudio API 实时合成（振荡器 + 噪声缓冲 + 滤波器），无外部音频文件：

- 环境：荧光灯嗡鸣（hum）、故障灯滋滋（flicker）、蒸汽（steam）、机器运转（machine）
- 动作：脚步（按地面材质区分）、开门/上锁、阀门、拾取、纸张、检查点
- 事件：切出故障音（glitch）、电梯、惊吓（sting）、停电/恢复、心跳、派对音乐（partyStart 合成旋律）

无外部音效、无版权音乐。

## 实体模型（`js/entities.js`）

猎犬、潜伏者、派对客均为 Three.js 基础几何体（球/盒/圆柱）程序化拼装 + 顶点色，
无外部模型文件。

## 文字内容

游戏内字条文本为本项目原创中文；层级与实体设定参考后室中文维基（CC BY-SA 3.0 社区内容），
已在 `LORE.md` 中注明原作与游戏改编的界限。游戏内字条本身不复制维基原文。
