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
import { dirname, join, resolve, relative } from 'node:path';
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

// ---------- 收集文件（tar 内路径用 /）----------
const files = [];
async function walk(dir, rel = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(full, r);
    else if (e.isFile()) files.push({ full, name: r });
  }
}
for (const name of ['theme.json', 'LICENSE', manifest.preview || 'preview.png']) {
  const full = join(ROOT, name);
  try { if ((await stat(full)).isFile()) files.push({ full, name }); } catch { /* preview 可以没有 */ }
}
await walk(DIST, 'dist');
files.sort((a, b) => a.name.localeCompare(b.name));

// ---------- 最小 tar 写入器（ustar）----------
const BLOCK = 512;
const octal = (n, width) => n.toString(8).padStart(width, '0').slice(-width);
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

const parts = [];
for (const f of files) {
  const data = await readFile(f.full);
  const st = await stat(f.full);
  parts.push(header(f.name, data.length, st.mtimeMs), data);
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
console.log('  包内根目录：theme.json + LICENSE + preview.png + dist/（Monitor 后台 / 主题市场直接装）');
