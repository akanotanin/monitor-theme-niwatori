// 主题引导：先读 Monitor hub 的公开接口，把站点设置写进 window.CP_OPTIONS / window.CP_THEME，
// 再加载农场主模块。
//
// 顺序很重要：js/data.js 在模块求值时就读 window.CP_OPTIONS（暴躁鸡阈值），
// 静态 import 会提前求值，所以这里用「await 设置 → 再 dynamic import」。
//
// Monitor 主题约定（hub 1.5.2 起）：
//   · /api/me 返回 { authed, site_name, public_page, history_days }；
//   · 主题的 config 表单保存在 /api/themes/<short>/config（一个站一份，GET 读、PUT 写）；
//   · public_page 关掉且没登录时，hub 对所有公开接口回 401 / 不显示状态页。

const SHORT = 'niwatori';

/* ------------------------------------------------------------------ *
 * 载入动画（js/loading.js）先起：纯 canvas、零依赖，必须早于 three 的模块图。
 * 它接管的元素是 #boot（原来那行提示条），进度用真实等待节点：
 *   0.08 起步 → 0.30 两个接口回来 → 0.30..0.86 由 44 个 GLB 逐个到位推进 → 1.0 首帧
 * 动画没起来（老浏览器 / 模块异常）时下面所有调用都是空操作，不影响主流程。
 * ------------------------------------------------------------------ */
let load = null;
// 浏览器里才启动；Node 里（scripts/check.mjs 会 import 这个模块核对默认值）没有 document
if (typeof document !== 'undefined') {
  try {
    // ★ 用 await import 会等模块图，但它只有一个文件、没有依赖，实际只多一次往返
    const mod = await import('./loading.js?v=1.0.20');
    load = mod.mount();
  } catch (err) {
    console.warn('[niwatori] 载入动画未启动', err);
  }
}
/** 真实进度落点（0..1）；动画没起来时静默跳过 */
const step = (v) => { try { load?.set(v); } catch { /* 装饰不参与主线 */ } };
/** 模型计数 → 进度条细粒度推进 */
const count = (ok, total, base, span) => { try { load?.count(ok, total, base, span); } catch { /* 同上 */ } };
/** 首帧就绪：让动画把 100% 那段演完再揭幕 */
const finish = (cb) => { try { load ? load.done(cb) : cb?.(); } catch { cb?.(); } };

/**
 * 手动收幕布：只在「没有 showWorld 来揭幕」的两条路径上用
 * （站点锁屏 / main.js 加载失败）。正常路径由 main.js 的 showWorld 揭幕。
 */
const dropCurtain = () => {
  const b = document.getElementById('boot');
  if (!b) return;
  // ★ 和 main.js 的正常揭幕路径一样要释放载入动画：resize/pointerdown 监听
  //   与闭包里的 Path2D 池（约 1.7 MB）否则会一直挂在 window 上。
  //   以前只在正常路径 dispose，锁屏/main.js 失败这两条异常路径照样泄漏。
  try { window.__NIWATORI_LOAD__?.dispose?.(); } catch { /* 没挂上 */ }
  b.classList.add('done');
  setTimeout(() => b.remove(), 420);
};

step(0.08);
setTimeout(() => { try { document.body.classList.add('ld-ready'); } catch { /* 纯装饰 */ } }, 700);

const DEFAULTS = {
  showWeb: true,
  geese: 2,
  dogs: 1,
  hotCpu: 55,
  hotMem: 85,
  hotMax: 0,
  sky: 'auto',
  sound: true,
};

const $ = (id) => document.getElementById(id);

function asBool(v, d) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no', ''].includes(s)) return false;
  }
  return d;
}

