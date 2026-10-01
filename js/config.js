/* config.js —— 全局命名空间与常量 */
window.BR = window.BR || {};
(function () {
  const BR = window.BR;
  BR.TILE = 3;                 // 每 tile 米数
  BR.CHUNK = 8;                // 每区块 tile 数（8x8）
  BR.Config = {
    TILE: 3,
    EYE: 1.62,                 // 站立眼高
    CROUCH_EYE: 1.02,          // 蹲伏眼高
    RADIUS: 0.35,              // 玩家碰撞半径
    WALK: 3.4, RUN: 5.6, CROUCH: 1.7,
    ACCEL: 26, FRICTION: 11,
    INTERACT_DIST: 2.8,        // 交互距离（米）
    FOV: 72, FOV_RUN: 78,
    STEP_LEN: 2.1,             // 每步距离（米），触发脚步声
    qualities: {
      low:  { pixelRatio: 1.0, fogScale: 0.75, maxLights: 3, fixtures: 14, particles: 0.4 },
      mid:  { pixelRatio: 1.5, fogScale: 1.0,  maxLights: 5, fixtures: 22, particles: 0.7 },
      high: { pixelRatio: 2.0, fogScale: 1.25, maxLights: 7, fixtures: 32, particles: 1.0 }
    }
  };
  // 调试输出：?debug=1 或 localStorage br_debug=1
  BR.DEBUG = (function () {
    try {
      return location.search.indexOf('debug=1') >= 0 || localStorage.getItem('br_debug') === '1';
    } catch (e) { return false; }
  })();
  BR.log = function () {
    if (BR.DEBUG && window.console) console.log.apply(console, ['[BR]'].concat([].slice.call(arguments)));
  };
  BR.warn = function () {
    if (window.console) console.warn.apply(console, ['[BR]'].concat([].slice.call(arguments)));
  };
})();
