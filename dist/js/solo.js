// 单机模式：主题不跑联机服，所以由这里在本地「养鸡」。
//
// 原版 cyber-probe 的探针鸡 / 网站鸡 / 大白鹅 / 看门狗全部由服务端下发、位置与血量都由服务端裁定
// （见 js/npc.js 的注释）。做成主题之后没有 farm_server.py 可连，场上就只剩玩家一只鸡 ——
// 这个模块补回最简单的本地 AI，让农场在纯静态主题里也能玩：
//
//   · 探针鸡：闲逛 / 啄地 / 振翅；CPU、内存超阈值（或网络最差）的会追人啄；
//   · 网站鸡：和探针鸡同款，但没有血量以外的状态；
//   · 大白鹅：守着自己那片领地，玩家走进来就追；被玩家打会反击，只有被狗咬才逃；
//   · 看门狗：在鸡舍门口溜达，看到大白鹅或暴躁鸡就冲过去咬（不咬玩家、打不倒）。
//
// 数值对齐 server/farm_server.py（PROBE_HP=100、玩家啄 12 / 扇翅 8、暴躁鸡啄 9 / 冷却 2.2s、
// 大白鹅 60 血 / 啄 6 / 领地 2.5m、看门狗 9 伤害 / 冷却 1.1s 等）。

import { Npc } from './npc.js?v=1.0.12';
import { Goose } from './goose.js';
import { Dog, DOG } from './dog.js';
import { CONF } from './data.js?v=1.0.12';
import { resolveCollision, BOUNDS, groundHeight } from './world.js';

const THEME = (typeof window !== 'undefined' && window.CP_THEME) || {};

// 与 js/chicken.js / server/farm_server.py 同一套状态位
const ST_KO = 1, ST_PECK = 2, ST_RUN = 4, ST_FLAP = 8, ST_PREEN = 16, ST_FLEE = 32, ST_FIGHT = 64;

const PROBE_HP = 100;
const PROBE_SPEED = 0.8;
const PROBE_RUN = 3.4;
const PROBE_FLEE = 4.2;
const PROBE_R = 0.5;
const PROBE_HOT_RANGE = 1.7;
const PROBE_HOT_DMG = 9;
const PROBE_HOT_CD = 2.2;
const PROBE_WING_RANGE = 1.75;
const PROBE_WING_DMG = 8;
const PROBE_WING_CD = 3.2;
const PROBE_WING_PICK = 0.45;
const PROBE_WING_KNOCK = 1.5;
const PROBE_FLEE_GAP = 9.0;
const PROBE_DASH_CHANCE = 0.45;
const PROBE_DASH_T = 1.4;

const BULLY_SEEK = 14.0;
const BULLY_PICK = 0.2;
const BULLY_DUR = 5.0;
const BULLY_CD = 8.0;
const BULLY_RANGE = 22.0;

const GOOSE_HP = 60;
const GOOSE_WALK = 1.05;
const GOOSE_CHASE = 2.9;
const GOOSE_CHASE_R = 2.5;
const GOOSE_LEASH = 6.5;
const GOOSE_PECK_R = 1.15;
const GOOSE_DMG = 6;
const GOOSE_CD = 1.2;
const GOOSE_R = 0.35;
const GOOSE_KNOCK = 1.2;

const DOG_WALK = 1.5;
const DOG_RUN = 4.2;
const DOG_SENSE = 8.0;
const DOG_BITE_R = 1.35;
const DOG_SCARE_T = 4.0;      // 被咬后逃离狗的范围持续多久
const DOG_LEASH = 5.0;        // 离家最远追这么远
const DOG_GIVEUP = 3.0;
const DOG_BAN = 8.0;
const DOG_RANGE_OUT = 2.2;
const DOG_R = 0.42;
const DOG_HOME = { x: -8.6, z: -4.2 };

const PLAYER_PECK_DMG = 12;
const PLAYER_WING_DMG = 8;
const RESPAWN_MS = 3500;
const GOOSE_RESPAWN_MS = 3500;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

