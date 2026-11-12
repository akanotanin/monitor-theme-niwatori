// 精细低模（GLB，CC BY 4.0）的加载器。
//
// 原版 cyber-probe 读的是 .mjs 模块（那部分许可不允许再分发）；
// 这个主题改为直接读 .glb 网格 —— .glb 采用 CC BY 4.0，允许随作品再分发；
// 每件文件的 asset.copyright / asset.extras 里保留了完整署名与来源，不要剥离。
//
// 同一份 GLB 会被多处复用（草垛 ×5、橡树 ×2…），所以这里缓存**原始 scene**，
// 调用方每次 clone 一份再摆位；几何体与材质由 clone 共享，不会重复吃显存。

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_DIR = new URL('../vendor/models/', import.meta.url).href;
const loader = new GLTFLoader();
const cache = new Map();

/** 加载一件模型；同一 id 只下载一次。返回原始 scene（**不要直接 add 到场景**，先 clone）。 */
export function loadModel(id, timeout = 8000) {
  let p = cache.get(id);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${id}`)), timeout);
      loader.load(
        MODEL_DIR + id + '.glb',
        (gltf) => {
          clearTimeout(timer);
          const scene = gltf.scene || gltf.scenes?.[0];
          if (!scene) { reject(new Error(`empty glb: ${id}`)); return; }
          scene.traverse((m) => {
            if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
          });
          resolve(scene);
        },
        undefined,
        (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(`load failed: ${id}`)); },
      );
    });
    p.catch(() => cache.delete(id));    // 失败了下次还能重试
    cache.set(id, p);
  }
  return p;
}

/** 摆位用：克隆一份（共享几何体/材质）。
 *  ⚠ 必须用 SkeletonUtils.clone：驴/狗是带骨骼的 SkinnedMesh，普通 clone 不会
 *  重新绑定骨架 —— 克隆出来的模型会按**原始骨骼**（原点）渲染，看起来像被摆到了场地中央。 */
export async function cloneModel(id, timeout) {
  const scene = await loadModel(id, timeout);
  return cloneSkinned(scene);
}
