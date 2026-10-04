/* ui.js —— 全部界面：标题/暂停/设置/HUD/笔记/死亡/结局/提示 */
(function () {
  const BR = window.BR;

  const U = {};
  BR.UI = U;

  const ITEM_INFO = {
    almond: {
      name: '杏仁水',
      desc: '后室最可靠的补给：回血 35、理智 30。苦，但管用。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3c3.2 4.2 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 2.8-6.8 6-11z"/></svg>'
    },
    bandage: {
      name: '绷带',
      desc: '包扎伤口，恢复生命 55。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="8.5" width="17" height="7" rx="3.5"/><path d="M12 10.8v2.4M10.8 12h2.4"/></svg>'
    },
    flashlight: {
      name: '手电筒',
      desc: '照亮黑暗，但也更容易被看见。靠电池供电：开灯时持续耗电，没电会自动熄灭。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h6v5H9z"/><path d="M10 7.5 6.5 15a2.4 2.4 0 0 0 2.1 3.5h6.8a2.4 2.4 0 0 0 2.1-3.5L14 7.5"/></svg>'
    },
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
    },
    // —— 香烟：镇静，理智 +12 ——
    cigarette: {
      name: '香烟',
      desc: '点上一支，深吸一口。镇静效果：理智 +12。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 14.5h10v3H3z"/><path d="M13 14.5h4v3h-4z"/><path d="M4.5 11.5c-1.4 1-1.4 2.6 0 3.6"/><path d="M7.5 10.5c-1.6 1.3-1.6 3.2 0 4.5" opacity="0.55"/></svg>'
    },
    // —— 口香糖：理智 +6 ——
    gum: {
      name: '口香糖',
      desc: '嚼一嚼，甜味能稍微安抚神经。理智 +6。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 8.5h9v7h-9z"/><path d="M7.5 8.5 4.5 6v12l3-2.5"/><path d="M16.5 8.5l3-2.5v12l-3-2.5"/><path d="M10.2 12h3.6"/></svg>'
    },
    // —— 皇家口粮：高级食物，饥饿 +70、回血 +15 ——
    royal_ration: {
      name: '皇家口粮',
      desc: '高级单兵口粮：食用恢复饥饿 +70，生命 +15。味道意外地不错。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11h10v8a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19z"/><path d="M7 11c0-1.8 2.2-3 5-3s5 1.2 5 3"/><path d="M9.2 5.4l1.1 1.5L12 4.8l1.7 2.1 1.1-1.5"/></svg>'
    },
    // —— 笑魇驱散剂：15 米内实体驱散 20 秒 ——
    repellent: {
      name: '笑魇驱散剂',
      desc: '对着空气喷洒：15 米内的实体会被刺鼻气味驱散，逃跑 20 秒。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 9.5h4V20a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/><path d="M10.8 9.5V7.5h2.4v2"/><path d="M13.2 6h3.2v3h-3.2"/><path d="M18.5 5.5l3-1M18.5 8.5l3.2 0M18.5 11.5l3 1"/></svg>'
    },
    // —— 火盐：投掷爆炸，半径 4 米 ——
    firesalt: {
      name: '火盐',
      desc: '朝准星方向投掷，落地爆炸：半径 4 米内的实体受伤并被驱散。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12.5h10l-1.1 7.2a1.5 1.5 0 0 1-1.5 1.3H9.6a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M7 12.5c1.6-1.6 8.4-1.6 10 0"/><path d="M12 3.2c1.5 1.9 2.4 3.2 2.4 4.7a2.4 2.4 0 0 1-4.8 0c0-1.5.9-2.8 2.4-4.7z"/></svg>'
    },
    // —— 痛液：前方锥形泼洒，腐蚀 5 秒 ——
    painliquid: {
      name: '痛液',
      desc: '向前方锥形泼洒强腐蚀液体，沾到的实体持续受腐蚀 5 秒，痛苦逃窜。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4"/><path d="M11 3v5l-4.5 8a2.4 2.4 0 0 0 2.1 3.5h6.8a2.4 2.4 0 0 0 2.1-3.5L13 8V3"/><path d="M9.2 16.5h5.6"/><path d="M18.6 13.5c.9 1.1 1.5 1.9 1.5 2.8a1.5 1.5 0 0 1-3 0c0-.9.6-1.7 1.5-2.8z"/></svg>'
    },
    // —— 腰果水：陷阱（说明不许剧透） ——
    // LORE 注释：这不是杏仁水。说明文字刻意写成"看起来像杏仁水…"，让玩家自己踩坑。
    // 图标与杏仁水几乎一样（描边略黄 + 多一道高光），细心者能看出差别。
    cashew: {
      name: '腰果水',
      desc: '看起来像杏仁水……颜色好像有点偏黄？应该是光线问题吧。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#e3c878" stroke-width="1.8" stroke-linecap="round"><path d="M12 3c3.2 4.2 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 2.8-6.8 6-11z"/><path d="M9.6 14.4a2.8 2.8 0 0 0 1.9 2.7" opacity="0.7"/></svg>'
    },
    // —— 电池：手电电量 +60 ——
    battery: {
      name: '电池',
      desc: '标准电池：为手电恢复 60% 电量（上限 100%）。',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="8" width="11" height="12" rx="2"/><path d="M10.5 8V5.5h3V8"/><path d="M12.8 10.5 10.8 14h3l-2 3.5"/></svg>'
    }
  };
  // W9：新道具注册表（js/items.js）的显示信息合并进来；老 13 种保持原样不动
  if (BR.Items && BR.Items.DEFS) {
    for (const id in BR.Items.DEFS) {
      if (!ITEM_INFO[id]) {
        const d = BR.Items.DEFS[id];
        ITEM_INFO[id] = { name: d.name, desc: d.desc, icon: d.icon };
      }
    }
  }

  U.init = function () {
    this.ensureShopPanel(); // M.E.G. 交易站面板（index.html 不许动，动态创建；必须在 cacheEls 之前）
    this.cacheEls();
    this.ensureHungerBar();
    this.ensureStaminaBar();
    this.renderKeyHint();
    this.renderKeysTable();
    this.bindButtons();
    this.renderSettings();
  };
  // 商店面板 DOM（index.html 不许动，这里动态创建；cacheEls 统一缓存）
  U.ensureShopPanel = function () {
    if (BR.$('screen-shop')) return;
    const d = document.createElement('div');
    d.id = 'screen-shop';
    d.className = 'screen';
    d.innerHTML =
      '<div class="panel shop-panel">' +
      '<h2>M.E.G. 前哨交易站 <span class="shop-wallet">杏仁水 ×<b id="shop-almond">0</b></span></h2>' +
      '<div class="shop-sub" id="shop-sub">队员：「明码标价，童叟无欺。杏仁水是硬通货。」</div>' +
      '<div id="shop-list"></div>' +
      '<button id="btn-shop-close" class="big">离开（Esc）</button>' +
      '</div>';
    document.body.appendChild(d);
  };
  // W9：耐力条 DOM（index.html 不许动，这里动态创建；疾跑时直观可见）
  U.ensureStaminaBar = function () {
    if (!this.$hud || BR.$('stam-wrap')) return;
    const w = document.createElement('div');
    w.id = 'stam-wrap';
    w.style.cssText = 'position:absolute;left:12px;top:calc(80px + env(safe-area-inset-top));' +
      'width:132px;height:6px;background:rgba(10,14,10,0.72);' +
      'border:1px solid #3a4a34;border-radius:3px;overflow:hidden;';
    const f = document.createElement('div');
    f.id = 'stam-fill';
    f.style.cssText = 'height:100%;width:100%;' +
      'background:linear-gradient(90deg,#5a9a3a,#9ae87a);transition:width 0.2s;';
    w.appendChild(f);
    this.$hud.appendChild(w);
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
     'screen-backpack', 'bp-grid', 'btn-bp-close', 'bp-key-hint',
     'screen-shop', 'shop-list', 'shop-almond', 'btn-shop-close', 'shop-sub',
     'prompt', 'objective', 'toasts', 'debug',
     'note-title', 'note-body', 'death-cause', 'ending-title', 'ending-body',
     'trans-text', 'seed-line', 'btn-continue', 'set-sens', 'set-vol',
     'set-joysize', 'set-joyside', 'set-quality', 'sens-val', 'vol-val', 'joysize-val',
     'bindings-list', 'btn-bindings-reset', 'keys-table'
    ].forEach(id => { this['$' + id.replace(/-/g, '_')] = BR.$(id); });
  };

  U.show = function (name) {
    ['screen-title', 'screen-how', 'screen-loading', 'screen-pause',
     'screen-note', 'screen-death', 'screen-ending', 'screen-backpack',
     'screen-shop'].forEach(s => {
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
  // v1.5.1：HUD 快捷栏已移除（使用只走背包）。updateInv 仅刷新血条/理智条/饥饿条。
  U.updateInv = function () {
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
    if (uf) {
      uf.style.width = hun + '%';
      // E：饥饿档位警告——≤33 虚弱档红闪；归零（≤0）红闪加强
      uf.classList.toggle('weak', hun <= 33 && hun > 0);
      uf.classList.toggle('crit', hun <= 0);
      uf.classList.remove('low'); // 旧 <25 档位已由 .weak 接管
    }
    BR.$('dmg-vignette').style.opacity = hp < 35 ? (0.65 - hp / 60) : 0;
    // W9：耐力条
    const stf = BR.$('stam-fill');
    if (stf && BR.Player) {
      const smax = (BR.Items && BR.Items.CONFIG.stamina.max) || 100;
      stf.style.width = Math.max(0, Math.min(100, BR.Player.stamina / smax * 100)) + '%';
    }
    // G（v1.3）：触屏按钮高亮与玩家状态同步（蹲下/第三人称/手电/疾跑）
    if (BR.Input && BR.Input.syncTouchStates) BR.Input.syncTouchStates();
  };
  // 低理智暗角（player.update 每帧调用）
  // Systems C-A：叠加轻度视线模糊（0~1.8px，随理智线性渐变；设置 sanityfx='off' 可关闭）
  U.setSanityFx = function (sanity) {
    const el = BR.$('sanity-vignette');
    if (!el) return;
    el.style.opacity = sanity < 40 ? (0.55 * (1 - sanity / 40)).toFixed(2) : 0;
    if (BR.SanityEvents && BR.SanityEvents.applyBlur) BR.SanityEvents.applyBlur(sanity);
  };
  // 迁跃浆果目的地：候选池权重与裂隙系统同表（EXPANSION_PLAN §2），排除当前关；
  // 用 seed + ':berry:' + count 派生 RNG（可复现），count = 此前食用浆果次数。
  // 未注册的关卡（扩建文件未接入时）自动跳过，保证食用不落空。
  const BERRY_WEIGHTS = [['L0', 15], ['L1', 15], ['L11', 12], ['L37', 12],
    ['L188', 10], ['L7', 8], ['L2', 8], ['L3', 6], ['FUN', 4]];
  // v1.5 W6：L94 从此表移除（94→! 替换）；实际候选走 BR.Cutout.pickRandomDest，
  // Level !（'bang'）由 lv_bang.js 经 registerRiftDest 登记，权重 10。
  U.countBerryEvents = function () {
    // 跨关单调计数：flags.berryCount 在食用后递增、存档保留。
    // （修 bug：原来按本关 ws.events 计数，跨关后新关 events 为空，count 永远从 0 开始导致落点重复）
    return (BR.Game && BR.Game.flags && BR.Game.flags.berryCount) || 0;
  };
  U.pickBerryDest = function () {
    const G = BR.Game;
    const count = this.countBerryEvents();
    const rng = new BR.RNG(BR.hashSeed((G.seed || 0) + ':berry:' + count));
    // W10：与裂隙共用候选池（仅已完成且合规；尊重 flags.bangEscaped）；
    // 权重表/顺序与旧 BERRY_WEIGHTS 一致，同种子同 count 落点不变
    const dest = (BR.Cutout && BR.Cutout.pickRandomDest) ?
      BR.Cutout.pickRandomDest(G.level, rng) : 'L0';
    return { dest, count };
  };
  U.useItem = function (id) {
    const G = BR.Game, P = BR.Player;
    if (!G || !P || G.state !== 'playing') return;
    // W9：新道具（js/items.js 注册表）走统一逻辑；返回 true 表示已处理
    if (BR.Items && BR.Items.handle(id)) return;
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
    } else if (id === 'cigarette') {
      // 香烟：镇静，理智 +12
      if (P.sanity >= 100) { this.toast('已经很镇定了'); return; }
      inv.cigarette--; P.restoreSanity(12); BR.Audio.drink();
      this.toast('点上一支烟，深吸一口，紧绷的神经松弛下来（理智+12）');
    } else if (id === 'gum') {
      // 口香糖：理智 +6
      if (P.sanity >= 100) { this.toast('已经很镇定了'); return; }
      inv.gum--; P.restoreSanity(6);
      this.toast('嚼了块口香糖，甜味让你稍微冷静了一点（理智+6）');
    } else if (id === 'royal_ration') {
      // 皇家口粮：高级食物，饥饿 +70、回血 +15
      if (P.hunger >= 100 && P.hp >= 100) { this.toast('状态已满，不需要进食'); return; }
      inv.royal_ration--; P.eat(70); P.heal(15); BR.Audio.drink();
      this.toast('皇家口粮：饥饿+70，生命+15，味道意外地不错');
    } else if (id === 'repellent') {
      // 笑魇驱散剂：15 米内敌对实体驱散/逃跑 20 秒；附近没实体时不消耗
      const n = (BR.Entities && BR.Entities.fleeRadius)
        ? BR.Entities.fleeRadius(P.pos.x, P.pos.z, 15, 20) : 0;
      if (n > 0) {
        inv.repellent--;
        BR.Audio.uiClick();
        this.toast('喷洒驱散剂！' + n + ' 个实体尖叫着逃开了（20 秒）', 3000);
      } else {
        this.toast('附近没有实体');
      }
    } else if (id === 'firesalt') {
      // 火盐：朝准星方向投掷，落点=射线命中点或最远 14 米；半径 4 米爆炸
      inv.firesalt--;
      const W = BR.World;
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(P.camera.rotation);
      let lx = P.pos.x, lz = P.pos.z;
      const maxD = 14;
      if (W && W.circleFree) {
        for (let d = 0.5; d <= maxD; d += 0.5) {
          const nx = P.pos.x + dir.x * d, nz = P.pos.z + dir.z * d;
          if (!W.circleFree(nx, nz, 0.3)) break; // 撞墙：落点=命中点
          lx = nx; lz = nz;
        }
      } else { lx = P.pos.x + dir.x * maxD; lz = P.pos.z + dir.z * maxD; }
      P.shake(0.5);
      BR.Audio.stinger();
      let n = 0, dmg = 0;
      if (BR.Entities && BR.Entities.hurtRadius) {
        const r = BR.Entities.hurtRadius(lx, lz, 4, 40);
        n = r.n; dmg = r.dmg;
      }
      if (n > 0) this.toast('火盐爆炸！命中 ' + n + ' 个实体（-' + dmg + '），它们被炸得四散逃开！', 3000);
      else this.toast('火盐在前方炸开，没有命中实体');
    } else if (id === 'painliquid') {
      // 痛液：向前方锥形（6 米、半角约 45°）泼洒，腐蚀 5 秒
      inv.painliquid--;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      let n = 0;
      if (BR.Entities && BR.Entities.coneCorrode)
        n = BR.Entities.coneCorrode(P.pos.x, P.pos.z, fx, fz, 6, 0.7, 5);
      P.shake(0.25);
      BR.Audio.drink();
      if (n > 0) this.toast('痛液泼洒！' + n + ' 个实体被腐蚀（5 秒），痛苦地逃窜', 3000);
      else this.toast('痛液泼向前方，什么都没沾到');
    } else if (id === 'cashew') {
      // 腰果水：陷阱——理智 -25、生命 -5、巨大噪音吸引实体（说明不剧透，见 ITEM_INFO）
      inv.cashew--;
      P.drainSanity(25);
      P.hp = Math.max(0, P.hp - 5);
      P.trauma = Math.min(1, P.trauma + 0.35);
      BR.bus.emit('hurt', { hp: P.hp, cause: 'cashew' });
      BR.bus.emit('noise', { level: 1 });
      BR.Audio.drink();
      this.toast('这水味道不对——又苦又涩！理智-25，生命-5，还发出了巨大的声响……', 3600);
      if (P.hp <= 0) { P.hp = 0; P.setState('disabled'); BR.bus.emit('died', { cause: 'cashew' }); }
    } else if (id === 'battery') {
      // 电池：手电电量 +60（上限 100）
      // W9 扩展：手电已满、且持有未满电的水下照明灯时，给照明灯充电（同样 +60，上限 100）；
      // 两者都满才拒绝（原"手电电池已满"语义保留）
      const dl = P.diveLight;
      const needFlash = P.flashBat < 100;
      const needDive = !!(dl && dl.charge < 100);
      if (!needFlash && !needDive) { this.toast('手电电池已满'); return; }
      inv.battery--;
      BR.Audio.uiClick();
      if (needFlash) {
        P.flashBat = Math.min(100, P.flashBat + 60);
        this.toast('换上新电池，手电电量恢复到 ' + Math.round(P.flashBat) + '%');
      } else {
        dl.charge = Math.min(100, dl.charge + 60);
        this.toast('给水下照明灯充电，电量恢复到 ' + Math.round(dl.charge) + '%');
      }
    }
    // G（v1.4）：道具消耗/状态变化后立刻落盘——刷新页面不再恢复已消耗的道具。
    // 提前 return 的拒绝路径（生命已满/数量为 0 等）不走到这里，不会误存档。
    if (G.autosave) G.autosave();
    this.updateInv();
  };

  // 桌面端 HUD 角落常驻键位提示：全部读按键绑定实时渲染，不写死；
  // 触屏端：显示触控操作说明（摇杆/视角/右侧按钮），不再隐藏
  U.renderKeyHint = function () {
    const el = BR.$('key-hint');
    if (!el || !BR.Input || !BR.Input.bindings) return;
    const I = BR.Input;
    if (I.isTouch) {
      el.innerHTML =
        '<span>左侧摇杆：移动</span><span>右侧拖动：视角</span>' +
        '<span>右侧按钮：交互 / 跳跃 / 奔跑 / 蹲下 / 手电 / 道具 / 背包 / 视角切换</span>' +
        '<span>游泳：上浮 / 下潜按钮 · 坐骑：下坐骑按钮</span>';
      el.style.display = 'flex';
      return;
    }
    const kb = (label) => `<kbd>${label}</kbd>`;
    // 移动：四个方向各取当前绑定（默认 W A S D + 方向键）
    const move = ['fwd', 'left', 'back', 'right'].map(a => kb(I.bindingLabel(a))).join('');
    let html = `<span>${move}移动</span>`;
    // v1.5 W8：动作表与新默认键位对齐；未绑定的动作不在 HUD 占位
    const rest = [
      ['run', '疾跑'], ['dive', '蹲/潜'], ['interact', '交互'],
      ['jump', '跳/浮'], ['flashlight', '手电'], ['backpack', '背包'],
      ['thirdperson', '视角'], ['pause', '暂停']
    ];
    for (const [a, name] of rest) {
      const label = I.bindingLabel(a);
      if (label === '未绑定') continue; // 未绑定的动作不在 HUD 占位
      html += `<span>${kb(label)}${name}</span>`;
    }
    el.innerHTML = html;
    el.style.display = I.isTouch ? 'none' : 'flex';
  };

  // 玩法说明里的键位表：按动作表动态生成行（index.html 只留空 table 容器）
  // G（v1.3）：双平台说明——电脑端 / 手机端 两栏；电脑端读当前改键绑定，手机端读触控操作
  U.TOUCH_OP = {
    move: '左侧摇杆', look: '右侧区域拖动', run: '跑步按钮（开关）',
    crouch: '蹲下按钮（仅陆地）', interact: '交互按钮', flashlight: '手电筒按钮',
    backpack: '背包按钮', thirdperson: '视角按钮（右列）',
    jump: '跳跃按钮（水中按住=上浮）', dive: '下潜按钮（按住）',
    pause: '右上角暂停按钮',
    dismount: '下坐骑按钮（坐骑时出现）'
  };
  U.renderKeysTable = function () {
    const tb = this.$keys_table;
    if (!tb || !BR.Input || !BR.Input.bindings) return;
    const I = BR.Input;
    const k = (label) => label === '未绑定'
      ? '<span class="k dim">未绑定</span>'
      : `<span class="k">${label}</span>`;
    const row = (name, pc, mob) => `<tr><td>${name}</td><td>${pc}</td><td>${mob}</td></tr>`;
    // v1.5 W8：动作表与新默认键位对齐（电脑端读当前改键绑定，手机端读触控操作）
    tb.innerHTML =
      '<thead><tr><th>动作</th><th>电脑端</th><th>手机端</th></tr></thead><tbody>' +
      row('移动', ['fwd', 'left', 'back', 'right'].map(a => k(I.bindingLabel(a))).join(''), U.TOUCH_OP.move) +
      row('视角', '鼠标<span class="dim">（点击画面锁定）</span>', U.TOUCH_OP.look) +
      row('疾跑', k(I.bindingLabel('run')), U.TOUCH_OP.run) +
      row('蹲下 / 下潜', k(I.bindingLabel('dive')) + '<span class="dim">（陆地按一下=蹲/起身；深水区按住=下潜）</span>', U.TOUCH_OP.crouch + ' / ' + U.TOUCH_OP.dive) +
      row('交互', k(I.bindingLabel('interact')) + '<span class="dim">（坐骑上按=下坐骑）</span>', U.TOUCH_OP.interact) +
      row('手电筒', k(I.bindingLabel('flashlight')), U.TOUCH_OP.flashlight) +
      row('背包', k(I.bindingLabel('backpack')) + ' 打开背包，点击道具直接使用',
        U.TOUCH_OP.backpack + '打开背包，点道具直接使用') +
      row('第三人称', k(I.bindingLabel('thirdperson')), U.TOUCH_OP.thirdperson) +
      row('跳跃 / 上浮', k(I.bindingLabel('jump')) + '<span class="dim">（陆地跳跃；深水区按住=上浮）</span>', U.TOUCH_OP.jump) +
      row('下坐骑', k(I.bindingLabel('interact')) + '<span class="dim">（坐骑上按交互键）</span>', U.TOUCH_OP.dismount) +
      row('暂停', k(I.bindingLabel('pause')), U.TOUCH_OP.pause) +
      '</tbody>';
  };

  /* ---------- 暂停菜单：按键设置 ---------- */
  U.renderBindings = function () {
    const list = this.$bindings_list;
    if (!list || !BR.Input || !BR.Input.bindings) return;
    const I = BR.Input;
    let html = '';
    for (const a of Object.keys(I.ACTION_NAMES)) {
      const capturing = I.captureAction === a;
      html += `<div class="bind-row"><span class="bind-name">${I.ACTION_NAMES[a]}</span>` +
        `<button class="ghost bind-key${capturing ? ' capturing' : ''}" data-action="${a}">` +
        (capturing ? '按下新按键… Esc 取消' : I.bindingLabel(a)) + '</button></div>';
    }
    list.innerHTML = html;
    list.querySelectorAll('.bind-key').forEach(btn => {
      btn.addEventListener('click', () => {
        // 刚捕获写入那次 mousedown 紧接着的 click：忽略，防又开一次捕获
        if (Date.now() - (I._captureEndT || 0) < 300) return;
        if (I.captureAction) return; // 已在捕获中
        btn.blur(); // 失焦，防空格键触发按钮默认点击
        I.startCapture(btn.dataset.action);
        this.renderBindings();
      });
    });
    const reset = this.$btn_bindings_reset;
    if (reset && !reset._bound) {
      reset._bound = true;
      reset.onclick = () => {
        I.resetBindings();
        this.renderBindings();
        this.renderKeyHint();
        this.renderKeysTable();
        this.toast('已恢复默认按键');
      };
    }
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

  /* ---------- 背包（B 键） ---------- */
  U._bpOpen = false; // 背包是否打开
  // 开/关背包：暂停语义（state 置 paused，关闭恢复 playing），参考 togglePause
  U.toggleBackpack = function (force) {
    const G = BR.Game;
    const open = force === true ? true : force === false ? false : !this._bpOpen;
    if (open) {
      if (!G || G.state !== 'playing' || this._bpOpen) return;
      this._bpOpen = true;
      G.state = 'paused';
      BR.Input.setLocked(true);
      this.renderBackpack();
      this.show('screen-backpack');
      BR.Audio.setPaused(true);
    } else {
      if (!this._bpOpen) return;
      this._bpOpen = false;
      G.state = 'playing';
      BR.Input.setLocked(false);
      this.show(null);
      BR.Audio.setPaused(false);
    }
  };
  // 背包面板：网格列出所有有数量的道具（手电筒按持有显示电量）。
  // v1.5.1 简化：单击道具直接使用（按 kind 走 useItem 统一逻辑），取消"选中再点使用按钮"两步流程。
  // 空背包显示空白面板（无多余文案）。桌面/手机共用同一套 click 逻辑（touchstart 阻止合成 click 防双触发）。
  U.renderBackpack = function () {
    const grid = this.$bp_grid;
    if (!grid) return;
    const inv = (BR.Game && BR.Game.inv) || {};
    const P = BR.Player;
    const ids = Object.keys(ITEM_INFO).filter(id => {
      if (id === 'flashlight') return !!(P && P.hasFlashlight);
      // W9：水下照明灯不占 inv 数量，按 P.diveLight 持有显示
      if (id === 'dive_light') return !!(P && P.diveLight);
      return (inv[id] || 0) > 0;
    });
    let html = '';
    ids.forEach(id => {
      const info = ITEM_INFO[id];
      const ct = id === 'flashlight'
        ? Math.round(P.flashBat != null ? P.flashBat : 100) + '%'
        : id === 'dive_light'
          ? Math.round(P.diveLight.charge) + '%'
          : (inv[id] || 0);
      html += `<div class="bp-cell" data-id="${id}">` +
        `<span class="ic">${info.icon}</span><span class="nm">${info.name}</span>` +
        `<span class="ct">${ct}</span></div>`;
    });
    grid.innerHTML = html; // 空背包：空白面板（无文案）
    grid.querySelectorAll('.bp-cell').forEach(el => {
      const use = () => {
        const id = el.dataset.id;
        // 先关背包（恢复 playing），再走正常使用流程（useItem 内含各类 guard）
        this.toggleBackpack(false);
        this.useItem(id);
      };
      el.addEventListener('click', use);
      // 触屏：直接消费并阻止合成 click，避免一次点击消耗两个道具
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); use(); }, { passive: false });
    });
    if (this.$bp_key_hint && BR.Input)
      this.$bp_key_hint.textContent = '（' + BR.Input.bindingLabel('backpack') + ' / Esc 关闭）';
  };

  /* ---------- M.E.G. 前哨交易站（L1 POI 'meg_shop' 的商店交互打开） ----------
   * 货币：杏仁水。价格表（消耗品便宜、稀有道具贵）：
   *   绷带 2 / 手电电池 2 / 皇家口粮 3 / 笑魇驱散剂 4 / 火盐 6 / 迁跃浆果 8
   * 只买不卖：买入扣杏仁水、道具进背包；不足时按钮灰显 + 点击提示。
   * 买入走 BR.Game.inv 与 autosave，正常进存档（存档字段本来就是 inv 全量）。 */
  U.SHOP_GOODS = [
    { id: 'bandage', price: 2 },      // 绷带：常用消耗品
    { id: 'battery', price: 2 },      // 手电电池：常用消耗品
    { id: 'royal_ration', price: 3 }, // 皇家口粮：高级食物
    { id: 'repellent', price: 4 },    // 笑魇驱散剂：中端保命
    { id: 'firesalt', price: 6 },     // 火盐：稀有攻击道具
    { id: 'berry', price: 8 }         // 迁跃浆果：稀有传送道具
  ];
  U._shopOpen = false; // 商店面板是否打开
  // 开商店：暂停语义（参考 toggleBackpack）
  U.openShop = function () {
    const G = BR.Game;
    if (!G || G.state !== 'playing' || this._shopOpen) return;
    this._shopOpen = true;
    G.state = 'paused';
    BR.Input.setLocked(true);
    this.renderShop();
    this.show('screen-shop');
    BR.Audio.setPaused(true);
  };
  U.closeShop = function () {
    if (!this._shopOpen) return;
    this._shopOpen = false;
    BR.Game.state = 'playing';
    BR.Input.setLocked(false);
    this.show(null);
    BR.Audio.setPaused(false);
    this.updateInv(); // 同步 HUD（购买后数量变化）
  };
  // 商店列表：图标/名/说明/持有数/价格按钮；买不起的灰显。
  // 触屏：整行可点（行点击=购买），按钮最小 48px（CSS）；买不起点行会 toast 提示。
  U.renderShop = function () {
    const list = this.$shop_list;
    if (!list) return;
    const inv = (BR.Game && BR.Game.inv) || {};
    const almond = inv.almond || 0;
    if (this.$shop_almond) this.$shop_almond.textContent = almond;
    // 触屏模式不写键盘按键：关闭按钮只写"关闭"
    if (this.$btn_shop_close)
      this.$btn_shop_close.textContent = (BR.Input && BR.Input.isTouch) ? '关闭' : '离开（Esc）';
    let html = '';
    this.SHOP_GOODS.forEach(g => {
      const info = ITEM_INFO[g.id];
      if (!info) return;
      const own = inv[g.id] || 0;
      const afford = almond >= g.price;
      html += `<div class="shop-row${afford ? '' : ' cant'}" data-id="${g.id}">` +
        `<span class="ic">${info.icon}</span>` +
        `<span class="shop-info"><span class="shop-name">${info.name}` +
        `<span class="shop-own">持有 ×${own}</span></span>` +
        `<span class="shop-desc">${info.desc || ''}</span></span>` +
        `<button class="shop-buy${afford ? '' : ' cant'}" data-id="${g.id}"${afford ? '' : ' disabled'}>` +
        `购买 · ${g.price} 杏仁水</button></div>`;
    });
    list.innerHTML = html || '<div class="bp-empty">今天没货</div>';
    // 触屏 tap 购买：touchstart 只记录（不 preventDefault，保证小屏列表可滚动），
    // touchend 时若为 tap（短时小位移）则购买并 preventDefault 阻止合成 click，
    // 避免一次点击扣两次钱；桌面端走 click。委托在 list 上，一处处理行与按钮。
    // 注意：list 元素在多次 renderShop 间复用，监听器只绑一次（防购买后重渲染叠加导致一次 tap 买 N 次）。
    if (!list._shopBound) {
      list._shopBound = true;
      let tsX = 0, tsY = 0, tsT = 0, tsRow = null;
      list.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        tsX = t.clientX; tsY = t.clientY; tsT = Date.now();
        tsRow = e.target && e.target.closest ? e.target.closest('.shop-row') : null;
      }, { passive: true });
      list.addEventListener('touchend', (e) => {
        const t = e.changedTouches[0];
        const row = tsRow; tsRow = null;
        if (row && Date.now() - tsT < 600 && Math.hypot(t.clientX - tsX, t.clientY - tsY) < 12) {
          e.preventDefault(); // 吞掉合成 click，只买一次
          e.stopPropagation();
          this.buyItem(row.dataset.id);
        }
      }, { passive: false });
      list.addEventListener('click', (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.shop-row') : null;
        if (row) this.buyItem(row.dataset.id);
      });
    }
  };
  // 买入：扣杏仁水、道具进背包、自动存档；货币不足拒绝
  U.buyItem = function (id) {
    const G = BR.Game;
    if (!G || !this._shopOpen || G.state !== 'paused') return;
    const g = this.SHOP_GOODS.filter(x => x.id === id)[0];
    if (!g || !ITEM_INFO[id]) return;
    const inv = G.inv;
    const almond = inv.almond || 0;
    if (almond < g.price) {
      this.toast('杏仁水不够（需要 ' + g.price + ' 瓶，你只有 ' + almond + ' 瓶）', 2600);
      if (BR.Audio.doorLocked) BR.Audio.doorLocked();
      return;
    }
    inv.almond = almond - g.price;
    inv[id] = (inv[id] || 0) + 1;
    BR.Audio.pickup();
    this.toast('购入' + ITEM_INFO[id].name + ' ×1（-' + g.price + ' 杏仁水）');
    this.renderShop(); // 刷新钱包与按钮灰显
    this.updateInv();
    if (G.autosave) G.autosave(); // state=paused 时 autosave 会执行
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
    const sc = BR.$('set-shakecam'); // W10：减镜头晃动（trauma 震动缩放）
    if (sc) sc.value = s.shakecam || 'on';
    const sx = BR.$('set-sanityfx'); // Systems C-A：低理智视觉特效（模糊+暗角）开关
    if (sx) sx.value = s.sanityfx || 'on';
    const fs = BR.$('btn-fullscreen');
    if (fs) fs.textContent = BR.Input.isFullscreen() ? '退出全屏' : '进入全屏';
    this.renderBindings(); // 暂停菜单每次打开刷新按键设置区
  };

  /* ---------- 死亡 / 结局 ---------- */
  U.showDeath = function (cause) {
    const texts = {
      hound: '猎犬从黑暗中扑了出来。',
      partygoer: '派对客抓住了你。现在，你也是派对的一员了。=)',
      steam: '过热的蒸汽灼伤了你。',
      lurker: '潜伏者把你拖进了管道阴影。',
      fall: '你坠入了无光的深渊。',
      starve: '你饿死在了后室深处。',
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
    BR.$('btn-dev') && (BR.$('btn-dev').onclick = () => { if (BR.Dev) BR.Dev.openPassword(); });
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
    const sc = BR.$('set-shakecam'); // W10：减镜头晃动
    if (sc) sc.onchange = (e) => { S.shakecam = e.target.value; BR.Input.saveSettings(); };
    const sx = BR.$('set-sanityfx'); // Systems C-A：低理智特效开关
    if (sx) sx.onchange = (e) => { S.sanityfx = e.target.value; BR.Input.saveSettings(); };
    const fsb = BR.$('btn-fullscreen');
    if (fsb) fsb.onclick = () => {
      BR.Input.toggleFullscreen();
      setTimeout(() => this.renderSettings(), 400);
    };
    // 背包关闭按钮
    const bpb = BR.$('btn-bp-close');
    if (bpb) bpb.onclick = () => this.toggleBackpack(false);
    // 商店关闭按钮
    const shb = BR.$('btn-shop-close');
    if (shb) shb.onclick = () => this.closeShop();
    // 商店打开时：Esc / 暂停键关闭商店（捕获阶段拦截，防 Esc 继续分发去触发暂停）
    addEventListener('keydown', (e) => {
      if (!this._shopOpen || e.repeat) return;
      const I = BR.Input;
      const act = I && I.actionForCode ? I.actionForCode(e.code) : null;
      if (act === 'pause' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeShop();
      }
    }, true);
    // 背包打开时：B（当前绑定）/ Esc / 暂停键关闭背包。
    // 捕获阶段拦截 + stopPropagation：input.js 的冒泡 keydown 看不到这次按键，
    // Esc 不会继续分发去触发暂停（state 已是 paused，直接关背包回到 playing）。
    addEventListener('keydown', (e) => {
      if (!this._bpOpen || e.repeat) return;
      const I = BR.Input;
      const act = I && I.actionForCode ? I.actionForCode(e.code) : null;
      if (act === 'backpack' || act === 'pause' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleBackpack(false);
      }
    }, true);
  };
})();
