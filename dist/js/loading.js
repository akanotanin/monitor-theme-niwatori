/* ------------------------------------------------------------------ *
 * 载入动画 · 像素农场「搭鸡舍」
 *
 * 一颗胶囊视窗里的小农场：小鸡一趟趟把稻草和木板搬过去，鸡舍按真实加载
 * 进度一层层搭起来（放线 → 石基 → 三面红墙 → 门楣立柱 → 双坡顶 → 侧窗
 * → 内部栖架与产蛋箱 → 门口坡道 → 蛋 → 点灯），草垛、栅栏、野花跟着长出来；
 * 进度满时灯亮、撒羽毛与麦穗，其他小鸡从两边跑来，幕布才揭。
 *
 * 约束：
 *   · 只依赖 canvas 2D，不 import 任何模块 —— 它必须比 three 的模块图先跑；
 *   · 进度来自真实等待（boot 两个接口 → 44 个 GLB 模型逐个到位 → 首帧），不编时间轴；
 *   · 美术画在 216×128 的整数网格上，按 DPR 取整数倍放大，永远是硬边像素。
 * ------------------------------------------------------------------ */

const ART_W = 216;
const ART_H = 128;

/* 胶囊几何：深墨线 1px → 奶油边 3px → 内墨线 1px */
const PILL = { x0: 9, y0: 9, x1: 206, y1: 118, r: 54 };
const FRAME = { ink: 1, cream: 3, lip: 1 };
const IN = {
  x0: PILL.x0 + FRAME.ink + FRAME.cream + FRAME.lip,
  y0: PILL.y0 + FRAME.ink + FRAME.cream + FRAME.lip,
  x1: PILL.x1 - FRAME.ink - FRAME.cream - FRAME.lip,
  y1: PILL.y1 - FRAME.ink - FRAME.cream - FRAME.lip,
};

/* 地面分层（y 越小越远） */
const G_TREE = 74;   // 远景树线
const G_BACK = 81;   // 后草地：鸡舍 / 草垛 / 栅栏的落脚线
const G_PATH = 89;   // 土路上沿
const G_FRONT = 98;  // 前景草地上沿
const FEET = 97;     // 小鸡脚底

/* 鸡舍：双坡顶（三角形山墙），前脸敞开能看见内部 —— 这是 niwatori 鸡舍的造型 */
const H = {
  x0: 118, x1: 176, base: G_BACK,
  apexX: 147,
  ridgeY: 44,        // 屋脊高度
  top: 58,           // 檐口高度
  ridgeHalf: 5,      // 屋脊半宽（顶瓦带）
  eaveHalf: 32,      // 檐口半宽（含 3px 出檐）
};
/* 前脸敞开：门洞（能看见里面） */
const OPEN = { x: 127, y: 62, w: 20, h: 19 };
/* 门窗都坐在石基上沿（base - 4 = 77）之上 */
const WIN = { x: 156, y: 63, w: 12, h: 12 };
/* 门口坡道 */
const RAMP = { y: 77, w: 22 };

/* 小鸡搬稻草的两头 */
const CX0 = 32;
const CX1 = 108;

const C = {
  ink: '#5a4632',
  hair: 'rgba(90, 70, 50, 0.32)',
  cream: '#fff8e7',        // --cream
  creamLo: '#efe0c4',
  lip: '#dfcba6',
  sky: ['#a8d8f0', '#b9dff0', '#cbe6df', '#dcebc8'],   // 与 #boot 的渐变同源
  cloud: '#ffffff',
  cloudLo: '#dceaf2',
  hillBack: '#a9c790', hillBackRim: '#bed6a8',
  hillFront: '#8fb975', hillFrontRim: '#a8ca90',
  treeLine: '#6f9a5f',
  grassBack: '#7ec850', grassBackLo: '#6cb143', grassBackRim: '#96d768',  // --grass
  grassFront: '#71bd46', grassFrontLo: '#61a83c', grassFrontRim: '#8acd5c',
  path: '#c9a878', pathLo: '#b08a5c', pathHi: '#dcbe92',
  stone: '#b5aa9a', stoneLo: '#918876', stoneHi: '#cdc2b0',
  // 鸡舍配色直接取 world.js 的 MAT：coopWall 0xb5553d / coopRoof 0x6b4a3a / coopTrim 0xf0e6d0
  wall: '#b5553d', wallLo: '#96432f', wallHi: '#c96a50',
  roof: '#6b4a3a', roofLo: '#553a2d', roofHi: '#8a6350',
  roofLeft: '#7a5544', roofLeftLo: '#64443a', roofRight: '#5d4136', roofRightLo: '#4a3329',
  trim: '#f0e6d0', trimLo: '#d3c4a6', trimHi: '#fbf5e6',
  wood: '#8a5a2b', woodLo: '#6b4420', woodMid: '#7d5028', woodHi: '#a97640',  // --wood
  hay: '#b08f3c', hayHi: '#d4b45c', hayLo: '#8f7228',
  wheat: '#d9bf6a', wheatHi: '#efd98f',
  lamp: '#ffd27a', lampHi: '#ffe9b8', glow: '#ffdf9c',
  glass: '#2f4a5a', glassLo: '#253c4a',
  egg: '#fffaf0', eggLo: '#e2d7c2',
  leaf: ['#3f6b3a', '#4f7d45', '#649156', '#7fa868'],
  flower: ['#ffd95e', '#f2846f', '#e8e0f0', '#ffb347', '#d97ab0'],
  comb: '#c93434', beak: '#d98a2b', leg: '#d9a441',  // chicken.js 的 RED / ORANGE
  feather: '#f7f2e6', featherLo: '#dbd0bb', eye: '#1a1a1a',
  sun: '#ffe9a0', sunHi: '#fff6cf',
  smoke: '#efe6d6',
};

/* 进度条配色：比场景木色深一档，小尺寸下也读得出 */
const UI = {
  track: '#fff8e7', trackLo: '#e8d8b8',
  fill: '#d98a2b', fillHi: '#f0a851', fillLo: '#b56f1e',   // --accent 系
  digit: '#5a4632',
};

/* 真实进度之上，等待期间最多自动蹭到这么多 —— 绝不越过它去假装完成 */
const CREEP_CAP = 0.88;

/* 5×7 像素数字 */
const GLYPH = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
};

/* 施工阶段：bar 与场景共用同一个 p；鸡舍到 94% 才封顶，别提前完工。
   ★ 节奏原则（实测出来的）：每一档跨度（约 6~10%）都要有明显面积变化（≥200px @216×128），
   否则后半段会读成「卡住了」。大动作（屋顶、点灯、亮面）尽量往后压，越接近 100% 越热闹。 */
const AT = {
  stake: 0.06,
  foundation: 0.12,
  wall: [0.17, 0.24, 0.31],   // 墙的三次「上料」：框架→填板→压顶（见 drawWalls，第一段就是整面墙高）
  lintel: 0.36,               // 门楣 + 两根立柱
  door: 0.42,                 // 门洞（露出屋里的深色）
  roof: [0.50, 0.63, 0.78],   // 屋面三段铺：50/63/78 —— 每次都铺掉一大片，是全程最大的一次变化
  ramp: 0.55,                 // 门口坡道（在草地上，看得见）
  perch: 0.68,                // 门洞里栖架
  nest: 0.72,                 // 产蛋箱
  window: 0.84,               // 窗在屋顶封顶后才开（封顶 → 开窗，读起来是「收尾」）
  eggs: 0.86,                 // 门口的蛋
  ribbon: 0.88,               // 屋檐挂上彩旗（一面面挂过去，横跨整个檐口 —— 大面积）
  glow: 0.90,                 // 窗与门洞里点灯
  golden: 0.92,               // 整片草地/阳光暖起来（收尾的最后一波大面积变化）
  fence: 0.44,
  bush: 0.56,
  hay: [0.32, 0.50, 0.68],
  well: [0.38, 0.52, 0.65],
  treeA: [0.09, 0.21, 0.34],
  treeB: [0.30, 0.47, 0.64],
  flower: 0.52,
};

