// 下载农场低模（GLB）到 dist/vendor/models/，并校验每件模型内置的 CC BY 4.0 署名元数据。
//
//   MODEL_CDN=https://your.mirror/cdn/ node scripts/fetch-models.mjs
//   node scripts/fetch-models.mjs --check    # 只检查缺哪些 / 元数据是否完整，不下载
//
// 模型下载源不写死在仓库里：用 MODEL_CDN 传入（可以是自建镜像或原站的 CDN 路径）。
//
// 许可：这些 .glb 采用 CC BY 4.0；每件文件的 asset.copyright 与 asset.extras 里保留了
// 完整署名、许可与来源，随文件一起分发，请不要剥离。本脚本不再生成额外的署名文件。

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
    const r = await fetch(CDN + id + '.glb');
    if (!r.ok) { missing.push(`${id} (HTTP ${r.status})`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 4).toString() !== 'glTF') { missing.push(`${id} (不是 GLB)`); continue; }
    await mkdir(OUT, { recursive: true });
    await writeFile(file, buf);
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

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({
  license: 'CC BY 4.0',
  attribution: 'embedded in each .glb (asset.copyright / asset.extras)',
  count: MODEL_IDS.length,
  ids: MODEL_IDS,
}, null, 2) + '\n');

const total = downloaded.reduce((s, [, n]) => s + n, 0);
console.log(`✓ ${CHECK_ONLY ? '模型齐全' : `本次下载 ${downloaded.length} 个`}（共 ${MODEL_IDS.length} 个，新增 ${(total / 1024 / 1024).toFixed(2)} MB）`);
console.log(`  → ${OUT}`);