export class SoloFarm {
  /**
   * @param {object} ctx {farm, hud, scene, world, npcs, player, playerChicken, feathers, sfx, isTouch, spawn, name}
   */
  constructor(ctx) {
    Object.assign(this, ctx);
    this.name = ctx.name || '你';
    this.events = [];
    this.lastHurt = 0;
    this._hudT = 0;
    this._gooseSeq = 0;
    this._dogSeq = 0;
    document.body.classList.add('solo');
    // 单机没有别的玩家，啄倒榜只显示自己；先把占位行换成真实分数
    this.pushBoard();
    this.spawnGeese();
    this.spawnDogs();
    this.sync();
  }

  // ---------- 生成 / 回收 ----------
  sync() {
    if (!this.npcs) return;
    const want = new Map();
    for (const n of this.farm.nodes) want.set(`n${n.id}`, { kind: 'probe', node: n });
    if (CONF.showWeb) {
      for (const t of this.farm.tasks.values()) want.set(`t${t.id}`, { kind: 'web', task: t });
    }

    // 补新鸡
    for (const [id, spec] of want) {
      if (this.npcs.get(id)) continue;      // 已有（本地或联机快照里的）都不重复生成
      this.spawnNpc(id, spec);
    }

    // 撤掉后端已经删掉的鸡（只动自己养的，不碰联机快照里的）
    for (const [id, e] of [...this.npcs]) {
      if (!e._solo) continue;
      if (e.kind === 'goose' || e.kind === 'dog') continue;
      if (!want.has(id)) this.removeNpc(id);
    }
  }

  spawnNpc(id, { kind, node = null, task = null }) {
    const npc = new Npc({ farm: this.farm, kind, node, task, world: this.world });
    npc.id = id;
    npc._solo = true;
    npc._seenAt = performance.now();
    npc.radius = PROBE_R;
    npc.setRemote(false);
    npc.hp = PROBE_HP;
    const p = this.freePoint(BOUNDS * 0.9, 5);   // 离玩家至少 5m：别让鸡一出生就糊在镜头前
    npc.pos.set(p.x, groundHeight(p.x, p.z), p.z);
    npc.group.position.copy(npc.pos);
    npc.yaw = rand(0, Math.PI * 2);
    npc.group.rotation.y = npc.yaw;
    npc._ai = this.newAi(p);
    npc.sync(Date.now() / 1000);
    npc.addTo(this.scene);
    if (this.isTouch) npc.chicken.hit.scale.setScalar(1.55);
    this.npcs.set(id, npc);
    return npc;
  }

  spawnGeese() {
    const n = clamp(Number(THEME.geese) || 0, 0, 8);
    for (let i = 0; i < n; i++) {
      const g = new Goose();
      g.id = `g${++this._gooseSeq}`;
      g._solo = true;
      g._seenAt = performance.now();
      g.radius = GOOSE_R;
      g.setRemote(false);
      g.hp = GOOSE_HP;
      const p = this.freePoint(BOUNDS * 0.75, 4);   // 大白鹅也别贴着玩家出生
      g.pos.set(p.x, groundHeight(p.x, p.z), p.z);
      g.group.position.copy(g.pos);
      g.yaw = rand(0, Math.PI * 2);
      g.group.rotation.y = g.yaw;
      g._ai = this.newAi(p, GOOSE_HP);
      g.sync();
      g.addTo(this.scene);
      if (this.isTouch) g.chicken.hit.scale.setScalar(1.6);
      this.npcs.set(g.id, g);
    }
  }

  spawnDogs() {
    const n = clamp(Number(THEME.dogs) || 0, 0, 3);
    for (let i = 0; i < n; i++) {
      const d = new Dog();
      d.id = `d${++this._dogSeq}`;
      d._solo = true;
      d._seenAt = performance.now();
      d.radius = DOG_R;
      d.setRemote(false);
      const p = { x: DOG_HOME.x + rand(-2.2, 2.2), z: DOG_HOME.z + rand(-2.2, 2.2) };
      d.pos.set(p.x, groundHeight(p.x, p.z), p.z);
      d.group.position.copy(d.pos);
      d.yaw = rand(0, Math.PI * 2);
      d.group.rotation.y = d.yaw;
      d._ai = this.newAi(p);
      d._ai.home = { ...DOG_HOME };
      d.sync();
      d.addTo(this.scene);
      this.npcs.set(d.id, d);
    }
  }

