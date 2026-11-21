// 打 Monitor 主题包：theme.json + LICENSE + dist/（+ preview.png），tar.gz 格式。
// 极简探针的主题包结构：hub 只做静态文件伺服，dist/ 就是整站。
//
//   node scripts/package.mjs
//   → release/theme.tar.gz
//   → release/monitor-theme-niwatori-<version>.tar.gz（版本化副本，发版/回装用）
//   → 同名 .sha256（市场目录与复验用）
//
// 不调系统的 tar（不同机器上未必有、Windows 沙箱里 spawn 也可能被拒）：
// 这里直接写 POSIX ustar + gzip，产物就是标准 .tar.gz。

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const manifest = JSON.parse(await readFile(join(ROOT, 'theme.json'), 'utf8'));
if (!/^[A-Za-z0-9_-]+$/.test(manifest.short || '')) throw new Error(`theme.json 的 short 不合法: ${manifest.short}`);
if (!(await stat(join(ROOT, 'LICENSE'))).isFile()) throw new Error('缺少 LICENSE');
if (!(await stat(join(DIST, 'index.html'))).isFile()) throw new Error('缺少 dist/index.html（先跑 npm run check）');

const version = String(manifest.version || '0.0.0');
const short = String(manifest.short).toLowerCase();
// 版本号会被拼进输出文件名：只允许字母数字点横线，且不能有 ..（`1.0.15/../../x` 会把包写到 release/ 之外）
if (!/^[0-9A-Za-z][0-9A-Za-z.\-]*$/.test(version) || version.includes('..')) {
  throw new Error(`theme.json 的 version 不合法: ${version}`);
}
// 预览图路径必须落在仓库内（manifest 是手写文件，不该能读仓库外的任意文件）
const previewPath = resolve(ROOT, manifest.preview || 'preview.png');
if (!previewPath.startsWith(ROOT + sep)) throw new Error(`theme.json 的 preview 越界: ${manifest.preview}`);
// 第三方许可与署名必须随包分发（three.js 的 MIT 要求「所有副本都带许可全文」）
if (!(await stat(join(ROOT, 'THIRD-PARTY-NOTICES.md'))).isFile()) {
  throw new Error('缺少 THIRD-PARTY-NOTICES.md（第三方许可与署名，必须随包分发）');
}

// ---------- 收集文件（tar 内路径用 /）----------
// ★ 只打「仓库里该有的文件」：以前 walk(DIST) 是全量收录，dist/debug.log、main.js.bak、.tmpnote
//   这些本机垃圾会跟着发布包发出去（.gitignore 忽略了也没用 —— 打包器不看 gitignore）。
//   判据：git 已跟踪 → 收；否则按「垃圾文件名」排除（新增文件还没 git add 时也要能打进去，
//   不能只认跟踪集 —— 否则新 vendor 的引擎/模型会被静默漏出发布包）。
let trackedSet = null;
try {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 << 20 });
  trackedSet = new Set(out.split('\0').filter(Boolean).map((p) => p.split(/[\\/]/).join('/')));
} catch { /* 没有 git（源码 zip / 沙箱）：只按文件名规则 */ }
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db)$|\.(log|bak|tmp|orig|rej|swp)$|~$|(^|\/)\._/i;
const isWanted = (rel) => {
  if (JUNK.test(rel)) return false;                                   // 本机垃圾：永远不收
  if (trackedSet) return trackedSet.has(rel) || !rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known');
  return !rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known');
};

const files = [];
const dropped = [];
async function walk(dir, rel = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(full, r);
    else if (e.isFile()) {
      if (isWanted(`dist/${r}`)) files.push({ full, name: `dist/${r}` });
      else dropped.push(`dist/${r}`);
    }
  }
}
for (const name of ['theme.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md', manifest.preview || 'preview.png']) {
  const full = join(ROOT, name);
  try { if ((await stat(full)).isFile()) files.push({ full, name }); } catch { /* preview 可以没有 */ }
}
await walk(DIST);
if (dropped.length) console.log(`· 跳过 ${dropped.length} 个未跟踪/垃圾文件（不进发布包）：${dropped.slice(0, 5).join('、')}${dropped.length > 5 ? ' …' : ''}`);
// 字节序排序（localeCompare 依赖 locale/ICU：同一份源码在不同机器上会排出不同的包，哈希就不可复验）
files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
// tar 头里的 mtime 固定（默认 0，可用 SOURCE_DATE_EPOCH 覆盖）：否则每个文件的修改时间都进哈希，
// 内容完全相同的包每次打出来都不一样，发布包的 sha256 无法用源码复验（审查 M11）。
const EPOCH = Number(process.env.SOURCE_DATE_EPOCH || 0);
// ★ 必须校验：octal() 用 padStart().slice(-width)，负数和 NaN 会原样落进 tar 头的 mtime 字段
//   （"000000000-5" / "00000000NaN"）—— 产出的是**解不开的包**，脚本却照样 exit 0 报成功。
if (!Number.isFinite(EPOCH) || EPOCH < 0) {
  throw new Error(`SOURCE_DATE_EPOCH 必须是 0 或正整数（当前：${process.env.SOURCE_DATE_EPOCH}）`);
}

