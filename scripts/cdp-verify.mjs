// 浏览器验收：用 CDP 打开主题的真实路由，截图 + 读页面状态，顺便收集控制台/网络错误。
//
//   node scripts/cdp-verify.mjs                 # 默认连 127.0.0.1:9333，站点 http://127.0.0.1:18099
//   CDP_PORT=9333 BASE=http://127.0.0.1:18099 SHOTS=./shots node scripts/cdp-verify.mjs
//
// 前提：一个开着 --remote-debugging-port 的 Chrome（headless 也行），和一个跑着主题的静态站
// （本地用 scripts/mock-hub.mjs）。脚本不开浏览器 —— 浏览器由调用方起，见 README「本地开发」。

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://127.0.0.1:18099';
const SHOTS = process.env.SHOTS || './shots';

async function newTarget(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`CDP /json/new ${r.status}`);
  return r.json();
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      } else if (m.method) {
        this.events.push(m);
        if (this.onEvent) this.onEvent(m);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
    return r.result?.value;
  }
  async waitFor(expr, ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try { if (await this.eval(expr)) return true; } catch { /* 页面还没就绪 */ }
      await sleep(250);
    }
    return false;
  }
}

async function openPage(path, { width = 1440, height = 900, dpr = 1 } = {}, base = BASE) {
  const target = await newTarget('about:blank');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const s = new Session(ws);
  const problems = { console: [], exceptions: [], http: [] };
  s.onEvent = (m) => {
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      problems.console.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      problems.exceptions.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 400));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      problems.console.push(`[log] ${m.params.entry.text}`.slice(0, 300));
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400) problems.http.push(`${r.status} ${r.url}`);
    }
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) {
      problems.http.push(`FAILED ${m.params.errorText} ${m.params.requestId}`);
    }
  };

  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Log.enable');
  await s.send('Network.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: width < 600 });
  await s.send('Page.navigate', { url: base + path });
  await s.waitFor('document.readyState === "complete"', 20000);
  return { s, ws, target, problems };
}