  removeNpc(id) {
    const e = this.npcs.get(id);
    if (!e) return;
    try { e.dispose(this.scene); } catch { /* 已经收过了 */ }
    this.npcs.delete(id);
  }

  freePoint(radius = BOUNDS * 0.9, minFromPlayer = 0) {
    // 障碍表在 world 上；挑一个不被推开的点（最多试 24 次），并尽量离玩家远一点
    for (let i = 0; i < 24; i++) {
      const x = rand(-radius, radius), z = rand(-radius, radius);
      if (minFromPlayer && this.player && Math.hypot(x - this.player.pos.x, z - this.player.pos.z) < minFromPlayer) continue;
      const [cx, cz] = resolveCollision(x, z, 0.5, this.world.obstacles, this.world.boxObstacles);
      if (Math.hypot(cx - x, cz - z) < 0.5) return { x, z };
    }
    return { x: rand(-radius, radius), z: rand(-radius, radius) };
  }

  newAi(p, hp = PROBE_HP) {
    return {
      mode: 'idle',
      t: rand(0.4, 2.2),          // 当前状态还要持续多久
      target: { x: p.x, z: p.z },
      home: { x: p.x, z: p.z },
      peckCd: rand(0.5, 2),
      lastHit: -1e9,
      koLeft: 0,
      maxHp: hp,
      anim: 0,
      animT: 0,
      fleeT: 0,
      fightT: 0,
      bitCd: 0,
      wingCd: 0,
      scareFrom: null,
      aggro: false,
      bullyId: null,
      bullyT: 0,
      bullyCd: 0,
      dashT: 0,
      dashFrom: null,
      inRange: false,
      cool: 0,
      ban: new Map(),
    };
  }

  // ---------- 每帧 ----------
  update(dt, player) {
    const nowMs = performance.now();
    for (const e of this.npcs.values()) {
      if (!e._solo) continue;
      e._seenAt = nowMs;                 // 别让 main 的「3 秒没快照就收模型」把本地鸡收掉
      if (e.kind === 'goose') this.stepGoose(e, dt, player);
      else if (e.kind === 'dog') this.stepDog(e, dt, player);
      else this.stepChicken(e, dt, player);
    }
    this.separate();
    this.regenPlayer(dt);
  }

