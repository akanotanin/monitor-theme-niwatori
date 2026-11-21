// 主题自检：不开浏览器也能发现 90% 的打包错误。
//
//   node scripts/check.mjs
//
// 检查项：
//   1. theme.json：short / version / preview / config 的结构与默认值；
//   2. theme-boot.js：SHORT 与 theme.json 一致、默认值与后台表单一致、数据源是 monitor；
//   3. index.html：Monitor 的标题占位、base、主题署名、资源引用都存在；
//   4. 主题模块齐全（boot / main / shell / solo / 数据层 / 3D 引擎）；
//   5. 国旗图是否齐全；6. 没有残留的 Komari 清单或 /api/public 依赖。

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 顶层兜底：缺文件/权限问题不该只甩一段裸栈，至少告诉人「自检没跑完」
process.on('uncaughtException', (e) => {
  console.error(`\n✗ 自检异常退出（不是断言失败）：${(e && e.message) || e}`);
  process.exit(1);
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const errors = [];
const notes = [];
const err = (msg) => errors.push(msg);
const ok = (msg) => notes.push(msg);
const text = (v) => (typeof v === 'string' ? v : v && (v['zh-CN'] || v.en || Object.values(v)[0]));

const REQUIRED_JS = [
  'theme-boot.js', 'theme-shell.js', 'solo.js', 'main.js', 'config.js',
  'data.js', 'komari.js', 'hud.js', 'npc.js', 'goose.js', 'dog.js', 'world.js', 'chicken.js',
];

// ---------- theme.json ----------
let manifest;
try {
  manifest = JSON.parse(await readFile(join(ROOT, 'theme.json'), 'utf8'));
} catch (e) {
  err(`theme.json 读不出来：${e.message}`);
}

/** Monitor 后台对一格设置「能不能装下这个默认值」的同一套判断（web-admin 的 fits()）。 */
function fits(field, value) {
  switch (field.type) {
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value)
      && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
    case 'select': return !!field.options?.some((o) => o.value === value);
    default: return typeof value === 'string';
  }
}

if (manifest) {
  if (!text(manifest.name)) err('theme.json: 缺 name');
  if (!manifest.short) err('theme.json: 缺 short');
  else if (!/^[A-Za-z0-9_-]+$/.test(manifest.short)) err(`theme.json: short 只能含字母/数字/_/-，当前 "${manifest.short}"`);
  else if (manifest.short.toLowerCase() === 'default') err('theme.json: short 不能是 default');
  if (!/^\d+\.\d+\.\d+/.test(String(manifest.version || ''))) err('theme.json: version 建议语义化（x.y.z）');
  if (!text(manifest.description)) err('theme.json: 缺 description');
  if (!manifest.author) err('theme.json: 缺 author');
  if (manifest.preview && !existsSync(join(ROOT, manifest.preview))) err(`theme.json: preview 指向的文件不存在：${manifest.preview}`);
  else if (manifest.preview) ok(`preview → ${manifest.preview}`);

  const config = Array.isArray(manifest.config) ? manifest.config : [];
  if (config.some((c) => c && c.key === 'models')) err('精细模型是强制开启的，theme.json 不应再有 models 开关');
  else ok('精细模型强制开启（无后台开关）');
  if (!config.length) err('theme.json: 缺 config（农场需要可在后台调的设置）');
  const keys = new Set();
  const titles = [];
  for (const [i, item] of config.entries()) {
    if (!item || typeof item !== 'object') { err(`config[${i}] 不是对象`); continue; }
    if (item.type === 'title') {
      if (typeof item.label !== 'string' || !item.label) err(`config[${i}]（title）缺 label`);
      else titles.push(item.label);
      continue;
    }
    const allowed = ['string', 'text', 'number', 'boolean', 'select'];
    if (!allowed.includes(item.type)) { err(`config[${i}] 类型不认识：${item.type}`); continue; }
    if (!item.key) { err(`config[${i}] 缺 key`); continue; }
    if (keys.has(item.key)) err(`config: key 重复：${item.key}`);
    keys.add(item.key);
    if (typeof item.label !== 'string' || !item.label) err(`config.${item.key} 缺 label（后台那一格会长成空白）`);
    if (item.help !== undefined && typeof item.help !== 'string') err(`config.${item.key} 的 help 必须是字符串`);
    if (item.type === 'select') {
      const opts = Array.isArray(item.options) ? item.options : [];
      if (!opts.length || opts.some((o) => !o || typeof o.value !== 'string' || !o.value)) {
        err(`config.${item.key} 的 options 必须是非空 [{value,label}] 数组`);
      }
    }
    if (item.type === 'number' && ((item.min !== undefined && typeof item.min !== 'number')
      || (item.max !== undefined && typeof item.max !== 'number'))) {
      err(`config.${item.key} 的 min/max 必须是数字`);
    }
    if (!fits(item, item.default)) err(`config.${item.key} 的 default 装不进这一格（type=${item.type}）`);
  }
  if (keys.size) ok(`设置项 ${keys.size} 个：${[...keys].join(', ')}${titles.length ? `；分节 ${titles.length} 个` : ''}`);

  // 与 theme-boot 的 SHORT / DEFAULTS 对账
  const bootSrc = await readFile(join(DIST, 'js/theme-boot.js'), 'utf8');
  const shortMatch = bootSrc.match(/const SHORT = ['"]([^'"]+)['"]/);
  if (!shortMatch) err('theme-boot.js: 找不到 const SHORT（读 /api/themes/<short>/config 的锚点）');
  else if (shortMatch[1] !== manifest.short) err(`theme-boot.js 的 SHORT=${shortMatch[1]}，theme.json 的 short=${manifest.short}（两边必须一致）`);

  const boot = await import(pathToFileURL(join(DIST, 'js/theme-boot.js')).href);
  const runtime = boot.pickSettings({});
  const want = {};
  for (const item of config) if (item.type !== 'title') want[item.key] = item.default;
  for (const [k, v] of Object.entries(want)) {
    if (!(k in runtime)) err(`设置 ${k} 在 theme-boot 的 DEFAULTS 里没有对应项`);
    else if (JSON.stringify(runtime[k]) !== JSON.stringify(v)) {
      err(`设置 ${k} 的默认值不一致：theme.json=${JSON.stringify(v)} / 代码=${JSON.stringify(runtime[k])}`);
    }
  }
  for (const k of Object.keys(runtime)) if (!(k in want)) err(`DEFAULTS 里的 ${k} 没有在 theme.json 里声明`);
  ok('设置默认值与 theme-boot DEFAULTS 一致');
}

// ---------- 数据源 ----------
{
  const configSrc = await readFile(join(DIST, 'js/config.js'), 'utf8');
  if (!/export const SOURCE = "monitor"/.test(configSrc)) err('dist/js/config.js: SOURCE 应该是 "monitor"');
  else ok('数据源 = monitor');
  if (existsSync(join(ROOT, 'komari-theme.json'))) err('还留着 komari-theme.json —— Monitor 主题包只认 theme.json');
  if (await readFile(join(DIST, 'js/theme-boot.js'), 'utf8').then((s) => s.includes('/api/public'))) {
    err('theme-boot.js 里还有 Komari 的 /api/public —— Monitor 用 /api/themes/<short>/config');
  }
}

// ---------- index.html ----------
let index = '';
try {
  index = await readFile(join(DIST, 'index.html'), 'utf8');
} catch (e) {
  err(`dist/index.html 读不出来：${e.message}`);
}
if (index) {
  if (!index.includes('<title>Monitor</title>')) err('dist/index.html: Monitor 主题的标题占位应是 <title>Monitor</title>');
  else ok('title 占位符');
  if (!/<base href="\/">/.test(index)) err('dist/index.html: 缺 <base href="/">（SPA 深链刷新时相对路径会 404）');
  else ok('base href="/"');
  if (!/Theme:\s*<a[^>]*>Niwatori<\/a>/i.test(index)) err('dist/index.html: 缺主题署名（Theme: Niwatori）');
  else ok('主题署名');
  if (!/href="https:\/\/github\.com\/akanotanin\/monitor-theme-niwatori"/.test(index)) err('dist/index.html: Niwatori 署名链接不是主题仓库');
  else ok('署名链接 → monitor-theme-niwatori');
  if (!/<link[^>]+theme\.css/.test(index)) err('dist/index.html: 没引入 theme.css');
  if (!/type="importmap"/.test(index)) err('dist/index.html: 缺 importmap（three 的解析表）');

  // 单引号属性也要认（手写 HTML 时很常见）；站内绝对路径按 DIST 为根解析，
  // 而不是「跳到下一轮」（那样 href="/no-such.css" 永远查不出来）。
  const refs = [...index.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (!ref || ref.startsWith('#') || ref.startsWith('http') || ref.startsWith('//')) continue;
    // 已知的站内路由（不是 dist 里的文件，由 hub/反代伺服）：后台、API
    if (/^\/(admin|api)(\/|$)/.test(ref)) continue;
    const rel = ref.replace(/^\//, '').replace(/^\.\//, '').replace(/[?#].*$/, '');
    if (!rel) continue;                            // href="/"（站名链接）不算资源
    // 目录型引用（以 / 结尾）说明是路由，不是静态文件
    if (ref.endsWith('/')) continue;
    const p = join(DIST, rel);
    if (!existsSync(p)) err(`dist/index.html: 引用的文件不存在：${ref}`);
  }
  ok('index.html 的本地资源引用都存在');
}

// ---------- 模块 ----------
for (const f of REQUIRED_JS) {
  if (!existsSync(join(DIST, 'js', f))) err(`dist/js/${f} 不存在`);
}
let threeOk = false;
if (!existsSync(join(DIST, 'vendor/three.module.min.js'))) err('dist/vendor/three.module.min.js 不存在（3D 引擎）');
// 必须是官方 min 构建（dev 版 1.30 MB 会让首屏白下 600 KB+）：许可头要留着
else {
  threeOk = true;
  const three = await readFile(join(DIST, 'vendor/three.module.min.js'), 'utf8');
  if (!/@license[\s\S]{0,200}SPDX-License-Identifier: MIT/.test(three.slice(0, 400))) {
    err('dist/vendor/three.module.min.js 缺 MIT 许可头（再分发必须保留）');
  } else if (three.length > 900 * 1024) {
    err(`dist/vendor/three.module.min.js 有 ${(three.length / 1024).toFixed(0)} KB，像是 dev 构建（min 应约 671 KB）`);
  }
}
if (threeOk) ok('3D 引擎与主题模块齐全');

// 扫描前剥掉注释用的状态机（模块图与版本号扫描共用）。
// ⚠ 必须认识「正则字面量」：URI 校验最常见写法 /^https?:\/\//i 里，第二个 \/ 的 / 与
//   前一个拼成 //，会被当成行注释起点，把这一行后面的代码（含 import）整段吞掉。
//   以前就是这样漏报过不存在的模块 + 错误的 ?v=。判据：`/` 出现在「表达式位置」才是正则。
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
// `return /re/`、`typeof /re/` 这类：/ 之前是关键字而不是标识符，也算表达式位置
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
const stripComments = (src) => {
  let out = '';
  let i = 0;
  let state = null;                    // 'line' | 'block' | 'sq' | 'dq' | 'tpl' | 're' | 'reclass'
  // 上一个非空白字符：判断 `/` 是除号还是正则起点（声明后、运算符后、行首 = 正则）
  let prevSig = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'line') { if (c === '\n') { state = null; out += c; } i++; continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = null; i += 2; } else i++; continue; }
    if (state === 'reclass') {                    // 正则里的 [...]：不影响 / 的配对
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if (c === ']') state = 're';
      i++; continue;
    }
    if (state === 're') {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }   // \/ 不结束正则
      if (c === '[') { state = 'reclass'; i++; continue; }
      if (c === '/') { state = null; prevSig = '/'; }
      i++; continue;
    }
    if (state) {
      out += c;
      if (c === '\\') { out += d || ''; i += 2; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) { state = null; prevSig = c; }
      i++; continue;
    }
    if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
    if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
    if (c === '/') {
      // 只有「表达式位置」才是正则字面量：行首 / 运算符后 / 开括号后 / 关键字后。
      // 标识符、`)`、`]`、引号之后一律当除号（`a / b`、`(x) / 2`、`arr[0] / 2`）。
      // `return /re/`、`typeof /re/`、`case /re/` 这类也算表达式位置（关键字白名单）。
      let isRegexPos = prevSig === '' || REGEX_PREV.has(prevSig);
      if (!isRegexPos && /[\w$]/.test(prevSig)) {
        const word = (out.match(/[\w$]+$/) || [''])[0];
        isRegexPos = REGEX_KEYWORDS.has(word);
      }
      if (isRegexPos) { state = 're'; out += c; i++; continue; }
      out += c; prevSig = c; i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { state = c === "'" ? 'sq' : (c === '"' ? 'dq' : 'tpl'); out += c; i++; continue; }
    if (!/\s/.test(c)) prevSig = c;
    out += c; i++;
  }
  return out;
};