/** 把配置里的数字夹到区间；缺项 / 空值一律回落默认值。 */
function asNum(v, d, min, max) {
  // ★ 先挡空值再转数：Number(null) === 0、Number('') === 0，都不是 NaN。
  //   后台把数字框清空后存的是 null / ''，直接转会把「没填」夹成 min ——
  //   hotCpu=1 会让 CPU 2% 的机器全判成暴躁鸡，geese=0 会让鹅整批消失。
  //   口径与 data.js:181 的 sanitizeMetrics 一致（那里也是先挡 null/''/布尔）。
  if (v == null || v === '' || typeof v === 'boolean') return d;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** /api/themes/<short>/config 的自由 JSON → 本主题认识的设置（缺项 / 类型不对都回到默认值）。 */
export function pickSettings(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // select 的选项值现在是 auto/day/dusk；中文写法兼容手改过的配置。
  const SKY = { auto: 'auto', day: 'day', dusk: 'dusk', 自动: 'auto', 白天: 'day', 黄昏: 'dusk' };
  return {
    showWeb: asBool(s.showWeb, DEFAULTS.showWeb),
    geese: asNum(s.geese, DEFAULTS.geese, 0, 8),
    dogs: asNum(s.dogs, DEFAULTS.dogs, 0, 3),
    hotCpu: asNum(s.hotCpu, DEFAULTS.hotCpu, 1, 100),
    hotMem: asNum(s.hotMem, DEFAULTS.hotMem, 1, 100),
    hotMax: asNum(s.hotMax, DEFAULTS.hotMax, 0, 64),
    sky: SKY[s.sky] || DEFAULTS.sky,
    sound: asBool(s.sound, DEFAULTS.sound),
  };
}

// ★ 引导阶段的请求也必须带超时：反代建连后不回包时，没有超时就会永远停在
//   「正在布置农场…」—— 比数据层卡住更致命（连 main.js 都不会加载，没有任何自愈路径）。
//   超时就抛错，上面的 try/catch 会照常回落到默认值 / me=null。
const BOOT_TIMEOUT = 5000;
async function getJSON(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BOOT_TIMEOUT);
  try {
    const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 自动光照：18:00–06:00 用黄昏，其余白天（与主题设置「自动」一档一致）。 */
export function autoSky(now = new Date()) {
  const h = now.getHours();
  return h >= 18 || h < 6 ? 'dusk' : 'day';
}

function lockScreen({ title, body, login }) {
  const el = document.createElement('div');
  el.id = 'theme-lock';
  el.className = 'theme-lock';
  el.innerHTML = `
    <div class="lock-card" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div class="lock-bird" aria-hidden="true">🐔</div>
      <h1 id="lock-title"></h1>
      <p></p>
      ${login ? '<a class="lock-btn" href="/admin/">登录 Monitor</a>' : ''}
      <p class="lock-note">Theme: <a href="https://github.com/akanotanin/monitor-theme-niwatori" target="_blank" rel="noopener">Niwatori</a></p>
    </div>`;
  el.querySelector('h1').textContent = title;
  el.querySelector('p').textContent = body;
  document.body.appendChild(el);
  document.body.classList.add('is-locked');
}

async function start() {
  // 站点级设置：hub 没存过 / 老 hub 没有这个接口，都回落默认值（公开页照常渲染）。
  let settings = { ...DEFAULTS };
  try {
    settings = pickSettings(await getJSON(`/api/themes/${SHORT}/config`));
  } catch { /* 取不到就用默认值 */ }
  step(0.22);

  let me = null;
  let meStatus = 0;
  try {
    me = await getJSON('/api/me');
  } catch (e) {
    meStatus = Number(e.status) || 0;
  }
  step(0.30);

  const siteName = String((me && me.site_name) || '').trim();
  const publicPage = !me || me.public_page !== false;
  const authed = !!(me && me.authed);

  // 精细模型始终开启：模型随包分发，没有后台开关；个别模型拉不到时由 decorate 逐个降级。
  window.CP_OPTIONS = {
    showWeb: settings.showWeb,
    hotCpu: settings.hotCpu,
    hotMem: settings.hotMem,
    hotMax: settings.hotMax,
  };
  window.CP_THEME = {
    ...settings,
    // 主模块只认 day / dusk：自动档在引导层就按北京时间折好
    sky: settings.sky === 'auto' ? autoSky() : settings.sky,
    siteName,
    publicPage,
    authed,
    // 主题不提供联机服：农场永远单机 + NPC（见 README「为什么没有多人」）。
    multiplayer: false,
    // 精细模型（GLB，CC BY 4.0）始终开启，给调试/自测留个标记。
    models: true,
    adminUrl: '/admin/',
    hasMe: !!me,
    meStatus,
  };

  // 站点把公开状态页关了：没登录就只给登录入口（hub 的公开接口这会儿本来也是 401）。
  if (!publicPage && !authed) {
    finish(dropCurtain);                         // 锁屏要盖在农场幕布之上：先把幕布收掉
    lockScreen({
      title: '状态页未对访客开放',
      body: '站点已关闭公开状态页，请先登录后再查看服务器状态。',
      login: true,
    });
    return;
  }
  if (!me && meStatus === 401) {
    finish(dropCurtain);
    lockScreen({
      title: '需要登录',
      body: '这个站点只对已登录的访客开放，请先登录。',
      login: true,
    });
    return;
  }

  // 标签页标题：hub 的站名（Monitor 主题的惯例是「站名」而不是固定字）。
  document.title = siteName || 'Monitor';

  // 主题文件在升级瞬间可能还没全部就位（或 CDN 缓存了短暂 404）：
  // 动态 import 重试 3 次；theme-shell 失败不锁农场，避免「农场没启动」整页报错。
  const V = '1.0.20';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function load(path, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        return await import(`${path}?v=${V}${i ? `&r=${i}` : ''}`);
      } catch (e) {
        last = e;
        if (i < tries - 1) await sleep(450 * (i + 1));
      }
    }
    throw last;
  }

  try {
    await load('./main.js');
  } catch (e) {
    console.error(e);
    const msg = String((e && e.message) || e);
    // Three.js r169 只支持 WebGL2：把「没有上下文」翻成能照着做的提示，别只甩一行英文。
    const noGL = /webgl/i.test(msg);
    finish(() => {                              // 先演完收尾再上锁屏，别让两层面板叠在一起
      dropCurtain();
      lockScreen({
        title: noGL ? '这台浏览器没有可用的 WebGL2' : '农场没有启动',
        body: noGL
          ? '主题的 3D 农场需要 WebGL2。请先开启浏览器的「使用图形加速功能」并重启，更新显卡驱动，或换用最新版 Chrome / Edge；远程桌面或虚拟机请在宿主机启用 GPU。地址栏打开 chrome://gpu（Edge 为 edge://gpu）可查看 WebGL 状态。'
          : `浏览器没能加载 3D 场景。${msg}`,
        login: false,
      });
    });
    return;
  }

  try {
    await load('./theme-shell.js');
  } catch (e) {
    // 农场、列表按钮本身还能用；只是地址栏同步/Tab 切页失效。
    console.warn('[theme] theme-shell 加载失败，农场继续运行', e);
    setTimeout(() => {
      try { window.__probeTheme?.hud?.banner?.('列表加载失败，刷新页面重试', 6000); } catch { /* 忽略 */ }
    }, 600);
  }
}

// 浏览器里才自动启动；Node 里（scripts/check.mjs 核对默认值）只取导出的纯函数。
if (typeof document !== 'undefined') start();