// ---------- 最小 tar 写入器（ustar）----------
const BLOCK = 512;
const octal = (n, width) => {
  // 负数 / NaN / 超出字段位宽的值一律拒绝：静默截断会写出解不开的包（mtime、size 两处都踩过）
  const max = Math.pow(8, width - 1) - 1;
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new Error(`tar 头字段溢出：值 ${n} 不在 0..${max}（width=${width}）`);
  }
  return Math.floor(n).toString(8).padStart(width, '0').slice(-width);
};
function header(name, size, mtime, mode = 0o644) {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar 路径超过 100 字节：${name}`);
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(mode, 7) + '\0', 100, 8, 'ascii');
  h.write('0000000\0', 108, 8, 'ascii');            // uid
  h.write('0000000\0', 116, 8, 'ascii');            // gid
  h.write(octal(size, 11) + '\0', 124, 12, 'ascii');
  h.write(octal(Math.floor(mtime / 1000), 11) + '\0', 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');             // checksum 先填空格
  h.write('0', 156, 1, 'ascii');                    // 普通文件
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  h.write('root', 265, 32, 'ascii');
  h.write('root', 297, 32, 'ascii');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(octal(sum, 6) + '\0 ', 148, 8, 'ascii');
  return h;
}

// 文本条目统一归一成 LF：Windows 工作区是 CRLF、仓库/CI 是 LF，不归一的话
// 「同一份源码」在不同 checkout 上打出来的包哈希不同（审查 R6）。二进制不动。
const TEXT_EXT = /\.(js|mjs|css|html|json|svg|md|txt|map)$/i;
const asText = (name) => TEXT_EXT.test(name) || /(^|\/)(LICENSE|THIRD-PARTY-NOTICES\.md)$/i.test(name);
const normalizeText = (buf, name) => {
  if (!asText(name) || buf.includes(0)) return buf;
  // 用 split/join 而不是正则：脚本按 CRLF 保存时，正则里的转义很容易被写坏（本项目踩过）
  const text = buf.toString('utf8').split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
  return Buffer.from(text, 'utf8');
};

const parts = [];
for (const f of files) {
  const data = normalizeText(await readFile(f.full), f.name);
  parts.push(header(f.name, data.length, EPOCH * 1000), data);
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  if (pad) parts.push(Buffer.alloc(pad, 0));
}
parts.push(Buffer.alloc(BLOCK * 2, 0));
const tarball = gzipSync(Buffer.concat(parts), { level: 9 });

// ---------- 落盘 + 版本化副本 + sha256 ----------
const outDir = join(ROOT, 'release');
await mkdir(outDir, { recursive: true });
const base = join(outDir, 'theme.tar.gz');
await writeFile(base, tarball);
const versioned = join(outDir, `monitor-theme-${short}-${version}.tar.gz`);
await writeFile(versioned, tarball);
const digest = createHash('sha256').update(tarball).digest('hex');
await writeFile(`${versioned}.sha256`, `${digest}  ${versioned.split(/[\\/]/).pop()}\n`);

console.log(`✓ ${relative(ROOT, versioned)}  ${(tarball.length / 1024).toFixed(0)} KB  ${files.length} 个文件`);
console.log(`  同时写了一份 ${relative(ROOT, base)}`);
console.log(`  SHA-256: ${digest}`);
console.log('  包内根目录：theme.json + LICENSE + THIRD-PARTY-NOTICES.md + preview.png + dist/（Monitor 后台 / 主题市场直接装）');
