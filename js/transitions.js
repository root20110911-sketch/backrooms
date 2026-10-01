/* transitions.js —— 切出/过场演出：黑屏字幕 + 镜头动画 + 看门狗 */
(function () {
  const BR = window.BR;

  const TR = {
    active: null,       // {name, skipped}
    _watchdog: null
  };
  BR.Trans = TR;

  const $ov = () => BR.$('screen-trans');
  const $tx = () => BR.$('trans-text');

  function setText(t) {
    const el = $tx();
    el.textContent = t || '';
    el.style.opacity = t ? 1 : 0;
  }
  function fade(op, ms) {
    return new Promise((res) => {
      const el = $ov();
      el.style.transition = `opacity ${ms}ms linear`;
      el.style.opacity = op;
      setTimeout(res, ms);
    });
  }
  function wait(ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if ((TR.active && TR.active.skipped) || performance.now() - t0 >= ms) {
          clearInterval(iv); res();
        }
      }, 60);
    });
  }
  function glitch(on) { $ov().classList.toggle('glitch', !!on); }

  TR.skip = function () {
    if (this.active && this.active.skippable) this.active.skipped = true;
  };

  TR.play = function (name, opts) {
    opts = opts || {};
    if (this.active) return Promise.resolve(); // 防止重叠
    const self = this;
    this.active = { name, skipped: false, skippable: opts.skippable !== false };
    BR.Input.setLocked(true);
    BR.UI.show(null);
    const ov = $ov();
    ov.classList.add('show');
    ov.style.pointerEvents = 'auto'; // 恢复点击（跳过用）
    ov.style.transition = 'none';
    ov.style.opacity = opts.startBlack === false ? 0 : 1;
    setText('');
    // 30 秒看门狗：绝不永久黑屏
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      BR.warn('transition watchdog fired:', name);
      if (self.active) self.active.skipped = true;
      setTimeout(() => self._finish(), 600);
    }, 30000);

    const fns = {
      intro: trIntro, noclip_wall: trNoclip, corridor: trCorridor,
      ceiling: trCeiling, gate: trGate, elevator: trElevator,
      fun_escape: trFunEscape, fail: trFail, fade: trFade
    };
    const fn = fns[name] || trFade;
    return Promise.resolve(fn(opts)).then(() => this._finish(), () => this._finish());
  };

  TR._finish = function () {
    clearTimeout(this._watchdog);
    const ov = $ov();
    ov.style.transition = 'opacity 400ms linear';
    ov.style.opacity = 0;
    ov.style.pointerEvents = 'none'; // 淡出期间立刻让出点击，避免盖住死亡/结局按钮
    glitch(false);
    setText('');
    setTimeout(() => ov.classList.remove('show'), 450);
    this.active = null;
    if (BR.Game.state === 'playing') BR.Input.setLocked(false);
  };

  // 镜头推拉辅助：相对玩家相机做偏移，结束后恢复
  function camAnim(dur, fn) {
    return new Promise((res) => {
      const P = BR.Player, cam = P.camera;
      const bx = cam.position.x, by = cam.position.y, bz = cam.position.z;
      const brx = cam.rotation.x, bry = cam.rotation.y;
      const t0 = performance.now();
      const iv = setInterval(() => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        if (TR.active && TR.active.skipped) { clearInterval(iv); restore(); res(); return; }
        fn(t, cam);
        if (t >= 1) { clearInterval(iv); restore(); res(); }
      }, 33);
      function restore() {
        cam.position.set(bx, by, bz);
        cam.rotation.x = brx; cam.rotation.y = bry;
      }
    });
  }

  /* ---------- 各转场 ---------- */
  async function trIntro() {
    setText('你切出了现实。');
    await wait(2200);
    setText('这里只有荧光灯的嗡鸣，和潮湿地毯的气味。');
    await wait(2600);
    setText('');
    await fade(0, 1800);
  }

  async function trNoclip() {
    // 穿墙：镜头贴向墙面
    BR.Audio.glitch();
    const P = BR.Player;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    await camAnim(1400, (t, cam) => {
      cam.position.x += fx * 0.012; cam.position.z += fz * 0.012;
    });
    glitch(true);
    BR.Audio.splash();
    setText('你穿过了墙。');
    await wait(1200);
    glitch(false);
    await fade(1, 500);
    await BR.Game.gotoLevel('L1');
    setText('Level 1 ——「宜居地带」');
    await wait(2000);
    setText('');
    await fade(0, 2000);
  }

  async function trCorridor() {
    setText('这条走廊……比看起来要长得多。');
    BR.Audio.glitch();
    const P = BR.Player;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    // 缓慢前推 + 灯光闪烁
    await camAnim(4200, (t, cam) => {
      cam.position.x += fx * 0.02; cam.position.z += fz * 0.02;
      if (Math.random() < 0.06) glitch(true); else glitch(false);
    });
    glitch(false);
    await fade(1, 800);
    await BR.Game.gotoLevel('L2');
    setText('Level 2 ——「废弃公共带」');
    await wait(2000);
    setText('');
    await fade(0, 2000);
  }

  async function trCeiling() {
    // 抬头被拉入天花板
    const P = BR.Player;
    BR.Audio.glitch();
    await camAnim(1500, (t, cam) => {
      cam.rotation.x = BR.lerp(cam.rotation.x, -1.2, t * 0.2);
      cam.position.y += 0.02;
    });
    BR.Audio.partyStart();
    setText('上面传来音乐声……还有笑声。');
    await fade(1, 900);
    await BR.Game.gotoLevel('FUN');
    setText('Level Fun ——「享乐层」=)');
    await wait(2200);
    setText('');
    await fade(0, 2200);
  }

  async function trGate() {
    BR.Audio.doorCreak();
    setText('门后是向下的阶梯，和发电机的轰鸣。');
    await wait(1800);
    await fade(1, 900);
    await BR.Game.gotoLevel('L3');
    setText('Level 3 ——「发电站」');
    await wait(2000);
    setText('');
    await fade(0, 2000);
  }

  async function trElevator() {
    setText('电梯门缓缓关上。');
    BR.Audio.elevatorDing();
    await wait(1500);
    BR.Audio.elevatorRumble();
    const P = BR.Player;
    await camAnim(4000, (t, cam) => { cam.position.y -= 0.004; });
    setText('你在下降。灯光熄灭了一次，又亮起。');
    await wait(2500);
    BR.Audio.elevatorDing();
    setText('门开了——外面是白光。');
    await wait(1500);
    await fade(1, 1200);
    // 结局由 main.js 接管显示
    await BR.Game.gotoEnding();
  }

  async function trFunEscape() {
    BR.Audio.glitch();
    setText('你撞开员工通道的门，身后派对的音乐戛然而止。');
    await wait(1600);
    await fade(1, 700);
    await BR.Game.gotoLevel('L1', { fromFun: true });
    setText('你回到了 Level 1。荧光灯依旧嗡鸣。');
    await wait(2000);
    setText('');
    await fade(0, 2000);
  }

  async function trFail(cause) {
    // 死亡：镜头倒地
    const P = BR.Player;
    BR.Audio.stinger();
    await camAnim(1800, (t, cam) => {
      cam.position.y -= 0.012;
      cam.rotation.z = BR.lerp(cam.rotation.z, 0.7, t * 0.15);
    });
    await fade(1, 800);
    BR.Game.showDeath(cause);
  }

  async function trFade(opts) {
    await fade(1, 600);
    if (opts && opts.then) await opts.then();
    await fade(0, 600);
  }

  // 跳过按钮（长按转场可跳过）
  document.addEventListener('DOMContentLoaded', () => {
    const ov = BR.$('screen-trans');
    if (ov) ov.addEventListener('click', () => TR.skip());
  });
})();
