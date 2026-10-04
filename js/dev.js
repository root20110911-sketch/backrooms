/* js/dev.js —— 开发者模式（v1.5.1，用户需求）
 * 入口：暂停菜单底部「开发者选项」→ 密码框（muse）→ 开发者面板。
 * 会话级（不落盘，刷新即关闭），只增不改现有流程。
 *   BR.Dev = { enabled:true, infStamina:false, infSanity:false }
 * player.js 钩子：drainSanity 开头 return；体力扣除处跳过/回满。
 */
(function () {
  'use strict';
  var BR = window.BR = window.BR || {};
  var Dev = BR.Dev = BR.Dev || {};

  var LEVELS = [
    ['L0', 'L0 大厅'], ['L1', 'L1 宜居地带'], ['L2', 'L2 管道走廊'], ['L3', 'L3 电气站'],
    ['L7', 'L7 深海恐惧症'], ['L11', 'L11 混凝土森林'], ['L37', 'L37 泳池房'],
    ['L188', 'L188 百窗庭'], ['FUN', 'FUN 乐园'], ['bang', 'Level! 快跑']
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
        Dev.enabled = true; Dev.infStamina = false; Dev.infSanity = false;
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
    var o = overlay(); o.id = 'dev-panel';
    var box = el('div', 'dev-box');
    box.style.cssText = 'background:#14161c;border:1px solid #3a3f4d;border-radius:10px;padding:20px;max-width:min(430px,92vw);max-height:86vh;overflow-y:auto;';
    var title = el('div', null, '开发者面板');
    title.style.cssText = 'font-size:17px;margin-bottom:12px;color:#e8eaf0;';
    box.appendChild(title);

    function toggleBtn(label, get, set) {
      var b = el('button', null, '');
      function refresh() { b.textContent = label + '：' + (get() ? '开' : '关'); }
      b.style.cssText = 'display:block;width:100%;font-size:16px;padding:13px 0;margin-bottom:8px;border-radius:8px;border:1px solid #4a5162;background:#232837;color:#fff;';
      b.onclick = function () { set(!get()); refresh(); };
      refresh();
      return b;
    }
    box.appendChild(toggleBtn('无限体力', function () { return Dev.infStamina; }, function (v) { Dev.infStamina = v; }));
    box.appendChild(toggleBtn('无限理智', function () { return Dev.infSanity; }, function (v) { Dev.infSanity = v; }));

    var tpTitle = el('div', null, '传送');
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
})();