  stepChicken(e, dt, player) {
    const ai = e._ai;
    if (!ai) return;
    if (e.chicken.limp) { e.chicken.update(dt, false, false, false, 0); return; }
    if (ai.koLeft > 0) {
      ai.koLeft -= dt * 1000;
      e.chicken.update(dt, false, false, false, ST_KO);
      if (ai.koLeft <= 0) this.reviveNpc(e);
      return;
    }

    ai.peckCd = Math.max(0, ai.peckCd - dt);
    ai.wingCd = Math.max(0, (ai.wingCd || 0) - dt);
    ai.fleeT = Math.max(0, ai.fleeT - dt);
    ai.fightT = Math.max(0, ai.fightT - dt);
    ai.bullyT = Math.max(0, (ai.bullyT || 0) - dt);
    ai.bullyCd = Math.max(0, (ai.bullyCd || 0) - dt);
    ai.dashT = Math.max(0, (ai.dashT || 0) - dt);
    if (ai.fleeT <= 0) ai.scareFrom = null;
    this.regenNpc(e, dt);

    const dp = dist2(e, player);
    const hot = !!(e.info && e.info.hot);

    // 被看门狗咬 / 挨打后逃窜：优先跑开（狗咬时逃离狗，普通挨打时逃离玩家）
    if (ai.fleeT > 0) {
      const src = ai.scareFrom || player.pos;
      if (!ai.scareFrom && dp > PROBE_FLEE_GAP) {
        ai.fleeT = 0;
      } else {
        const away = this.awayPoint(e, { pos: src }, 6);
        this.moveTo(e, away.x, away.z, PROBE_FLEE, dt);
        e.chicken.update(dt, true, true, false, ST_FLEE | ST_RUN);
        this.updateRing(e, dt);
        return;
      }
    }

    // 打了就跑：普通鸡啄/扇中后撤一步，等冷却再扑回来
    if (ai.dashT > 0) {
      const away = this.awayPoint(e, { pos: ai.dashFrom || player.pos }, 5);
      this.moveTo(e, away.x, away.z, PROBE_FLEE * 0.75, dt);
      e.chicken.update(dt, true, true, false, ST_FLEE | ST_RUN);
      this.updateRing(e, dt);
      return;
    }

    // 暴躁鸡欺负别的鸡：附近没有玩家时，偶尔挑一只（对齐 BULLY_* 参数）
    let bully = null;
    if (hot) {
      if (ai.bullyId) {
        const b = this.npcs.get(ai.bullyId);
        if (b && b !== e && b._solo && b.kind !== 'dog' && b.chicken.koT <= 0
          && ai.bullyT > 0 && dist2(e, b) <= BULLY_RANGE) bully = b;
        else { ai.bullyId = null; ai.bullyT = 0; ai.bullyCd = BULLY_CD; }
      }
      if (!bully && !ai.bullyId && ai.bullyCd <= 0 && dp > BULLY_SEEK && Math.random() < BULLY_PICK * dt * 20) {
        let best = null, bd = BULLY_RANGE;
        for (const o of this.npcs.values()) {
          if (o === e || !o._solo || o.kind === 'dog' || o.chicken.koT > 0) continue;
          const d = dist2(e, o);
          if (d < bd) { bd = d; best = o; }
        }
        if (best) { ai.bullyId = best.id; ai.bullyT = BULLY_DUR; bully = best; }
      }
    }

    if (bully) {
      const d = dist2(e, bully);
      if (d > PROBE_HOT_RANGE) {
        this.moveTo(e, bully.pos.x, bully.pos.z, PROBE_RUN, dt);
        e.chicken.update(dt, true, true, false, ST_RUN | ST_FIGHT);
      } else {
        this.faceTo(e, bully.pos.x, bully.pos.z);
        e.chicken.update(dt, false, false, false, ST_FIGHT);
        if (ai.peckCd <= 0) { ai.peckCd = PROBE_HOT_CD; this.chickenAttack(e, bully, d, false); }
      }
    } else {
      const chase = dp < 16 && (ai.fightT > 0 || hot);
      if (chase && player.koT <= 0) {
        if (dp > PROBE_HOT_RANGE) {
          this.moveTo(e, player.pos.x, player.pos.z, PROBE_RUN, dt);
          e.chicken.update(dt, true, true, false, hot ? ST_RUN : (ST_RUN | ST_FIGHT));
        } else {
          this.faceTo(e, player.pos.x, player.pos.z);
          e.chicken.update(dt, false, false, false, hot ? ST_PECK : ST_FIGHT);
          if (ai.peckCd <= 0) { ai.peckCd = PROBE_HOT_CD; this.chickenAttack(e, player, dp, true); }
        }
      } else {
        this.wander(e, dt, PROBE_SPEED);
      }
    }
    this.updateRing(e, dt);
  }

  /** 鸡的一次出手：近距离偶尔扇翅（8 伤害 + 1.5m 击退），否则啄（9 伤害）。 */
  chickenAttack(e, target, d, isPlayer) {
    const ai = e._ai;
    const wing = d <= PROBE_WING_RANGE && (ai.wingCd || 0) <= 0 && Math.random() < PROBE_WING_PICK;
    if (wing) { ai.wingCd = PROBE_WING_CD; e.chicken.flap(); }
    else e.chicken.peck();
    this.sfx.peck();
    if (isPlayer) {
      this.hurtPlayer(wing ? PROBE_WING_DMG : PROBE_HOT_DMG, e, wing ? PROBE_WING_KNOCK : 0);
      if (!(e.info && e.info.hot) && Math.random() < PROBE_DASH_CHANCE) {
        e._ai.dashT = PROBE_DASH_T;
        e._ai.dashFrom = { x: target.pos.x, z: target.pos.z };
      }
      return;
    }
    this.damage(target, wing ? PROBE_WING_DMG : PROBE_HOT_DMG, null);
    if (wing) this.pushAway(e, target, PROBE_WING_KNOCK);
  }

  updateRing(e, dt) {
    if (!e.ring) return;
    const t = performance.now() / 1000;
    const want = e.info?.netWorst ? 0.45 + 0.35 * Math.sin(t * 4) : 0;
    e.ring.material.opacity += (want - e.ring.material.opacity) * Math.min(1, dt * 6);
    e.ring.scale.setScalar(e.info?.netWorst ? 1 + 0.10 * Math.sin(t * 4) : 1);
  }

