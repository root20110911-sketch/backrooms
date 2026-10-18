/* js/dev.js —— 开发者模式（v2.2，W-dev：开发者模式增强）
 * 入口：暂停菜单底部「开发者选项」→ 密码框（muse）→ 开发者面板。
 * 作弊开关（无限体力/无限理智/无限生命）：独立 toggle，localStorage 持久化
 *   （刷新仍保持；面板访问本身仍需每次输密码，Dev.enabled 仍是会话级）。
 *   BR.Dev = { enabled, infStamina, infSanity, infHp }
 * 冻结语义（v2.2 用户原话：「直接锁住，直接冻结 999 个」）：
 *   开启瞬间把对应数值设为 999；player.js 每帧末尾 pin 住 999（任何直接扣减路径——
 *   hurt、饿死、腰果水、L4 未封窗等——都会被纠正回来），对应消耗/伤害逻辑短路。
 *   体力：跑步不再消耗（W9 块短路），显示条满格 + 金色锁定框。
 *   理智：drainSanity/restoreSanity 均短路；sanity=999 时低理智特效（耳语/暗角/视线游移）不触发。
 *   生命：hurt 短路；饿死/腰果水等直接扣血路径由帧末 pin 纠正。不是无敌穿墙，只是血量锁住。
 * 传送：14 关全覆盖（L0/L1/L2/L3/L4/L6/L7/L11/L25/L37/L37.2/L188/Level!/FUN），
 *   走 BR.Cutout.travelTo(id, {mode:'none'}) 落各关默认出生点（v2.2 已逐关实测落点安全）。
 * 保留：回满状态按钮（一键体力/理智/生命/饥饿回 100）。
 */
