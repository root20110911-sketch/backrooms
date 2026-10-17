/* lv_l25.js —— Level 25「街机枢纽·Quarter Hub」内容搭建
 * 原著取舍（见 LORE.md，由原著研究结论汇总）：
 *   Wikidot "The Quarter Hub"：废弃 80 年代街机厅、大回声房间+穿插走廊+
 *     后场景（储藏/锅炉房，常见补给与硬币）；约 1/1500 机器可用，投币玩 →
 *     传送到预定层级（对面必有另一台机器）；出口含 L37、L11。
 *   Fandom "Out of Order"：机身颜色密码（橙→L11）；出口列表含 L188；
 *     地毯房间、霓虹星空装饰。
 *   游戏内实现：可玩机（投币 → 单键 timing 小游戏，赢了传送）3 台：
 *     红机→L37（Wikidot）、橙机→L11（Wikidot+Fandom）、蓝机→L188（Fandom）；
 *     普通可玩机赢了给补给奖励；故障机可观察（花屏/异常画面）；异常机事件。
 *   无原著依据的连接一律不做；机器侧面的号码标签是原著设定的"流浪者留言"。
 *
 * 交互：全部走 W.addInteractable（统一管线），prompt 用 BR.interactKeyLabel()。
 * 小游戏：投币后指针来回扫，按交互键（E/触屏交互钮）在指针进绿区时"拍"，
 *   5 次命中获胜 / 3 次失手吞币。只用管线内的 use()，不监听任何按键。
 * 状态：W.state.l25 = {coins, mach:{cabIdx:{seen,plays,wins,st}}}，
 *   挂在按关 ws 桶下（P0-2 透传持久化；save.js 缺省回填由集成工人登记）。
 * 性能：机身/招牌走 InstancedMesh（每区块各 1 draw call）；屏幕为共享材质
 *   的普通 Mesh（状态切换只换材质）；仅当前游玩的机器用一块动态 Canvas。
 */
