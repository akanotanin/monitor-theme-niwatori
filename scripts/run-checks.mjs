// 串行跑多个自检脚本，并**归并退出码**（不用 shell 的 && 串联）。
//
// 为什么需要这个：`node check.mjs && node check-leaks.mjs` 里，check.mjs 在受限环境
// （node --check 全 EPERM）会 exit 3 —— `&&` 只把 0 当成功，于是**第二条（脱敏自检）根本不会跑**，
// 而泄漏检查恰恰是最不能跳过的一项。npm 的整体退出码也会停在 3，「没跑语法门」与「真失败」
// 依然混在一起。
//
// 约定（与各脚本一致）：0 = 通过，1 = 断言失败，2 = 用法/配置错误，3 = 环境不可用（没跑成）。
// 归并规则：有 1/2 → 1（真失败优先）；否则有 3 → 3；否则 0。
import { spawnSync } from 'node:child_process';

const scripts = process.argv.slice(2);
if (!scripts.length) {
  console.error('用法: node scripts/run-checks.mjs <script.mjs> [script2.mjs …]');
  process.exit(2);
}

let hardFail = false, envOnly = false;
for (const s of scripts) {
  console.log(`\n── ${s} ──`);
  const r = spawnSync(process.execPath, [s], { stdio: 'inherit' });
  const code = r.status ?? 1;
  if (code === 0) continue;
  if (code === 3) { envOnly = true; continue; }
  hardFail = true;              // 1 / 2 / 崩溃：真失败，但要继续跑后面的脚本
}

if (hardFail) { console.log('\n✗ 自检失败（见上方各段输出）'); process.exit(1); }
if (envOnly) { console.log('\n⚠ 断言通过，但有一项因环境限制未运行（exit 3）'); process.exit(3); }
console.log('\n✓ 全部自检通过');
process.exit(0);