(function () {
  'use strict';
  var BR = window.BR = window.BR || {};
  var Dev = BR.Dev = BR.Dev || {};

  // 冻结数值：用户要的 999
  Dev.FREEZE = 999;

  // —— 持久化（localStorage；隐私模式等异常时静默降级为会话级） ——
  function lsGet(k) {
    try { return window.localStorage.getItem('br_dev_' + k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem('br_dev_' + k, v ? '1' : '0'); } catch (e) {}
  }
  if (Dev.infStamina == null) Dev.infStamina = (lsGet('infStamina') === '1');
  if (Dev.infSanity == null) Dev.infSanity = (lsGet('infSanity') === '1');
  if (Dev.infHp == null) Dev.infHp = (lsGet('infHp') === '1');

  var LEVELS = [
    ['L0', 'L0 大厅'], ['L1', 'L1 宜居地带'], ['L2', 'L2 管道走廊'], ['L3', 'L3 电气站'],
    ['L4', 'L4 废弃办公室'], ['L6', 'L6 熄灯之时'], ['L7', 'L7 深海恐惧症'],
    ['L11', 'L11 混凝土森林'], ['L25', 'L25 街机枢纽'], ['L37', 'L37 泳池房'],
    ['L372', 'L37.2 阳光泳池'], ['L188', 'L188 百窗庭'],
    ['bang', 'Level! 快跑'], ['FUN', 'FUN 乐园']
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function overlay() {
    var o = el('div', 'dev-overlay');
    o.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.72);';
    return o;
  }

  // —— 作弊开关应用到玩家（开启瞬间设 999；帧末 pin 由 player.js 负责） ——
  function applyCheats() {
    var P = BR.Player;
    if (!P) return;
    if (Dev.infStamina) { P.stamina = Dev.FREEZE; P._staminaOut = false; }
    if (Dev.infSanity) P.sanity = Dev.FREEZE;
    if (Dev.infHp) P.hp = Dev.FREEZE;
  }
  Dev.applyCheats = applyCheats;

  // —— HUD 条锁定显示：宽度钳到 100%，wrap 加金色锁定框 ——
  function wrapHud() {
    if (Dev._hudWrapped || !BR.UI || !BR.UI.updateBars) return;
    Dev._hudWrapped = true;
    var orig = BR.UI.updateBars;
    var LOCKS = [
      ['infStamina', 'stam-wrap', 'stam-fill'],
      ['infSanity', 'san-wrap', 'san-fill'],
      ['infHp', 'hp-wrap', 'hp-fill']
    ];
    BR.UI.updateBars = function () {
      orig.call(this);
      for (var i = 0; i < LOCKS.length; i++) {
        var on = !!Dev[LOCKS[i][0]];
        var w = document.getElementById(LOCKS[i][1]);
        var f = document.getElementById(LOCKS[i][2]);
        if (f && on) {
          var pct = parseFloat(f.style.width);
          if (!isNaN(pct) && pct > 100) f.style.width = '100%';
          f.title = Dev.FREEZE + '（开发者锁定）';
        } else if (f) {
          f.title = '';
        }
        if (w) w.style.boxShadow = on ? '0 0 6px 1px rgba(255,215,0,.9)' : '';
      }
    };
  }
  Dev.wrapHud = wrapHud;
  wrapHud(); // ui.js 在 dev.js 之前加载，此处可直接包

  // —— 密码框 ——
  Dev.openPassword = function () {
    if (Dev.enabled) { Dev.openPanel(); return; }
    var o = overlay();
    var box = el('div', 'dev-box');
    box.style.cssText = 'background:#14161c;border:1px solid #3a3f4d;border-radius:10px;padding:22px 24px;min-width:min(320px,84vw);';
    box.appendChild(el('div', null, '开发者选项'));
    box.firstChild.style.cssText = 'font-size:17px;margin-bottom:12px;color:#e8eaf0;';
    var inp = el('input');
    inp.type = 'password'; inp.placeholder = '输入密码'; inp.autocomplete = 'off';
    inp.style.cssText = 'width:100%;box-sizing:border-box;font-size:17px;padding:10px 12px;margin-bottom:12px;background:#0c0e13;color:#fff;border:1px solid #4a5162;border-radius:6px;';
    box.appendChild(inp);
    var row = el('div');
    row.style.cssText = 'display:flex;gap:10px;';
    var ok = el('button', null, '确认');
    var cancel = el('button', null, '取消');
    [ok, cancel].forEach(function (b) {
      b.style.cssText = 'flex:1;font-size:16px;padding:12px 0;border-radius:8px;border:1px solid #4a5162;background:#232837;color:#fff;';
    });
    row.appendChild(ok); row.appendChild(cancel);
    box.appendChild(row);
    o.appendChild(box);
    document.body.appendChild(o);
    function close() { o.remove(); }
    function submit() {
      if (inp.value === 'muse') {
        Dev.enabled = true; // 会话级：刷新后需重新输密码；作弊开关本身走 localStorage 持久化
        close(); Dev.openPanel();
      } else {
        BR.UI.toast('密码错误');
        close();
      }
    }
    ok.onclick = submit;
    cancel.onclick = close;
    inp.onkeydown = function (e) { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(); };
    setTimeout(function () { inp.focus(); }, 50);
  };

  // —— 开发者面板 ——
  Dev.openPanel = function () {
    if (!Dev.enabled) return;
    Dev.closePanel();
    wrapHud();
    var o = overlay(); o.id = 'dev-panel';
    var box = el('div', 'dev-box');
    box.style.cssText = 'background:#14161c;border:1px solid #3a3f4d;border-radius:10px;padding:20px;max-width:min(430px,92vw);max-height:86vh;overflow-y:auto;';
    var title = el('div', null, '开发者面板');
    title.style.cssText = 'font-size:17px;margin-bottom:12px;color:#e8eaf0;';
    box.appendChild(title);

    function toggleBtn(label, key) {
      var b = el('button', null, '');
      function refresh() {
        b.textContent = label + '：' + (Dev[key] ? '开 🔒' : '关');
        b.style.borderColor = Dev[key] ? '#8a7326' : '#4a5162';
      }
      b.style.cssText = 'display:block;width:100%;font-size:16px;padding:13px 0;margin-bottom:8px;border-radius:8px;border:1px solid #4a5162;background:#232837;color:#fff;';
      b.onclick = function () {
        Dev[key] = !Dev[key];
        lsSet(key, Dev[key]);
        if (Dev[key]) applyCheats();
        refresh();
        BR.UI.toast(label + (Dev[key] ? '已开启（冻结 ' + Dev.FREEZE + '，刷新仍保持）' : '已关闭'));
      };
      refresh();
      return b;
    }
    var cheatTitle = el('div', null, '作弊（独立开关，localStorage 持久化）');
    cheatTitle.style.cssText = 'font-size:15px;margin:0 0 8px;color:#aeb4c2;';
    box.appendChild(cheatTitle);
    box.appendChild(toggleBtn('无限体力', 'infStamina'));
    box.appendChild(toggleBtn('无限理智', 'infSanity'));
    box.appendChild(toggleBtn('无限生命', 'infHp'));

    var tpTitle = el('div', null, '传送（14 关）');
    tpTitle.style.cssText = 'font-size:15px;margin:12px 0 8px;color:#aeb4c2;';
    box.appendChild(tpTitle);
    var grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;';
    LEVELS.forEach(function (lv) {
      var b = el('button', null, lv[1]);
      b.style.cssText = 'font-size:15px;padding:13px 0;border-radius:8px;border:1px solid #4a5162;background:#1d2230;color:#fff;';
      b.onclick = function () {
        if (!BR.Levels[lv[0]]) { BR.UI.toast('该楼层尚未开放'); return; }
        Dev.closePanel();
        // 从暂停菜单直接传送：先恢复 playing 再走无过渡传送
        if (BR.Game.state === 'paused') BR.UI.togglePause(false);
        BR.Cutout.travelTo(lv[0], { mode: 'none' });
      };
      grid.appendChild(b);
    });
    box.appendChild(grid);

    var full = el('button', null, '回满状态（体力/理智/生命/饥饿）');
    full.style.cssText = 'display:block;width:100%;font-size:16px;padding:13px 0;margin-bottom:8px;border-radius:8px;border:1px solid #4a7c59;background:#1e2f24;color:#fff;';
    full.onclick = function () {
      var P = BR.Player;
      P.stamina = 100; P._staminaOut = false;
      P.sanity = 100; P.hp = 100; P.hunger = 100;
      BR.UI.toast('状态已回满');
    };
    box.appendChild(full);

    var close = el('button', null, '关闭');
    close.style.cssText = 'display:block;width:100%;font-size:16px;padding:13px 0;border-radius:8px;border:1px solid #4a5162;background:#232837;color:#fff;';
    close.onclick = Dev.closePanel;
    box.appendChild(close);

    o.appendChild(box);
    o.addEventListener('click', function (e) { if (e.target === o) Dev.closePanel(); });
    document.body.appendChild(o);
  };
  Dev.closePanel = function () {
    var o = document.getElementById('dev-panel');
    if (o) o.remove();
  };

  // 刷新后作弊开关仍在（localStorage）：玩家对象就绪后补一次 999（main.js 开局后 Player 存在）
  // 用延迟轮询一次，避免与 loadLevel/reset 时序打架（reset 只在 full 模式清数值，travel 保留）
  (function reapplyAfterBoot() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (BR.Player && BR.Player.pos && (Dev.infStamina || Dev.infSanity || Dev.infHp)) {
        applyCheats();
      }
      if (tries > 40) clearInterval(iv); // 约 20 秒后停
    }, 500);
  })();
})();
