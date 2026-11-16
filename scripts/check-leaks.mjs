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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'release']);

// ---------- 通用形态 ----------
const GENERIC = [
  { name: 'Windows 用户目录', re: /[A-Za-z]:\\+Users\\+[^\\\s"']+/i },
  { name: '服务器绝对路径', re: /(^|[\s"'(])\/(opt|var\/www|root|etc\/nginx|home\/[a-z]+)(\/|\b)/ },
  { name: '本机绝对路径', re: /(^|[\s"'(])\/(Users|home)\/[a-z0-9._-]+\//i },
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

function listFiles() {
  const tracked = git(['ls-files']).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter((f) => {
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
      if (rule.re.test(lines[i])) {
        hits.push({ where: `${rel}:${i + 1}`, rule: rule.name, text: lines[i].trim().slice(0, 120) });
        break;                       // 一条规则每个文件只报一次
      }
    }
  }
}

// 提交信息也算「公开出去的文字」
const allRules = [...listRules, ...GENERIC];
const log = git(['log', '--all', '--format=%H%x09%B']);
for (const block of log.split('\n\n')) {
  const [head, ...rest] = block.split('\n');
  if (!head) continue;
  const sha = head.split('\t')[0].slice(0, 8);
  const msg = [head.split('\t')[1] || '', ...rest].join('\n');
  for (const rule of allRules) {
    if (rule.re.test(msg)) hits.push({ where: `commit:${sha}`, rule: rule.name, text: msg.trim().split('\n')[0].slice(0, 120) });
  }
}

// ---------- 报告 ----------
if (!hits.length) {
  console.log(`· 脱敏自检：${listFiles().length} 个文件 + 全部提交信息，${allRules.length} 条判据，零命中 ✓`);
  if (!existsSync(join(ROOT, '.leaklist'))) console.log('  （没找到 .leaklist，只跑了通用形态）');
  process.exit(0);
}

console.error(`✗ 脱敏自检发现 ${hits.length} 处可疑内容：`);
for (const h of hits) console.error(`  [${h.rule}] ${h.where}\n      ${h.text}`);
console.error('\n处理：换成占位符（example.com / 127.0.0.1 / <主机别名>），或把该词加进 .leaklist 之外的豁免白名单。');
process.exit(1);
