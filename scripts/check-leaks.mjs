// 脱敏自检：公开仓库里不许出现「本机 / 私有站点」的痕迹。
//
//   npm run check:leaks            # 扫工作区（已跟踪 + 未忽略的新文件）+ 全部提交信息
//
// 两类判据：
//   1. 通用形态（永远生效）：本机绝对路径（C:\Users\…、/opt/…、/var/www…）、
//      非 noreply 的邮箱、局域网/公网 IPv4、ssh 别名与 root@host、-p 233 这类运维痕迹。
//   2. 站点专属词表：读仓库根目录的 `.leaklist`（**不入库**，见 .gitignore）。
//      一行一个，`#` 开头是注释，`/…/` 包起来按正则、否则按不区分大小写的子串。
//      别的机器上没有这份文件时自动跳过，只跑通用形态。
//
// 为什么名单要放本地文件：把「不能出现的域名」写进脚本本身，等于把域名再公开一遍。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'release']);

// ---------- 通用形态 ----------
// 已知误报：命中这些形态的行不再算泄漏（example.com 这类占位符、GitHub 的 noreply 地址、图标文件名）
const WHITELIST = [
  /@example\.(com|org|net)\b/i,
  /git@github\.com:/,
  /icon@2x\./i,
  /[\w.-]+@users\.noreply\.github\.com/i,
  /https?:\/\/(www\.)?(github\.com|creativecommons\.org|polyfork\.dev|threejs\.org|flagcdn\.com|flagpedia\.net|komari\.wiki|nezha\.wiki)\//i,
];

const GENERIC = [
  // Windows 用户目录：正斜杠、反斜杠、file:/// 都要认（以前只认反斜杠，C:/Users/… 从缝里漏了）
  { name: 'Windows 用户目录', re: /[A-Za-z]:[\\/]{1,2}Users[\\/][^\\/\s"']+/i },
  { name: 'file:// 本机路径', re: /file:\/\/\/?[A-Za-z]:?\/?Users\//i },
  { name: 'WSL 挂载路径', re: /\/mnt\/[a-z]\/Users\/[^\/\s"']+/i },
  { name: '服务器绝对路径', re: /(^|[\s"'(])\/(opt|var\/www|root|etc\/nginx|home\/[a-z]+)(\/|\b)/ },
  { name: '本机绝对路径', re: /(^|[\s"'(])\/(Users|home)\/[a-z0-9._-]+\//i },
  { name: '家目录简写', re: /(^|[\s"'(])~\/[a-z0-9._-]+\//i },
  { name: '邮箱（非 noreply）', re: /\b[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i },
  { name: 'IPv4 字面量', re: /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(?!192\.0\.2\.)(?!198\.51\.100\.)(?!203\.0\.113\.)([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\b/ },
  { name: '运维命令痕迹', re: /\b(ssh\s+-[a-zA-Z]*\s*-?[pP]\s*233|root@[a-z0-9.-]+\.[a-z]{2,}|systemctl\s+(reload|restart)\s+(nginx|caddy))\b/i },
];

// ---------- 站点专属词表 ----------
function loadList() {
  const file = join(ROOT, '.leaklist');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      // re:… 才是正则，其余一律按字面量（"/opt/monitor" 曾被当成 /opt/i，误报一片）
      if (l.startsWith('re:')) return { name: `词表 ${l}`, re: new RegExp(l.slice(3), 'i'), isRe: true };
      return { name: `词表 ${l}`, re: new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
    });
}

// ---------- 文件枚举 ----------
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
/** git 不可用时（没装 git、源码 zip、沙箱拒子进程）返回 null —— 脱敏自检不该因此拦住发版。 */
function gitSafe(args) {
  try { return git(args); } catch { return null; }
}

const LOCAL_ONLY = new Set(['.leaklist', '.gitignore', '.gitattributes', '.DS_Store']);
function walk(dir, prefix = '', out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || LOCAL_ONLY.has(e.name)) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) walk(join(dir, e.name), rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

function listFiles() {
  const query = ['ls-files'];
  const tracked = gitSafe(query);
  if (tracked == null) {
    console.log('· 没有可用的 git：改成遍历工作区（跳过 .git/node_modules/release）');
    return walk(ROOT);
  }
  const untracked = gitSafe(['ls-files', '--others', '--exclude-standard']) || '';
  return [...new Set([...tracked.split('\n'), ...untracked.split('\n')])].filter(Boolean).filter((f) => {
    const top = f.split('/')[0];
    if (SKIP_DIRS.has(top)) return false;
    try { return statSync(join(ROOT, f)).isFile(); } catch { return false; }
  });
}

const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

// ---------- 扫描 ----------
const listRules = loadList();
const hits = [];
const SELF = 'scripts/check-leaks.mjs';        // 本文件里有"反例"注释，别扫自己

for (const rel of listFiles()) {
  if (rel === SELF) continue;
  const full = join(ROOT, rel);
  const buf = readFileSync(full);
  const binary = isBinary(buf);
  // 二进制（png/glb）只做词表字面量搜索；通用形态（邮箱/IP 正则）在字节噪声里必然误报
  const rules = binary ? listRules.filter((r) => !r.isRe) : [...listRules, ...GENERIC];
  if (!rules.length) continue;
  const text = binary ? buf.toString('latin1') : buf.toString('utf8');
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!rule.re.test(line)) continue;
      if (WHITELIST.some((w) => w.test(line))) continue;     // 占位符/公开链接/图标名不算泄漏
      hits.push({ where: `${rel}:${i + 1}`, rule: rule.name, text: line.trim().slice(0, 120) });
      break;                       // 一条规则每个文件只报一次
    }
  }
}

// 提交信息也算「公开出去的文字」
const allRules = [...listRules, ...GENERIC];
// 作者/提交者邮箱也算公开信息（%B 只是正文，以前没扫 %an/%ae）
const log = gitSafe(['log', '--all', '--format=%H%x09%an <%ae>%x09%B']);
const commitsScanned = log != null;
if (!commitsScanned) console.log('· 没有可用的 git：跳过提交信息扫描');
else
for (const block of log.split('\n\n')) {
  const [head, ...rest] = block.split('\n');
  if (!head) continue;
  const sha = head.split('\t')[0].slice(0, 8);
  const meta = head.split('\t')[1] || '';
  const msg = [meta, ...rest].join('\n');
  if (WHITELIST.some((w) => w.test(msg))) continue;
  for (const rule of allRules) {
    if (rule.re.test(msg)) hits.push({ where: `commit:${sha}`, rule: rule.name, text: msg.trim().split('\n')[0].slice(0, 120) });
  }
}

// ---------- 报告 ----------
if (!hits.length) {
  const filesCount = listFiles().length;
  console.log(`· 脱敏自检：${filesCount} 个文件 + ${commitsScanned ? '全部提交信息' : '（提交信息已跳过）'}，${allRules.length} 条判据，零命中 ✓`);
  if (!existsSync(join(ROOT, '.leaklist'))) console.log('  （没找到 .leaklist，只跑了通用形态）');
  process.exit(0);
}

console.error(`✗ 脱敏自检发现 ${hits.length} 处可疑内容：`);
for (const h of hits) console.error(`  [${h.rule}] ${h.where}\n      ${h.text}`);
console.error('\n处理：换成占位符（example.com / 127.0.0.1 / <主机别名>），或把该词加进 .leaklist 之外的豁免白名单。');
process.exit(1);