// 只剥 /* */ 与 // 注释时，CSS 也要用对应语法：CSS 里 url(https://…) 的 // 不是注释。
// 版本号扫描对 .css 走这条（CSS 只有块注释）。
const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------- 模块图闭包 + 语法检查（2026-11-17 加，同日二轮加固）----------
// 以前只核对 REQUIRED_JS 里的 13 个文件名：删模块、删 addon、改 importmap、写语法错都 exit=0。
// 现在从 index.html 的入口把整张模块图走一遍（importmap 以 index.html 里那份 JSON 为唯一真源），
// 对每个自研模块跑 node --check，并要求所有相对 import 都带 ?v=<当前版本>。
const moduleFiles = [];
let envBlocked = false;        // node --check 因环境限制没跑成（独立退出码）
{
  // importmap 的真源是 index.html。以前用脚本里硬编码的副本，index.html 写错路径查不出来。
  let MAP = null;
  const im = index.match(/<script[^>]+type="importmap"[^>]*>([\s\S]*?)<\/script>/i);
  if (!im) err('dist/index.html 缺 <script type="importmap">（three 的解析表）');
  else {
    try {
      const json = JSON.parse(im[1]);
      MAP = json && json.imports && typeof json.imports === 'object' ? json.imports : null;
      if (!MAP) err('dist/index.html 的 importmap 缺 imports 字段');
    } catch (e) {
      err(`dist/index.html 的 importmap 不是合法 JSON：${e.message}`);
    }
  }
  MAP = MAP || {};

  const cleanRel = (p) => String(p).replace(/^\.\//, '').split(/[?#]/)[0];
  const resolveSpec = (spec, from) => {
    const s = spec.split(/[?#]/)[0];
    if (s.startsWith('./') || s.startsWith('../')) return relative(DIST, join(DIST, dirname(from), s));
    if (MAP[s]) return cleanRel(MAP[s]);
    for (const [k, v] of Object.entries(MAP)) {
      if (k.endsWith('/') && s.startsWith(k)) return cleanRel(v + s.slice(k.length));
    }
    return null;
  };
  // 注释里出现的旧路径不该让自检失败：扫描前先按「字符串/注释」状态机剥掉注释。
  // ⚠ 不能用简单的 /\/\*[\s\S]*?\*\// ：注释里出现 /api/* 这种片段会把它当成块注释起点，
  //   一直吞到文件里下一个 */ —— 那样整张模块图会静默少掉模块（本次自测就吞掉了 komari/nezha）。

  // ⚠ 不能用一条跨语句的大正则：`[\\s\\S]*?` 没有语句边界，
  //   一条 side-effect `import './x.js'` 后面若出现任意 ` from '字面量'`（哪怕在字符串里），
  //   正则会把两者拼成一条，side-effect import 的路径被整个跳过 —— 缺文件检查静默失明。
  //   实测：`import './does-not-exist.js'` + `const t = "bundled from 'three'";` → 该文件完全不报。
  //   做法：先按「语句」切（分号/换行 + 括号深度 0），再在每条语句内部匹配 import/export。
  const splitStatements = (src) => {
    const out = [];
    let cur = '', depth = 0;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      cur += c;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      // 语句结束：深度 0 且遇到 ; 或 换行（换行后如果下一个非空字符不是 . / ? / : 等续行算新语句）
      if (depth <= 0 && c === ';') { out.push(cur); cur = ''; depth = 0; continue; }
      if (depth <= 0 && c === '\n') {
        const rest = src.slice(i + 1);
        const nextSig = rest.match(/^\s*(\S)/)?.[1] || '';
        // 续行符：`.`（链式）`?` `:` `+` `-` `*` `/` `&` `|` `=` `,` 都不算新语句
        if (!/^[.?+:+\-*/&|=,)\]]$/.test(nextSig)) { out.push(cur); cur = ''; }
      }
    }
    if (cur.trim()) out.push(cur);
    return out;
  };
  // 单条语句里的模块说明符（静态 import/export ... from '…'，含多行写法与 side-effect import）
  const SPEC_ONE = /(?:^|[^\w$.])(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]/;
  const DYN_ONE = /\bimport\s*\(\s*['"]([^'"]+)['"]/;
  const specsOf = (src) => {
    const out = [];
    for (const stmt of splitStatements(src)) {
      const m = stmt.match(SPEC_ONE) || stmt.match(DYN_ONE);
      if (m) out.push(m[1]);
    }
    return out;
  };

  const seen = new Set();
  const missing = [];
  const badSpec = [];
  const noVer = [];
  const queue = [];
  const push = (rel) => { if (rel && !seen.has(rel)) queue.push(rel); };

  // 入口 1：index.html 里的本地 <script src>
  // 站内绝对路径（/js/theme-boot.js）是完全合法的写法（<base href="/"> 下等价），
  // 以前直接跳过 → 模块图 0 个模块却打印「?v= 全部通过」。现在按 DIST 为根解析入图。
  const fromIndex = (ref) => {
    const r = cleanRel(String(ref).replace(/^\.\//, '').replace(/^\//, ''));
    if (!r || /^https?:/.test(r) || r.startsWith('//')) return null;
    // 站内绝对路径里已经含了 dist 前缀（/vendor/three.module.js）就原样用
    return r;
  };
  for (const m of index.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
    const ref = fromIndex(m[1]);
    if (ref) push(ref);
  }
  // 入口 2：theme-boot 这类「字符串传进 load()/import()」的动态入口 —— 这些是必需项，
  // 写错一个字母就必须报错（以前只在文件存在时展开，写错会静默丢整张图）。
  for (const m of index.matchAll(/['"]((?:\.{1,2}\/|\/)[\w./-]+\.js)(?:\?[^'"]*)?['"]/g)) {
    const ref = fromIndex(m[1]);
    if (ref) push(ref);
  }

  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const full = join(DIST, rel);
    if (!existsSync(full)) { missing.push(rel); continue; }
    if (rel.startsWith('vendor/')) continue;        // vendored（three/addons）只看在不在，不解析内部
    moduleFiles.push(rel);
    const raw = await readFile(full, 'utf8');
    const src = stripComments(raw);
    // 必需入口：load('./main.js') / import('./x.js') 里的相对字面量
    // （也按语句切：避免跨语句拼匹配）
    const DYN_ONE = /\b(?:load|import)\s*\(\s*['"](\.{1,2}\/[\w./-]+\.js)(?:\?[^'"]*)?['"]\s*[,)]/g;
    for (const stmt of splitStatements(src)) {
      let mm;
      DYN_ONE.lastIndex = 0;
      while ((mm = DYN_ONE.exec(stmt))) {
        const to = resolveSpec(mm[1], rel);
        if (!to) { badSpec.push(`${rel} → ${mm[1]}`); continue; }
        if (!existsSync(join(DIST, to))) missing.push(`${to}（被 ${rel} 的 load()/import() 引用）`);
        else push(to);
      }
    }
    for (const spec of specsOf(src)) {
      if (!spec || /^(data:|https?:|node:)/.test(spec)) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        if (!/[?&]v=/.test(spec)) noVer.push(`${rel} → ${spec}`);   // 升级后新旧模块混跑
      }
      const to = resolveSpec(spec, rel);
      if (!to) { badSpec.push(`${rel} → ${spec}`); continue; }
      if (!existsSync(join(DIST, to))) missing.push(`${to}（被 ${rel} 引用）`);
      else push(to);
    }
  }
  // ★ 下限断言：模块图一眼看出规模不对时（入口写成解析不了的形式、正则失效、import 全被吞）
  //   「缺文件/语法/?v= 全绿」是最危险的假绿 —— 图里只剩 3 个模块也能打印「全部通过」。
  //   REQUIRED_JS 是必须存在的自研模块清单，模块图规模小于它就说明扫描本身坏了。
  if (moduleFiles.length < REQUIRED_JS.length) {
    err(`模块图只解析出 ${moduleFiles.length} 个模块（应至少 ${REQUIRED_JS.length} 个）—— 入口识别或 import 扫描失效，`
      + `这时的「缺文件 / 语法 / ?v= 全通过」不可信`);
  }
  if (missing.length) err(`模块图缺文件：${[...new Set(missing)].slice(0, 6).join('、')}${missing.length > 6 ? ' …' : ''}`);
  if (badSpec.length) err(`模块图里有解析不了的 import（既不是相对路径也不在 importmap 里）：${badSpec.slice(0, 4).join('、')}`);
  if (noVer.length) err(`相对 import 缺 ?v=${manifest?.version}（升级后浏览器会混用新旧模块）：${[...new Set(noVer)].slice(0, 6).join('、')}`);

  // 语法检查：用 --experimental-default-type=module 明确按 ESM 解析
  // （否则 package.json 丢了 "type":"module" 时 node --check 会把 ESM 当 CJS，整道闸门静默失效）
  const syn = [];
  const envFail = [];
  for (const rel of moduleFiles) {
    try {
      execFileSync(process.execPath, ['--experimental-default-type=module', '--check', join(DIST, rel)], { stdio: 'pipe' });
    } catch (e) {
      // EPERM/ENOENT 是「跑不起来 node」，不是代码有语法错 —— 分开报，别误导排查。
      if (e && (e.code === 'EPERM' || e.code === 'ENOENT' || e.code === 'EAGAIN')) {
        envFail.push(`${rel}：${e.code}`);
        continue;
      }
      const line = String(e.stderr || e.message || '').split('\n').find((l) => /Error|error/.test(l)) || '语法错误';
      syn.push(`${rel}：${line.trim().slice(0, 120)}`);
    }
  }
  // 环境失败单独一路：受限沙箱里 node --check 全 EPERM 时，**真实语法错误和「没检查」输出完全相同**。
  // 以前这里既 err（exit 1）又 ok（打印「?v= 通过」），同一次运行自相矛盾，久了就被当成噪音忽略。
  // 现在拆成独立退出码 3：CI 里能区分「跑了但失败」与「根本没跑」。
  envBlocked = envFail.length > 0;
  if (syn.length) err(`node --check 失败：\n    ${syn.join('\n    ')}`);
  if (envFail.length) {
    console.log(`!! 环境不可用：${envFail.length} 个文件无法运行 node --check（${envFail.slice(0, 3).join('、')}）`);
    console.log('   这道门在受限沙箱里等于「没跑」—— 请在有子进程权限的机器上复验语法。');
  }
  if (!missing.length && !badSpec.length && !noVer.length && !syn.length) {
    if (envBlocked) ok(`模块图 ${moduleFiles.length} 个模块、?v= 通过（node --check 未运行，见上方环境提示）`);
    else ok(`模块图 ${moduleFiles.length} 个模块、语法检查与 ?v= 全部通过`);
  }
}
// ---------- 国旗：按清单集合比对 ----------
// 只数数量的话，删掉 cn.png 还剩 249 面 ≥ 240，检查照样通过（审查 M12）。
const FLAG_CODES = ('ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw c'
  + 'x cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq'
  + ' ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na'
  + ' nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz t'
  + 'c td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws xk ye yt za zm zw').split(/\s+/);
try {
  const flags = (await readdir(join(DIST, 'vendor/flags'))).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
  const got = new Set(flags);
  const want = new Set(FLAG_CODES);
  const miss = FLAG_CODES.filter((c) => !got.has(c));
  const extra = flags.filter((c) => !want.has(c));
  if (miss.length) err(`国旗缺 ${miss.length} 面：${miss.slice(0, 8).join(', ')}${miss.length > 8 ? ' …' : ''}`);
  else if (extra.length) err(`国旗多出清单外的 ${extra.length} 面：${extra.slice(0, 8).join(', ')}`);
  else ok(`国旗 ${flags.length} 面（与 ISO 3166-1 + XK 清单一致）`);
} catch {
  err('dist/vendor/flags 目录不存在');
}

// ---------- 版本号单源：theme.json 是唯一真源 ----------
// 版本号以前散在 15 处（theme.json / package.json / ?v= / theme-boot 的 V / README 包名），
// 没有任何一处校验一致性 —— 改漏一个就会出现「浏览器还拿旧的缓存模块」（审查 L5）。
if (manifest?.version) {
  const ver = String(manifest.version);
  const wrong = [];
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    if (pkg.version !== ver) wrong.push(`package.json=${pkg.version}`);
  } catch { wrong.push('package.json 读不出来'); }
  try {
    const boot = await readFile(join(DIST, 'js/theme-boot.js'), 'utf8');
    const bv = (boot.match(/const V = '([^']+)'/) || [])[1];
    if (bv !== ver) wrong.push(`theme-boot.js V=${bv}`);
  } catch { /* 模块图那关已经报过 */ }
  const scan = new Set([...moduleFiles, 'index.html', 'style.css', 'theme.css']);
  for (const rel of scan) {
    let raw;
    try { raw = await readFile(join(DIST, rel), 'utf8'); } catch { continue; }
    // 只看代码：注释里写「旧版是 ?v=1.0.15」不该判成版本不一致。
    // CSS 走块注释剥离：CSS 里 url(https://…) 的 // 不是行注释，用 JS 状态机会把整行吞掉
    // （同一行里跟着的 ?v=0.0.1 就查不出来了）。
    const src = rel.endsWith('.css') ? stripCssComments(raw) : stripComments(raw);
    for (const m of src.matchAll(/\?v=([0-9A-Za-z.\-]+)/g)) if (m[1] !== ver) wrong.push(`${rel} ?v=${m[1]}`);
  }
  try {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
    for (const m of readme.matchAll(/monitor-theme-niwatori-([0-9.]+)\.tar\.gz/g)) {
      if (m[1] !== ver) wrong.push(`README 包名 ${m[1]}`);
    }
  } catch { /* 没有 README 就算了 */ }
  const uniq = [...new Set(wrong)];
  if (uniq.length) err(`版本号不一致（theme.json = ${ver}）：${uniq.slice(0, 8).join('、')}`);
  else ok(`版本号一致：${ver}（${scan.size} 个 dist 文件 + package.json + README）`);
}