  stepGoose(e, dt, player) {
    const ai = e._ai;
    if (!ai) return;
    if (ai.koLeft > 0) {
      ai.koLeft -= dt * 1000;
      e.chicken.update(dt, ST_KO);
      if (ai.koLeft <= 0) this.reviveGoose(e);
      return;
    }
    ai.peckCd = Math.max(0, ai.peckCd - dt);
    ai.fleeT = Math.max(0, ai.fleeT - dt);
    this.regenNpc(e, dt);

    const dp = dist2(e, player);
    if (ai.fleeT > 0) {
      const src = ai.scareFrom || player.pos;
      const away = this.awayPoint(e, { pos: src }, 5);
      this.moveTo(e, away.x, away.z, 3.6, dt);
      e.chicken.update(dt, ST_FLEE | ST_RUN, true);
      return;
    }

    // 领地：玩家进 2.5m 开追，追到 6.5m 放走；被玩家打过也会追（不逃跑）
    if (player.koT <= 0) {
      if (dp <= GOOSE_CHASE_R) ai.aggro = true;
      else if (dp > GOOSE_LEASH) ai.aggro = false;
    }
    if (ai.aggro && player.koT <= 0) {
      if (dp > GOOSE_PECK_R) {
        this.moveTo(e, player.pos.x, player.pos.z, GOOSE_CHASE, dt);
        e.chicken.update(dt, ST_RUN, true);
      } else {
        this.faceTo(e, player.pos.x, player.pos.z);
        e.chicken.update(dt, ST_PECK, false);
        if (ai.peckCd <= 0) {
          ai.peckCd = GOOSE_CD;
          e.chicken.peck();
          this.sfx.peck();
          this.hurtPlayer(GOOSE_DMG, e, GOOSE_KNOCK);
        }
      }
      return;
    }

    // 回窝附近溜达
    if (Math.hypot(e.pos.x - ai.target.x, e.pos.z - ai.target.z) < 0.5 || Math.random() < dt * 0.15) {
      const a = rand(0, Math.PI * 2), r = rand(1, 4);
      ai.target.x = ai.home.x + Math.cos(a) * r;
      ai.target.z = ai.home.z + Math.sin(a) * r;
    }
    this.moveTo(e, ai.target.x, ai.target.z, GOOSE_WALK, dt);
    e.chicken.update(dt, 0, true);
  }

  stepDog(e, dt, player) {
    const ai = e._ai;
    if (!ai) return;
    ai.bitCd = Math.max(0, ai.bitCd - dt);
    const now = performance.now();
    const homeD = Math.hypot(e.pos.x - DOG_HOME.x, e.pos.z - DOG_HOME.z);

    let target = null;
    if (ai.targetId) {
      target = this.npcs.get(ai.targetId);
      if (target) {
        const valid = target._solo && target.kind !== 'dog' && target.chicken.koT <= 0
          && (target.kind === 'goose' || (target.info && target.info.hot))
          && dist2(e, target) <= DOG_SENSE * 1.8;
        if (!valid) { ai.targetId = null; target = null; }
        else if (homeD > DOG_LEASH) {
          ai.ban.set(target.id, now + DOG_BAN * 1000);
          ai.targetId = null; ai.cool = now + DOG_GIVEUP * 1000; target = null;
        }
      } else ai.targetId = null;
    }

    if (!target && homeD <= DOG_LEASH * 0.8 && now >= (ai.cool || 0)) {
      let best = null, bd = DOG_SENSE;
      for (const o of this.npcs.values()) {
        if (o === e || !o._solo || o.kind === 'dog' || o.chicken.koT > 0) continue;
        if (o.kind !== 'goose' && !(o.info && o.info.hot)) continue;
        if ((ai.ban.get(o.id) || 0) > now) continue;
        const d = dist2(e, o);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) { ai.targetId = best.id; ai.inRange = false; target = best; }
    }

    if (target) {
      const d = dist2(e, target);
      if (d > DOG_RANGE_OUT) ai.inRange = false;
      else if (d <= DOG_BITE_R) ai.inRange = true;
      if (!ai.inRange) {
        this.moveTo(e, target.pos.x, target.pos.z, DOG_RUN, dt);
        e.chicken.update(dt, ST_RUN);
      } else {
        this.faceTo(e, target.pos.x, target.pos.z);
        e.chicken.update(dt, 0);
        if (ai.bitCd <= 0) {
          ai.bitCd = DOG.cd;
          e.chicken.bite();
          this.sfx.hit(1);
          this.damage(target, DOG.dmg, null);
          if (target._ai) {
            target._ai.fleeT = DOG_SCARE_T;
            target._ai.scareFrom = { x: e.pos.x, z: e.pos.z };
            if (target.kind === 'goose') target._ai.aggro = false;
          }
        }
      }
      return;
    }

    // 没目标：回鸡舍门口溜达
    if (homeD > 3.5) {
      ai.target.x = DOG_HOME.x; ai.target.z = DOG_HOME.z;
    } else if (Math.hypot(e.pos.x - ai.target.x, e.pos.z - ai.target.z) < 0.4 || Math.random() < dt * 0.2) {
      const a = rand(0, Math.PI * 2), r = rand(1.2, 3.2);
      ai.target.x = DOG_HOME.x + Math.cos(a) * r;
      ai.target.z = DOG_HOME.z + Math.sin(a) * r;
    }
    this.moveTo(e, ai.target.x, ai.target.z, DOG_WALK, dt);
    e.chicken.update(dt, 0);
  }

