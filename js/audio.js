/* audio.js —— WebAudio 全合成音频（无外部音频文件）
 * 提供 BR.Audio：init / setVolume / setMuted / setAmbient / 位置循环声 /
 * 全部一次性音效 / 派对音乐 / 闪烁事件。
 * 全部声音由 Oscillator + NoiseBuffer + BiquadFilter 合成。
 */
(function () {
  var BR = window.BR = window.BR || {};

  var Audio = {
    _inited: false,
    _ok: false,          // false = 无 AudioContext，全接口静默降级
    _ctx: null,
    _volume: 1,
    _muted: false,
    _master: null, _sfx: null, _amb: null, _music: null,
    _noiseBuf: null,
    _ambientLevel: null, _ambientNodes: null,
    _loops: {},          // id -> {srcs:[], gain, pan, base, x, z}
    _listener: { x: 0, z: 0, yaw: 0 },
    _party: null,
    _savedAmbient: null, // blackout 前的环境，用于恢复

    // ---------- 初始化（幂等） ----------
    init: function () {
      if (this._inited) return;
      this._inited = true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this._ok = false; return; } // 不支持则静默降级
      try {
        this._ctx = new AC();
      } catch (e) {
        this._ok = false;
        return;
      }
      this._ok = true;
      var ctx = this._ctx;
      // 三路总线：master -> destination；sfx / ambient / music -> master
      this._master = ctx.createGain();
      this._master.connect(ctx.destination);
      this._sfx = ctx.createGain(); this._sfx.connect(this._master);
      this._amb = ctx.createGain(); this._amb.connect(this._master);
      this._music = ctx.createGain(); this._music.connect(this._master);
      this._applyVolume();
      // AudioContext 只能在用户手势后 resume：init 若不是手势触发，
      // 注册一次性监听，等首次 pointerdown / keydown / touchend 再 resume。
      var self = this;
      function tryResume() {
        if (self._ctx && self._ctx.state === 'suspended') {
          try { self._ctx.resume(); } catch (e) { /* 忽略 */ }
        }
      }
      tryResume(); // 若 init 本身就是手势触发，这里直接 resume
      if (ctx.state === 'suspended') {
        window.addEventListener('pointerdown', tryResume, { once: true });
        window.addEventListener('keydown', tryResume, { once: true });
        window.addEventListener('touchend', tryResume, { once: true });
      }
    },

    // ---------- 音量 ----------
    setVolume: function (v) {
      this._volume = Math.max(0, Math.min(1, v == null ? 1 : v));
      this._applyVolume();
    },
    setMuted: function (m) {
      this._muted = !!m;
      this._applyVolume();
    },
    // 暂停菜单用：挂起/恢复整个音频上下文
    setPaused: function (p) {
      if (!this._ok || !this._ctx) return;
      try { if (p) this._ctx.suspend(); else this._ctx.resume(); } catch (e) { /* 忽略 */ }
    },
    _applyVolume: function () {
      if (!this._ok || !this._master) return;
      var v = this._muted ? 0 : this._volume;
      try {
        this._master.gain.setTargetAtTime(v, this._ctx.currentTime, 0.05);
      } catch (e) { /* 忽略 */ }
    },

    // ---------- 合成基础工具 ----------
    _t: function () { return this._ctx.currentTime; },

    // 缓存 2 秒白噪声 Buffer
    _noise: function () {
      if (this._noiseBuf) return this._noiseBuf;
      var ctx = this._ctx, len = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
      return buf;
    },

    // 一次性音调：{f, f1(滑向), type, dur, vol, a(起音), at(相对延迟秒), dest}
    _tone: function (o) {
      if (!this._ok) return;
      var ctx = this._ctx, t = this._t() + (o.at || 0), dur = o.dur || 0.3;
      var osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(1, o.f || 440), t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.3), t + (o.a || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(o.dest || this._sfx);
      try { osc.start(t); osc.stop(t + dur + 0.05); } catch (e) { /* 忽略 */ }
    },

    // 一次性噪声：{f, f1, ft(滤波类型), q, dur, vol, a, at, dest}
    _nz: function (o) {
      if (!this._ok) return;
      var ctx = this._ctx, t = this._t() + (o.at || 0), dur = o.dur || 0.3;
      var src = ctx.createBufferSource();
      src.buffer = this._noise(); src.loop = true;
      var f = ctx.createBiquadFilter();
      f.type = o.ft || 'bandpass';
      f.frequency.setValueAtTime(Math.max(10, o.f || 1000), t);
      f.Q.value = o.q || 1;
      if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.3), t + (o.a || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(o.dest || this._sfx);
      try { src.start(t); src.stop(t + dur + 0.05); } catch (e) { /* 忽略 */ }
    },

    // 循环声源装配：返回 {group, srcs[]}，srcs 需在停止时 stop
    _loopRig: function (buildFn) {
      var self = this;
      var ctx = this._ctx;
      var group = ctx.createGain(); group.gain.value = 0;
      var srcs = [];
      function osc(type, f) {
        var o = ctx.createOscillator(); o.type = type;
        o.frequency.value = f; srcs.push(o); return o;
      }
      function noise() {
        var s = ctx.createBufferSource(); s.buffer = self._noise(); s.loop = true;
        srcs.push(s); return s;
      }
      function filter(type, f, q) {
        var fl = ctx.createBiquadFilter(); fl.type = type;
        fl.frequency.value = f; fl.Q.value = q || 1; return fl;
      }
      function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
      buildFn.call(this, { osc: osc, noise: noise, filter: filter, gain: gain, group: group, srcs: srcs });
      for (var i = 0; i < srcs.length; i++) {
        try { srcs[i].start(); } catch (e) { /* 忽略 */ }
      }
      return { group: group, srcs: srcs };
    },

    // ---------- 环境底噪（关卡切换，内部交叉淡化） ----------
    // setAmbient(level, fadeDur?) level: 'L0'|'L1'|'L2'|'L3'|'FUN'|null
    setAmbient: function (level, fadeDur) {
      if (!this._ok) return;
      fadeDur = (fadeDur == null) ? 2.0 : fadeDur;
      if (level === this._ambientLevel) return;
      if (this._ambientLevel === 'FUN') this.partyStop(); // 离开 FUN 停派对音乐
      // 旧环境淡出后停止
      var old = this._ambientNodes;
      if (old) {
        var t = this._t();
        try { old.group.gain.setTargetAtTime(0.0001, t, Math.max(0.05, fadeDur / 3)); } catch (e) {}
        setTimeout(function () {
          for (var i = 0; i < old.srcs.length; i++) { try { old.srcs[i].stop(); } catch (e) {} }
          try { old.group.disconnect(); } catch (e) {}
        }, fadeDur * 1000 + 400);
      }
      this._ambientLevel = level;
      this._ambientNodes = null;
      if (level === 'FUN') { this.partyStart(); return; } // FUN 环境 = 派对音乐
      if (!level || level === 'off' || level === 'none') return;
      var rig = this._buildAmbient(level);
      if (!rig) return;
      rig.group.connect(this._amb);
      this._ambientNodes = rig;
      try { rig.group.gain.setTargetAtTime(rig.target, this._t(), Math.max(0.05, fadeDur / 3)); } catch (e) {}
    },

    _buildAmbient: function (level) {
      var rig;
      if (level === 'L0') {
        // 荧光灯嗡鸣：50Hz 基频 + 谐波 + 高频嘶嘶
        rig = this._loopRig(function (R) {
          var o1 = R.osc('sine', 50), g1 = R.gain(0.55);
          o1.connect(g1); g1.connect(R.group);
          var o2 = R.osc('sine', 100), g2 = R.gain(0.20);
          o2.connect(g2); g2.connect(R.group);
          var o3 = R.osc('sine', 150), g3 = R.gain(0.07);
          o3.connect(g3); g3.connect(R.group);
          var n = R.noise(), hf = R.filter('highpass', 4200, 0.7), ng = R.gain(0.035);
          n.connect(hf); hf.connect(ng); ng.connect(R.group);
        });
        rig.target = 0.32;
      } else if (level === 'L1') {
        // 管道低频轰鸣 + 缓慢呼吸起伏
        rig = this._loopRig(function (R) {
          var n = R.noise(), lp = R.filter('lowpass', 220, 0.8), ng = R.gain(0.65);
          n.connect(lp); lp.connect(ng); ng.connect(R.group);
          var lfo = R.osc('sine', 0.13), lg = R.gain(0.28);
          lfo.connect(lg); lg.connect(ng.gain); // 呼吸调制
          var n2 = R.noise(), bp = R.filter('bandpass', 900, 2), g2 = R.gain(0.05);
          n2.connect(bp); bp.connect(g2); g2.connect(R.group);
        });
        rig.target = 0.38;
      } else if (level === 'L2') {
        // 蒸汽嘶嘶 + 远处机器低频脉动
        rig = this._loopRig(function (R) {
          var n = R.noise(), hp = R.filter('highpass', 2500, 0.6), ng = R.gain(0.20);
          n.connect(hp); hp.connect(ng); ng.connect(R.group);
          var o = R.osc('sine', 48), og = R.gain(0.55);
          o.connect(og); og.connect(R.group);
          var lfo = R.osc('sine', 1.7), lg = R.gain(0.22);
          lfo.connect(lg); lg.connect(og.gain); // 机器脉动
        });
        rig.target = 0.42;
      } else if (level === 'L3') {
        // 发电机：锯齿低频过低通 + 轰鸣
        rig = this._loopRig(function (R) {
          var o = R.osc('sawtooth', 55), lp = R.filter('lowpass', 260, 0.9), og = R.gain(0.55);
          o.connect(lp); lp.connect(og); og.connect(R.group);
          var o2 = R.osc('sine', 110), g2 = R.gain(0.18);
          o2.connect(g2); g2.connect(R.group);
          var n = R.noise(), lp2 = R.filter('lowpass', 420, 0.7), ng = R.gain(0.14);
          n.connect(lp2); lp2.connect(ng); ng.connect(R.group);
          var lfo = R.osc('sine', 0.9), lg = R.gain(0.16);
          lfo.connect(lg); lg.connect(og.gain); // 发电机起伏
        });
        rig.target = 0.48;
      } else {
        return null;
      }
      return rig;
    },

    // ---------- 位置循环声 ----------
    // type: 'hum' | 'buzz' | 'steam' | 'machine' | 'flicker'
    // 距离衰减：gain = base / (1 + d*d*0.02)
    addLoop: function (id, type, x, z, gain) {
      if (!this._ok) return;
      this.removeLoop(id);
      var ctx = this._ctx;
      var gg = ctx.createGain(); gg.gain.value = 0;
      var pan = null;
      if (ctx.createStereoPanner) {
        pan = ctx.createStereoPanner();
        gg.connect(pan); pan.connect(this._sfx);
      } else {
        gg.connect(this._sfx);
      }
      var rig;
      if (type === 'hum') {          // 荧光灯近场嗡鸣
        rig = this._loopRig(function (R) {
          var o1 = R.osc('sine', 120), g1 = R.gain(0.8);
          o1.connect(g1); g1.connect(R.group);
          var o2 = R.osc('sine', 240), g2 = R.gain(0.25);
          o2.connect(g2); g2.connect(R.group);
        });
      } else if (type === 'buzz') {  // 电流滋滋
        rig = this._loopRig(function (R) {
          var o = R.osc('sawtooth', 170), lp = R.filter('lowpass', 800, 1), g = R.gain(0.7);
          o.connect(lp); lp.connect(g); g.connect(R.group);
        });
      } else if (type === 'steam') { // 蒸汽泄漏
        rig = this._loopRig(function (R) {
          var n = R.noise(), hp = R.filter('highpass', 2600, 0.7), g = R.gain(0.8);
          n.connect(hp); hp.connect(g); g.connect(R.group);
        });
      } else if (type === 'machine') {// 机器运转
        rig = this._loopRig(function (R) {
          var o = R.osc('sine', 52), g1 = R.gain(0.8);
          o.connect(g1); g1.connect(R.group);
          var n = R.noise(), lp = R.filter('lowpass', 180, 0.8), g2 = R.gain(0.45);
          n.connect(lp); lp.connect(g2); g2.connect(R.group);
        });
      } else if (type === 'flicker') {// 故障灯闪烁滋滋
        rig = this._loopRig(function (R) {
          var n = R.noise(), bp = R.filter('bandpass', 700, 2), g = R.gain(0.5);
          n.connect(bp); bp.connect(g); g.connect(R.group);
          var lfo = R.osc('square', 9), lg = R.gain(0.35);
          lfo.connect(lg); lg.connect(g.gain); // 闪烁调制
        });
      } else {
        return; // 未知类型：静默忽略
      }
      rig.group.connect(gg);
      this._loops[id] = {
        rig: rig, gain: gg, pan: pan,
        base: (gain == null ? 0.5 : gain), x: x || 0, z: z || 0
      };
      this.updateListener(this._listener.x, this._listener.z, this._listener.yaw);
    },

    removeLoop: function (id) {
      if (!this._ok) return;
      var L = this._loops[id];
      if (!L) return;
      delete this._loops[id];
      var t = this._t();
      try { L.gain.gain.setTargetAtTime(0.0001, t, 0.08); } catch (e) {}
      setTimeout(function () {
        for (var i = 0; i < L.rig.srcs.length; i++) { try { L.rig.srcs[i].stop(); } catch (e) {} }
        try { L.rig.group.disconnect(); L.gain.disconnect(); } catch (e) {}
      }, 400);
    },

    // 每帧调用：更新全部位置循环声的音量与声像
    updateListener: function (x, z, yaw) {
      this._listener.x = x; this._listener.z = z; this._listener.yaw = yaw || 0;
      if (!this._ok) return;
      var t = this._t();
      for (var id in this._loops) {
        if (!this._loops.hasOwnProperty(id)) continue;
        var L = this._loops[id];
        var dx = L.x - x, dz = L.z - z;
        var d2 = dx * dx + dz * dz;
        var g = L.base / (1 + d2 * 0.02);
        if (d2 > 3600) g = 0; // 60m 外直接静音
        try { L.gain.gain.setTargetAtTime(g, t, 0.12); } catch (e) {}
        if (L.pan) {
          var rel = Math.atan2(dx, dz) - (yaw || 0);
          var p = Math.max(-1, Math.min(1, Math.sin(rel)));
          try { L.pan.pan.setTargetAtTime(p, t, 0.12); } catch (e) {}
        }
      }
    },

    // ---------- 一次性音效 ----------
    // 脚步：按地面材质变滤波
    footstep: function (surface) {
      if (!this._ok) return;
      var cfg = {
        carpet:   { f: 320,  ft: 'lowpass',  vol: 0.14 },
        concrete: { f: 620,  ft: 'bandpass', vol: 0.20 },
        metal:    { f: 1500, ft: 'bandpass', vol: 0.22 },
        tile:     { f: 980,  ft: 'bandpass', vol: 0.20 },
        wood:     { f: 460,  ft: 'lowpass',  vol: 0.20 }
      }[surface] || { f: 600, ft: 'bandpass', vol: 0.18 };
      var v = 0.9 + Math.random() * 0.2; // 每次脚步轻微随机，避免机械感
      this._nz({ f: cfg.f * v, ft: cfg.ft, q: 1.2, dur: 0.11, vol: cfg.vol });
      this._tone({ f: 68 * v, type: 'sine', dur: 0.08, vol: 0.10 });
    },
    doorOpen: function () {
      if (!this._ok) return;
      this._tone({ f: 170, f1: 85, type: 'sawtooth', dur: 0.5, vol: 0.10 }); // 铰链
      this._nz({ f: 420, ft: 'lowpass', dur: 0.3, vol: 0.18 });
      this._tone({ f: 62, type: 'sine', dur: 0.25, vol: 0.30, at: 0.35 });  // 门体顿响
    },
    doorLocked: function () {
      if (!this._ok) return;
      this._tone({ f: 110, type: 'sine', dur: 0.12, vol: 0.30 });
      this._tone({ f: 105, type: 'sine', dur: 0.12, vol: 0.28, at: 0.18 });
      this._nz({ f: 900, ft: 'bandpass', q: 2, dur: 0.10, vol: 0.14, at: 0.02 }); // 锁舌晃动
    },
    doorCreak: function () {
      if (!this._ok) return;
      this._tone({ f: 140, f1: 70, type: 'sawtooth', dur: 1.1, vol: 0.10 });
      this._nz({ f: 520, ft: 'bandpass', q: 3, dur: 1.0, vol: 0.08 });
    },
    pickup: function () {
      if (!this._ok) return;
      this._tone({ f: 660, type: 'sine', dur: 0.08, vol: 0.22 });
      this._tone({ f: 990, type: 'sine', dur: 0.12, vol: 0.22, at: 0.07 });
    },
    drink: function () { // 喝杏仁水：三口吞咽
      if (!this._ok) return;
      for (var i = 0; i < 3; i++) {
        this._tone({ f: 165, f1: 92, type: 'sine', dur: 0.13, vol: 0.28, at: i * 0.24 });
        this._nz({ f: 480, ft: 'lowpass', dur: 0.10, vol: 0.10, at: i * 0.24 });
      }
    },
    paper: function () {
      if (!this._ok) return;
      this._nz({ f: 2600, ft: 'highpass', dur: 0.16, vol: 0.22 });
      this._nz({ f: 3600, ft: 'highpass', dur: 0.12, vol: 0.15, at: 0.06 });
    },
    valve: function () { // 拧阀门：棘轮声 + 蒸汽
      if (!this._ok) return;
      for (var i = 0; i < 5; i++) {
        this._tone({ f: 700 - i * 80, type: 'square', dur: 0.05, vol: 0.16, at: i * 0.12 });
      }
      this.steamBurst();
    },
    steamBurst: function () {
      if (!this._ok) return;
      this._nz({ f: 1900, f1: 480, ft: 'bandpass', q: 0.8, dur: 0.7, vol: 0.45, a: 0.05 });
    },
    elevatorDing: function () {
      if (!this._ok) return;
      this._tone({ f: 880, type: 'sine', dur: 1.4, vol: 0.28 });
      this._tone({ f: 1318, type: 'sine', dur: 1.1, vol: 0.13 });
    },
    elevatorRumble: function () { // 电梯运行 4 秒
      if (!this._ok) return;
      this._nz({ f: 120, ft: 'lowpass', dur: 4.0, vol: 0.45, a: 0.8 });
      this._tone({ f: 38, f1: 44, type: 'sine', dur: 4.0, vol: 0.35, a: 1.0 });
    },
    glitch: function () { // 切出/空间异常
      if (!this._ok) return;
      for (var i = 0; i < 7; i++) {
        this._tone({
          f: 200 + Math.random() * 3800, type: 'square',
          dur: 0.04, vol: 0.16, at: i * 0.05
        });
      }
      this._nz({ f: 1200, f1: 300, ft: 'highpass', dur: 0.35, vol: 0.20 });
    },
    stinger: function () { // 惊吓和弦（小二度簇）
      if (!this._ok) return;
      this._tone({ f: 220, type: 'sawtooth', dur: 1.3, vol: 0.22, a: 0.05 });
      this._tone({ f: 233, type: 'sawtooth', dur: 1.3, vol: 0.22, a: 0.05 });
      this._tone({ f: 466, type: 'sawtooth', dur: 1.1, vol: 0.10, a: 0.08 });
      this._nz({ f: 800, ft: 'lowpass', dur: 1.0, vol: 0.12, a: 0.1 });
    },
    heartbeat: function () { // 一次“怦-怦”
      if (!this._ok) return;
      this._tone({ f: 58, type: 'sine', dur: 0.16, vol: 0.50 });
      this._tone({ f: 52, type: 'sine', dur: 0.14, vol: 0.40, at: 0.28 });
    },
    giggle: function () { // 派对客诡异笑声
      if (!this._ok) return;
      for (var i = 0; i < 6; i++) {
        this._tone({
          f: 760 - i * 52 + Math.random() * 30, f1: 600 - i * 45,
          type: 'sine', dur: 0.09, vol: 0.18, at: i * 0.11
        });
      }
    },
    growl: function () { // 猎犬低吼
      if (!this._ok) return;
      this._tone({ f: 66, f1: 50, type: 'sawtooth', dur: 1.6, vol: 0.32, a: 0.15 });
      this._nz({ f: 300, ft: 'lowpass', dur: 1.5, vol: 0.26, a: 0.2 });
    },
    bark: function () {
      if (!this._ok) return;
      this._tone({ f: 320, f1: 170, type: 'square', dur: 0.12, vol: 0.32 });
      this._tone({ f: 300, f1: 160, type: 'square', dur: 0.12, vol: 0.30, at: 0.17 });
    },
    whisper: function () { // L0 远处人声幻听
      if (!this._ok) return;
      this._nz({ f: 1600, f1: 3200, ft: 'bandpass', q: 3, dur: 1.3, vol: 0.16, a: 0.3 });
      this._nz({ f: 2400, f1: 1400, ft: 'bandpass', q: 3, dur: 1.0, vol: 0.10, a: 0.4, at: 0.3 });
    },
    dropRumble: function (dur) { // 掉落转场：低频嗡鸣渐强后骤停（失重感）
      if (!this._ok) return;
      dur = dur || 1.9;
      this._tone({ f: 52, f1: 27, type: 'sine', dur: dur, vol: 0.55, a: dur * 0.7 });
      this._tone({ f: 104, f1: 55, type: 'triangle', dur: dur, vol: 0.16, a: dur * 0.7 });
      this._nz({ f: 220, f1: 90, ft: 'lowpass', dur: dur, vol: 0.22, a: dur * 0.6 });
    },
    thud: function () { // 落地闷响
      if (!this._ok) return;
      this._tone({ f: 64, f1: 30, type: 'sine', dur: 0.32, vol: 0.65, a: 0.008 });
      this._nz({ f: 300, ft: 'lowpass', dur: 0.22, vol: 0.28, a: 0.008 });
    },
    uiClick: function () {
      if (!this._ok) return;
      this._tone({ f: 1250, type: 'square', dur: 0.04, vol: 0.10 });
    },
    checkpoint: function () {
      if (!this._ok) return;
      var notes = [523, 659, 784, 1047];
      for (var i = 0; i < notes.length; i++) {
        this._tone({ f: notes[i], type: 'sine', dur: 0.28, vol: 0.18, at: i * 0.12 });
      }
    },
    splash: function () { // 踩水 / 切出落水感
      if (!this._ok) return;
      this._nz({ f: 2400, f1: 200, ft: 'lowpass', dur: 0.5, vol: 0.38, a: 0.02 });
    },

    // ---------- 派对音乐（FUN 关） ----------
    partyStart: function () {
      if (!this._ok || !this._ctx) return;
      if (this._party && this._party.on) return;
      var ctx = this._ctx;
      var mg = ctx.createGain();
      mg.gain.value = 0;
      mg.connect(this._music);
      var lp = ctx.createBiquadFilter(); // 降级时压暗整体
      lp.type = 'lowpass'; lp.frequency.value = 8000;
      lp.connect(mg);
      var dly = ctx.createDelay(); // 简单回声增加派对空间感
      dly.delayTime.value = 0.27;
      var fb = ctx.createGain(); fb.gain.value = 0.22;
      dly.connect(fb); fb.connect(dly); dly.connect(mg);
      try { mg.gain.setTargetAtTime(0.5, this._t(), 1.0); } catch (e) {}
      var self = this;
      this._party = {
        on: true, stage: 0, step: 0, next: 0,
        gain: mg, lp: lp, delay: dly,
        tempo: 128, detune: 0, timer: null
      };
      this._party.timer = setInterval(function () { self._partyTick(); }, 110);
    },

    // 降级 stage 0..2：越往后越慢、越走音、越压抑
    partyDegrade: function (stage) {
      var P = this._party;
      if (!this._ok || !P || !P.on) return;
      stage = Math.max(0, Math.min(2, stage | 0));
      P.stage = stage;
      var cfgs = [
        { tempo: 128, det: 0,    lp: 8000 },
        { tempo: 96,  det: -150, lp: 1600 },
        { tempo: 62,  det: -380, lp: 700 }
      ];
      var c = cfgs[stage];
      P.tempo = c.tempo; P.detune = c.det;
      try { P.lp.frequency.setTargetAtTime(c.lp, this._t(), 0.8); } catch (e) {}
    },

    partyStop: function () {
      var P = this._party;
      if (!P || !P.on) return;
      P.on = false;
      if (P.timer) { clearInterval(P.timer); P.timer = null; }
      this._party = null;
      var t = this._t();
      try { P.gain.gain.setTargetAtTime(0.0001, t, 0.4); } catch (e) {}
      setTimeout(function () {
        try { P.lp.disconnect(); P.delay.disconnect(); P.gain.disconnect(); } catch (e) {}
      }, 1500);
    },

    // 音序器心跳：向前 0.35s 预定音符
    _partyTick: function () {
      var P = this._party;
      if (!P || !P.on || !this._ok) return;
      var ctx = this._ctx;
      if (P.next < ctx.currentTime) P.next = ctx.currentTime + 0.06;
      var spb = 60 / P.tempo / 2; // 八分音符时值
      var guard = 0;
      while (P.next < ctx.currentTime + 0.35 && guard++ < 24) {
        this._partyNote(P.step, P.next - ctx.currentTime, spb);
        P.next += spb;
        P.step = (P.step + 1) % 32;
      }
    },

    _partyNote: function (step, at, spb) {
      var P = this._party;
      if (!P || !P.on) return;
      var ctx = this._ctx;
      var major = [0, 2, 4, 7, 9, 12, 14, 16];
      var minor = [0, 2, 3, 7, 8, 12, 14, 15];
      // stage>=2 全小调；stage1 后半小节开始变调
      var sc = (P.stage >= 2 || (P.stage >= 1 && step % 16 >= 8)) ? minor : major;
      var base = P.stage >= 2 ? 110 : 130.81; // C3（降级后降到 A2，更阴沉）
      function det(f) { return f * Math.pow(2, P.detune / 1200); }
      // 贝斯：每拍一个根音
      if (step % 2 === 0) {
        this._tone({ f: det(base / 2), f1: det(base / 2) * 0.995, type: 'triangle', dur: spb * 1.8, vol: 0.42, at: at, dest: P.lp });
      }
      // 主旋律：欢快五声音阶琶音
      var mel = [0, 4, 2, 7, 4, 2, 0, 4, 5, 4, 2, 0, 2, 4, 2, 1];
      var idx = mel[step % 16];
      var f = det(base * Math.pow(2, sc[idx % sc.length] / 12) * (P.stage >= 2 ? 0.5 : 1));
      this._tone({ f: f, type: 'square', dur: spb * 0.9, vol: 0.10, at: at, dest: P.lp });
      // 回声送一点旋律进 delay
      this._tone({ f: f, type: 'sine', dur: spb * 0.8, vol: 0.06, at: at, dest: P.delay });
      // 每小节第 5 拍加拍手噪声
      if (step % 8 === 4) {
        this._nz({ f: 3200, ft: 'highpass', dur: 0.08, vol: 0.13, at: at, dest: P.lp });
      }
      // stage2 加一个不和谐的低鸣
      if (P.stage >= 2 && step % 8 === 0) {
        this._tone({ f: det(55.7), type: 'sawtooth', dur: spb * 6, vol: 0.10, at: at, dest: P.lp });
      }
    },

    // ---------- L1 闪烁事件 ----------
    flickerBuzz: function () { // 短促电流滋滋（闪烁风暴用，不碰环境音）
      if (!this._ok) return;
      this._nz({ f: 2400, f1: 300, ft: 'highpass', dur: 1.2, vol: 0.20 });
      this._tone({ f: 120, f1: 60, type: 'sawtooth', dur: 1.0, vol: 0.12 });
    },
    blackoutStart: function () {
      if (!this._ok) return;
      // 断电：音高坠落 + 电流熄灭
      this._tone({ f: 420, f1: 38, type: 'sawtooth', dur: 0.9, vol: 0.30 });
      this._nz({ f: 3000, f1: 200, ft: 'highpass', dur: 0.8, vol: 0.25 });
      // 记住当前环境并快速切掉（恢复时再切回来）
      this._savedAmbient = this._ambientLevel;
      this.setAmbient(null, 0.5);
    },
    blackoutEnd: function () {
      if (!this._ok) return;
      // 来电：音高爬升 + 荧光灯逐个点亮的滋滋
      this._tone({ f: 40, f1: 420, type: 'sawtooth', dur: 0.7, vol: 0.22 });
      for (var i = 0; i < 4; i++) {
        this._nz({ f: 900 + i * 300, ft: 'bandpass', q: 2, dur: 0.15, vol: 0.14, at: 0.5 + i * 0.18 });
      }
      var lvl = this._savedAmbient;
      this._savedAmbient = null;
      if (lvl && lvl !== 'FUN') this.setAmbient(lvl, 1.5);
      else if (lvl === 'FUN') this.setAmbient('FUN', 1.5);
    }
  };

  BR.Audio = Audio;
})();
