// 本地 Monitor hub 模拟服务：不上真站也能预览 / 验收这个主题。
//
//   node scripts/mock-hub.mjs                 # http://127.0.0.1:18099
//   node scripts/mock-hub.mjs --closed        # public_page=false（验收锁屏）
//   node scripts/mock-hub.mjs --sky dusk --sound off
//
// 提供的接口（形状对齐极简探针 Monitor hub 的公开 API）：
//   GET /api/me                          站点名 / 登录状态 / public_page / history_days
//   GET /api/themes/niwatori/config    主题设置（后台「主题设置」存下来的值）
//   GET /api/nodes                       { nodes: [...] }
//   GET /api/nodes/<id>/metrics          历史曲线（?series=ping 时只回 ping）
//
// 静态文件从 dist/ 出；找不到的路径回 index.html（模拟 hub 的 SPA 回退）。

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(arg('port', process.env.PORT || 18099));
const CLOSED = args.includes('--closed');
const THEME_SKY = arg('sky', 'auto');             // auto | day | dusk
const THEME_SOUND = arg('sound', 'on') !== 'off';
const ROOT = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ---------- 假数据 ----------
const NODES = [
  { id: 1, name: '东京 · A1', region: 'JP', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-54-amd64', arch: 'amd64', virt: 'kvm', cpu_name: 'AMD EPYC 7B13', cpu_cores: 4, mem_total: 8 * 1024 ** 3, swap_total: 2 * 1024 ** 3, disk_total: 80 * 1024 ** 3, public_remark: '月付 · 三网优化', price: 19.9, currency: 'CNY', billing_cycle: 'month', day_rx: 3.2 * 1024 ** 3, day_tx: 1.1 * 1024 ** 3 },
  { id: 2, name: '香港 · B2', region: 'HK', os: 'Ubuntu 24.04 LTS', kernel: '6.8.0-45-generic', arch: 'amd64', virt: 'kvm', cpu_name: 'Intel Xeon Platinum 8358', cpu_cores: 2, mem_total: 4 * 1024 ** 3, swap_total: 0, disk_total: 40 * 1024 ** 3, public_remark: '', price: 9.9, currency: 'CNY', billing_cycle: 'month', day_rx: 0.8 * 1024 ** 3, day_tx: 0.3 * 1024 ** 3 },
  { id: 3, name: '洛杉矶 · C3', region: 'US', os: 'AlmaLinux 9.4', kernel: '5.14.0-427', arch: 'amd64', virt: 'kvm', cpu_name: 'AMD EPYC 7763', cpu_cores: 8, mem_total: 16 * 1024 ** 3, swap_total: 4 * 1024 ** 3, disk_total: 160 * 1024 ** 3, public_remark: '大流量 · 回程 CN2', price: 49, currency: 'CNY', billing_cycle: 'year', day_rx: 12 * 1024 ** 3, day_tx: 4 * 1024 ** 3 },
  { id: 4, name: '法兰克福 · D4', region: 'DE', os: 'Debian GNU/Linux 11 (bullseye)', kernel: '5.10.0-32-amd64', arch: 'amd64', virt: 'none', cpu_name: 'Intel Xeon E5-2680 v4', cpu_cores: 2, mem_total: 2 * 1024 ** 3, swap_total: 1 * 1024 ** 3, disk_total: 20 * 1024 ** 3, public_remark: '年付 · 存储型', price: 12, currency: 'CNY', billing_cycle: 'year', day_rx: null, day_tx: null },
  { id: 5, name: '新加坡 · E5', region: 'SG', os: 'Rocky Linux 9.4', kernel: '5.14.0-427', arch: 'arm64', virt: 'kvm', cpu_name: 'Ampere Altra', cpu_cores: 4, mem_total: 8 * 1024 ** 3, swap_total: 0, disk_total: 60 * 1024 ** 3, public_remark: '', price: 22, currency: 'CNY', billing_cycle: 'month', day_rx: null, day_tx: null },
  { id: 6, name: '广州 · F6', region: 'CN', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-30-amd64', arch: 'amd64', virt: 'none', cpu_name: 'Intel Xeon E3-1275 v6', cpu_cores: 8, mem_total: 32 * 1024 ** 3, swap_total: 2 * 1024 ** 3, disk_total: 500 * 1024 ** 3, public_remark: '家宽 · 大硬盘', price: 0, currency: 'CNY', billing_cycle: '', day_rx: 20 * 1024 ** 3, day_tx: 9 * 1024 ** 3 },
];

const ONLINE = new Set([1, 2, 3, 6]);

function metricsFor(node, t = Date.now()) {
  const i = node.id - 1;
  const wave = Math.abs(Math.sin(t / 40000 + i * 1.7));
  const hot = node.id === 3;
  const cpu = hot ? 78 + 12 * Math.sin(t / 9000) : 4 + 40 * wave;
  const mem = node.mem_total * (0.28 + 0.45 * Math.abs(Math.sin(t / 60000 + i)));
  return {
    uptime: Math.round(86400 * (3 + i) + (t % 60000) / 1000),
    cpu: Math.round(cpu * 10) / 10,
    load: [0.4 + wave, 0.3 + wave * 0.8, 0.2 + wave * 0.6],
    mem_total: node.mem_total,
    mem_used: Math.round(mem),
    disk_total: node.disk_total,
    disk_used: Math.round(node.disk_total * (0.31 + i * 0.05)),
    net_rx: Math.round(900e3 + 500e3 * Math.abs(Math.cos(t / 27000 + i))),
    net_tx: Math.round(120e3 + 90e3 * Math.abs(Math.sin(t / 30000 + i))),
    total_rx: (12 + i * 3) * 1024 ** 3,
    total_tx: (3 + i) * 1024 ** 3,
    month_rx: (1.2 + i * 0.4) * 1024 ** 3,
    month_tx: (0.4 + i * 0.1) * 1024 ** 3,
    swap_total: node.swap_total,
    swap_used: node.swap_total ? Math.round(node.swap_total * 0.12) : 0,
    tcp: 120 + i * 40,
    udp: 20 + i * 7,
    procs: 90 + i * 17,
  };
}

const nowSec = () => Math.floor(Date.now() / 1000);

function nodeView(node) {
  const online = ONLINE.has(node.id);
  const m = online ? metricsFor(node) : null;
  return {
    id: node.id,
    name: node.name,
    sort: node.id,
    public: true,
    online,
    country: node.region,
    public_remark: node.public_remark,
    last_seen: online ? nowSec() : nowSec() - 3600 * 7,
    last_seen_ago: online ? 0 : 3600 * 7,
    metrics: m,
    os: node.os,
    kernel: node.kernel,
    arch: node.arch,
    virt: node.virt,
    cpu_name: node.cpu_name,
    cpu_cores: node.cpu_cores,
    mem_total: node.mem_total,
    swap_total: node.swap_total,
    disk_total: node.disk_total,
    price: node.price,
    currency: node.currency,
    billing_cycle: node.billing_cycle,
    expires_at: new Date(Date.now() + 86400e3 * (30 + node.id * 5)).toISOString(),
    expires_in: 30 + node.id * 5,
    traffic_limit: 0,
    traffic_mode: '',
    traffic_reset_day: 1,
    total_rx: m ? m.total_rx : 0,
    total_tx: m ? m.total_tx : 0,
    month_rx: m ? m.month_rx : 0,
    month_tx: m ? m.month_tx : 0,
    day_rx: node.day_rx,
    day_tx: node.day_tx,
  };
}

const PING_TASKS = [
  { id: 1, name: '上海移动' },
  { id: 2, name: '北京联通' },
];

function pingSeries(nodeId, hours = 1, t = Date.now()) {
  const step = 60 * 1000;
  const since = t - hours * 3600 * 1000;
  const ping = [];
  const loss = {};
  for (const task of PING_TASKS) {
    let lost = 0, total = 0;
    for (let ts = since; ts <= t; ts += step) {
      const base = task.id === 1 ? 95 : 155;
      const wave = 30 * Math.sin(ts / 900000 + task.id + nodeId);
      let v = Math.round(base + wave + (Math.random() * 14 - 7));
      // 节点 2（香港）对北京联通丢包多一点；其余基本不丢
      if (task.id === 2 && nodeId === 2 && Math.random() < 0.08) v = -1;
      total += 1;
      if (v < 0) { lost += 1; ping.push({ task_id: task.id, ts: Math.floor(ts / 1000), latency: null }); }
      else ping.push({ task_id: task.id, ts: Math.floor(ts / 1000), latency: v });
    }
    loss[task.id] = total ? Math.round(lost / total * 1000) / 10 : 0;
  }
  return { ping, probes: Object.fromEntries(PING_TASKS.map((t2) => [t2.id, t2.name])), loss };
}

function loadRows(hours = 24, t = Date.now()) {
  const step = 5 * 60 * 1000;
  const rows = [];
  for (let ts = t - hours * 3600 * 1000; ts <= t; ts += step) {
    const k = Math.abs(Math.sin(ts / 500000));
    rows.push({
      ts: Math.floor(ts / 1000),
      cpu: 8 + 60 * k,
      load: [0.4 + 1.4 * k, 0.3 + 1.1 * k, 0.2 + 0.9 * k],
      mem_total: 8 * 1024 ** 3,
      mem_used: 2 * 1024 ** 3 + 3 * 1024 ** 3 * k,
      swap_total: 2 * 1024 ** 3,
      swap_used: 0.2 * 1024 ** 3,
      disk_total: 80 * 1024 ** 3,
      disk_used: 20 * 1024 ** 3,
      net_rx: 800e3 + 400e3 * k,
      net_tx: 200e3 + 100e3 * k,
      tcp: Math.round(100 + 40 * k),
      udp: 20,
      procs: 120,
    });
  }
  return rows;
}

const json = (res, body, status = 200) => {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, 'cache-control': 'no-store' });
  res.end(data);
};

