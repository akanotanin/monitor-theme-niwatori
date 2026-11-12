// 主题引导：先读 Monitor hub 的公开接口，把站点设置写进 window.CP_OPTIONS / window.CP_THEME，
// 再加载农场主模块。
//
// 顺序很重要：js/data.js 在模块求值时就读 window.CP_OPTIONS（暴躁鸡阈值），
// 静态 import 会提前求值，所以这里用「await 设置 → 再 dynamic import」。
//
// Monitor 主题约定（hub 1.6.0 起）：
//   · /api/me 返回 { authed, site_name, public_page, history_days }；
//   · 主题的 config 表单保存在 /api/themes/<short>/config（一个站一份，GET 读、PUT 写）；
//   · public_page 关掉且没登录时，hub 对所有公开接口回 401 / 不显示状态页。

const SHORT = 'niwatori';

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

function asNum(v, d, min, max) {
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

async function getJSON(path) {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
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

  let me = null;
  let meStatus = 0;
  try {
    me = await getJSON('/api/me');
  } catch (e) {
    meStatus = Number(e.status) || 0;
  }

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
    lockScreen({
      title: '状态页未对访客开放',
      body: '站点已关闭公开状态页，请先登录后再查看服务器状态。',
      login: true,
    });
    return;
  }
  if (!me && meStatus === 401) {
    lockScreen({
      title: '需要登录',
      body: '这个站点只对已登录的访客开放，请先登录。',
      login: true,
    });
    return;
  }

  // 标签页标题：hub 的站名（Monitor 主题的惯例是「站名」而不是固定字）。
  document.title = siteName || 'Monitor';

  try {
    // ?v=… 让升级后拿到新代码（主题静态文件默认会被浏览器缓存）
    await import('./main.js?v=1.0.4');
    await import('./theme-shell.js?v=1.0.4');
  } catch (e) {
    console.error(e);
    lockScreen({
      title: '农场没有启动',
      body: `浏览器没能加载 3D 场景（可能需要 WebGL）。${String((e && e.message) || e)}`,
      login: false,
    });
  }
}

// 浏览器里才自动启动；Node 里（scripts/check.mjs 核对默认值）只取导出的纯函数。
if (typeof document !== 'undefined') start();