  pushAway(from, to, dist) {
    const ang = Math.atan2(to.pos.x - from.pos.x, to.pos.z - from.pos.z);
    const [nx, nz] = resolveCollision(to.pos.x + Math.sin(ang) * dist, to.pos.z + Math.cos(ang) * dist,
      to.radius || 0.4, this.world.obstacles, this.world.boxObstacles);
    to.pos.x = nx; to.pos.z = nz;
    to.pos.y = groundHeight(nx, nz);
    to.group.position.set(nx, to.pos.y, nz);
  }

  separate() {
    const arr = [...this.npcs.values()].filter((e) => e._solo && e.kind !== 'dog' && e.chicken.koT <= 0);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const min = (a.radius || 0.4) + (b.radius || 0.4);
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * 0.5;
        dx /= d; dz /= d;
        const [ax, az] = resolveCollision(a.pos.x - dx * push, a.pos.z - dz * push, a.radius || 0.4, this.world.obstacles, this.world.boxObstacles);
        const [bx, bz] = resolveCollision(b.pos.x + dx * push, b.pos.z + dz * push, b.radius || 0.4, this.world.obstacles, this.world.boxObstacles);
        a.pos.x = ax; a.pos.z = az;
        b.pos.x = bx; b.pos.z = bz;
        a.pos.y = groundHeight(a.pos.x, a.pos.z);
        b.pos.y = groundHeight(b.pos.x, b.pos.z);
        a.group.position.copy(a.pos);
        b.group.position.copy(b.pos);
      }
    }
  }

  // ---------- 移动 ----------
  moveTo(e, tx, tz, speed, dt) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const step = Math.min(speed * dt, d);
    const nx = e.pos.x + (dx / d) * step;
    const nz = e.pos.z + (dz / d) * step;
    const [cx, cz] = resolveCollision(nx, nz, e.radius || 0.4, this.world.obstacles, this.world.boxObstacles);
    e.pos.x = clamp(cx, -BOUNDS * 1.25, BOUNDS * 1.25);
    e.pos.z = clamp(cz, -BOUNDS * 1.25, BOUNDS * 1.25);
    e.pos.y = groundHeight(e.pos.x, e.pos.z);
    e.group.position.set(e.pos.x, e.pos.y, e.pos.z);
    e.yaw = Math.atan2(dx, dz);
    e.group.rotation.y = e.yaw;
  }

  faceTo(e, x, z) {
    e.yaw = Math.atan2(x - e.pos.x, z - e.pos.z);
    e.group.rotation.y = e.yaw;
  }

  awayPoint(e, from, r) {
    const ang = Math.atan2(e.pos.x - from.pos.x, e.pos.z - from.pos.z) || rand(0, Math.PI * 2);
    return { x: e.pos.x + Math.sin(ang) * r, z: e.pos.z + Math.cos(ang) * r };
  }

  wander(e, dt, speed) {
    const ai = e._ai;
    if (ai.mode === 'idle') {
      ai.t -= dt;
      ai.animT -= dt;
      if (ai.animT <= 0) {
        ai.animT = rand(0.6, 1.6);
        ai.anim = Math.random() < 0.55 ? 0 : [ST_PECK, ST_FLAP, ST_PREEN][Math.floor(Math.random() * 3)];
      }
      e.chicken.update(dt, false, false, false, ai.anim);
      if (ai.t <= 0) {
        ai.mode = 'walk';
        ai.t = rand(3, 7);
        const a = rand(0, Math.PI * 2), r = rand(2.5, 5);
        ai.target.x = e.pos.x + Math.cos(a) * r;
        ai.target.z = e.pos.z + Math.sin(a) * r;
        // 别把目标点挑到围栏外
        ai.target.x = clamp(ai.target.x, -BOUNDS * 1.1, BOUNDS * 1.1);
        ai.target.z = clamp(ai.target.z, -BOUNDS * 1.1, BOUNDS * 1.1);
      }
      return;
    }
    ai.t -= dt;
    if (ai.t <= 0 || Math.hypot(e.pos.x - ai.target.x, e.pos.z - ai.target.z) < 0.4) {
      ai.mode = 'idle';
      ai.t = rand(1.2, 3.5);
      ai.anim = 0;
      ai.animT = rand(0.3, 0.9);
      e.chicken.update(dt, false, false, false, 0);
      return;
    }
    this.moveTo(e, ai.target.x, ai.target.z, speed, dt);
    e.chicken.update(dt, true, false, false, 0);
  }

  // ---------- 玩家出手 ----------
  peck(player) {
    if (!player || player.koT > 0) return;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    for (const e of this.npcs.values()) {
      if (!e._solo || e.kind === 'dog') continue;
      if (e.chicken.koT > 0) continue;
      const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.7) continue;
      if ((dx / (d || 1)) * fx + (dz / (d || 1)) * fz < 0.35) continue;
      this.damage(e, PLAYER_PECK_DMG, player);
    }
  }

  wing(player) {
    if (!player || player.koT > 0) return;
    for (const e of this.npcs.values()) {
      if (!e._solo || e.kind === 'dog') continue;
      if (e.chicken.koT > 0) continue;
      const d = dist2(e, player);
      if (d > 1.35) continue;
      this.damage(e, PLAYER_WING_DMG, player);
      // 扇翅的击退：把人/鸡往外推 1.2m（与服务端同手感）
      const ang = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      const [nx, nz] = resolveCollision(e.pos.x + Math.sin(ang) * 1.5, e.pos.z + Math.cos(ang) * 1.5, e.radius || 0.4, this.world.obstacles, this.world.boxObstacles);
      e.pos.x = nx; e.pos.z = nz;
      e.pos.y = groundHeight(nx, nz);
      e.group.position.set(nx, e.pos.y, nz);
    }
  }

  damage(e, dmg, player) {
    const ai = e._ai;
    if (!ai || ai.koLeft > 0 || e.chicken.koT > 0) return;
    ai.lastHit = performance.now();
    e.hp = Math.max(0, (e.hp ?? ai.maxHp) - dmg);
    e.chicken.flash();
    e.chicken.flap();
    if (e.hp <= 0) { this.ko(e, player); return; }
    e.chicken.setHp(Math.round(e.hp));
    if (player) ai.scareFrom = null;   // 玩家打的不再沿用上一次狗咬的逃跑方向
    // 挨打之后的反应（对齐 server/farm_server.py）：
    // 暴躁鸡永远回击；大白鹅被玩家打会转为追击；普通鸡 45% 逃窜、其余回击。
    if (e.kind === 'goose') {
      ai.fightT = 0;
      ai.aggro = true;
    } else if (e.info && e.info.hot) {
      ai.fightT = 6;
      ai.fleeT = 0;
    } else if (Math.random() < 0.45) {
      ai.fleeT = 4.5;
      ai.fightT = 0;
    } else {
      ai.fightT = 6;
      ai.fleeT = 0;
    }
    if (ai.mode === 'idle') ai.t = 0;
  }

  ko(e, player) {
    const ai = e._ai;
    const title = (e.info && e.info.title) || e.id;
    e.chicken.ko();
    ai.koLeft = e.kind === 'goose' ? GOOSE_RESPAWN_MS : RESPAWN_MS;
    this.sfx.hit(0);
    if (player) {
      player.score = (player.score || 0) + 1;
      this.pushBoard();
      this.hud.banner(`🎯 啄倒了 ${title}！`, 1400);
      this.hud.feed(`🐔💥 你啄倒了 ${title}`);
    } else {
      this.hud.feed(`🐔💥 ${title} 被啄倒了`);
    }
    this.events.push({ t: Date.now(), name: title, kind: e.kind });
    if (this.events.length > 30) this.events.shift();
  }

  reviveNpc(e) {
    const ai = e._ai;
    e.hp = ai.maxHp;
    e.chicken.revive();
    e.chicken.setHp(ai.maxHp);
    const p = this.freePoint(17);
    e.pos.set(p.x, groundHeight(p.x, p.z), p.z);
    e.group.position.copy(e.pos);
    ai.mode = 'idle';
    ai.t = rand(0.5, 2);
    ai.anim = 0;
    ai.fleeT = 0;
    ai.fightT = 0;
  }

  reviveGoose(e) {
    const ai = e._ai;
    e.hp = GOOSE_HP;
    e.chicken.revive();
    e.chicken.setHp(GOOSE_HP);
    const ang = rand(0, Math.PI * 2), rad = rand(6, 20);
    const [gx, gz] = resolveCollision(Math.cos(ang) * rad, Math.sin(ang) * rad, GOOSE_R, this.world.obstacles, this.world.boxObstacles);
    e.pos.set(gx, groundHeight(gx, gz), gz);
    e.group.position.copy(e.pos);
  }

  regenNpc(e, dt) {
    const ai = e._ai;
    if (!ai || e.hp == null || e.hp >= ai.maxHp) return;
    if (performance.now() - ai.lastHit < 6000) return;
    e.hp = Math.min(ai.maxHp, e.hp + 4 * dt);
    e.chicken.setHp(Math.round(e.hp));
  }

  // ---------- 玩家受伤 / 回血 ----------
  hurtPlayer(dmg, from, knock = 0) {
    const p = this.player;
    if (!p || p.koT > 0) return;
    p.hp = Math.max(0, p.hp - dmg);
    this.lastHurt = performance.now();
    try { this.playerChicken.flash(); } catch { /* 动画失败不影响结算 */ }
    this.playerChicken.setHp(p.hp);
    this.hud.setSelfState(p.hp, p.koT, p.score || 0);
    this.sfx.hit(0.3);

    // 被顶开（只有扇翅/大白鹅啄才击退；普通啄不推人）
    if (from && knock > 0) {
      const ang = Math.atan2(p.pos.x - from.pos.x, p.pos.z - from.pos.z);
      const [nx, nz] = resolveCollision(p.pos.x + Math.sin(ang) * knock, p.pos.z + Math.cos(ang) * knock, 0.45, this.world.obstacles, this.world.boxObstacles);
      p.pos.x = nx; p.pos.z = nz;
      p.pos.y = groundHeight(nx, nz);
    }
    if (p.hp <= 0) {
      p.koT = 3.5;
      p.hp = 0;
      this.playerChicken.ko();
      this.hud.banner('😵 你被啄晕了！', 2000);
    }
  }

  regenPlayer(dt) {
    const p = this.player;
    if (!p || p.koT > 0) return;
    if (p.hp < 100 && performance.now() - this.lastHurt > 5000) {
      p.hp = Math.min(100, p.hp + 5 * dt);
      p.koT = 0;
      this.playerChicken.setHp(p.hp);
    }
    // HUD 不用每帧写；4Hz 足够让血条看起来是连续的
    this._hudT += dt;
    if (this._hudT > 0.25) {
      this._hudT = 0;
      this.hud.setSelfState(p.hp, p.koT, p.score || 0);
    }
  }

  pushBoard() {
    this.hud.updateBoard([{
      id: 'me',
      name: `${this.name}（玩家）`,
      score: this.player?.score || 0,
      me: true,
    }], true);
  }
}