(function () {
  var BR = window.BR;
  var T = BR.TILE;

  var CAB_COLORS = { red: 0xb03030, orange: 0xc96a1e, blue: 0x2a5fc9, purple: 0x7a3dc9, teal: 0x2aa5a0, yellow: 0xc9a52a };
  var DEST_TEXT = { L37: 'Level 37 ——「泳池房」', L11: 'Level 11 ——「无垠城市」', L188: 'Level 188 ——「百窗庭」' };

  function poiList(map, type) { return (map.pois || []).filter(function (p) { return p.type === type; }); }
  function travelL25(dest, dropText) {
    if (!BR.Levels[dest]) {
      BR.UI.toast('……机器那头一片黑暗（该楼层尚未开放）。');
      return;
    }
    if (BR.Cutout && typeof BR.Cutout.travelTo === 'function') {
      try {
        var r = BR.Cutout.travelTo(dest, { mode: 'door', dropText: dropText });
        if (r && typeof r.then === 'function') r.catch(function () {});
        return;
      } catch (e) { if (BR.log) BR.log('[l25] travelTo 异常，走 travel 兜底', e); }
    }
    if (BR.Cutout && typeof BR.Cutout.travel === 'function') BR.Cutout.travel(dest, { kind: 'door', dropText: dropText });
    else if (BR.Game && BR.Game.gotoLevel) BR.Game.gotoLevel(dest, {});
  }
  function pushEvent(W, id) {
    if (W.state.events.indexOf(id) < 0) {
      W.state.events.push(id);
      BR.bus.emit('event', { id: id });
    }
  }
  function st25(W) {
    if (!W.state.l25) W.state.l25 = { coins: 0, mach: {} };
    return W.state.l25;
  }
  function machState(W, idx) {
    var S = st25(W);
    if (!S.mach[idx]) S.mach[idx] = { seen: 0, plays: 0, wins: 0, st: 'idle' };
    return S.mach[idx];
  }

  var NOTES = {
    L25_note0: {
      title: '皱巴巴的笔记本（入口厅）',
      body: '「第25层。废弃的街机厅，我叫它 Quarter Hub。\n\n这里大约一千五百台里只有一台能用：投币，玩，赢了就会被送到机器连着的层级。别问我原理，我只知道管用。\n\n机器侧面有人用马克笔写了号码——那是目的地，是以前来过的人留下的。\n\n花屏的机器别碰。它们坏掉不是因为没电。」'
    },
    L25_note1: {
      title: '锅炉房墙上的粉笔字',
      body: '「锅炉别碰，阀门烫。\n\n箱子底下、墙角经常有掉出来的游戏币，M.E.G. 那帮人来过，把能玩的机器都试了一遍。\n\n记住：橙色的那台去 11，别上错机。」'
    }
  };

  function addNoteL25(W, p) {
    var note = NOTES[p.data.noteId];
    if (!note) return;
    var id = 'note_l25_' + p.tx + '_' + p.ty;
    W.addChunkContent(p.tx, p.ty, function (group) {
      if (W.state.picked.indexOf(id) >= 0) return;
      var m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: BR.Textures.get('note') }));
      m.position.set(BR.tileCX(p.tx), 1.5, BR.tileCZ(p.ty));
      m.rotation.y = Math.PI / 4;
      W.reg(group, m);
      W.addInteractable({
        id: id, kind: 'note', chunkKey: W.chunkKeyOf(p.tx, p.ty),
        meshes: [m], pos: m.position.clone(), radius: 2.4,
        prompt: function () { return '阅读字条'; },
        canUse: function () { return true; },
        use: function () {
          BR.Audio.paper();
          BR.UI.showNote(note.title, note.body);
          if (W.state.picked.indexOf(id) < 0) {
            W.state.picked.push(id);
            BR.bus.emit('picked', { id: id });
          }
        }
      });
    });
  }

  /* ================= Level 定义 ================= */
  BR.Levels.L25 = {
    name: 'Level 25 ——「街机枢纽·Quarter Hub」',
    theme: {
      bg: 0x07070f, fogNear: 6, fogFar: 64, ambient: 0x8a7ab0, ambInt: 0.5,
      sky: 0x0a0a14, ground: 0x14101e, light: 0xff9fd0, lightInt: 0.65,
      wallH: 3.0, wall: 'arc_wall', floor: 'arc_carpet', ceil: 'arc_ceil',
      surface: 'carpet', fixtureEvery: 9999, hum: 0.35
    },

    buildContent: function (map, W) {
      var meta = map.meta.l25 || { cabs: [], shelves: [] };
      if (W.INTERACT_KINDS.indexOf('arcade') < 0) W.INTERACT_KINDS.push('arcade');
      st25(W);
      var L = (W._l25 = {
        scrByCab: {}, coinMeshes: [], active: null,
        flickT: 0, neonT: 0, marqMats: []
      });

      /* ---------- 共享屏幕材质（状态切换只换材质，不建新纹理） ---------- */
      var scrMats = (L.scrMats = {});
      ['scr_attract0', 'scr_attract1', 'scr_static0', 'scr_static1', 'scr_static2',
       'scr_static3', 'scr_glitch', 'scr_off', 'scr_weird', 'scr_win'].forEach(function (n) {
        scrMats[n] = new THREE.MeshBasicMaterial({ map: BR.Textures.get(n) });
      });
      // 游玩画布（全关共用一块，只在有人玩时绘制）
      var pc = document.createElement('canvas'); pc.width = 256; pc.height = 192;
      var px2d = pc.getContext('2d');
      var playTex = new THREE.CanvasTexture(pc);
      scrMats._play = new THREE.MeshBasicMaterial({ map: playTex });
      L.playCanvas = pc; L.playCtx = px2d; L.playTex = playTex;
      // 招牌纹理（运行时绘制一块共享）
      var mc = document.createElement('canvas'); mc.width = 128; mc.height = 32;
      var mx = mc.getContext('2d');
      mx.fillStyle = '#0a0a12'; mx.fillRect(0, 0, 128, 32);
      mx.font = 'bold 22px monospace'; mx.textAlign = 'center'; mx.textBaseline = 'middle';
      mx.shadowColor = '#ff5fa2'; mx.shadowBlur = 10;
      mx.fillStyle = '#ffd9ec'; mx.fillText('▶ PLAY', 64, 17);
      var marqTex = new THREE.CanvasTexture(mc);
      L.marqMat = new THREE.MeshBasicMaterial({ map: marqTex });

      /* ---------- 街机：按区块分组，机身/招牌 InstancedMesh ---------- */
      var byChunk = {};
      meta.cabs.forEach(function (cb) {
        W.skipWall(cb.tx, cb.ty);
        var k = W.chunkKeyOf(cb.tx, cb.ty);
        (byChunk[k] = byChunk[k] || []).push(cb);
      });
      var bodyGeo = new THREE.BoxGeometry(0.95, 1.9, 0.8);
      var bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      var marqGeo = new THREE.PlaneGeometry(0.9, 0.22);
      var scrGeo = new THREE.PlaneGeometry(0.74, 0.56);
      var dummy = new THREE.Object3D();
      var tmpColor = new THREE.Color();
      Object.keys(byChunk).forEach(function (k) {
        var list = byChunk[k];
        var rep = list[0];
        W.addChunkContent(rep.tx, rep.ty, function (group) {
          // 机身
          var bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, list.length);
          // 招牌
          var marqs = new THREE.InstancedMesh(marqGeo, L.marqMat, list.length);
          var mi = 0;
          list.forEach(function (cb, i) {
            var cx = BR.tileCX(cb.tx), cz = BR.tileCZ(cb.ty);
            var yaw = Math.atan2(cb.nx, cb.nz);
            dummy.position.set(cx, cb.tipped ? 0.48 : 0.95, cz);
            dummy.rotation.set(0, yaw, cb.tipped ? 1.35 : 0);
            dummy.updateMatrix();
            bodies.setMatrixAt(i, dummy.matrix);
            try {
              tmpColor.setHex(CAB_COLORS[cb.color] || 0x888888);
              if (cb.state === 'broken' || cb.state === 'off') tmpColor.multiplyScalar(0.45);
              bodies.setColorAt(i, tmpColor);
            } catch (e) {}
            // 招牌（推倒的不装）
            if (!cb.tipped) {
              dummy.position.set(cx + cb.nx * 0.415, 1.78, cz + cb.nz * 0.415);
              dummy.rotation.set(0, yaw, 0);
              dummy.updateMatrix();
              marqs.setMatrixAt(mi++, dummy.matrix);
            }
            // 屏幕（推倒/纯坏机不装屏幕网格，省 draw call）
            if (!cb.tipped && cb.state !== 'broken') {
              var sm = new THREE.Mesh(scrGeo, scrMatFor(L, cb));
              sm.position.set(cx + cb.nx * 0.412, 1.30, cz + cb.nz * 0.412);
              sm.rotation.y = yaw;
              W.reg(group, sm);
              L.scrByCab[cb.idx] = sm;
              sm.userData.cabIdx = cb.idx;
              wireCabinet(W, L, map, cb, sm);
            }
          });
          bodies.instanceMatrix.needsUpdate = true;
          if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
          marqs.count = mi;
          marqs.instanceMatrix.needsUpdate = true;
          W.reg(group, bodies);
          W.reg(group, marqs);
          L.marqMats.push(L.marqMat);
        });
      });

      /* ---------- 货架挡墙渲染 ---------- */
      (meta.shelves || []).forEach(function (s, si) {
        for (var yy = s[1]; yy <= s[3]; yy++)
          for (var xx = s[0]; xx <= s[2]; xx++) W.skipWall(xx, yy);
        var sx = BR.tileCX((s[0] + s[2]) / 2), sz = BR.tileCZ((s[1] + s[3]) / 2);
        W.addChunkContent(s[0], s[1], function (group) {
          var wM = (s[2] - s[0] + 1) * T, dM = (s[3] - s[1] + 1) * T;
          var shelf = new THREE.Mesh(new THREE.BoxGeometry(wM, 2.2, dM),
            new THREE.MeshLambertMaterial({ color: 0x2c2620 }));
          shelf.position.set(sx, 1.1, sz);
          W.reg(group, shelf);
          // 货架上的纸箱剪影
          for (var bxi = 0; bxi < 3; bxi++) {
            var box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7),
              new THREE.MeshLambertMaterial({ color: 0x6b5636 }));
            box.position.set(sx + (bxi - 1) * (wM / 3.2), 2.45, sz);
            box.rotation.y = bxi * 0.4;
            W.reg(group, box);
          }
        });
      });

      /* ---------- 入口霓虹招牌 ---------- */
      W.addChunkContent(27, 47, function (group) {
        var sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 3),
          new THREE.MeshBasicMaterial({ map: BR.Textures.get('neon_sign') }));
        sign.position.set(BR.tileCX(27), 2.0, BR.tileCZ(47) - 1.44);
        sign.rotation.y = Math.PI; // 面向入口（+z）
        W.reg(group, sign);
      });

      /* ---------- 游戏币拾取 ---------- */
      var coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 14);
      var coinMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
      poiList(map, 'quarter').forEach(function (p) {
        var id = 'l25q_' + p.tx + '_' + p.ty;
        W.addChunkContent(p.tx, p.ty, function (group) {
          if (W.state.picked.indexOf(id) >= 0) return;
          var cm = new THREE.Mesh(coinGeo, coinMat);
          cm.position.set(BR.tileCX(p.tx), 0.55, BR.tileCZ(p.ty));
          cm.rotation.x = Math.PI / 2.4;
          W.reg(group, cm);
          L.coinMeshes.push(cm);
          W.addInteractable({
            id: id, kind: 'pickup', chunkKey: W.chunkKeyOf(p.tx, p.ty),
            meshes: [cm], pos: cm.position.clone(), radius: 2.2,
            prompt: function () { return BR.interactKeyLabel() + '捡起游戏币'; },
            canUse: function () { return W.state.picked.indexOf(id) < 0; },
            use: function () {
              if (W.state.picked.indexOf(id) >= 0) return;
              W.state.picked.push(id);
              st25(W).coins++;
              BR.Audio.pickup();
              BR.UI.toast('捡到一枚游戏币（共 ' + st25(W).coins + ' 枚）');
              BR.bus.emit('picked', { id: id });
              pushEvent(W, 'l25_coin');
              W.removeInteractable(id);
              if (cm.parent) cm.parent.remove(cm);
            }
          });
        });
      });

      /* ---------- 字条 / 补给箱 / 薄墙 ---------- */
      poiList(map, 'note').forEach(function (p) { addNoteL25(W, p); });
      if (BR._lvShare && BR._lvShare.addCrate)
        poiList(map, 'crate').forEach(function (p) { BR._lvShare.addCrate(W, p); });
      BR.buildThinWalls(map, W);

      W.objective = '探索街机枢纽：找能用的机器。投币，玩，赢了也许能去别的地方——机器侧面的号码是前人留下的提示';
    },

    onEnter: function () {
      BR.UI.setObjective(BR.World.objective);
      BR.Audio.setAmbient('L25');
      setTimeout(function () {
        BR.UI.toast('街机枢纽。镇流器的嗡鸣、远处断断续续的 8-bit 旋律，和一排排死去的屏幕。', 4200);
      }, 1200);
    },

    tick: function (dt) {
      var W = BR.World;
      if (!W) return;
      var L = W._l25;
      if (!L) return;
      BR.thinWallTick(dt);
      // 屏幕闪烁：attract 双帧 / 故障机雪花四帧（只动已加载的）
      L.flickT += dt;
      if (L.flickT > 0.28) {
        L.flickT = 0;
        var fr = (L._fr = ((L._fr || 0) + 1) % 4);
        for (var idx in L.scrByCab) {
          var sm = L.scrByCab[idx];
          if (!sm || !sm.parent || !sm.userData.cb) continue;
          var cb = sm.userData.cb;
          var ms = machState(W, cb.idx);
          if (ms.st === 'playing' || ms.st === 'wonflash') continue;
          if (cb.state === 'work' || cb.state === 'tether')
            sm.material = L.scrMats[fr % 2 ? 'scr_attract1' : 'scr_attract0'];
          else if (cb.state === 'inspect')
            sm.material = L.scrMats['scr_static' + fr];
        }
      }
      // 霓虹招牌微闪
      L.neonT += dt;
      if (L.neonT > 0.12) {
        L.neonT = 0;
        var j = 0.86 + Math.random() * 0.14;
        L.marqMat.color.setScalar(j);
      }
      // 硬币浮动（顺带清理已卸载区块的残留引用）
      L._coinT = (L._coinT || 0) + dt;
      if (L._coinT > 5) {
        L._coinT = 0;
        L.coinMeshes = L.coinMeshes.filter(function (m) { return m && m.parent; });
      }
      for (var ci = 0; ci < L.coinMeshes.length; ci++) {
        var cm = L.coinMeshes[ci];
        if (cm && cm.parent) {
          cm.rotation.z += dt * 2.2;
          cm.position.y = 0.55 + Math.sin(W.time * 2.4 + ci) * 0.08;
        }
      }
      // 进行中的小游戏：指针扫描 + 重绘
      var A = L.active;
      if (A) {
        var cbA = A.cb, msA = machState(W, cbA.idx);
        if (msA.st !== 'playing') { L.active = null; }
        else {
          // 区块重建导致屏幕网格换新：重绑（交互物 id 不变，use 仍能找到）
          if (!A.screenMesh.parent && L.scrByCab[cbA.idx] && L.scrByCab[cbA.idx].parent) {
            A.screenMesh = L.scrByCab[cbA.idx];
            A.screenMesh.material = L.scrMats._play;
          }
          A.p += A.dir * A.spd * dt;
          if (A.p > 1) { A.p = 1; A.dir = -1; }
          if (A.p < 0) { A.p = 0; A.dir = 1; }
          drawPlayScreen(L, A);
          L.playTex.needsUpdate = true;
        }
      }
    }
  };

  // v2.0 P4：把 L25 登记进随机裂隙候选池（权重 10，接 cutout.js _extraRiftDests）。
  if (BR.Cutout && typeof BR.Cutout.registerRiftDest === 'function') BR.Cutout.registerRiftDest('L25', 10);

  /* ---------- 屏幕材质 ---------- */
  function scrMatFor(L, cb) {
    if (cb.state === 'work' || cb.state === 'tether') return L.scrMats.scr_attract0;
    if (cb.state === 'inspect') return L.scrMats.scr_static0;
    if (cb.state === 'weird') return L.scrMats.scr_weird;
    return L.scrMats.scr_off;
  }

  /* ---------- 街机交互接线 ---------- */
  function wireCabinet(W, L, map, cb, screenMesh) {
    screenMesh.userData.cb = cb;
    var cx = BR.tileCX(cb.tx), cz = BR.tileCZ(cb.ty);
    // 注意：pos 必须落在屏幕网格附近——rayInteract 按"射线到网格的距离"做 radius 过滤，
    // pos 若放在前方 tile 中央（离屏幕 2.6m），会因 h.distance > radius 被恒拒绝。
    var px = cx + cb.nx * 0.5, pz = cz + cb.nz * 0.5;
    var id = 'l25cab_' + cb.idx;
    var playable = cb.state === 'work' || cb.state === 'tether';
    var observable = cb.state === 'inspect' || cb.state === 'weird';
    if (!playable && !observable) return;
    W.addInteractable({
      id: id, kind: 'arcade', chunkKey: W.chunkKeyOf(cb.tx, cb.ty),
      meshes: [screenMesh], pos: new THREE.Vector3(px, 1.3, pz), radius: 2.6,
      prompt: function () {
        var kl = BR.interactKeyLabel();
        var ms = machState(W, cb.idx);
        if (cb.state === 'weird') return kl + '靠近看看那台机器';
        if (cb.state === 'inspect') return kl + '观察花屏';
        if (ms.st === 'playing') return kl + '拍！（指针进绿区时按）';
        var c = st25(W).coins;
        var dest = (cb.state === 'tether' && ms.seen) ? '（→' + cb.dest + '）' : '';
        return kl + '投币玩街机' + dest + '（你有 ' + c + ' 枚币）';
      },
      canUse: function () {
        return BR.Game && BR.Game.state === 'playing' && !(BR.Cutout && BR.Cutout.busy);
      },
      use: function () { cabUse(W, L, cb, screenMesh); }
    });
  }

  function cabUse(W, L, cb, screenMesh) {
    var ms = machState(W, cb.idx);
    // —— 故障机：观察花屏 ——
    if (cb.state === 'inspect') {
      var ev = 'l25_glitch_' + cb.idx;
      if (W.state.events.indexOf(ev) < 0) {
        pushEvent(W, ev);
        BR.Audio.glitch();
        BR.Player.drainSanity(4);
        BR.UI.toast('屏幕突然爆出一阵彩条噪点——里面好像有半张人脸，一闪就没了。你决定不再盯着它看。', 4200);
      } else {
        BR.Audio.glitch();
        var lines = ['雪花噪点里混着断断续续的电流声。', '屏幕一角残留着烧焦的痕迹，像是被什么东西从里面烧的。',
          '你听到机箱里传来一声很轻的"咔哒"，像投币口在空转。'];
        BR.UI.toast(lines[(ms.plays++) % lines.length]);
      }
      return;
    }
    // —— 异常机 ——
    if (cb.state === 'weird') {
      var wev = 'l25_weird';
      if (W.state.events.indexOf(wev) < 0) {
        pushEvent(W, wev);
        BR.Audio.stinger();
        BR.Player.drainSanity(8);
        BR.UI.showNote('那台机器',
          '屏幕上是一张扭曲的笑脸。它明明是画上去的，可当你眨眼时，笑脸的眼睛好像动了一下——在看你。\n\n机箱背后用指甲刻着一行小字：「别玩第五台」。\n\n你数了数，这间大厅里根本没有"第五台"这种编号。');
      } else {
        BR.Audio.whisper();
        BR.Player.drainSanity(2);
        BR.UI.toast('笑脸还在。它好像比上次离屏幕更近了一点。', 3000);
      }
      return;
    }
    // —— 可玩机：游玩中 → 判定这一次"拍" ——
    if (ms.st === 'playing' && L.active && L.active.cb.idx === cb.idx) {
      attemptHit(W, L, cb, screenMesh);
      return;
    }
    // 胜利闪光/传送等待中，或别处还有一局没打完：不接受新投币
    if (ms.st === 'wonflash') return;
    if (L.active && L.active.cb.idx !== cb.idx) {
      BR.UI.toast('你还有一局没打完——先回去把它打完吧。', 2500);
      return;
    }
    // —— 跨关机首次：先看标签（观察发现，不摆传送按钮） ——
    if (cb.state === 'tether' && !ms.seen) {
      ms.seen = 1;
      BR.Audio.paper();
      BR.UI.showNote('褪色的标签',
        cb.hint + '\n\n有人用马克笔在机身上写了这个。看来这台机器连着别的地方——' +
        (DEST_TEXT[cb.dest] || cb.dest) + '。\n\n投币，玩，赢了就能过去。');
      pushEvent(W, 'l25_seen_' + cb.dest);
      return;
    }
    // —— 投币启动 ——
    var S = st25(W);
    if (S.coins <= 0) {
      BR.Audio.doorLocked();
      BR.UI.toast('投币口毫无反应。你没有游戏币——去后场景的储藏区找找，箱子底下和墙角经常有。', 3600);
      return;
    }
    S.coins--;
    ms.plays++;
    ms.st = 'playing';
    ms.hits = 0; ms.misses = 0;
    var spd = 0.5 + Math.min(0.5, 0.06 * ms.plays);
    L.active = {
      cb: cb, screenMesh: screenMesh, p: 0, dir: 1, spd: spd,
      zone: newZone(), hits: 0, misses: 0, missT: 0
    };
    screenMesh.material = L.scrMats._play;
    BR.Audio.pickup();
    BR.Audio.elevatorDing();
    BR.UI.toast('哐当——游戏币落进去了。屏幕亮了：等指针扫进绿区时' + BR.interactKeyLabel() + '拍一下，5 次命中获胜！', 3600);
    pushEvent(W, 'l25_play');
  }
  function newZone() {
    return { x: 0.35 + Math.random() * 0.3, w: 0.11 };
  }

  function attemptHit(W, L, cb, screenMesh) {
    var ms = machState(W, cb.idx), A = L.active;
    if (!A) return;
    if (A.screenMesh && A.screenMesh.parent) screenMesh = A.screenMesh; // 用重绑后的新网格
    if (Math.abs(A.p - A.zone.x) <= A.zone.w) {
      ms.hits++;
      A.hits = ms.hits;
      BR.Audio.pickup();
      A.zone = newZone();
      A.spd = Math.min(1.4, A.spd + 0.05);
      if (ms.hits >= 5) winGame(W, L, cb, screenMesh);
    } else {
      ms.misses++;
      A.misses = ms.misses;
      BR.Audio.glitch();
      BR.Player.drainSanity(2);
      A.missT = 0.35;
      if (ms.misses >= 3) loseGame(W, L, cb, screenMesh);
    }
  }

  function winGame(W, L, cb, screenMesh) {
    var ms = machState(W, cb.idx);
    ms.wins++;
    ms.st = 'wonflash';
    L.active = null;
    screenMesh.material = L.scrMats.scr_win;
    BR.Audio.checkpoint();
    setTimeout(function () { BR.Audio.glitch(); }, 350);
    pushEvent(W, 'l25_win' + (cb.state === 'tether' ? '_' + cb.dest : ''));
    if (cb.state === 'tether') {
      BR.UI.toast('YOU WIN! —— 屏幕中央裂开一道白光，机器背后传来别的层级的声音……', 3000);
      ms.st = 'wonflash';
      setTimeout(function () {
        ms.st = 'idle';
        travelL25(cb.dest, '你穿过白光，扑进' + (DEST_TEXT[cb.dest] || '另一层') + '。身后，一台街机静静地立在原地。');
      }, 1400);
    } else {
      ms.st = 'idle';
      BR.Player.restoreSanity(12);
      // 奖励：轮流给（补给 / 退币），用确定性轮换避免刷
      var giveQuarter = (ms.wins % 2 === 0);
      if (giveQuarter) {
        st25(W).coins++;
        BR.UI.toast('YOU WIN! 机器"哐当"吐出一枚游戏币以示鼓励（+1 币），你感觉心情好了些（理智+12）。', 3600);
      } else if (BR.Items && BR.Items.add && BR.Items.canAdd && BR.Items.canAdd('almond', 1)) {
        BR.Items.add('almond', 1);
        BR.UI.toast('YOU WIN! 机器底部分发口掉出一瓶杏仁水（+1），你感觉心情好了些（理智+12）。', 3600);
      } else {
        BR.UI.toast('YOU WIN! 你感觉心情好了些（理智+12）。', 3000);
      }
      setTimeout(function () {
        if (screenMesh.parent) screenMesh.material = L.scrMats.scr_attract0;
      }, 1600);
    }
  }

  function loseGame(W, L, cb, screenMesh) {
    var ms = machState(W, cb.idx);
    ms.st = 'idle';
    L.active = null;
    screenMesh.material = L.scrMats.scr_off;
    BR.Audio.thud();
    BR.UI.toast('GAME OVER —— 三次失手，硬币被机器吞了。屏幕暗了下去。', 3200);
    setTimeout(function () {
      if (screenMesh.parent) screenMesh.material = L.scrMats.scr_attract0;
    }, 2500);
  }

  /* ---------- 游玩画布绘制 ---------- */
  function drawPlayScreen(L, A) {
    var x = L.playCtx, w = 256, h = 192;
    x.fillStyle = '#0b1026'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#7df0ff'; x.font = 'bold 18px monospace';
    x.textAlign = 'center'; x.fillText('TIMING!', w / 2, 28);
    // 命中/失手计数
    x.font = 'bold 14px monospace';
    x.fillStyle = '#5dffb0';
    x.fillText('HIT ' + (A.hits || 0), 40, 52);
    x.fillStyle = '#ff5f6e';
    x.fillText('MISS ' + (A.misses || 0), w - 46, 52);
    // 轨道
    x.fillStyle = '#1a2340'; x.fillRect(18, 86, w - 36, 26);
    // 绿区
    var zx = 18 + (A.zone.x - A.zone.w) * (w - 36), zw = 2 * A.zone.w * (w - 36);
    x.fillStyle = '#2dff8f'; x.fillRect(zx, 86, zw, 26);
    // 指针
    var mxp = 18 + A.p * (w - 36);
    x.fillStyle = '#ffe93d'; x.fillRect(mxp - 2, 78, 4, 42);
    // 失手红闪
    if (A.missT > 0) {
      A.missT -= 0.016;
      x.fillStyle = 'rgba(255,40,60,' + Math.max(0, A.missT).toFixed(2) + ')';
      x.fillRect(0, 0, w, h);
    }
    x.fillStyle = '#8fa3c8'; x.font = '12px monospace';
    x.fillText('5 HITS TO WIN', w / 2, 140);
    // 扫描线
    x.fillStyle = 'rgba(0,0,0,0.25)';
    for (var y = 0; y < h; y += 4) x.fillRect(0, y, w, 2);
  }
})();
