// 主题路由层：把农场 / 探针列表 / 节点详情做成真正的地址（History API + Monitor 的 SPA 回退）。
//
//   /               农场（3D 场景，默认页）
//   /nodes          探针列表（悬浮层，复用农场里那块 #plist 面板；农场在后面暂停并模糊）
//   /node/<id>      节点详情（同一块悬浮层，放宽到 1160px；图表、时间范围、页签都在）
//
// 说明：
//   · 列表与详情不是另做一套 UI —— 就是 cyber-probe 原本的面板：两者都是悬浮层，
//     详情只是把面板放宽/放高一点，农场始终在背后暂停并模糊。
//   · 农场渲染在列表页暂停（api.setPaused），数据轮询照旧；回到农场继续。
//   · Monitor hub 找不到静态文件时会回 index.html，所以刷新 /node/123 也能直接进详情。

const api = window.__probeTheme;
if (api) start();

function start() {
  const hud = api.hud;
  const farm = api.farm;
  const baseTitle = document.title;
  const $ = (id) => document.getElementById(id);

  let applying = false;
  let route = { view: 'farm' };

  // ---------- 地址解析 ----------
  function parse() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/index.html') return { view: 'farm' };
    if (p === '/nodes') return { view: 'nodes' };
    const m = p.match(/^\/node\/([^/]+)$/);
    if (m) {
      try { return { view: 'detail', key: decodeURIComponent(m[1]) }; } catch { return { view: 'nodes' }; }
    }
    return { view: 'farm' };
  }
  const nodeKey = (n) => String(n.id);

  // 自维护的地址栈：用来识别「replace 之后会和上一条重复」的情况（见 push）
  let trail = [location.pathname];
  function push(path, replace = false) {
    if (location.pathname === path) return;
    // ★ 详情按 Esc 回列表时走 replace，栈会变成 [/, /nodes, /nodes] ——
    //   浏览器的「后退」落在同一 URL 上，画面不变，看着像失灵。
    //   这种「replace 目标和上一条相同」的情况改成 back()：栈收回 [/, /nodes]，后退就回农场。
    if (replace && trail.length >= 2 && trail[trail.length - 2] === path) {
      trail.pop();
      try { history.back(); } catch { /* 没有 History API */ }
      return;
    }
    try {
      history[replace ? 'replaceState' : 'pushState']({}, '', path);
      if (replace) trail[trail.length - 1] = path;
      else trail.push(path);
    } catch { /* 极老的浏览器没有 History API：地址栏不跟手，功能照旧 */ }
  }

  // ---------- 节点解析（详情深链要等第一轮数据）----------
  function waitNodes(ms = 9000) {
    if (farm.nodes.length) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const off = farm.onChange(() => { if (!done) { done = true; off(); resolve(); } });
      setTimeout(() => { if (!done) { done = true; off(); resolve(); } }, ms);
    });
  }
  async function resolveNode(key) {
    await waitNodes();
    // Monitor 的节点 id 是数字；uuid 是 Komari 那种多源后端的兼容写法（本主题不启用，但留着不碍事）。
    return farm.nodes.find((n) => String(n.id) === key || (n.uuid && String(n.uuid) === key)) || null;
  }

  // ---------- 路由 → 界面 ----------
  let applyGen = 0;
  async function apply(next, { ui = true } = {}) {
    const gen = ++applyGen;
    route = next;
    applying = true;
    try {
      document.body.classList.toggle('route-farm', next.view === 'farm');

      if (next.view === 'farm') {
        api.setPaused(false);
        if (ui && hud.probesOpen) hud.hideProbes();
        document.title = baseTitle;
        return;
      }

      api.setPaused(true);
      if (ui && !hud.probesOpen) hud.showProbes();

      if (next.view === 'nodes') {
        if (ui && hud.view === 'detail') hud.backToList();
        document.title = '探针列表 · ' + baseTitle;
        return;
      }

      // detail
      const node = await resolveNode(next.key);
      if (gen !== applyGen) return;      // 等数据期间用户又点了别的：这次 apply 作废
      if (!node) {
        // 节点被删了 / 深链写错了：退回列表，别停在空白详情上
        push('/nodes', true);
        route = { view: 'nodes' };
        if (ui && hud.view === 'detail') hud.backToList();
        document.title = '探针列表 · ' + baseTitle;
        return;
      }
      document.title = `${node.name} · ${baseTitle}`;
      if (ui) {
        if (!hud.probesOpen) hud.showProbes();
        hud.showDetail({ kind: 'probe', nodeId: node.id });
      }
    } finally {
      if (gen === applyGen) applying = false;
    }
  }

  // 用户操作已经改过界面时，只同步「地址栏 + 暂停状态 + body class」，不再重复开合面板
  function follow(next) {
    if (applying) {
      // 用户已经改过界面：让在途的 apply 作废（否则它回来会把面板/标题改回去）
      applyGen++;
      applying = false;
    }
    const sameView = route.view === next.view && (next.view !== 'detail' || route.key === next.key);
    if (sameView) return;
    route = next;
    document.body.classList.toggle('route-farm', next.view === 'farm');
    api.setPaused(next.view !== 'farm');
    // 标题跟着视图走（以前只有回农场才写，进详情后标签页还写着「探针列表」）
    if (next.view === 'farm') document.title = baseTitle;
    else if (next.view === 'nodes') document.title = '探针列表 · ' + baseTitle;
    else {
      const n = farm.nodeById(next.key);
      document.title = n ? `${n.name} · ${baseTitle}` : '探针详情 · ' + baseTitle;
    }
  }

  // ---------- 把 hud 的动作接到地址栏 ----------
  // 用包装而不是改 hud.js：面板仍是原版那份代码，主题只加一层「地址随手势走」。
  const orig = {
    showProbes: hud.showProbes.bind(hud),
    hideProbes: hud.hideProbes.bind(hud),
    backToList: hud.backToList.bind(hud),
    showDetail: hud.showDetail.bind(hud),
  };

  hud.showProbes = function (...args) {
    orig.showProbes(...args);
    if (applying) return;
    push('/nodes', route.view === 'detail');
    follow({ view: 'nodes' });
  };
  hud.hideProbes = function (...args) {
    orig.hideProbes(...args);
    if (applying) return;
    push('/');
    follow({ view: 'farm' });
  };
  hud.backToList = function (...args) {
    orig.backToList(...args);
    if (applying) return;
    push('/nodes', true);
    follow({ view: 'nodes' });
  };
  hud.showDetail = function (target, ...rest) {
    const p = orig.showDetail(target, ...rest);
    if (!applying && target && target.kind === 'probe') {
      const n = farm.nodeById(target.nodeId);
      if (n) { push(`/node/${nodeKey(n)}`); follow({ view: 'detail', key: nodeKey(n) }); }
    }
    return p;
  };

  // ---------- 键盘：Tab 在农场 ⇄ 列表之间走 ----------
  // 用捕获阶段拦下，别让 main.js 的 Tab 处理再 toggle 一次（否则会开了又关）。
  addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    // ⚠ 这里不要做「焦点在面板里就放行」：main.js 的全局 Tab 处理器没有同样的判断，
    //   放行后事件继续冒泡、面板照样被 toggle —— 那个判断是无效改动，已撤回。
    //   Tab 的语义由站长定：农场 ⇄ 列表直接开关（关闭也可以按 Esc / ✕）。
    // 详情里按 Tab ＝ 回列表（和 Esc 的「详情 → 列表」一致，而不是一路跳回农场）
    if (hud.view === 'detail' && hud.probesOpen) {
      e.preventDefault();
      e.stopPropagation();
      orig.backToList();
      push('/nodes', true);
      follow({ view: 'nodes' });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (route.view === 'farm') {
      orig.showProbes();
      push('/nodes');
      follow({ view: 'nodes' });
    } else {
      orig.hideProbes();
      push('/');
      follow({ view: 'farm' });
    }
  }, true);

  // ---------- 农场顶栏的站名 ----------
  // 农场是首页，访客得知道这是谁的站点；站名来自 /api/public，不写死在主题里。
  const topbar = document.getElementById('topbar');
  if (topbar) {
    const brand = document.createElement('a');
    brand.className = 'theme-brand';
    brand.href = '/';
    brand.title = '回到农场';
    const bird = document.createElement('span');
    bird.textContent = '🐔';
    const name = document.createElement('b');
    name.textContent = (window.CP_THEME && window.CP_THEME.siteName) || '探针农场';
    brand.append(bird, name);
    topbar.insertBefore(brand, topbar.firstChild);
  }
  // 页脚署名：弹层模式里也看得见（主题要求保留）
  const credit = $('theme-credit');
  if (credit) credit.classList.remove('hidden');

  // ---------- 浏览器前进 / 后退 ----------
  addEventListener('popstate', () => {
    // 地址栏动了（前进/后退）：本地栈跟着同步，否则后面的 replace 判断会用错基准
    const p = location.pathname;
    const at = trail.lastIndexOf(p);
    if (at >= 0) trail = trail.slice(0, at + 1);
    else trail.push(p);
    apply(parse());
  });

  // 首次进入：把地址对应的界面摆好
  apply(parse());
}