// ---------- 精细模型（GLB · CC BY 4.0）----------
{
  const modelIds = (await import(pathToFileURL(join(DIST, 'js/model-ids.js')).href)).MODEL_IDS;
  const dir = join(DIST, 'vendor/models');
  const missing = [];
  const badMeta = [];
  for (const id of modelIds) {
    const file = join(dir, `${id}.glb`);
    if (!existsSync(file)) { missing.push(`${id}.glb`); continue; }
    try {
      const buf = await readFile(file);
      if (buf.length < 20 || buf.subarray(0, 4).toString() !== 'glTF') throw new Error('不是 GLB');
      const len = buf.readUInt32LE(12);
      const asset = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')).asset || {};
      if (!asset.copyright || !/CC[- ]BY[- ]4\.0/i.test(JSON.stringify(asset))) badMeta.push(id);
    } catch { badMeta.push(`${id}(读不出)`); }
  }
  if (missing.length) err(`dist/vendor/models 缺 ${missing.length} 个模型：${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`);
  else ok(`精细模型 ${modelIds.length} 个（GLB）`);
  if (badMeta.length) err(`模型缺少内置 CC BY 4.0 署名元数据：${badMeta.slice(0, 5).join(', ')}`);
  else ok('模型内置署名元数据齐全（CC BY 4.0）');
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    if (manifest.count !== modelIds.length) err(`vendor/models/manifest.json 的 count=${manifest.count}，清单是 ${modelIds.length}`);
    if (!/CC BY 4\.0/.test(String(manifest.license || ''))) err('vendor/models/manifest.json 缺 CC BY 4.0 许可标记');
  } catch {
    err('缺 dist/vendor/models/manifest.json（模型清单）');
  }
}

// ---------- 输出 ----------
const size = (p) => stat(p).then((s) => s.size).catch(() => 0);
const total = await size(join(ROOT, 'theme.json')) + await size(join(ROOT, 'preview.png'));
notes.unshift(`主题：${text(manifest?.name)}  v${manifest?.version}  (short: ${manifest?.short})`);
notes.unshift(`dist 体积：${((await dirSize(DIST)) / 1024 / 1024).toFixed(2)} MB；包根文件：${(total / 1024).toFixed(0)} KB`);

console.log(notes.map((n) => `· ${n}`).join('\n'));
if (errors.length) {
  console.error('\n✗ 自检失败：');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
if (envBlocked) {
  // 断言全绿、只是 node --check 跑不起来（受限沙箱）：独立退出码，CI 里能和「真失败」区分开
  console.log('\n⚠ 断言通过，但语法门禁因环境限制未运行（exit 3）');
  process.exit(3);
}
console.log('\n✓ 自检通过');

async function dirSize(dir) {
  let sum = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    sum += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return sum;
}
