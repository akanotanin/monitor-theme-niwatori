// 生成主题预览图（README / Monitor 主题面板用）：打开农场、把玩家摆到一个好看的位置，截图。
//
//   node scripts/preview-shot.mjs                  # 连 127.0.0.1:9333，站点 http://127.0.0.1:18099
//   BASE=http://127.0.0.1:18099 PREVIEW_OUT=../preview.png node scripts/preview-shot.mjs
//
// 需要先起 mock（npm run mock）和一个带 --remote-debugging-port 的 Chrome，见 README「本地开发」。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE || 'http://127.0.0.1:18099';
const OUT = resolve(process.env.PREVIEW_OUT || '../preview.png');
const W = Number(process.env.PREVIEW_W || 1600);
const H = Number(process.env.PREVIEW_H || 900);
const SPAWN = process.env.PREVIEW_SPAWN || '0,0';
const YAW = process.env.PREVIEW_YAW || '3.1416';

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/?light=day&debug&spawn=${encodeURIComponent(SPAWN)}&yaw=${encodeURIComponent(YAW)}` });
for (let i = 0; i < 80; i++) {
  if (await evalJS('!!window.__farm && window.__farm.farm.nodes.length > 0')) break;
  await sleep(250);
}
await sleep(5500);   // 等精细模型（约 5 MB）加载完再截

// 只调机位距离/俯角：出生点与朝向已经在 URL 里定好，相机遮挡体也是按这个位置量的
await evalJS(`(() => {
  const f = window.__farm;
  if (!f) return;
  f.camDist = 5.6;
  f.camPitch = 0.36;
  f.hud.banner('🐔 探针鸡农场', 600);
})()`);
await sleep(1800);
// 无头 Chrome 的鼠标默认停在画面中央 —— 会把那只鸡的悬浮详情卡弹出来挡住玩家。
// 把指针挪到右下角空地，再等卡片淡出。
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W - 10, y: H - 10 });
await sleep(700);

mkdirSync(dirname(OUT), { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log(`✓ ${OUT}  ${W}×${H}`);
ws.close();
fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
