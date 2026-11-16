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

  const refs = [...index.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (!ref || ref.startsWith('#') || ref.startsWith('http') || ref.startsWith('//')) continue;
    if (ref.startsWith('/')) continue;             // 站内绝对路径交给 hub 路由（/admin/、/favicon 等）
    const p = join(DIST, ref.replace(/^\.\//, '').replace(/[?#].*$/, ''));
    if (!existsSync(p)) err(`dist/index.html: 引用的文件不存在：${ref}`);
  }
  ok('index.html 的本地资源引用都存在');
}

// ---------- 模块 ----------
for (const f of REQUIRED_JS) {
  if (!existsSync(join(DIST, 'js', f))) err(`dist/js/${f} 不存在`);
}
if (!existsSync(join(DIST, 'vendor/three.module.js'))) err('dist/vendor/three.module.js 不存在（3D 引擎）');
else ok('3D 引擎与主题模块齐全');

// ---------- 模块图闭包 + 语法检查（2026-11-17 加）----------
// 以前这里只核对 REQUIRED_JS 里的 13 个文件名：删掉 glb-models.js（models.js 静态 import 它）、
// 删一个 addon、改模块名、importmap 指错路径、给模块写进语法错误 —— check 全部 exit=0，
// 而这些正是最常见的坏包形态（审查 M12）。现在从 index.html 的入口把整张模块图走一遍，
// 再对每个自研模块跑 node --check。
const moduleFiles = [];
{
  const IMPORTMAP = { three: 'vendor/three.module.js', 'three/addons/': 'vendor/addons/' };
  const seen = new Set();
  const missing = [];
  const badSpec = [];
  const queue = [];
  const push = (rel) => { if (rel && !seen.has(rel)) queue.push(rel); };

  // 入口 1：index.html 里的本地 <script src>
  for (const m of index.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const ref = m[1].split(/[?#]/)[0].replace(/^\.\//, '');
    if (ref && !ref.startsWith('http') && !ref.startsWith('/')) push(ref);
  }
  // 入口 2：importmap 的目标
  for (const v of Object.values(IMPORTMAP)) if (!existsSync(join(DIST, v))) missing.push(v);
  // 入口 3：theme-boot 动态 import 的模块（字符串不在静态 import 里也能被扫到）
  for (const m of index.matchAll(/import\s*\(\s*['"]\.?\/?([^'"?]+\.js)/g)) push(m[1]);

  const resolveRef = (spec, from) => {
    const s = spec.split(/[?#]/)[0];
    if (s.startsWith('./') || s.startsWith('../')) return relative(DIST, join(DIST, dirname(from), s));
    if (IMPORTMAP[s]) return IMPORTMAP[s];
    for (const [k, v] of Object.entries(IMPORTMAP)) if (k.endsWith('/') && s.startsWith(k)) return v + s.slice(k.length);
    return null;
  };

  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const full = join(DIST, rel);
    if (!existsSync(full)) { missing.push(rel); continue; }
    if (rel.startsWith('vendor/')) continue;        // vendored（three/addons）只看在不在，不解析内部
    moduleFiles.push(rel);
    const src = await readFile(full, 'utf8');
    const re = /(?:^|[^\w$.])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1] || m[2];
      if (!spec || /^(data:|https?:)/.test(spec)) continue;
      const to = resolveRef(spec, rel);
      if (!to) { badSpec.push(`${rel} → ${spec}`); continue; }
      if (!existsSync(join(DIST, to))) missing.push(`${to}（被 ${rel} 引用）`);
      else push(to);
    }
    // 还有一类 import 是拼出来的（theme-boot 的 `load('./main.js')` → import(`${path}?v=`))：
    // 把源码里出现的相对 .js 字符串字面量也当成入口展开。不存在的只忽略 —— 注释里也可能写路径。
    for (const m of src.matchAll(/['"](\.{1,2}\/[\w./-]+\.js)(?:\?[^'"]*)?['"]/g)) {
      const to = resolveRef(m[1], rel);
      if (to && existsSync(join(DIST, to))) push(to);
    }
  }
  if (missing.length) err(`模块图缺文件：${[...new Set(missing)].slice(0, 6).join('、')}${missing.length > 6 ? ' …' : ''}`);
  if (badSpec.length) err(`模块图里有解析不了的 import（既不是相对路径也不是 importmap）：${badSpec.slice(0, 4).join('、')}`);

  // 语法检查：ESM 语法错（多写/少写括号、注释吞掉语句）在浏览器里就是整页白屏
  const syn = [];
  for (const rel of moduleFiles) {
    try {
      execFileSync(process.execPath, ['--check', join(DIST, rel)], { stdio: 'pipe' });
    } catch (e) {
      const line = String(e.stderr || e.message || '').split('\n').find((l) => /Error|error/.test(l)) || '语法错误';
      syn.push(`${rel}：${line.trim().slice(0, 120)}`);
    }
  }
  if (syn.length) err(`node --check 失败：\n    ${syn.join('\n    ')}`);
  if (!missing.length && !badSpec.length && !syn.length) ok(`模块图 ${moduleFiles.length} 个模块、语法检查全部通过`);
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
    let src;
    try { src = await readFile(join(DIST, rel), 'utf8'); } catch { continue; }
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
console.log('\n✓ 自检通过');

async function dirSize(dir) {
  let sum = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    sum += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return sum;
}
