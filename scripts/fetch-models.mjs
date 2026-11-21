// 下载农场低模（GLB）到 dist/vendor/models/，并校验每件模型内置的 CC BY 4.0 署名元数据。
//
//   MODEL_CDN=https://your.mirror/cdn/ node scripts/fetch-models.mjs
//   node scripts/fetch-models.mjs --check    # 只检查缺哪些 / 元数据是否完整，不下载
//
// 模型下载源不写死在仓库里：用 MODEL_CDN 传入（可以是自建镜像或原站的 CDN 路径）。
//
// 许可：这些 .glb 采用 CC BY 4.0；每件文件的 asset.copyright 与 asset.extras 里保留了
// 完整署名、许可与来源，随文件一起分发，请不要剥离。本脚本不再生成额外的署名文件。

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist/vendor/models');
const CDN = (process.env.MODEL_CDN || '').replace(/\/?$/, '/');
const CHECK_ONLY = process.argv.includes('--check');

const { MODEL_IDS } = await import(new URL('../dist/js/model-ids.js', import.meta.url).href);

if (!CDN && !CHECK_ONLY) {
  console.error('· 未配置模型源：设置 MODEL_CDN=https://…/cdn/ 后再运行（--check 不需要）');
  process.exit(2);
}

/** 读出 GLB 的 JSON 块（asset 元数据在这里）。 */
async function glbAsset(file) {
  const buf = await readFile(file);
  if (buf.length < 20 || buf.subarray(0, 4).toString() !== 'glTF') throw new Error('不是 GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')).asset || {};
}

const missing = [];
const badMeta = [];
const downloaded = [];
const hashes = {};                  // id → sha256（下载过的才记；写进 manifest 供下次核对）

for (const id of MODEL_IDS) {
  const file = join(OUT, `${id}.glb`);
  let need = true;
  try {
    const buf = await readFile(file);
    need = buf.length < 100;
  } catch { /* 没有就下 */ }

  if (CHECK_ONLY) {
    if (need) { missing.push(id); continue; }
  } else if (need) {
    // 带超时 + 一次重试：CDN 挂住时脚本不该无限等
    let buf = null;
    for (let attempt = 0; attempt < 2 && !buf; attempt++) {
      try {
        const r = await fetch(CDN + id + '.glb', { signal: AbortSignal.timeout(30000) });
        if (!r.ok) { if (attempt) missing.push(`${id} (HTTP ${r.status})`); continue; }
        buf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        if (attempt) missing.push(`${id} (${e.name === 'TimeoutError' ? '超时' : e.message})`);
      }
    }
    if (!buf) continue;
    if (buf.subarray(0, 4).toString() !== 'glTF') { missing.push(`${id} (不是 GLB)`); continue; }
    await mkdir(OUT, { recursive: true });
    await writeFile(file, buf);
    hashes[id] = createHash('sha256').update(buf).digest('hex');
    downloaded.push([id, buf.length]);
  }

  // CC BY 的署名在文件里：asset.copyright + asset.extras.license / source
  try {
    const asset = await glbAsset(file);
    const meta = JSON.stringify(asset);
    if (!asset.copyright || !/CC[- ]BY[- ]4\.0/i.test(meta)) badMeta.push(id);
  } catch {
    badMeta.push(`${id}(读不出)`);
  }
}

if (missing.length || badMeta.length) {
  if (missing.length) console.error(`⚠ 缺 ${missing.length} 个模型：${missing.join(', ')}`);
  if (badMeta.length) console.error(`⚠ ${badMeta.length} 个模型缺少内置 CC BY 4.0 署名元数据：${badMeta.join(', ')}`);
  process.exit(1);
}

// --check 只读不写：以前它也会把 manifest.json 重写一遍（审查 L18）
if (CHECK_ONLY) process.exit(0);
await mkdir(OUT, { recursive: true });
// ★ sha256 必须覆盖**磁盘上的全部模型**，而不是「本次下载的」：
//   以前 hashes 只装新下载的，任何人再跑一次（全都在了）就会把 sha256 整块从 manifest 抹掉，
//   而注释还写着「再次运行可据此发现被替换的同名模型」—— 能力实际不存在。
const allHashes = {};
for (const id of MODEL_IDS) {
  try { allHashes[id] = createHash('sha256').update(await readFile(join(OUT, `${id}.glb`))).digest('hex'); }
  catch { /* 上面已校验过存在性 */ }
}
// 先拿**上一版记录**比对（顺序很重要：必须在覆盖 manifest 之前读旧值），不一致就报警
let mismatch = 0;
try {
  const old = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
  for (const [id, h] of Object.entries(old.sha256 || {})) {
    if (allHashes[id] && allHashes[id] !== h) { console.error(`⚠ ${id}.glb 的 sha256 与上次记录不一致（文件被替换/损坏）`); mismatch++; }
  }
} catch { /* 第一次生成 */ }
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({
  license: 'CC BY 4.0',
  attribution: 'embedded in each .glb (asset.copyright / asset.extras)',
  count: MODEL_IDS.length,
  ids: MODEL_IDS,
  // 全部模型的 sha256（磁盘现状）：再次运行会拿它对比，发现被替换/损坏的同名模型
  sha256: allHashes,
}, null, 2) + '\n');
if (mismatch) {
  console.error(`✗ ${mismatch} 个模型与上次记录的 sha256 不一致（manifest 已按当前磁盘内容更新；请确认这是有意替换）`);
  process.exit(1);
}

const total = downloaded.reduce((s, [, n]) => s + n, 0);
console.log(`✓ ${CHECK_ONLY ? '模型齐全' : `本次下载 ${downloaded.length} 个`}（共 ${MODEL_IDS.length} 个，新增 ${(total / 1024 / 1024).toFixed(2)} MB）`);
console.log(`  → ${OUT}`);