async function shot(s, name) {
  mkdirSync(SHOTS, { recursive: true });
  const r = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = `${SHOTS}/${name}.png`;
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

const results = [];
async function record(name, path, opts, checks) {
  const { s, ws, target, problems } = await openPage(path, opts);
  const ok = await s.waitFor('!!window.__probeTheme && window.__probeTheme.farm.nodes.length > 0', 15000);
  // 等模型全到位再读状态：decorate 单个模型的超时是 7s，固定 sleep 会读到 pfTotal=0 假红
  if (opts.waitModels) await s.waitFor('window.__pfTotal > 0', 15000);
  // 等两帧，让首屏淡入 / NPC 出生跑完
  await sleep(opts.wait ?? 1800);
  const state = ok ? await s.eval(`(() => {
    const p = window.__probeTheme;
    const body = document.body;
    return {
      path: location.pathname,
      body: body.className,
      paused: p.paused,
      nodes: p.farm.nodes.length,
      online: p.farm.onlineCount,
      npcs: p.npcs ? p.npcs.size : -1,
      kinds: p.npcs ? [...new Set([...p.npcs.values()].map(n => n.kind))].sort() : [],
      solo: !!p.solo,
      hudOpen: p.hud.probesOpen,
      detail: !document.getElementById('plist-detail')?.classList.contains('hidden'),
      cards: document.querySelectorAll('.pcard').length,
      canvases: document.querySelectorAll('#plist canvas').length,
      // 三网那一行：每个运营商一格（电信/联通/移动）；列表本身不能有横向溢出
      net: [...document.querySelectorAll('.pcard .pnet')].slice(0, 3)
        .map((n) => [...n.querySelectorAll('.net b')].map((b) => b.textContent)),
      overflow: (() => {
        const b = document.getElementById('plist-body');
        return b ? b.scrollWidth - b.clientWidth : null;
      })(),
      // 折线图必须按「CSS 宽 × dpr」出图（旧版位图写死 760px，被拉到面板宽度就是糊的）
      chart: (() => {
        const c = document.querySelector('#plist-detail canvas');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
        return { cssW: Math.round(r.width), bmpW: c.width, dpr, want: Math.round(r.width * dpr) };
      })(),
      title: document.title,
      models: !!(window.CP_THEME && window.CP_THEME.models),
      // 每只狗必须各自挂着自己的模型（共用同一个缓存 scene 时，后一只 add() 会把前一只的模型
      // 从它身上摘走 —— 后台把看门狗设成 2 只后，先建的那只只剩名牌，审查 H1）。
      dogs: p.npcs ? [...p.npcs.values()].filter((n) => n.kind === 'dog')
        .map((d) => ({
          model: !!d.chicken?.model,
          parentIsBody: !!(d.chicken?.model && d.chicken.model.parent === d.chicken.bodyG),
        })) : [],
      geese: p.npcs ? [...p.npcs.values()].filter((n) => n.kind === 'goose').length : 0,
      pfModels: window.__pfModels || 0,
      pfDecor: window.__pfDecor || 0,
      pfTotal: window.__pfTotal || 0,
      pfLog: (window.__pfLog || []).length,
    };
  })()`) : { error: 'theme never initialised' };
  const file = await shot(s, name);
  ws.close();
  fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  const row = { name, path, ok, ...state, shot: file, problems };
  results.push(row);
  return row;
}

async function main() {
  const farm = await record('farm-desktop', '/', { width: 1440, height: 900, wait: 2500, waitModels: true });
  const farmDay = await record('farm-day', '/?light=day', { width: 1440, height: 900, wait: 2500, waitModels: true });
  const nodes = await record('nodes-desktop', '/nodes', { width: 1440, height: 900 });
  // 详情页按 2x 屏跑：折线图必须按 dpr 出图（1x 下「位图 760 被拉宽」也能蒙混过关）
  const detail = await record('detail-desktop', '/node/1', { width: 1440, height: 900, dpr: 2 });
  const mobile = await record('farm-mobile', '/', { width: 390, height: 844, dpr: 2, waitModels: true });
  // 手机上真的把列表打开：卡片文字不能被挤出去（长名字/长备注也不能把列表撑出横向滚动）
  const nodesMobile = await record('nodes-mobile', '/nodes', { width: 375, height: 780, dpr: 3 });

  // Tab 在农场 ⇄ 列表之间切地址
  {
    const { s, ws, target, problems } = await openPage('/', { width: 1440, height: 900 });
    await s.waitFor('!!window.__probeTheme', 15000);
    await sleep(1200);
    const diag0 = await s.eval(`(() => {
      window.__tabSeen = 0;
      addEventListener('keydown', (e) => { window.__tabSeen++; window.__tabCode = e.code; }, true);
      return { wrapped: String(window.__probeTheme.hud.showProbes).includes('native') === false, path: location.pathname };
    })()`);
    // 真键盘事件（CDP 注入的是可信事件，和用户按 Tab 等价）
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(900);
    const toNodes = await s.eval('({path: location.pathname, open: window.__probeTheme.hud.probesOpen, paused: window.__probeTheme.paused, seen: window.__tabSeen, code: window.__tabCode})');
    // 浏览器后退：应该回到农场（popstate → apply farm：恢复渲染、关面板）
    await s.eval('history.back()');
    await sleep(1200);
    const afterBack = await s.eval('({path: location.pathname, open: window.__probeTheme.hud.probesOpen, paused: window.__probeTheme.paused, body: document.body.className})');
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(900);
    const back = await s.eval('({path: location.pathname, open: window.__probeTheme.hud.probesOpen, paused: window.__probeTheme.paused, seen: window.__tabSeen})');
    const file = await shot(s, 'tab-toggle');
    ws.close();
    fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    results.push({ name: 'tab-toggle', diag0, toNodes, afterBack, back, shot: file, problems });
  }

  // 详情里按 Tab → 回列表；再按浏览器后退 → 回农场
  {
    const { s, ws, target, problems } = await openPage('/node/1', { width: 1440, height: 900 });
    await s.waitFor('!!window.__probeTheme && !!document.querySelector("#plist-detail canvas")', 15000);
    await sleep(600);
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(700);
    const afterTab = await s.eval('({path: location.pathname, detail: !document.getElementById("plist-detail").classList.contains("hidden"), open: window.__probeTheme.hud.probesOpen})');
    const file = await shot(s, 'detail-tab-back');
    ws.close();
    fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    results.push({ name: 'detail-tab-back', afterTab, shot: file, problems });
  }

  // 私有站点：引导层应该直接出锁屏，不去加载 3D
  let privateSite = null;
  if (process.env.PRIVATE_BASE) {
    const { s, ws, target, problems } = await openPage('/', { width: 1280, height: 800 }, process.env.PRIVATE_BASE);
    await sleep(2500);
    const state = await s.eval(`(() => {
      const lock = document.getElementById('theme-lock');
      return {
        lock: !!lock,
        title: lock ? lock.querySelector('h1')?.textContent : '',
        login: !!lock?.querySelector('a[href^="/admin"]'),
        theme: !!window.__probeTheme,
      };
    })()`);
    const file = await shot(s, 'private-lock');
    ws.close();
    fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
    privateSite = { ...state, shot: file, problems };
    results.push({ name: 'private-lock', ...privateSite });
  }

  const threeNet = (r) => Array.isArray(r.net) && r.net.length > 0
    && r.net.every((row) => Array.isArray(row) && row.join('/') === '电信/联通/移动');

  // 控制台异常 / 例外 / HTTP>=400 以前只写进 report.json，**不参与最终判定** ——
  // 任意 .glb、国旗 404，只要主题还能初始化，ok 仍是 true（坏资产能发布，审查 M13）。
  // 这里把预期内的噪音白名单掉（未登录时 /admin 的 401、图标探测的 404），其余一条都不放过。
  const EXPECT_HTTP = [/\/admin\b/, /\/favicon/i, /apple-touch-icon/i,
    /401 .*\/api\/me(?:\?|$)/];   // 真关了公开页的 hub：/api/me 本来就回 401（theme-boot 会渲染登录卡）
  const EXPECT_LOG = [/Failed to load resource: the server responded with a status of 40[14]/i];
  const hunt = (r) => {
    const pr = r.problems || {};
    return {
      name: r.name,
      http: (pr.http || []).filter((u) => !EXPECT_HTTP.some((re) => re.test(u))),
      console: (pr.console || []).filter((t) => !EXPECT_LOG.some((re) => re.test(t))),
      exceptions: pr.exceptions || [],
    };
  };
  const noise = results.map(hunt).filter((x) => x.http.length || x.console.length || x.exceptions.length);

  const report = {
    base: BASE,
    farm, farmDay, nodes, detail, mobile, nodesMobile, privateSite,
    checks: results,
    errors: noise,
    ok: results.every((r) => r.ok !== false)
      && noise.length === 0
      // 模型必须一个不少：__pfModels 是「成功摆上去的数量」，以前只断言 > 10，
      // 而实际有 29 个模型 × 多处摆放（44 次）—— 24 个 404 也能通过（审查 M13）。
      && farm.pfTotal > 0 && farm.pfDecor === farm.pfTotal && farm.pfLog === farm.pfTotal
      // 有模型的狗必须都还挂在自己身上（多狗共用缓存 scene 的回归：第一只只剩名牌）
      && farm.dogs.every((d) => !d.model || d.parentIsBody)
      && farm.npcs > 0 && nodes.paused === true && detail.detail === true
      // 三网：一格一个运营商（以前三个任务全是电信时这里会是 电信/电信/电信）
      && threeNet(nodes) && threeNet(nodesMobile)
      // 列表不能横向溢出（长名字卡片曾把手机端卡片挤出面板）
      && nodes.overflow === 0 && nodesMobile.overflow === 0
      // 图表按 dpr 出图（留 5% 余量给取整）
      && detail.chart && detail.chart.bmpW >= detail.chart.want * 0.95
      && results.find((r) => r.name === 'tab-toggle')?.toNodes?.path === '/nodes'
      && results.find((r) => r.name === 'tab-toggle')?.afterBack?.path === '/'
      && results.find((r) => r.name === 'detail-tab-back')?.afterTab?.path === '/nodes'
      && (!privateSite || (privateSite.lock && privateSite.login && !privateSite.theme
        && /未对访客开放|需要登录/.test(privateSite.title || '')))
,
  };
  writeFileSync(`${SHOTS}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
