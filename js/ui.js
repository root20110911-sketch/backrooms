/* ui.js —— 全部界面：标题/暂停/设置/HUD/笔记/死亡/结局/提示 */
(function () {
  const BR = window.BR;

  const U = {};
  BR.UI = U;

  const ITEM_INFO = {
    almond: { name: '杏仁水', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3c3.2 4.2 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 2.8-6.8 6-11z"/></svg>' },
    bandage: { name: '绷带', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="8.5" width="17" height="7" rx="3.5"/><path d="M12 10.8v2.4M10.8 12h2.4"/></svg>' },
    flashlight: { name: '手电筒', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h6v5H9z"/><path d="M10 7.5 6.5 15a2.4 2.4 0 0 0 2.1 3.5h6.8a2.4 2.4 0 0 0 2.1-3.5L14 7.5"/></svg>' },
    // —— 迁跃浆果：稀有消耗品 ——
    // LORE 注释：Wiki 的 Object 74（"Devil's Berries"）并非随机传送，本游戏将其改编为
    // "随机传送到未知层级"的消耗品。正式 LORE 说明由 Docs 任务写入 LORE.md。
    berry: {
      name: '迁跃浆果',
      desc: '散发着微光的浆果。吃下去会随机传送到未知层级——目标随机，可能更危险，不是安全回城。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="15" r="4.3"/><circle cx="15" cy="15" r="4.3"/><path d="M12 10.7C12 7 14.2 4.6 18.5 4"/><path d="M12 10.7c-1.8-1.2-4.3-1.3-6.4 0.2"/></svg>'
    },
    // —— 食物：回饥饿的主力补给 ——
    food: {
      name: '食物',
      desc: '压缩干粮。食用恢复饥饿 +40，并少量回血 +5。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 9h10v10a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19z"/><path d="M7 9c0-2.2 2.2-3.8 5-3.8s5 1.6 5 3.8"/><path d="M10 13.5h4M10 16.5h2.5"/></svg>'
    }
  };

  U.init = function () {
    this.cacheEls();
    this.ensureHungerBar();
    this.renderKeyHint();
    this.bindButtons();
    this.renderSettings();
  };
  // 饥饿条 DOM（index.html 不许动，这里动态创建；桌面/触屏都显示）
  U.ensureHungerBar = function () {
    if (!this.$hud || BR.$('hun-wrap')) return;
    const w = document.createElement('div');
    w.id = 'hun-wrap';
    const f = document.createElement('div');
    f.id = 'hun-fill';
    w.appendChild(f);
    this.$hud.appendChild(w);
  };
  U.cacheEls = function () {
    ['screen-title', 'screen-how', 'screen-loading', 'hud', 'screen-pause',
     'screen-note', 'screen-death', 'screen-ending', 'screen-trans',
     'prompt', 'objective', 'inv-bar', 'toasts', 'debug',
     'note-title', 'note-body', 'death-cause', 'ending-title', 'ending-body',
     'trans-text', 'seed-line', 'btn-continue', 'set-sens', 'set-vol',
     'set-joysize', 'set-joyside', 'set-quality', 'sens-val', 'vol-val', 'joysize-val'
    ].forEach(id => { this['$' + id.replace(/-/g, '_')] = BR.$(id); });
  };

  U.show = function (name) {
    ['screen-title', 'screen-how', 'screen-loading', 'screen-pause',
     'screen-note', 'screen-death', 'screen-ending'].forEach(s => {
      const el = this['$' + s.replace(/-/g, '_')];
      if (el) el.classList.toggle('show', s === name);
    });
    this.$hud.classList.toggle('show', name === null);
    if (name) document.exitPointerLock && document.exitPointerLock();
  };

  /* ---------- 标题 ---------- */
  U.showTitle = function (seed) {
    const sv = this.peekSeedInput();
    const s = sv != null ? sv : (seed != null ? seed : ((Math.random() * 1e9) | 0));
    this.$seed_line.textContent = '世界种子：' + s;
    this.$seed_line.dataset.seed = s;
    this.$btn_continue.style.display = BR.Save.hasSave() ? 'block' : 'none';
    this.show('screen-title');
  };
  U.refreshContinue = function () {
    if (this.$btn_continue) this.$btn_continue.style.display = BR.Save.hasSave() ? 'block' : 'none';
  };
  U.peekSeedInput = function () {
    const v = (BR.$('seed-input').value || '').trim();
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    return null;
  };
  U.newSeed = function () { return (Math.random() * 1e9) | 0; };

  /* ---------- HUD ---------- */
  U.setPrompt = function (text) {
    if (!this.$prompt) return;
    this.$prompt.textContent = text || '';
    this.$prompt.style.opacity = text ? 1 : 0;
  };
  U.setObjective = function (text) {
    if (this.$objective) this.$objective.textContent = text || '';
  };
  U.toast = function (msg, ms) {
    if (!msg) return; // 空消息不显示，避免留下空黑条
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = msg;
    this.$toasts.appendChild(d);
    setTimeout(() => d.classList.add('out'), (ms || 2400) - 400);
    setTimeout(() => d.remove(), ms || 2400);
    while (this.$toasts.children.length > 4) this.$toasts.firstChild.remove();
  };
  U.updateInv = function () {
    const inv = BR.Game.inv || {};
    let html = '';
    const keys = ['almond', 'bandage', 'flashlight', 'berry', 'food'];
    keys.forEach((id, i) => {
      const n = inv[id] || 0;
      const info = ITEM_INFO[id];
      const active = id === 'flashlight' && BR.Player.flashlightOn;
      html += `<div class="inv-item${n ? '' : ' empty'}${active ? ' on' : ''}" data-id="${id}">` +
        `<span class="ic">${info.icon}</span><span class="nm">${info.name}</span>` +
        (id === 'flashlight' ? '' : `<span class="ct">${n}</span>`) +
        `<span class="kb">${i + 1}</span></div>`;
    });
    this.$inv_bar.innerHTML = html;
    this.$inv_bar.querySelectorAll('.inv-item').forEach(el => {
      el.addEventListener('click', () => this.useItem(el.dataset.id));
      el.addEventListener('touchstart', (e) => { e.stopPropagation(); this.useItem(el.dataset.id); }, { passive: true });
    });
    // 血条 / 理智条 / 饥饿条
    this.updateBars();
  };
  // 轻量血条/理智条/饥饿条刷新（主循环节流调用，updateInv 里复用）
  U.updateBars = function () {
    if (!BR.Player) return;
    const hp = BR.Player.hp, san = BR.Player.sanity;
    const hf = BR.$('hp-fill');
    if (hf) { hf.style.width = hp + '%'; hf.classList.toggle('low', hp < 30); }
    const sf = BR.$('san-fill');
    if (sf) { sf.style.width = san + '%'; sf.classList.toggle('low', san < 30); }
    const hun = BR.Player.hunger != null ? BR.Player.hunger : 100;
    const uf = BR.$('hun-fill');
    if (uf) { uf.style.width = hun + '%'; uf.classList.toggle('low', hun < 25); }
    BR.$('dmg-vignette').style.opacity = hp < 35 ? (0.65 - hp / 60) : 0;
  };
  // 低理智暗角（player.update 每帧调用）
  U.setSanityFx = function (sanity) {
    const el = BR.$('sanity-vignette');
    if (!el) return;
    el.style.opacity = sanity < 40 ? (0.55 * (1 - sanity / 40)).toFixed(2) : 0;
  };
  // 迁跃浆果目的地：候选池权重与裂隙系统同表（EXPANSION_PLAN §2），排除当前关；
  // 用 seed + ':berry:' + count 派生 RNG（可复现），count = 此前食用浆果次数。
  // 未注册的关卡（扩建文件未接入时）自动跳过，保证食用不落空。
  const BERRY_WEIGHTS = [['L0', 15], ['L1', 15], ['L11', 12], ['L37', 12],
    ['L188', 10], ['L94', 10], ['L7', 8], ['L2', 8], ['L3', 6], ['FUN', 4]];
  U.countBerryEvents = function () {
    // 跨关单调计数：flags.berryCount 在食用后递增、存档保留。
    // （修 bug：原来按本关 ws.events 计数，跨关后新关 events 为空，count 永远从 0 开始导致落点重复）
    return (BR.Game && BR.Game.flags && BR.Game.flags.berryCount) || 0;
  };
  U.pickBerryDest = function () {
    const G = BR.Game;
    const count = this.countBerryEvents();
    const rng = new BR.RNG(BR.hashSeed((G.seed || 0) + ':berry:' + count));
    const pool = [];
    for (const [lv, w] of BERRY_WEIGHTS) {
      if (lv === G.level) continue;                       // 排除当前关
      if (BR.Levels && !BR.Levels[lv]) continue;          // 关卡未接入时跳过
      for (let i = 0; i < w; i++) pool.push(lv);
    }
    const dest = pool.length ? pool[rng.int(0, pool.length - 1)] : 'L0';
    return { dest, count };
  };
  U.useItem = function (id) {
    const G = BR.Game, P = BR.Player;
    if (!G || !P || G.state !== 'playing') return;
    const inv = G.inv;
    if (id === 'flashlight') { P.toggleFlashlight(); this.updateInv(); return; }
    if (!(inv[id] > 0)) { this.toast('没有' + ITEM_INFO[id].name); return; }
    if (id === 'almond') {
      if (P.hp >= 100 && P.sanity >= 100) { this.toast('状态已满，不需要喝'); return; }
      inv.almond--; P.heal(35); P.restoreSanity(30); BR.Audio.drink();
      this.toast('喝下杏仁水，恢复了体力和理智');
    } else if (id === 'bandage') {
      if (P.hp >= 100) { this.toast('生命已满，不需要包扎'); return; }
      inv.bandage--; P.heal(55); BR.Audio.heal(); this.toast('包扎伤口，恢复了生命');
    } else if (id === 'berry') {
      // 迁跃浆果：食用即传送。物品说明（ITEM_INFO.berry.desc）已明确告知
      // "目标随机，可能更危险，不是安全回城"，直接执行。
      inv.berry--;
      BR.Audio.drink();
      const pick = this.pickBerryDest();
      const evs = BR.World && BR.World.state && BR.World.state.events;
      if (evs) {
        evs.push('berry_' + pick.count + ':' + G.level + '>' + pick.dest);
        BR.bus.emit('event', { id: 'berry_' + pick.count });
      }
      // 跨关单调计数（见 countBerryEvents 注释）
      G.flags.berryCount = (G.flags.berryCount || 0) + 1;
      this.toast('浆果在你嘴里化开——空间开始扭曲！', 2600);
      if (BR.Cutout && BR.Cutout.travel) {
        BR.Cutout.travel(pick.dest, { kind: 'berry' });
      } else {
        // Systems A 的 cutout.js 尚未接入时的兜底：直接跨关（抵达演出缺失）
        G.gotoLevel(pick.dest, { drop: true });
      }
    } else if (id === 'food') {
      // 食物：只回饥饿（+40），少量回血（+5）。满饥饿时拒绝使用。
      if (P.hunger >= 100) { this.toast('已经吃饱了'); return; }
      inv.food--; P.eat(40); P.heal(5); BR.Audio.drink();
      this.toast('吃下食物，恢复了饥饿（+40），少量回血');
    }
    this.updateInv();
  };

  // 桌面端 HUD 角落常驻键位提示；触屏端已有触控按钮，不显示
  U.renderKeyHint = function () {
    const el = BR.$('key-hint');
    if (!el) return;
    el.innerHTML =
      '<span><kbd>W A S D</kbd>移动</span>' +
      '<span><kbd>Shift</kbd>疾跑</span>' +
      '<span><kbd>C</kbd>蹲伏</span>' +
      '<span><kbd>E</kbd>交互</span>' +
      '<span><kbd>F</kbd>手电</span>' +
      '<span><kbd>1-5</kbd>物品</span>' +
      '<span><kbd>Esc</kbd>暂停</span>';
    el.style.display = (BR.Input && BR.Input.isTouch) ? 'none' : 'flex';
  };
  /* ---------- 笔记 ---------- */
  U.showNote = function (title, body) {
    this._noteReturn = 'hud';
    this.$note_title.textContent = title || '字条';
    this.$note_body.textContent = body || '';
    this.show('screen-note');
    BR.Input.setLocked(true);
  };
  U.closeNote = function () {
    this.show(null);
    BR.Input.setLocked(false);
  };

  /* ---------- 暂停 ---------- */
  U.togglePause = function (force) {
    const G = BR.Game;
    if (G.state !== 'playing' && G.state !== 'paused') return;
    const toPause = force === true ? true : G.state === 'playing';
    if (toPause) {
      G.state = 'paused';
      BR.Input.setLocked(true);
      this.renderSettings();
      this.show('screen-pause');
      BR.Audio.setPaused(true);
    } else {
      G.state = 'playing';
      BR.Input.setLocked(false);
      this.show(null);
      BR.Audio.setPaused(false);
    }
  };
  U.renderSettings = function () {
    const s = BR.Input.settings;
    this.$set_sens.value = s.sens; this.$sens_val.textContent = s.sens.toFixed(1);
    this.$set_vol.value = s.vol; this.$vol_val.textContent = Math.round(s.vol * 100) + '%';
    this.$set_joysize.value = s.joySize; this.$joysize_val.textContent = s.joySize + 'px';
    this.$set_joyside.value = s.joySide;
    this.$set_quality.value = s.quality || 'auto';
    const hb = BR.$('set-headbob');
    if (hb) hb.value = s.headbob || 'on';
    const dc = BR.$('set-dropcam'); // Systems A：坠落镜头强度
    if (dc) dc.value = s.dropcam || 'full';
    const fs = BR.$('btn-fullscreen');
    if (fs) fs.textContent = BR.Input.isFullscreen() ? '退出全屏' : '进入全屏';
  };

  /* ---------- 死亡 / 结局 ---------- */
  U.showDeath = function (cause) {
    const texts = {
      hound: '猎犬从黑暗中扑了出来。',
      partygoer: '派对客抓住了你。现在，你也是派对的一员了。=)',
      steam: '过热的蒸汽灼伤了你。',
      lurker: '潜伏者把你拖进了管道阴影。',
      fall: '你坠入了无光的深渊。',
      default: '你死在了后室深处。'
    };
    this.$death_cause.textContent = texts[cause] || texts.default;
    this.show('screen-death');
    BR.Input.setLocked(true);
  };
  U.showEnding = function (title, body) {
    this.$ending_title.textContent = title;
    this.$ending_body.textContent = body;
    this.show('screen-ending');
    BR.Input.setLocked(true);
  };

  /* ---------- 调试面板 ---------- */
  U.updateDebug = function () {
    if (!BR.DEBUG) { this.$debug.style.display = 'none'; return; }
    this.$debug.style.display = 'block';
    const st = BR.World.getStats();
    const fps = BR.Game.fps || 0;
    this.$debug.innerHTML =
      `FPS ${fps.toFixed(0)} · 区块 ${st.chunks} · 实体 ${st.entities}<br>` +
      `种子 ${st.seed} · 绘制 ${st.drawCalls} · 三角 ${st.tris}<br>` +
      `关卡 ${BR.Game.level} · HP ${Math.round(BR.Player.hp)}`;
  };

  /* ---------- 按钮绑定 ---------- */
  U.bindButtons = function () {
    const G = () => BR.Game;
    BR.$('btn-new').onclick = () => {
      const s = this.peekSeedInput() != null ? this.peekSeedInput() : this.newSeed();
      BR.Save.clearSave();
      G().newGame(s);
    };
    BR.$('btn-continue').onclick = () => G().continueGame();
    BR.$('btn-how').onclick = () => this.show('screen-how');
    BR.$('btn-how-back').onclick = () => this.showTitle();
    BR.$('btn-wipe').onclick = () => {
      if (BR.Save.hasSave() && !confirm('确定要删除当前存档吗？')) return;
      BR.Save.clearSave();
      this.refreshContinue();
      this.toast('存档已清除');
    };
    BR.$('btn-reseed').onclick = () => {
      const s = this.newSeed();
      this.$seed_line.textContent = '世界种子：' + s;
      this.$seed_line.dataset.seed = s;
      BR.$('seed-input').value = '';
    };
    BR.$('btn-resume').onclick = () => this.togglePause(false);
    BR.$('btn-settings-back') && (BR.$('btn-settings-back').onclick = () => this.togglePause(false));
    BR.$('btn-quit-title').onclick = () => {
      BR.Save.saveGame();
      location.reload();
    };
    BR.$('btn-note-close').onclick = () => this.closeNote();
    BR.$('btn-retry').onclick = () => G().retryAfterDeath();
    BR.$('btn-death-title').onclick = () => { BR.Save.clearSave(); location.reload(); };
    BR.$('btn-ending-title').onclick = () => { BR.Save.clearSave(); location.reload(); };
    // 设置项
    const S = BR.Input.settings;
    this.$set_sens.oninput = (e) => { S.sens = +e.target.value; this.$sens_val.textContent = S.sens.toFixed(1); BR.Input.saveSettings(); };
    this.$set_vol.oninput = (e) => { S.vol = +e.target.value; this.$vol_val.textContent = Math.round(S.vol * 100) + '%'; BR.Audio.setVolume(S.vol); BR.Input.saveSettings(); };
    this.$set_joysize.oninput = (e) => { S.joySize = +e.target.value; this.$joysize_val.textContent = S.joySize + 'px'; BR.Input.saveSettings(); };
    this.$set_joyside.onchange = (e) => { S.joySide = e.target.value; BR.Input.applyJoySide(); BR.Input.saveSettings(); };
    this.$set_quality.onchange = (e) => { S.quality = e.target.value; BR.Input.saveSettings(); BR.UI.toast('画质将在下次进入关卡时生效'); };
    const hb = BR.$('set-headbob');
    if (hb) hb.onchange = (e) => { S.headbob = e.target.value; BR.Input.saveSettings(); };
    const dc = BR.$('set-dropcam'); // Systems A：坠落镜头强度（唯一允许的 ui.js 新增）
    if (dc) dc.onchange = (e) => { S.dropcam = e.target.value; BR.Input.saveSettings(); };
    const fsb = BR.$('btn-fullscreen');
    if (fsb) fsb.onclick = () => {
      BR.Input.toggleFullscreen();
      setTimeout(() => this.renderSettings(), 400);
    };
    // 物品快捷键
    addEventListener('keydown', (e) => {
      if (G().state !== 'playing') return;
      if (e.code === 'Digit1') this.useItem('almond');
      if (e.code === 'Digit2') this.useItem('bandage');
      if (e.code === 'Digit3') this.useItem('flashlight');
      if (e.code === 'Digit4') this.useItem('berry');
      if (e.code === 'Digit5') this.useItem('food');
    });
  };
})();