/* ---------------------------- 小工具 ---------------------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** 两个 #rrggbb 之间插值（草地随进度变亮用它，避免写一堆中间色） */
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const f = (sh) => {
    const ca = (pa >> sh) & 255;
    const cb = (pb >> sh) & 255;
    return Math.round(ca + (cb - ca) * clamp(t, 0, 1));
  };
  return `rgb(${f(16)}, ${f(8)}, ${f(0)})`;
}

/** 确定性伪随机：撒花 / 云 / 草丛都用它，帧间不抖 */
function noise(i, seed = 0) {
  const x = Math.sin(i * 127.1 + seed * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/** stadium 的逐行跨度：两端半圆，中间直边 */
function rowsOf(x0, y0, x1, y1, r) {
  const out = [];
  const h = y1 - y0 + 1;
  const cy = y0 + h / 2;
  for (let i = 0; i < h; i++) {
    const d = Math.abs(y0 + i + 0.5 - cy);
    const cap = d >= r ? 0 : Math.sqrt(r * r - d * d);
    const inset = Math.round(r - cap);
    out.push({ y: y0 + i, x0: x0 + inset, x1: x1 - inset });
  }
  return out;
}

function pathOf(rows) {
  const p = new Path2D();
  for (const r of rows) p.rect(r.x0, r.y, r.x1 - r.x0 + 1, 1);
  return p;
}

/* ---------------------------- 装载 ---------------------------- */

export function mount() {
  const curtain = document.getElementById('boot');
  const canvas = document.getElementById('ld-canvas');
  if (!curtain || !canvas || !canvas.getContext) return null;
  if (window.__NIWATORI_LOAD__ && window.__NIWATORI_LOAD__.mounted) return window.__NIWATORI_LOAD__;

  const ctx = canvas.getContext('2d');
  const scene = document.createElement('canvas');
  scene.width = ART_W;
  scene.height = ART_H;
  const s = scene.getContext('2d');
  s.imageSmoothingEnabled = false;

  const still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---- 三层胶囊（外墨线 / 奶油边 / 内墨线），场景按最内层裁剪 ---- */
  const rOuter = rowsOf(PILL.x0, PILL.y0, PILL.x1, PILL.y1, PILL.r);
  const rCream = rowsOf(PILL.x0 + FRAME.ink, PILL.y0 + FRAME.ink, PILL.x1 - FRAME.ink, PILL.y1 - FRAME.ink, PILL.r - FRAME.ink);
  const rLip = rowsOf(PILL.x0 + FRAME.ink + FRAME.cream, PILL.y0 + FRAME.ink + FRAME.cream,
    PILL.x1 - FRAME.ink - FRAME.cream, PILL.y1 - FRAME.ink - FRAME.cream, PILL.r - FRAME.ink - FRAME.cream);
  const rInner = rowsOf(IN.x0, IN.y0, IN.x1, IN.y1, PILL.r - FRAME.ink - FRAME.cream - FRAME.lip);
  const pOuter = pathOf(rOuter);
  const pCream = pathOf(rCream);
  const pLip = pathOf(rLip);
  const pScene = pathOf(rInner);
  const SKY = [
    { y0: IN.y0, y1: 36, c: C.sky[0] },
    { y0: 36, y1: 52, c: C.sky[1] },
    { y0: 52, y1: 63, c: C.sky[2] },
    { y0: 63, y1: G_BACK, c: C.sky[3] },
  ];

  /** 某一行的可用横向跨度（胶囊是圆头，靠边那几行要往里收） */
  function innerBand(y, pad = 0) {
    const r = rInner[clamp(Math.round(y) - IN.y0, 0, rInner.length - 1)];
    return [r.x0 + pad, r.x1 - pad];
  }
  const CLOUDS = [
    { x: 34, y: 31, w: 27, s: 0.55 },
    { x: 84, y: 26, w: 19, s: 0.38 },
    { x: 166, y: 33, w: 16, s: 0.30 },
  ];
  const FLOWERS = [];
  for (let i = 0; i < 14; i++) {
    FLOWERS.push({
      x: 20 + Math.round(noise(i, 3) * 176),
      y: 101 + Math.round(noise(i, 7) * 7),
      c: C.flower[i % C.flower.length],
      at: AT.flower + (i / 14) * 0.42,
    });
  }
  const TUFTS = [];
  for (let i = 0; i < 30; i++) {
    const y = 100 + Math.round(noise(i, 13) * 9);
    const band = innerBand(y, 3);
    TUFTS.push({
      x: band[0] + Math.round(noise(i, 11) * Math.max(1, band[1] - band[0])),
      y,
    });
  }
  const TREE_LINE = [];
  for (let x = IN.x0 + 4; x < IN.x1 - 4; x += 7) {
    TREE_LINE.push({ x, h: 4 + Math.round(noise(x, 5) * 4) });
  }
  /* 收尾时从两边跑来的邻居小鸡 */
  const NEIGHBORS = [
    { from: 22, to: 104, at: 0.10, dir: 1 },
    { from: 196, to: 168, at: 0.24, dir: -1 },
    { from: 14, to: 62, at: 0.46, dir: 1 },
  ];

  /* ---- 运行状态 ---- */
  let target = 0.05;
  let shown = 0.02;
  let lastSetAt = 0;      // 上一次收到真实进度的时间（creep 的闸门）
  let phase = 'load';     // load | celebrate | gone
  let phaseT = 0;
  let endCb = null;
  let hopAt = 0;          // 点小鸡：跳跃起点
  let tapAt = 0;          // 点小鸡：气泡起点
  let counted = { ok: 0, total: 0 };   // 模型计数（显示在 tip 旁，也用于细化进度）

  /* ---- 尺寸：整数倍放大，保证像素硬边 ---- */
  let scale = 1;
  function fit() {
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 640;
    const aspect = ART_H / ART_W;
    const maxH = clamp(vh * 0.46, 96, 420);
    const wantW = Math.min(clamp(vw * 0.86, 200, 420), maxH / aspect);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    // 取最接近目标宽度的整数倍率；别永远退到 1×（1080p 桌面会小得可怜）
    scale = Math.max(1, Math.round((wantW * dpr) / ART_W));
    while (scale > 1 && (ART_W * scale) / dpr > vw * 0.94) scale -= 1;
    const w = ART_W * scale;
    const h = ART_H * scale;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = `${Math.round(w / dpr)}px`;
    canvas.style.height = `${Math.round(h / dpr)}px`;
    ctx.imageSmoothingEnabled = false;
  }

  /* ---- 笔触 ---- */
  const px = (x, y, w, h, c) => {
    s.fillStyle = c;
    s.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };

  function blob(cx, cy, rx, ry, c) {
    s.fillStyle = c;
    const y0 = Math.round(cy - ry);
    const y1 = Math.round(cy + ry);
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / (ry + 0.4);
      if (Math.abs(dy) > 1) continue;
      const half = Math.max(0, Math.round(rx * Math.sqrt(1 - dy * dy)));
      s.fillRect(Math.round(cx - half), y, Math.max(1, half * 2), 1);
    }
  }

  /* ---------- 天空 / 远景 ---------- */
  function drawSky() {
    for (const b of SKY) px(IN.x0, b.y0, IN.x1 - IN.x0 + 1, b.y1 - b.y0, b.c);
    // 分层交界做两行棋盘抖动，避免生硬横线
    for (let k = 0; k < SKY.length - 1; k++) {
      const y = SKY[k].y1;
      const a = SKY[k].c;
      const b = SKY[k + 1].c;
      for (let x = IN.x0; x <= IN.x1; x++) {
        const on = (x + y) % 2 === 0;
        px(x, y - 1, 1, 1, on ? b : a);
        px(x, y, 1, 1, on ? a : b);
      }
    }
  }

  function drawSun(p) {
    const cx = 33;
    const cy = 48;
    const halo = 12 + Math.round(p * 5);
    s.globalAlpha = 0.10 + p * 0.14;
    blob(cx, cy, halo, halo, C.sun);
    s.globalAlpha = 0.18 + p * 0.20;
    blob(cx, cy, halo - 3, halo - 3, C.sun);
    s.globalAlpha = 1;
    blob(cx, cy, 7, 7, C.sun);
    blob(cx - 1, cy - 2, 4, 4, C.sunHi);
  }

  function drawCloud(x, y, w) {
    px(x + 2, y + 4, w - 3, 3, C.cloud);
    px(x + 5, y + 1, w - 11, 4, C.cloud);
    px(x + 9, y - 1, w - 16, 3, C.cloud);
    px(x, y + 6, w, 1, C.cloud);
    px(x + 3, y + 7, w - 6, 1, C.cloudLo);
  }

  function drawClouds(t) {
    if (still) {
      drawCloud(CLOUDS[0].x, CLOUDS[0].y, CLOUDS[0].w);
      drawCloud(CLOUDS[2].x, CLOUDS[2].y, CLOUDS[2].w);
      return;
    }
    for (const cl of CLOUDS) {
      const span = 160;
      const x = 18 + (((cl.x - 18 + t * cl.s) % span) + span) % span;
      drawCloud(Math.round(x), cl.y, cl.w);
    }
  }

  function drawHills() {
    for (let x = IN.x0; x <= IN.x1; x++) {
      const b = Math.round(62 - 4 * Math.sin(x * 0.058) - 2 * Math.sin(x * 0.023 + 2.1));
      px(x, b, 1, G_BACK - b, C.hillBack);
      px(x, b, 1, 1, C.hillBackRim);
      const f = Math.round(70 - 3 * Math.sin(x * 0.043 + 1.4) - 2 * Math.sin(x * 0.019 + 0.5));
      px(x, f, 1, G_BACK - f, C.hillFront);
      px(x, f, 1, 1, C.hillFrontRim);
    }
  }

  /** 远景树线：常驻，保证第一帧也不空 */
  function drawTreeLine() {
    for (const t of TREE_LINE) {
      const top = G_TREE - t.h;
      px(t.x, top + 2, 5, t.h - 2, C.treeLine);
      px(t.x + 1, top, 3, 3, C.treeLine);
      px(t.x + 1, top + 1, 1, 1, C.grassBackRim);
    }
  }

  function drawGround(p) {
    // 草地随进度整体变亮一档（0.30 起）：满进度时是「晒饱了太阳」的农场。
    // 大面积连续变化，让后半段每一档都有可感知的推进，而不是只等一个小道具冒头。
    const sun = clamp((p - 0.30) / 0.62, 0, 1);
    const lit = (base, hi) => mixHex(base, hi, sun * 0.55);

    px(IN.x0, G_BACK, IN.x1 - IN.x0 + 1, G_PATH - G_BACK, lit(C.grassBack, C.grassBackRim));
    px(IN.x0, G_BACK, IN.x1 - IN.x0 + 1, 1, lit(C.grassBackRim, '#a8e07a'));
    px(IN.x0, G_PATH - 1, IN.x1 - IN.x0 + 1, 1, C.grassBackLo);

    px(IN.x0, G_PATH, IN.x1 - IN.x0 + 1, G_FRONT - G_PATH, C.path);
    px(IN.x0, G_PATH, IN.x1 - IN.x0 + 1, 1, C.pathLo);
    px(IN.x0, G_FRONT - 2, IN.x1 - IN.x0 + 1, 1, C.pathHi);
    for (let i = 0; i < 24; i++) {
      const x = IN.x0 + 2 + Math.round(noise(i, 21) * (IN.x1 - IN.x0 - 4));
      const y = G_PATH + 2 + Math.round(noise(i, 23) * 5);
      px(x, y, 2, 1, C.pathLo);
    }

    px(IN.x0, G_FRONT, IN.x1 - IN.x0 + 1, IN.y1 - G_FRONT + 1, lit(C.grassFront, C.grassFrontRim));
    px(IN.x0, G_FRONT, IN.x1 - IN.x0 + 1, 1, lit(C.grassFrontRim, '#a9e57c'));
    for (const tf of TUFTS) {
      px(tf.x, tf.y, 1, 2, C.grassFrontLo);
      px(tf.x + 1, tf.y + 1, 1, 1, C.grassFrontLo);
    }
  }

  function drawFlowers(p) {
    for (const f of FLOWERS) {
      if (p < f.at) continue;
      px(f.x, f.y + 2, 1, 2, C.grassFrontLo);
      px(f.x - 1, f.y + 1, 3, 1, f.c);
      px(f.x, f.y, 1, 1, f.c);
    }
  }

  /* ---------- 鸡舍 ---------- */
  /** 放线：三个木桩 + 一根拉线，最先出现 */
  function drawStakes() {
    for (const x of [H.x0, H.apexX, H.x1]) {
      px(x, H.base - 4, 1, 4, C.wood);
      px(x, H.base - 4, 1, 1, C.woodHi);
    }
    px(H.x0, H.base - 3, H.x1 - H.x0, 1, 'rgba(138,90,43,0.5)');
  }

  function drawFoundation() {
    px(H.x0 - 3, H.base - 4, H.x1 - H.x0 + 7, 5, C.stone);
    px(H.x0 - 3, H.base - 4, H.x1 - H.x0 + 7, 1, C.stoneHi);
    px(H.x0 - 3, H.base, H.x1 - H.x0 + 7, 1, C.stoneLo);
    for (let x = H.x0 - 1; x < H.x1 + 2; x += 6) px(x, H.base - 3, 1, 3, C.stoneLo);
  }

  /** 三面红墙 + 木板分缝（world.js 的 coopWall / plankDark 就是这个语汇）
   *  第一段就把整面墙（檐口到石基）立满 —— 墙体必须一步到位，
   *  否则半截红墙会被读成"平屋顶压在地基上"。后两段是「上料」：先立框架、再填板、最后压顶。 */
  function drawWalls(p) {
    if (p < AT.wall[0]) return;
    const yTop = H.top;
    const yBot = H.base - 4;
    const hgt = yBot - yTop;

    // ① 框架：两根角柱 + 上下横梁（第一段就有，视觉上是"木构架立起来了"）
    px(H.x0, yTop, H.x1 - H.x0 + 1, hgt, C.wallLo);
    px(H.x0, yTop, 3, hgt, C.wood);
    px(H.x0 + 2, yTop, 1, hgt, C.woodLo);
    px(H.x1 - 2, yTop, 3, hgt, C.wood);
    px(H.x1 - 2, yTop, 1, hgt, C.woodLo);
    px(H.x0, yTop, H.x1 - H.x0 + 1, 2, C.wood);
    px(H.x0, yTop + 1, H.x1 - H.x0 + 1, 1, C.woodLo);

    if (p < AT.wall[1]) return;

    // ② 填板：红墙板条一块块填上去（从下往上，留出顶部一截还没填）
    const filled = p < AT.wall[2] ? Math.round(hgt * 0.62) : hgt;
    const fy = yBot - filled;
    px(H.x0 + 3, fy, H.x1 - H.x0 - 5, filled - 2, C.wall);
    px(H.x0 + 3, fy, H.x1 - H.x0 - 5, 1, C.wallHi);
    px(H.x0 + 3, yBot - 3, H.x1 - H.x0 - 5, 1, C.wallLo);
    // 木板分缝：每 4px 一道，横着排（读成一条条木板，不是一块红砖）
    for (let y = fy + 3; y < yBot - 3; y += 4) {
      px(H.x0 + 3, y, H.x1 - H.x0 - 5, 1, C.wallLo);
    }
    // 墙脚一圈奶油色 trim（world.js 的 coopTrim）
    px(H.x0, yBot - 2, H.x1 - H.x0 + 1, 2, C.trim);
    px(H.x0, yBot - 2, H.x1 - H.x0 + 1, 1, C.trimHi);

    if (p < AT.wall[2]) return;

    // ③ 压顶：檐下一道奶油色横梁（把墙收口）
    px(H.x0, yTop, H.x1 - H.x0 + 1, 2, C.trim);
    px(H.x0, yTop, H.x1 - H.x0 + 1, 1, C.trimHi);
  }

  /** 门楣 + 两根立柱：前脸敞开，中间留出门洞 */
  function drawLintel(p) {
    if (p < AT.lintel) return;
    // 门楣（横向一条奶油色梁，压住门洞上沿）
    px(H.x0, 58, H.x1 - H.x0 + 1, 3, C.trim);
    px(H.x0, 58, H.x1 - H.x0 + 1, 1, C.trimHi);
    px(H.x0, 60, H.x1 - H.x0 + 1, 1, C.trimLo);
    // 两根立柱（门洞两侧）
    px(OPEN.x - 3, 61, 3, H.base - 4 - 61, C.trim);
    px(OPEN.x - 3, 61, 1, H.base - 4 - 61, C.trimHi);
    px(OPEN.x + OPEN.w, 61, 3, H.base - 4 - 61, C.trim);
    px(OPEN.x + OPEN.w + 2, 61, 1, H.base - 4 - 61, C.trimLo);
  }

  /** 门洞：里面是暗的（前脸敞开），能看见栖架与产蛋箱的影子 */
  function drawDoor(p) {
    if (p < AT.door) return;
    const { x, y, w, h } = OPEN;
    // 门洞内部：先铺一层深色，读成「屋里」
    px(x, y, w, h, '#3a2a20');
    px(x, y, w, 2, '#2a1d16');
    // 内壁受光（左侧一点暖色）
    px(x, y + 2, 2, h - 2, '#4a3628');
    // 门口挂的小木牌（coop 的门楣下那块）
    px(x + 6, y - 7, 8, 4, C.wood);
    px(x + 6, y - 7, 8, 1, C.woodHi);
    px(x + 9, y - 8, 1, 1, C.woodLo);
    px(x + 12, y - 8, 1, 1, C.woodLo);
  }

  /** 栖架（两根横杆）+ 产蛋箱：都在门洞里，进度到才长出来 */
  function drawPerch(p) {
    if (p < AT.perch) return;
    const { x, y, w, h } = OPEN;
    // 两根栖架横杆
    for (const [dy, inset] of [[Math.round(h * 0.34), 2], [Math.round(h * 0.56), 4]]) {
      px(x + inset, y + dy, w - inset * 2, 1, C.woodHi);
      px(x + inset, y + dy + 1, w - inset * 2, 1, C.woodLo);
    }
    if (p < AT.nest) return;
    // 产蛋箱：右侧一格，格口朝外
    const nx = x + w - 7;
    const ny = y + Math.round(h * 0.62);
    px(nx, ny, 6, 6, C.wood);
    px(nx, ny, 6, 1, C.woodHi);
    px(nx + 1, ny + 2, 4, 3, '#2a1d16');
    px(nx + 2, ny + 3, 2, 1, C.eggLo);
  }

  function drawWindow(p) {
    if (p < AT.window) return;
    const { x, y, w, h } = WIN;
    // 白框（coopTrim）+ 深色玻璃（glass 0x2f4a5a）+ 十字棂
    px(x - 1, y - 1, w + 2, h + 2, C.trim);
    px(x - 1, y - 1, w + 2, 1, C.trimHi);
    px(x, y, w, h, C.glass);
    px(x + 1, y + 1, w - 2, h - 3, C.glassLo);
    px(x + Math.floor(w / 2), y + 1, 1, h - 2, C.trim);
    px(x + 1, y + Math.floor(h / 2), w - 2, 1, C.trim);
    if (p >= AT.glow) {
      // 点灯：窗格变暖，窗台往草地上洒一小片光
      px(x + 1, y + 1, w - 2, h - 3, C.glow);
      px(x + 2, y + 2, 2, 1, C.cream);
      s.globalAlpha = 0.18;
      px(x + 1, y + h + 1, w - 2, 1, C.glow);
      px(x - 2, y + h + 2, w + 4, 1, C.glow);
      s.globalAlpha = 1;
    }
    px(x - 1, y + h + 1, w + 2, 1, 'rgba(60,40,26,0.16)');
  }

  /** 屋顶木架：瓦还没铺到的地方露出椽子 + 檩条，读成「施工中」而不是「屋顶飘着」 */
  function drawRoofFrame() {
    const span = H.top - H.ridgeY;
    const ridgeY = H.ridgeY;
    // 先在整片屋面铺一层暗色的望板 —— 否则瓦没铺到的部分会露出天空，读成屋顶悬空
    for (let y = ridgeY; y <= H.top; y++) {
      const k = (y - ridgeY) / span;
      const half = H.ridgeHalf + Math.round(k * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - half, y, half * 2 + 1, 1, k > 0.5 ? '#4a3329' : '#553a2d');
    }
    // 两根斜脊梁（左右坡的外沿）
    for (let i = 0; i <= span; i++) {
      const y = ridgeY + i;
      const k = i / span;
      const dx = Math.round(H.ridgeHalf + k * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - dx, y, 1, 1, C.woodMid);
      px(H.apexX + dx, y, 1, 1, C.woodMid);
    }
    // 椽条：沿坡向排列的细木，等间距
    for (let q = -3; q <= 3; q++) {
      for (let i = 0; i <= span; i++) {
        const y = ridgeY + i;
        const k = i / span;
        const half = H.ridgeHalf + Math.round(k * (H.eaveHalf - H.ridgeHalf));
        const x = H.apexX + Math.round((q / 3) * half);
        px(x, y, 1, 1, C.woodLo);
      }
    }
    // 两根横向檩条
    for (const at of [0.34, 0.7]) {
      const y = ridgeY + Math.round(span * at);
      const dx = Math.round(H.ridgeHalf + at * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - dx, y, dx * 2 + 1, 1, C.wood);
      px(H.apexX - dx, y + 1, dx * 2 + 1, 1, 'rgba(40,28,20,0.35)');
    }
  }

  function drawRoof(p) {
    if (p < AT.roof[0]) return;
    drawRoofFrame();
    // 分三段往下铺：50% 铺到第一段、63% 到第二段、78% 铺满到檐 —— 每次都推进一大片
    const span = H.top - H.ridgeY;
    let last = H.ridgeY + span * 0.36;
    if (p >= AT.roof[2]) last = H.top;
    else if (p >= AT.roof[1]) last = H.ridgeY + span * 0.72;
    for (let y = H.ridgeY; y < last; y++) {
      const k = (y - H.ridgeY) / span;
      const half = H.ridgeHalf + Math.round(k * (H.eaveHalf - H.ridgeHalf));
      const x0 = H.apexX - half;
      const x1 = H.apexX + half;
      // 瓦垄：每 3 行一道压边；整片屋面靠左亮右暗立起坡度
      const row = y - H.ridgeY;
      const lite = row % 3 === 2 ? C.roofLeftLo : C.roofLeft;
      const dark = row % 3 === 2 ? C.roofRightLo : C.roofRight;
      const midL = H.apexX - Math.round(half * 0.42);
      const midR = H.apexX + Math.round(half * 0.42);
      px(x0, y, midL - x0, 1, lite);
      px(midL, y, midR - midL, 1, C.roof);
      px(midR, y, x1 - midR + 1, 1, dark);
      // 受光边 / 背光边
      px(x0, y, 1, 1, C.roofHi);
      px(x1, y, 1, 1, C.roofLo);
    }
    // 铺到哪儿，那儿就有一道「瓦口」——边推进边有厚度
    {
      const y = Math.round(last) - 1;
      const half = H.ridgeHalf + Math.round(((last - H.ridgeY) / span) * (H.eaveHalf - H.ridgeHalf));
      px(H.apexX - half, y, half * 2 + 1, 1, C.roofHi);
      px(H.apexX - half, y + 1, half * 2 + 1, 1, C.roofLo);
    }
    // 屋脊压顶：一条横向的奶油色瓦带（coopTrim 脊）。要等屋面铺满才出现，
    // 否则会读成"屋脊先盖、屋顶后长"
    if (p >= AT.roof[2]) {
      px(H.apexX - H.ridgeHalf - 1, H.ridgeY - 2, H.ridgeHalf * 2 + 3, 2, C.trim);
      px(H.apexX - H.ridgeHalf - 1, H.ridgeY, H.ridgeHalf * 2 + 3, 1, C.roof);
    } else {
      // 铺瓦过程中屋脊只是一道深色脊梁（跟望板同色，不抢戏）
      px(H.apexX - H.ridgeHalf - 1, H.ridgeY - 1, H.ridgeHalf * 2 + 3, 1, C.roofHi);
    }
    if (p >= AT.roof[2]) {
      // 檐口：奶油色 trim + 一道暗影，屋顶才像压住墙
      const half = H.eaveHalf;
      px(H.apexX - half - 1, H.top - 1, (half + 1) * 2 + 1, 2, C.trim);
      px(H.apexX - half - 1, H.top + 1, (half + 1) * 2 + 1, 1, C.roofLo);
      px(H.x0 - 5, H.top + 2, H.x1 - H.x0 + 11, 1, 'rgba(40,28,20,0.22)');
    }
  }

  /** 门口坡道（coop 的 ramp）：一块斜板 + 两道横档 */
  function drawRamp(p) {
    if (p < AT.ramp) return;
    const cx = OPEN.x + Math.round(OPEN.w / 2);
    for (let i = 0; i < 5; i++) {
      const y = RAMP.y + 3 - i;
      const w = RAMP.w - Math.round(i * 0.6);
      px(cx - Math.round(w / 2), y, w, 1, i % 2 ? C.wood : C.woodMid);
    }
    px(cx - Math.round(RAMP.w / 2), RAMP.y + 4, RAMP.w, 1, 'rgba(40,28,20,0.18)');
  }

  /** 门口的蛋（coop 门外的彩蛋细节） */
  function drawEggs(p) {
    if (p < AT.eggs) return;
    for (let i = 0; i < 4; i++) {
      const x = OPEN.x + OPEN.w + 4 + (i % 2) * 3;
      const y = H.base - 1 - Math.floor(i / 2) * 2;
      blob(x, y, 1, 1.4, C.egg);
      px(x, y, 1, 1, C.egg);
    }
  }

  /** 屋檐挂彩旗：100% 前最显眼的一记（一整排小三角，横跨檐口） */
  function drawRibbon(p) {
    if (p < AT.ribbon) return;
    const y = H.top + 3;
    const x0 = H.x0 + 1;
    const x1 = H.x1 - 1;
    // 先拉一根细线
    px(x0, y, x1 - x0, 1, 'rgba(40,28,20,0.35)');
    // 三角旗：交替四色，每面 5px 宽；挂满整个檐口（88% → 96% 之间一面面挂过去）
    const colors = ['#e8574a', '#ffd95e', '#5aa9d6', '#f2846f'];
    const n = Math.floor((x1 - x0) / 5);
    const hung = Math.ceil(n * clamp((p - AT.ribbon) / 0.08, 0, 1));
    for (let i = 0; i < hung; i++) {
      const cxp = x0 + i * 5 + 2;
      const c = colors[i % colors.length];
      px(cxp - 1, y + 1, 3, 1, c);
      px(cxp, y + 2, 1, 1, c);
      px(cxp, y + 1, 1, 1, 'rgba(255,255,255,0.35)');
    }
    // 再往檐下补一道暖光带：与点灯衔接
    if (p >= AT.glow) {
      s.globalAlpha = 0.5;
      px(x0, y + 1, x1 - x0, 1, 'rgba(255,233,160,0.55)');
      s.globalAlpha = 1;
    }
  }

  /** 满进度：整片场景暖一下（阳光斜下来），门里门外都亮起来 */
  function drawGoldenHour(p) {
    if (p < AT.golden) return;
    const k = clamp((p - AT.golden) / 0.08, 0, 1);
    // 两片暖光压在草地上 + 天空整体提亮一档（大面积，收尾看得见）
    s.globalAlpha = 0.16 * k;
    blob(56, 95, 46, 18, '#ffe9a0');
    blob(150, 90, 50, 14, '#ffdf9c');
    s.globalAlpha = 0.10 * k;
    px(IN.x0, IN.y0, IN.x1 - IN.x0 + 1, G_BACK - IN.y0, '#ffdfa8');
    s.globalAlpha = 1;
  }

  /** 门洞里点灯（100% 时） */

  function drawLamp(p, t) {
    if (p < AT.glow) return;
    const { x, y, w, h } = OPEN;
    // 门洞里整片透暖光（先铺底，再画灯）—— 这才是「屋里点着灯」的读数
    px(x + 1, y + 1, w - 2, h - 1, '#5a3a1e');
    px(x + 2, y + 2, w - 4, h - 2, '#8a5a24');
    px(x + 3, y + 3, w - 6, h - 4, C.glow);
    px(x + 4, y + 4, w - 8, h - 6, '#ffdc94');
    // 门口的暖光洒到草地上
    s.globalAlpha = 0.22;
    px(x - 1, H.base - 1, w + 2, 1, C.glow);
    px(x - 3, H.base + 1, w + 6, 1, C.glow);
    s.globalAlpha = 1;

    const lx = x + Math.round(w / 2);
    const ly = y + 3;
    // 吊线 + 灯罩
    px(lx, y, 1, 3, '#3a2a20');
    px(lx - 2, ly, 5, 2, C.lamp);
    px(lx - 1, ly, 3, 1, C.lampHi);
    // 光晕（缓慢呼吸，still 时恒定）
    const k = still ? 0.5 : 0.4 + 0.2 * Math.sin(t * 2.2);
    s.globalAlpha = 0.10 + k * 0.14;
    blob(lx, y + h * 0.55, 9, 7, C.golden || C.glow);
    s.globalAlpha = 1;
  }

  /* ---------- 树 / 灌木 / 栅栏 / 草垛 ---------- */
  /** 地面接触阴影：太阳在左边，影子统一往右下压一格 */
  function groundShadow(cx, base, halfW) {
    s.globalAlpha = 0.11;
    px(cx - halfW, base, halfW * 2 + 1, 1, '#2f3a24');
    px(cx - halfW + 2, base + 1, halfW * 2 - 3, 1, '#2f3a24');
    s.globalAlpha = 1;
  }

  function tree(cx, base, stage) {
    if (stage <= 0) return;
    if (stage === 1) {
      // 树苗：一根细枝两片叶
      px(cx, base - 5, 1, 5, C.woodLo);
      px(cx - 2, base - 6, 2, 1, C.leaf[2]);
      px(cx + 1, base - 7, 2, 1, C.leaf[3]);
      groundShadow(cx, base, 2);
      return;
    }
    const trunkH = stage === 2 ? 10 : 14;
    groundShadow(cx, base, stage === 2 ? 4 : 6);
    px(cx - 1, base - trunkH, 3, trunkH, C.woodLo);
    px(cx, base - trunkH, 1, trunkH, C.wood);
    if (stage === 2) {
      blob(cx, base - trunkH - 3, 7, 6, C.leaf[1]);
      blob(cx - 2, base - trunkH - 5, 5, 4, C.leaf[2]);
      blob(cx - 3, base - trunkH - 6, 3, 2, C.leaf[3]);
    } else {
      blob(cx, base - trunkH - 2, 10, 9, C.leaf[0]);
      blob(cx - 1, base - trunkH - 5, 9, 7, C.leaf[1]);
      blob(cx - 2, base - trunkH - 7, 6, 5, C.leaf[2]);
      blob(cx - 4, base - trunkH - 8, 3, 3, C.leaf[3]);
    }
  }

  function drawBush() {
    const x = 72;
    groundShadow(x, G_BACK, 4);
    blob(x, G_BACK - 3, 6, 4, C.leaf[0]);
    blob(x - 1, G_BACK - 4, 5, 3, C.leaf[1]);
    blob(x - 2, G_BACK - 5, 3, 2, C.leaf[2]);
    px(x + 2, G_BACK - 2, 1, 1, C.leaf[3]);
  }

  /** 小石井：左半的视觉分量，别让鸡舍一头沉 */
  function drawWell(p) {
    const x = 56;
    const base = G_BACK;
    const stage = p < AT.well[1] ? 1 : p < AT.well[2] ? 2 : 3;
    groundShadow(x, base, 5);
    px(x - 6, base - 1, 13, 1, 'rgba(40,28,20,0.16)');
    blob(x, base - 6, 6, 5, C.stone);
    blob(x, base - 6, 5, 4, C.stoneHi);
    px(x - 3, base - 8, 7, 3, C.stoneLo);
    px(x - 2, base - 8, 5, 2, '#2f3a3c');
    px(x - 2, base - 8, 5, 1, '#1f282a');
    px(x - 5, base - 4, 1, 1, C.stoneLo);
    px(x + 1, base - 3, 2, 1, C.stoneLo);
    px(x - 2, base - 6, 1, 1, C.stoneLo);
    if (stage < 2) return;
    px(x - 4, base - 16, 1, 9, C.wood);
    px(x + 4, base - 16, 1, 9, C.woodLo);
    px(x - 4, base - 16, 9, 1, C.woodMid);
    px(x, base - 15, 1, 2, C.woodLo);
    px(x - 1, base - 13, 3, 2, C.woodMid);
    px(x - 1, base - 13, 3, 1, C.woodHi);
    if (stage < 3) return;
    for (let i = 0; i < 3; i++) {
      const w = 7 - i * 2;
      px(x - w, base - 18 + i, w * 2 + 1, 1, i === 0 ? C.roofHi : C.roof);
    }
  }

  /** 白色矮栅栏（world.js 的 fenceLow） */
  function drawFence() {
    const base = G_BACK;
    s.globalAlpha = 0.1;
    px(179, base, 20, 1, '#2f3a24');
    s.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const x = 181 + i * 5;
      px(x, G_BACK - 9, 2, 9, C.trimLo);
      px(x, G_BACK - 9, 1, 9, C.trim);
      px(x, G_BACK - 9, 2, 1, C.trimHi);
    }
    px(180, G_BACK - 7, 18, 1, C.trimLo);
    px(180, G_BACK - 4, 18, 1, C.trimLo);
  }

  /** 草垛（world.js 的 hay，5 个一摞）：三阶段的视觉配重 */
  function drawHay(p) {
    if (p < AT.hay[0]) return;
    const base = G_BACK;
    // 主垛：一堆圆柱状的草捆
    const stack = p >= AT.hay[2] ? 3 : p >= AT.hay[1] ? 2 : 1;
    for (let i = 0; i < stack; i++) {
      const cx = 126 + i * 7;
      groundShadow(cx, base, 4);
      blob(cx, base - 3, 4, 3, C.hayLo);
      blob(cx, base - 3, 3.5, 2.5, C.hay);
      px(cx - 2, base - 4, 5, 1, C.hayHi);
      px(cx - 1, base - 2, 3, 1, C.hayLo);
    }
    // 散落的麦穗
    if (p >= AT.hay[1]) {
      for (let i = 0; i < 3; i++) {
        const x = 121 + i * 3;
        px(x, base - 1, 1, 3, C.wheat);
        px(x + 1, base - 2, 1, 1, C.wheatHi);
      }
    }
  }

  /* ---------- 稻草捆：左侧料堆 → 门口码好的成品 ---------- */
  function bale(x, y) {
    // 一个横放的小草捆：外皮暗、顶面亮、两道箍
    px(x, y, 7, 4, C.hay);
    px(x, y, 7, 1, C.hayHi);
    px(x, y + 3, 7, 1, C.hayLo);
    px(x + 2, y, 1, 4, C.hayLo);
    px(x + 5, y, 1, 4, C.hayLo);
  }

  function drawSupply(delivered) {
    const base = G_BACK;
    const left = clamp(6 - delivered, 0, 6);
    if (left > 0) groundShadow(22, base, 7);
    // 垫木 + 斜靠的木板（读成「料堆」，别画成小屋）
    px(14, base - 1, 20, 1, 'rgba(40,28,20,0.16)');
    for (let i = 0; i < 3; i++) {
      px(15 + i * 4, base - 8 - i, 2, 8 + i, i % 2 ? C.wood : C.woodLo);
    }
    for (let i = 0; i < left; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      bale(22 + col * 8, base - 5 - row * 5);
    }
  }

  function drawDelivered(n) {
    if (n > 0) groundShadow(100, G_BACK, 10);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      bale(102 + col * 8, G_BACK - 5 - row * 5);
    }
  }

  /* ---------- 小鸡（~8px 高：门洞 19px，家禽就该是门的三分之一多一点） ---------- */
  function chicken(cx, feet, dir, step, carrying, hop) {
    const bob = step === 1 && !hop ? 1 : 0;
    const y = feet - hop - bob;

    s.globalAlpha = hop ? 0.08 : 0.14;
    blob(cx, feet + 1, hop ? 3 : 4, 1.2, '#2f3a24');
    s.globalAlpha = 1;

    // 腿
    const legY = y - 2;
    px(cx - 2, legY, 1, 2, C.leg);
    px(cx + 1, legY, 1, 2, C.leg);
    px(cx - 3, legY + 2, 2, 1, C.leg);
    px(cx + 1, legY + 2, 2, 1, C.leg);

    // 身体
    blob(cx, y - 4, 3.5, 2.6, C.feather);
    blob(cx, y - 3, 3.5, 2, C.feather);
    px(cx - 1, y - 3, 2, 1, C.featherLo);
    // 尾羽
    px(cx - dir * 4, y - 5, 1, 2, C.featherLo);
    // 头
    const hx = cx + dir * 2;
    blob(hx, y - 7, 2, 2, C.feather);
    // 冠 / 喙 / 眼 / 肉垂
    px(hx, y - 10, 1, 2, C.comb);
    px(hx + dir, y - 9, 1, 1, C.comb);
    px(hx + dir * 2, y - 7, 1, 1, C.beak);
    px(hx, y - 8, 1, 1, C.eye);
    px(hx + dir, y - 5, 1, 1, C.comb);

    if (carrying) {
      const bx = cx - dir;
      // 背上的小草捆
      px(bx - 2, y - 9, 4, 2, C.hay);
      px(bx - 2, y - 9, 4, 1, C.hayHi);
      px(bx - 2, y - 8, 4, 1, C.hayLo);
    }
  }

  /* ---------- 进度条 + 百分比 ---------- */
  function drawDigits(x, y, text) {
    let cx = x;
    for (const ch of text) {
      const g = GLYPH[ch];
      if (!g) { cx += 4; continue; }
      s.fillStyle = UI.digit;
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[r].length; c++) {
          if (g[r][c] === '1') s.fillRect(cx + c, y + r, 1, 1);
        }
      }
      cx += 6;
    }
    return cx - 1;
  }

  function drawBar(p) {
    // 进度条做成农场入口的木牌：两根立柱插进草地，牌面本身就是槽
    const bx = 33;
    const by = 30;
    const bw = 66;
    const bh = 13;

    // 立柱 + 斜撑（先画柱，牌面压在上面）
    px(bx + 6, by + bh, 1, 13, C.woodLo);
    px(bx + bw - 7, by + bh, 1, 13, C.woodLo);
    px(bx + 7, by + bh + 12, 2, 1, 'rgba(40,28,20,0.16)');
    px(bx + bw - 7, by + bh + 12, 2, 1, 'rgba(40,28,20,0.16)');
    // 牌面：木框 + 深墨线
    px(bx - 1, by - 1, bw + 2, bh + 2, C.woodLo);
    px(bx, by, bw, bh, C.wood);
    px(bx, by, bw, 1, C.woodHi);
    px(bx, by + bh - 1, bw, 1, C.woodLo);
    px(bx, by, 1, bh, C.woodLo);
    // 槽：底板做旧一点，跟填充分得开
    px(bx + 2, by + 2, bw - 4, bh - 4, UI.trackLo);
    px(bx + 2, by + 2, bw - 4, 1, '#d8c49c');

    const inner = bw - 6;
    const fw = Math.round(inner * clamp(p, 0, 1));
    if (fw > 0) {
      px(bx + 3, by + 3, fw, bh - 6, UI.fill);
      px(bx + 3, by + 3, fw, 1, UI.fillHi);
      px(bx + 3, by + bh - 4, fw, 1, UI.fillLo);
      if (fw < inner - 1) px(bx + fw + 3, by + 3, 1, bh - 6, UI.fillLo);
    }
    // 刻度：每 1/5 一格，读得出「还剩多远」
    for (let i = 1; i < 5; i++) {
      const tickX = bx + 3 + Math.round((inner * i) / 5);
      px(tickX, by + 3, 1, bh - 6, 'rgba(70,45,30,0.18)');
    }

    // 百分比：刻在第一根立柱下方的小木牌上（跟进度条同一个木牌家族）
    const label = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    const tw = 26;
    const th = 13;
    const tx = bx + 1;
    const ty = by + bh + 4;
    px(tx - 1, ty - 1, tw + 2, th + 2, C.woodLo);
    px(tx, ty, tw, th, C.wood);
    px(tx, ty, tw, 1, C.woodHi);
    px(tx, ty + th - 1, tw, 1, C.woodLo);
    px(tx + 1, ty + 1, tw - 2, th - 2, C.cream);
    px(tx + 1, ty + 1, tw - 2, 1, '#fffdf4');
    px(tx + 1, ty + th - 2, tw - 2, 1, C.lip);
    const w = label.length * 6 - 1;
    drawDigits(tx + Math.round((tw - w) / 2), ty + 3, label);
  }

  /* ---------- 收尾：撒羽毛 + 麦穗 ---------- */
  function drawConfetti(t) {
    for (let i = 0; i < 26; i++) {
      const delay = noise(i, 31) * 0.28;
      const life = clamp((t - delay) / 0.8, 0, 1);
      if (life <= 0 || life >= 1) continue;
      const x0 = IN.x0 + 6 + noise(i, 37) * (IN.x1 - IN.x0 - 12);
      const drift = (noise(i, 41) - 0.5) * 26;
      const y = IN.y0 + 6 + life * (IN.y1 - IN.y0 - 14) * (0.7 + noise(i, 43) * 0.3);
      const x = x0 + drift * life;
      s.globalAlpha = life > 0.72 ? (1 - life) * 3.5 : 1;
      // 羽毛（三片一组）与麦穗（两色），比纯色方块耐看
      if (i % 3 === 0) {
        px(x, y, 1, 3, C.wheatHi);
        px(x + 1, y + 1, 1, 2, C.wheat);
      } else if (i % 3 === 1) {
        px(x, y, 2, 1, C.egg);
        px(x + 1, y + 1, 1, 1, C.eggLo);
      } else {
        px(x, y, 2, 2, C.flower[i % C.flower.length]);
      }
      s.globalAlpha = 1;
    }
  }

  /* ---------- 一帧 ---------- */
  function drawScene(now, p) {
    const t = still ? 0 : now / 1000;
    drawSky();
    drawSun(p);
    drawClouds(t);
    drawHills();
    drawTreeLine();
    drawGround(p);

    // 鸡舍与树的落地影
    s.globalAlpha = 0.1;
    px(H.x0 - 4, G_BACK - 1, H.x1 - H.x0 + 9, 1, '#2f3a24');
    s.globalAlpha = 1;

    tree(90, G_BACK, p >= AT.treeB[2] ? 3 : p >= AT.treeB[1] ? 2 : p >= AT.treeB[0] ? 1 : 0);

    if (p >= AT.well[0]) drawWell(p);
    if (p >= AT.fence) drawFence();
    if (p >= AT.bush) drawBush();

    // 鸡舍本体：放线 → 石基 → 墙 → 门楣 → 门洞 → 窗 → 屋顶 → 内部 → 坡道 → 蛋 → 灯
    if (p < AT.foundation) drawStakes();
    if (p >= AT.foundation) drawFoundation();
    drawWalls(p);
    drawDoor(p);
    drawPerch(p);
    drawWindow(p);
    drawRoof(p);
    drawRibbon(p);
    drawRamp(p);
    drawEggs(p);
    drawLamp(p, t);      // 点灯最后画：门洞的暖光要盖住里面的家具，不能被后画的东西糊掉

    const delivered = clamp(Math.floor(p * 7), 0, 6);
    drawDelivered(delivered);
    drawSupply(delivered);
    if (p >= AT.hay[0]) drawHay(p);
    drawFlowers(p);
    drawGoldenHour(p);

    // 进度条永远压在最上面（它是 HUD，不该被屋顶挡住）
    drawBar(p);

    // 小鸡：搬 → 放 → 空手回 → 再搬
    let chX = CX0;
    let carrying = false;
    let step = 0;
    let hop = 0;
    if (phase === 'celebrate') {
      chX = 100;
      const cycle = (phaseT % 0.64) / 0.64;
      hop = still ? 0 : Math.round(Math.sin(cycle * Math.PI) * 4);
      step = still ? 0 : cycle < 0.5 ? 0 : 1;
    } else if (still) {
      chX = 74;
      carrying = true;
    } else {
      const trip = (t % 5.0) / 5.0;
      if (trip < 0.44) {
        chX = lerp(CX0, CX1, trip / 0.44);
        carrying = true;
        step = Math.floor(t * 6) % 2;
      } else if (trip < 0.5) {
        chX = CX1;
        carrying = trip < 0.47;
      } else if (trip < 0.86) {
        chX = lerp(CX1, CX0, (trip - 0.5) / 0.36);
        step = Math.floor(t * 8) % 2;
      } else {
        chX = CX0;
        carrying = trip > 0.93;
      }
    }
    if (hopAt) {
      const k = clamp((now - hopAt) / 470, 0, 1);
      if (k < 1) hop = Math.max(hop, Math.round(Math.sin(k * Math.PI) * 6));
    }
    chicken(Math.round(chX), FEET, 1, step, carrying, hop);

    // 收尾时邻居小鸡跑来（每只从一侧入场，跑到位置就停）
    if (phase === 'celebrate') {
      for (const n of NEIGHBORS) {
        const k = clamp((phaseT - n.at) / 0.9, 0, 1);
        if (k <= 0) continue;
        const ease = 1 - (1 - k) * (1 - k);
        const x = lerp(n.from, n.to, ease);
        const s2 = Math.floor(phaseT * 9) % 2;
        chicken(Math.round(x), FEET + 1, n.dir, s2, false, 0);
      }
    }

    // 点过之后冒一个「♪」
    const bubble = now - tapAt;
    if (tapAt && bubble < 900) {
      const bx = Math.round(chX) + 8;
      const by = FEET - 24 - Math.round(Math.sin(clamp(bubble / 900, 0, 1) * Math.PI) * 4);
      s.globalAlpha = bubble > 660 ? 1 - (bubble - 660) / 240 : 1;
      px(bx, by, 9, 8, 'rgba(255,248,231,0.96)');
      px(bx, by, 9, 1, C.ink);
      px(bx, by + 7, 9, 1, C.ink);
      px(bx, by, 1, 8, C.ink);
      px(bx + 8, by, 1, 8, C.ink);
      // 一个像素音符
      px(bx + 3, by + 2, 1, 4, C.ink);
      px(bx + 4, by + 2, 1, 1, C.ink);
      px(bx + 5, by + 3, 1, 1, C.ink);
      px(bx + 2, by + 6, 2, 1, C.ink);
      s.globalAlpha = 1;
    }

    if (phase === 'celebrate') drawConfetti(phaseT);
  }

  /* ---------- 合成到屏幕画布：投影 + 胶囊框 ---------- */
  function render(now, p) {
    s.clearRect(0, 0, ART_W, ART_H);
    s.fillStyle = C.ink;
    s.fill(pOuter);
    s.fillStyle = C.cream;
    s.fill(pCream);
    s.fillStyle = C.ink;
    s.fill(pLip);

    s.save();
    s.clip(pScene);
    drawScene(now, p);
    // 内侧一圈极淡的墨线，让画面不像浮在奶油边上
    s.fillStyle = C.hair;
    for (let i = 0; i < rInner.length; i++) {
      const r = rInner[i];
      if (i === 0 || i === rInner.length - 1) { s.fillRect(r.x0, r.y, r.x1 - r.x0 + 1, 1); continue; }
      s.fillRect(r.x0, r.y, 1, 1);
      s.fillRect(r.x1, r.y, 1, 1);
    }
    s.restore();

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, ART_W, ART_H);
    // 落地阴影：两档叠出一点柔度
    ctx.save();
    ctx.translate(0, 4);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#2f3a24';
    const sh1 = rowsOf(PILL.x0 + 5, PILL.y0 + 3, PILL.x1 - 5, PILL.y1 + 1, PILL.r);
    for (const r of sh1) ctx.fillRect(r.x0, r.y, r.x1 - r.x0 + 1, 1);
    ctx.translate(0, 3);
    ctx.globalAlpha = 0.06;
    const sh2 = rowsOf(PILL.x0 + 11, PILL.y0 + 3, PILL.x1 - 11, PILL.y1 + 1, PILL.r);
    for (const r of sh2) ctx.fillRect(r.x0, r.y, r.x1 - r.x0 + 1, 1);
    ctx.restore();
    ctx.drawImage(scene, 0, 0);
  }

  /* ---------- 帧循环 ---------- */
  let raf = 0;
  let last = 0;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function loop(now) {
    if (!canvas.isConnected) return stop();
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;

    if (phase === 'load') {
      // 真实进度是下限；等得久了就往上慢慢蹭一点，但永不越过 88%
      // （这一步只为「别卡在 12% 干等」，不会替首帧宣布完成）
      const idle = lastSetAt ? (now - lastSetAt) / 1000 : 0;
      if (target < CREEP_CAP) {
        target = Math.min(CREEP_CAP, target + dt * 0.030 * clamp(idle / 0.6, 0, 1));
      }
      shown += (target - shown) * (1 - Math.exp(-dt * 3.6));
      if (target - shown < 0.004) shown = target;
    } else if (phase === 'celebrate') {
      phaseT += dt;
      // 收尾也走同一套平滑：模型没全到就揭幕时可能还在 60%，
      // 直接跳到 100% 会让鸡舍从「半边屋顶」瞬间完工（视觉断层）
      shown += (1 - shown) * (1 - Math.exp(-dt * 4.2));
      if (1 - shown < 0.004) shown = 1;
      // 进度真到 100% 再揭幕（另有时间上限兜住：动画卡住时别拖住页面）
      if (endCb && ((shown >= 0.995 && phaseT > 0.5) || phaseT > 1.8)) {
        const cb = endCb;
        endCb = null;
        cb();
      }
      if (phaseT > 2.6) { phase = 'gone'; return stop(); }
    }
    render(now, shown);
  }

  /* ---------- 尺寸跟随 ---------- */
  let resizeTimer = 0;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      fit();
      render(performance.now(), shown);
    }, 120);
  }

  /* ---------- 点小鸡：跳一下 ---------- */
  function onTap(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const ax = ((e.clientX - r.left) / r.width) * ART_W;
    // 只在小鸡能落脚的那一段响应，别让整条路都变成按钮
    if (ax < CX0 - 12 || ax > CX1 + 24) return;
    hopAt = performance.now();
    tapAt = hopAt;
  }

  /* ---------- 对外接口 ---------- */
  const api = {
    mounted: true,
    /** 真实进度落点（0..1），只往上走 */
    set(v) {
      if (phase !== 'load') return;
      const n = clamp(Number(v) || 0, 0, 1);
      if (n > target) target = n;
      lastSetAt = performance.now();
    },
    /**
     * 模型计数：把 ok/total 映射到 [base, base+span] 这一段真实进度。
     * 比 set() 更细 —— 44 个 GLB 逐个到位时进度条会一格一格往前走。
     */
    count(ok, total, base = 0.30, span = 0.56) {
      if (phase !== 'load') return;
      counted = { ok, total };
      const k = total > 0 ? clamp(ok / total, 0, 1) : 0;
      this.set(base + span * k);
    },
    /** 首帧已渲染：把 100% 那段演完再揭幕 */
    done(cb) {
      if (phase === 'celebrate' || phase === 'gone') { if (cb) cb(); return; }
      phase = 'celebrate';
      phaseT = 0;
      endCb = cb || null;
      target = 1;
      lastSetAt = performance.now();
    },
    /** 出错了：不演完，直接收场 */
    fail(cb) {
      phase = 'gone';
      stop();
      if (cb) cb();
    },
    get progress() { return shown; },
    get models() { return { ...counted }; },
    /** 验收用探针：当前阶段、显示进度、是否在跳、画布尺寸 */
    state() {
      return {
        phase, shown, target, hop: hopAt > 0, tap: tapAt > 0,
        w: canvas.width, h: canvas.height, scale, models: { ...counted },
      };
    },
  };

  fit();
  render(performance.now(), shown);
  raf = requestAnimationFrame(loop);
  window.addEventListener('resize', onResize, { passive: true });
  canvas.addEventListener('pointerdown', onTap, { passive: true });

  window.__NIWATORI_LOAD__ = api;
  api.dispose = () => {
    stop();
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('pointerdown', onTap);
    if (window.__NIWATORI_LOAD__ === api) delete window.__NIWATORI_LOAD__;
  };
  return api;
}