function api(req, res, pathname, query) {
  if (pathname === '/api/me') {
    return json(res, {
      authed: false,
      github: false,
      site_name: '探针鸡农场 · Mock',
      public_page: !CLOSED,
      history_days: 30,
    });
  }
  if (pathname === '/api/themes/niwatori/config') {
    return json(res, {
      showWeb: true,
      geese: 2,
      dogs: 1,
      hotCpu: 55,
      hotMem: 85,
      hotMax: 0,
      sky: THEME_SKY,
      sound: THEME_SOUND,
    });
  }
  if (pathname === '/api/nodes') {
    if (CLOSED) return json(res, { error: 'unauthorized' }, 401);
    return json(res, { nodes: NODES.map(nodeView) });
  }
  const m = pathname.match(/^\/api\/nodes\/(\d+)\/metrics$/);
  if (m) {
    if (CLOSED) return json(res, { error: 'unauthorized' }, 401);
    const id = Number(m[1]);
    if (!NODES.some((n) => n.id === id)) return json(res, { error: 'not found' }, 404);
    const hours = Math.max(1, Math.min(168, Number(query.get('hours') || 1)));
    const ping = pingSeries(id, Math.min(hours, 24));
    if (query.get('series') === 'ping') return json(res, ping);
    return json(res, { metrics: loadRows(hours), ...ping });
  }
  return json(res, { error: `mock: 没有这个接口 ${pathname}` }, 404);
}

// ---------- 静态文件 ----------
const indexPath = join(ROOT, 'index.html');
async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const full = normalize(join(ROOT, rel));
  if (!full.startsWith(normalize(ROOT))) return null;
  try {
    const st = await stat(full);
    if (!st.isFile()) return null;
    const body = await readFile(full);
    res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream', 'content-length': body.length });
    res.end(body);
    return true;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url.pathname, url.searchParams);
  const hit = await serveStatic(res, url.pathname);
  if (hit) return;
  // SPA 回退：/nodes、/node/1 这类没有扩展名的路径都回 index.html
  if (!extname(url.pathname)) {
    const body = await readFile(indexPath);
    res.writeHead(200, { 'content-type': MIME['.html'], 'content-length': body.length, 'cache-control': 'no-store' });
    return res.end(body);
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock Monitor hub → http://127.0.0.1:${PORT}/  (dist: ${ROOT})`);
  console.log(`设置：sky=${THEME_SKY} sound=${THEME_SOUND ? 'on' : 'off'}${CLOSED ? ' public_page=false' : ''}`);
});
