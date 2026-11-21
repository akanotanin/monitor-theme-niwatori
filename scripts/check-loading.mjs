// 载入动画验收：像素农场「搭鸡舍」
//
//   CDP_PORT=9333 BASE=http://127.0.0.1:18099 node scripts/check-loading.mjs
//
// 前提：一个开着 --remote-debugging-port 的 Chrome（**不要用 swiftshader**，
// 本机实测 --use-angle=swiftshader 会让 Page.captureScreenshot 随机卡死 30s+），
// 以及跑着主题的静态站（scripts/mock-hub.mjs）。
//
// 断言的都是「真实行为」，不是像素快照：
//   1. 载入期间 #boot 里确实挂着画布，且是整数倍放大（硬边像素）
//   2. 进度只能往上走（真实进度是下限，不许回退）
//   3. 模型计数能推进进度条（count 的映射真的接上了）
//   4. 相邻进度之间的画面必须真的变化（防「后半段像卡住」）
//   5. 收尾：100% 前后画面变化显著（点灯/彩旗/暖光）
//   6. 揭幕后 #boot 被移除，3D 画布淡入
//   7. 主模块失败时立刻揭幕，不把访客困在幕布上
//   8. 全程无 console error

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://127.0.0.1:18099';
// 独立预览页（tools/ld-preview.html）由仓库根的静态服务提供，不是 dist 里的路由
const PREVIEW = process.env.PREVIEW || 'http://127.0.0.1:5210/tools/ld-preview.html';
const OUT = process.env.OUT || join(tmpdir(), 'niwatori-loading-check');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, pass, extra) {
  results.push(pass);
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${name}${extra === undefined ? '' : '  ' + JSON.stringify(extra)}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.p = new Map(); this.h = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) {
        const { resolve, reject } = this.p.get(m.id);
        this.p.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && this.h.has(m.method)) this.h.get(m.method)(m.params);
    });
  }
  on(k, f) { this.h.set(k, f); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.p.delete(id)) rej(new Error('timeout ' + method)); }, 30000);
    });
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = join(OUT, 'prof-' + Date.now());
  const log = openSync(join(OUT, 'chrome.log'), 'w');
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox',
    // ★ 不要加 --use-angle=swiftshader：本机实测它会让 Page.captureScreenshot 随机卡死
    // ★ --no-proxy-server：本机（以及任何开了系统代理的 CI）若不显式关掉，
    //   headless 访问 127.0.0.1 也会被代理接管 → 页面直接变成 chrome-error://chromewebdata/，
    //   所有断言一起变成 null（看起来像「载入动画坏了」，其实是根本没加载）。
    '--no-proxy-server',
    '--window-size=1440,900', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', log, log], windowsHide: true });
  closeSync(log);
  const cleanup = () => {
    try { chrome.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);
  setTimeout(() => { console.log('!! 超时'); cleanup(); process.exit(9); }, 150000);

  let targets = null;
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    try { const j = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (j?.length) { targets = j; break; } } catch {}
  }
  if (!targets) { console.log('!! Chrome 未启动'); process.exit(8); }
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  const cdp = new CDP(ws);

  const errors = [];
  cdp.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)); });
  cdp.on('Runtime.exceptionThrown', (p) => errors.push('EX: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 200)));

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  /* ---------- 1. 画布挂在 #boot 里，整数倍放大 ---------- */
  await cdp.send('Page.navigate', { url: `${BASE}/?t=${Date.now()}` });
  let geo = null;
  for (let i = 0; i < 80; i++) {
    await sleep(80);
    geo = await ev(`(() => {
      const c = document.getElementById('ld-canvas');
      const b = document.getElementById('boot');
      if (!c || !b) return null;
      const r = c.getBoundingClientRect();
      const L = window.__NIWATORI_LOAD__;
      // ★ 必须等到 fit() 跑完：mount 后 canvas.width 先是 HTML 里的 216，
      //   动画起来才改成 216×scale。抓到初始值会误判成「没放大」。
      if (!L || !L.state().scale || L.state().scale < 1) return null;
      return { bmpW: c.width, bmpH: c.height, cssW: Math.round(r.width),
        left: Math.round(r.left), right: Math.round(r.right),
        vw: window.innerWidth, scale: L.state().scale,
        tip: !!document.querySelector('#boot .ld-tip') };
    })()`).catch(() => null);
    if (geo) break;
  }
  check('载入画布挂在 #boot 里，且有一行小字', !!geo && geo.tip, geo && { bmp: `${geo.bmpW}x${geo.bmpH}` });
  check('整数倍放大（位图 = 216 × scale）', !!geo && geo.bmpW === 216 * geo.scale && geo.bmpH === 128 * geo.scale, geo && { bmpW: geo.bmpW, scale: geo.scale });
  check('不溢出视口', !!geo && geo.right <= geo.vw && geo.left >= 0, geo && { left: geo.left, right: geo.right, vw: geo.vw });

  /* ---------- 2/3. 进度只往上走 + 模型计数接上了 ---------- */
  // ★ 不要在外部按 30/60ms 轮询：本地全命中缓存时载入 1 秒内就结束，
  //   轮询只能采到 1–3 个点，「单调性」这条断言等于没测（样本太少）。
  //   改成页面内 rAF 采样器 —— 每帧记一次，样本数与载入速度无关。
  //   先装采样器再导航（addScriptToEvaluateOnNewDocument），保证从第一帧就在记。
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__trace = [];
      const sample = () => {
        try {
          const L = window.__NIWATORI_LOAD__;
          const st = L && L.state ? L.state() : null;
          if (st) window.__trace.push({ p: st.shown, t: st.target, ph: st.phase, m: st.models });
          // 收尾阶段（celebrate/done）多记 40 帧就够，之后停
          if (window.__trace.length > 4000) return;
        } catch { /* 还没挂上 */ }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })();`,
  });
  await cdp.send('Page.navigate', { url: `${BASE}/?probe=1&t=${Date.now()}` });
  // 等载入动画彻底结束（#boot 移除）再一次性取回全部样本
  await ev(`new Promise((r) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const b = document.getElementById('boot');
      if ((b && b.classList.contains('done')) || Date.now() - t0 > 25000) { clearInterval(iv); r(1); }
    }, 80);
  })`);
  const trace = (await ev('(window.__trace || []).filter(Boolean)')) || [];

  let mono = true;
  for (let i = 1; i < trace.length; i++) if (trace[i].p < trace[i - 1].p - 0.002) mono = false;
  // rAF 采样器每帧一次：本地也能采到几十个点。仍留 3 的下限防止采样器没装上时「真空通过」。
  check('进度只往上走（不假装回退）', mono && trace.length >= 3, { samples: trace.length });
  const counted = trace.some((s) => s.m && s.m.total > 0 && s.m.ok > 0);
  check('模型计数推进了进度（count 接上了）', counted, trace.find((s) => s.m?.total > 0)?.m || null);
  check('真实进度没有越过上限就直接跳满', trace.filter((s) => s.ph === 'load').every((s) => s.t <= 1.0), null);

  /* ---------- 4/5. 画面必须真的在变（防「卡住」） ---------- */
  const fp = async (p) => {
    await cdp.send('Page.navigate', { url: `${PREVIEW}?p=${p}&t=${Date.now()}` }).catch(() => {});
    // ★ 等 1.6s：动画是平滑逼近 target 的，太快抓到的是「还没走到 p」的中间态，
    //   会让相邻档看起来变化很小（本机实测 0.90 那档会误报成只有 722px 变化）。
    await sleep(1600);
    return ev(`(() => {
      const c = document.getElementById('ld-canvas');
      if (!c) return null;
      const o = document.createElement('canvas'); o.width = 216; o.height = 128;
      const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(c, 0, 0, 216, 128);
      const px = g.getImageData(0, 0, 216, 128).data;
      const a = []; for (let i = 0; i < px.length; i += 4) a.push(px[i], px[i+1], px[i+2]);
      return a;
    })()`).catch(() => null);
  };
  const pts = [0.14, 0.26, 0.36, 0.50, 0.64, 0.78, 0.90, 1.0];
  const frames = [];
  for (const p of pts) {
    const f = await fp(p);
    if (f) frames.push({ p, f });
  }
  let weak = [];
  const deltas = [];
  for (let i = 1; i < frames.length; i++) {
    let d = 0;
    const A = frames[i - 1].f, B = frames[i].f;
    for (let k = 0; k < A.length; k += 3) {
      if (Math.abs(A[k] - B[k]) + Math.abs(A[k+1] - B[k+1]) + Math.abs(A[k+2] - B[k+2]) > 12) d++;
    }
    deltas.push(`${frames[i-1].p}→${frames[i].p}:${d}`);
    if (d < 120) weak.push({ from: frames[i - 1].p, to: frames[i].p, px: d });
  }
  check('每一档之间画面都在变（不是只有进度条在动）', frames.length >= 6 && weak.length === 0,
    { frames: frames.length, weak, deltas });
  const lastDiff = (() => {
    if (frames.length < 2) return 0;
    const A = frames[frames.length - 2].f, B = frames[frames.length - 1].f;
    let d = 0;
    for (let k = 0; k < A.length; k += 3) {
      if (Math.abs(A[k] - B[k]) + Math.abs(A[k+1] - B[k+1]) + Math.abs(A[k+2] - B[k+2]) > 12) d++;
    }
    return d;
  })();
  check('收尾有显著变化（点灯 + 彩旗 + 暖光）', lastDiff >= 1500, { changedPx: lastDiff });

  /* ---------- 6. 揭幕后幕布移除、画布淡入 ---------- */
  // ★ 先清空累积错误：第 4/5 段是逐帧截图（PREVIEW），导航打断上一页的加载
  //   会产生「Failed to fetch dynamically imported module」这类噪音，
  //   它属于测试自己的换页动作，不是主题的问题 —— 不清掉会一路带到第 7 段之后。
  errors.length = 0;
  await cdp.send('Page.navigate', { url: `${BASE}/?t=${Date.now()}` });
  let revealed = null;
  for (let i = 0; i < 240; i++) {
    await sleep(100);
    const r = await ev(`(() => {
      const b = document.getElementById('boot');
      const v = document.querySelector('#app > canvas');
      return { boot: !!b, done: b ? b.classList.contains('done') : null,
        op: v ? Number(getComputedStyle(v).opacity) : -1,
        town: !!window.__probeTheme };
    })()`).catch(() => null);
    if (r && !r.boot && r.op > 0.9 && r.town) { revealed = r; break; }
  }
  check('揭幕后 #boot 被移除、3D 画布淡入、小镇就绪', !!revealed && revealed.town, revealed);

  /* ---------- 7. 主模块失败 → 立刻揭幕 ---------- */
  // ★ 这一段会故意让 main.js 404，控制台必然有错 —— 先把前面累积的错误结算掉，
  //   否则「无控制台错误」这条会被自己的破坏性测试弄红。
  const errsBeforeBlock = errors.slice();
  errors.length = 0;
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*js/main.js*'] });
  await cdp.send('Page.navigate', { url: `${BASE}/?broken=1&t=${Date.now()}` });
  let failed = null;
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    const r = await ev(`(() => ({ boot: !!document.getElementById('boot'),
      done: document.getElementById('boot')?.classList.contains('done') ?? null,
      text: (document.body.innerText || '').trim().length }))()`).catch(() => null);
    if (r && r.done) { failed = r; break; }
  }
  await cdp.send('Network.setBlockedURLs', { urls: [] });
  check('主模块失败时立刻揭幕、不留空白页', !!failed && failed.text > 20, failed);

  check('无控制台错误', errsBeforeBlock.length === 0, errsBeforeBlock.slice(0, 3));

  const pass = results.filter(Boolean).length;
  console.log(`\n===== 通过 ${pass}/${results.length} =====`);
  cleanup();
  process.exit(pass === results.length ? 0 : 5);
}

main().catch((e) => { console.error(e); process.exit(9); });
