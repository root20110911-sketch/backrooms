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
      // W10：玩家跳跃/落地 → 音频反馈（bus 订阅，一次性节点自动断开）
      this._bindBus();
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
      // 修：ended 后断开连接，否则每个音符留一个 GainNode 挂在总线上，
      // 长时间播放（钢琴曲/环境音乐）会让 audio graph 节点数无界增长。
      osc.onended = function () { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
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
      // 修：同 _tone，ended 后断开，避免无界累积。
      src.onended = function () { try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) {} };
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
    // 扩建钩子：新关卡注册环境音
    // 用法：BR.Audio.registerAmbient('L7', function(){ var rig = this._loopRig(function(R){ ... }); rig.target = 0.4; return rig; });
    registerAmbient: function (name, builderFn) {
      (BR.Audio._extAmbient = BR.Audio._extAmbient || {})[name] = builderFn;
    },
    setAmbient: function (level, fadeDur) {      if (!this._ok) return;
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
      // 扩建钩子：新关卡注册的环境音优先（registerAmbient 在 setAmbient 附近定义）
      var ext = BR.Audio._extAmbient && BR.Audio._extAmbient[level];
      if (ext) { rig = ext.call(this); }
      else if (level === 'L0') {
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
      } else if (level === 'L7') {
        // W10：深海恐惧——风浪起伏 + 金属船体呻吟 + 深海低频
        rig = this._loopRig(function (R) {
          var n = R.noise(), bp = R.filter('bandpass', 520, 0.6), ng = R.gain(0.50);
          n.connect(bp); bp.connect(ng); ng.connect(R.group);
          var lfo = R.osc('sine', 0.11), lg = R.gain(0.30);
          lfo.connect(lg); lg.connect(ng.gain); // 海浪起伏
          var o = R.osc('sine', 38), og = R.gain(0.50);
          o.connect(og); og.connect(R.group);   // 深海低频压迫
          var m = R.osc('sawtooth', 82), mf = R.filter('lowpass', 200, 1), mg = R.gain(0.10);
          m.connect(mf); mf.connect(mg); mg.connect(R.group); // 金属船体呻吟
          var lfo2 = R.osc('sine', 0.05), lg2 = R.gain(40);
          lfo2.connect(lg2); lg2.connect(m.frequency); // 呻吟音高缓慢漂移
        });
        rig.target = 0.50;
      } else if (level === 'L7_uw') {
        // W10：L7 水下变体（BR.Swim 头部入水时按 dry+'_uw' 约定切换）
        rig = this._loopRig(function (R) {
          var n = R.noise(), lp = R.filter('lowpass', 340, 0.7), ng = R.gain(0.55);
          n.connect(lp); lp.connect(ng); ng.connect(R.group);
          var o = R.osc('sine', 46), og = R.gain(0.55);
          o.connect(og); og.connect(R.group); // 水下深海低频加重
        });
        rig.target = 0.55;
        return rig;
      } else if (level === 'L11') {
        // W10：无垠城市——远风 + 建筑结构低鸣 + 偶发金属伸缩
        rig = this._loopRig(function (R) {
          var n = R.noise(), bp = R.filter('bandpass', 300, 0.5), ng = R.gain(0.35);
          n.connect(bp); bp.connect(ng); ng.connect(R.group);
          var lfo = R.osc('sine', 0.07), lg = R.gain(0.20);
          lfo.connect(lg); lg.connect(ng.gain); // 穿楼风起伏
          var o = R.osc('sine', 55), og = R.gain(0.30);
          o.connect(og); og.connect(R.group);   // 结构低鸣
          var n2 = R.noise(), hp = R.filter('highpass', 3000, 0.8), g2 = R.gain(0.03);
          n2.connect(hp); hp.connect(g2); g2.connect(R.group); // 高空风哨
        });
        rig.target = 0.42;
      } else if (level === 'L188') {
        // W10：百窗庭——走廊空气流动 + 窗玻璃微振 + 远钟摆
        rig = this._loopRig(function (R) {
          var n = R.noise(), bp = R.filter('bandpass', 800, 0.9), ng = R.gain(0.16);
          n.connect(bp); bp.connect(ng); ng.connect(R.group);
          var lfo = R.osc('sine', 0.21), lg = R.gain(0.08);
          lfo.connect(lg); lg.connect(ng.gain); // 走廊穿堂风
          var g = R.osc('sine', 1180), gg = R.gain(0.012);
          g.connect(gg); gg.connect(R.group);   // 窗玻璃微振
          var lfo2 = R.osc('sine', 0.5), lg2 = R.gain(0.010);
          lfo2.connect(lg2); lg2.connect(gg.gain);
          var o = R.osc('sine', 65), og = R.gain(0.16);
          o.connect(og); og.connect(R.group);   // 老建筑低鸣
        });
        rig.target = 0.36;
      } else if (level === 'BANG') {
        // W10：Level ! 警报追逐（Level ! 建造者接入后 setAmbient('BANG') 即用；
        // 本关在当前版本尚未实装，环境音先行注册，见 cutout.js BANG_ID 说明）
        rig = this._loopRig(function (R) {
          var a = R.osc('square', 660), ag = R.gain(0.10);
          a.connect(ag); ag.connect(R.group);
          var lfo = R.osc('sine', 2.2), lg = R.gain(140);
          lfo.connect(lg); lg.connect(a.frequency); // 警报双音摆动
          var o = R.osc('sawtooth', 98), og = R.gain(0.22);
          o.connect(og); og.connect(R.group);   // 追逐低频脉冲
          var lfo2 = R.osc('sine', 3.1), lg2 = R.gain(0.14);
          lfo2.connect(lg2); lg2.connect(og.gain);
          var n = R.noise(), hp = R.filter('highpass', 2000, 0.7), ng = R.gain(0.05);
          n.connect(hp); hp.connect(ng); ng.connect(R.group); // 紧张嘶嘶
        });
        rig.target = 0.5;
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
    // 脚步：按地面材质变滤波；level 可选——走廊类关卡加一层短回声
    // （L0 荧光灯脚步回声 / L37 水声瓷砖回响 / L188 走廊回声 / L11 城市短反射；
    //  L7 开阔海面无反射；回声节点一次性、ended 断开，不累积）
    footstep: function (surface, level) {
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
      var ec = this._echoFor(level);
      if (ec) {
        this._nz({ f: cfg.f * v, ft: cfg.ft, q: 1.2, dur: 0.11, vol: cfg.vol * ec.vol, at: ec.delay });
        if (ec.delay2) this._nz({ f: cfg.f * v, ft: cfg.ft, q: 1.2, dur: 0.12, vol: cfg.vol * ec.vol2, at: ec.delay2 });
      }
    },
    // 关卡脚步回声配置（null=无回声）
    _echoFor: function (level) {
      switch (level) {
        case 'L0':   return { delay: 0.09, vol: 0.35 };                            // 荧光灯走廊回声
        case 'L37':  return { delay: 0.14, vol: 0.40, delay2: 0.23, vol2: 0.20 };  // 瓷砖回响
        case 'L188': return { delay: 0.12, vol: 0.30 };                            // 走廊回声
        case 'L11':  return { delay: 0.06, vol: 0.22 };                            // 城市短促反射
        default: return null;
      }
    },
    jump: function () { // 起跳：轻微衣物摩擦 + 上升气流（W10：bus 'jump' 订阅）
      if (!this._ok) return;
      this._nz({ f: 700, f1: 1500, ft: 'bandpass', q: 1, dur: 0.14, vol: 0.09 });
    },
    swimStroke: function () { // 划水：柔和拨水（W10：游泳移动反馈）
      if (!this._ok) return;
      this._nz({ f: 950, f1: 320, ft: 'lowpass', dur: 0.35, vol: 0.15, a: 0.08 });
    },
    wadeStep: function () { // 涉水：踩水声（W10：浅水移动反馈）
      if (!this._ok) return;
      this._nz({ f: 1800, f1: 420, ft: 'lowpass', dur: 0.22, vol: 0.19, a: 0.02 });
    },
    mountStep: function () { // 坐骑移动反馈钩子（鸭子坐骑建造者调用）
      if (!this._ok) return;
      this._nz({ f: 520, ft: 'lowpass', dur: 0.12, vol: 0.13 });
      this._tone({ f: 92, type: 'sine', dur: 0.10, vol: 0.07 });
    },
    mountSqueak: function () { // 鸭子坐骑叫声钩子（建造者调用）
      if (!this._ok) return;
      this._tone({ f: 620, f1: 880, type: 'triangle', dur: 0.12, vol: 0.15 });
      this._tone({ f: 660, f1: 920, type: 'triangle', dur: 0.10, vol: 0.12, at: 0.14 });
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
    heal: function () { // 绷带包扎：布料摩擦裹缠
      if (!this._ok) return;
      for (var i = 0; i < 2; i++) {
        this._nz({ f: 900, ft: 'bandpass', q: 1.5, dur: 0.18, vol: 0.16, at: i * 0.22 });
      }
      this._tone({ f: 520, f1: 660, type: 'sine', dur: 0.12, vol: 0.14, at: 0.46 });
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
    whisperDeep: function () { // Systems C-A：低理智强化版——立体声飘忽（左→右漂移 + 右→左回漂 + 脑后贴耳低语层）
      if (!this._ok) return;
      this._nzPan({ f: 1400, f1: 2900, ft: 'bandpass', q: 3, dur: 1.6, vol: 0.14, a: 0.4, panFrom: -0.9, panTo: 0.9 });
      this._nzPan({ f: 2200, f1: 1200, ft: 'bandpass', q: 3, dur: 1.2, vol: 0.09, a: 0.5, at: 0.35, panFrom: 0.8, panTo: -0.8 });
      this._nz({ f: 500, f1: 900, ft: 'bandpass', q: 2, dur: 1.8, vol: 0.07, a: 0.6, at: 0.15 });
    },
    // 带声像漂移的一次性噪声：{..., panFrom, panTo}（无 StereoPanner 时退化为普通 _nz）
    _nzPan: function (o) {
      if (!this._ok) return;
      var ctx = this._ctx;
      if (!ctx.createStereoPanner) { this._nz(o); return; }
      var t = this._t() + (o.at || 0), dur = o.dur || 0.3;
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
      var pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(o.panFrom != null ? o.panFrom : 0, t);
      pan.pan.linearRampToValueAtTime(o.panTo != null ? o.panTo : 0, t + dur);
      src.connect(f); f.connect(g); g.connect(pan); pan.connect(this._sfx);
      try { src.start(t); src.stop(t + dur + 0.05); } catch (e) { /* 忽略 */ }
      // 修：ended 后断开全链（含 panner），避免 audio graph 节点无界增长
      src.onended = function () { try { src.disconnect(); f.disconnect(); g.disconnect(); pan.disconnect(); } catch (e) {} };
    },
    halluPoof: function () { // Systems C-A：幻觉消散——轻微的"噗" + 下滑音调（反向感）
      if (!this._ok) return;
      this._nz({ f: 3000, f1: 400, ft: 'highpass', dur: 0.4, vol: 0.12, a: 0.02 });
      this._tone({ f: 180, f1: 90, type: 'sine', dur: 0.5, vol: 0.08, a: 0.05 });
    },
    dropRumble: function (dur) { // 掉落转场：低频嗡鸣渐强后骤停（失重感）
      if (!this._ok) return;
      dur = dur || 1.9;
      this._tone({ f: 52, f1: 27, type: 'sine', dur: dur, vol: 0.55, a: dur * 0.7 });
      this._tone({ f: 104, f1: 55, type: 'triangle', dur: dur, vol: 0.16, a: dur * 0.7 });
      this._nz({ f: 220, f1: 90, ft: 'lowpass', dur: dur, vol: 0.22, a: dur * 0.6 });
    },
    thud: function () { // 落地闷响
      this.thudAt(1);
    },
    thudAt: function (k) { // W10：按强度缩放的落地闷响（bus 'land' 按 impact 订阅）
      if (!this._ok) return;
      k = Math.max(0.15, Math.min(1, k == null ? 0.6 : k));
      this._tone({ f: 64, f1: 30, type: 'sine', dur: 0.32, vol: 0.65 * k, a: 0.008 });
      this._nz({ f: 300, ft: 'lowpass', dur: 0.22, vol: 0.28 * k, a: 0.008 });
    },
    // W10：玩家事件 → 音频反馈（只绑一次；init 内调用）
    _bindBus: function () {
      if (this._busBound || !BR.bus) return;
      this._busBound = true;
      var self = this;
      BR.bus.on('jump', function () { self.jump(); });
      BR.bus.on('land', function (d) {
        var k = (d && d.impact) ? Math.min(1, d.impact / 8) : 0.5;
        self.thudAt(k);
      });
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

    // ---------- 马尼拉房间：舒缓钢琴曲 + 嗡鸣减弱 + 墙内敲击 ----------
    // 靠近房间时 levels.js 调用 manilaPianoStart/manilaHumDuck(true)，离开时停止/恢复。
    manilaPianoStart: function () {
      if (!this._ok || !this._ctx) return;
      if (this._piano && this._piano.on) return;
      var ctx = this._ctx;
      var mg = ctx.createGain(); mg.gain.value = 0; mg.connect(this._music);
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.connect(mg);
      var dly = ctx.createDelay(1.0); dly.delayTime.value = 0.45; // 轻微回声：空房间感
      var fb = ctx.createGain(); fb.gain.value = 0.3;
      dly.connect(fb); fb.connect(dly); dly.connect(mg);
      try { mg.gain.setTargetAtTime(0.38, this._t(), 2.5); } catch (e) {}
      var self = this;
      this._piano = { on: true, step: 0, next: 0, gain: mg, lp: lp, delay: dly, timer: null };
      this._piano.timer = setInterval(function () { self._pianoTick(); }, 180);
    },
    manilaPianoStop: function () {
      var Pc = this._piano;
      if (!Pc || !Pc.on) return;
      Pc.on = false;
      if (Pc.timer) { clearInterval(Pc.timer); Pc.timer = null; }
      this._piano = null;
      var t = this._t();
      try { Pc.gain.gain.setTargetAtTime(0.0001, t, 0.8); } catch (e) {}
      setTimeout(function () {
        try { Pc.lp.disconnect(); Pc.delay.disconnect(); Pc.gain.disconnect(); } catch (e) {}
      }, 2500);
    },
    // 音序器心跳：向前 0.45s 预定音符（仿 _partyTick 写法）
    _pianoTick: function () {
      var Pc = this._piano;
      if (!Pc || !Pc.on || !this._ok) return;
      // 离开 L0（跨关）时自停并恢复嗡鸣：levels.js 的 tick 不再运行，这里兜底
      if (BR.Game && BR.Game.level !== 'L0') {
        this.manilaPianoStop(); this.manilaHumDuck(false); return;
      }
      var ctx = this._ctx;
      if (Pc.next < ctx.currentTime) Pc.next = ctx.currentTime + 0.1;
      var spb = 0.52, guard = 0;
      while (Pc.next < ctx.currentTime + 0.45 && guard++ < 16) {
        this._pianoNote(Pc.step, Pc.next - ctx.currentTime, spb, Pc);
        Pc.next += spb;
        Pc.step = (Pc.step + 1) % 32;
      }
    },
    _pianoNote: function (step, at, spb, Pc) {
      function mf(m) { return 440 * Math.pow(2, (m - 69) / 12); } // midi -> Hz
      var dest = Pc.lp;
      // 低音：每 8 步一个根音（C - Am - F - G，舒缓进行）
      var bass = [48, 45, 41, 43];
      if (step % 8 === 0) {
        this._tone({ f: mf(bass[(step / 8) | 0]), type: 'sine', dur: spb * 6, vol: 0.10, a: 0.08, at: at, dest: dest });
      }
      // 主旋律：32 步摇篮曲式五声音阶
      var mel = [64, -1, 67, -1, 69, -1, 72, -1, 74, -1, 72, 69, 67, -1, 64, -1,
                 65, -1, 69, -1, 72, -1, 76, -1, 74, 72, 69, 67, 64, -1, -1, -1];
      var m = mel[step % 32];
      if (m > 0) {
        this._tone({ f: mf(m), type: 'triangle', dur: spb * 3.2, vol: 0.11, a: 0.03, at: at, dest: dest });
        this._tone({ f: mf(m), type: 'sine', dur: spb * 2.0, vol: 0.05, a: 0.05, at: at, dest: Pc.delay });
      }
    },
    // 靠近马尼拉房间时压低 L0 荧光灯嗡鸣（环境总线），离开恢复
    manilaHumDuck: function (on) {
      if (!this._ok || !this._ctx || !this._amb) return;
      try { this._amb.gain.setTargetAtTime(on ? 0.22 : 1.0, this._t(), 1.2); } catch (e) {}
    },
    knock: function () { // 墙内敲击：闷响 4 下，间隔随机
      if (!this._ok) return;
      for (var i = 0; i < 4; i++) {
        var at = i * (0.38 + Math.random() * 0.15);
        this._tone({ f: 95 - i * 7, f1: 42, type: 'sine', dur: 0.22, vol: 0.5, at: at });
        this._nz({ f: 260, ft: 'lowpass', dur: 0.14, vol: 0.30, at: at });
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
