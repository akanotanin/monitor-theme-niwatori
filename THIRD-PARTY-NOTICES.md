# 第三方组件与许可（THIRD-PARTY NOTICES）
本主题（niwatori）本身以 MIT 分发，见同目录 `LICENSE`。下面这些组件随主题包一起分发，各自的许可与署名如下；
再分发时请连同本文件一起带走。

## 1. three.js r169（MIT）
随包分发的文件：`dist/vendor/three.module.js`、`dist/vendor/addons/**`（5 个文件：`geometries/ConvexGeometry.js`、`loaders/GLTFLoader.js`、`math/ConvexHull.js`、`utils/BufferGeometryUtils.js`、`utils/SkeletonUtils.js`）。

与 npm `three@0.169.0` 逐字节一致，未做修改。

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 2. 3D 模型（CC BY 4.0）
`dist/vendor/models/*.glb` 共 29 件，均由 Polyfork（polyfork.dev）以 CC BY 4.0 发布；
每件文件的 `asset.copyright` / `asset.extras` 里已内置完整署名，**不要剥离**。
聚合清单见 `dist/vendor/models/manifest.json`。

| 文件 | 署名 |
|---|---|
| `compact-tractor-35b84b.glb` | Compact Tractor by Polyfork (https://polyfork.dev/asset/compact-tractor-35b84b), CC BY 4.0 |
| `roofed-well-43a2fc.glb` | Roofed Well by Polyfork (https://polyfork.dev/asset/roofed-well-43a2fc), CC BY 4.0 |
| `wheelbarrow-0f8406.glb` | Wheelbarrow by Polyfork (https://polyfork.dev/asset/wheelbarrow-0f8406), CC BY 4.0 |
| `scarecrow-334079.glb` | Scarecrow by Polyfork (https://polyfork.dev/asset/scarecrow-334079), CC BY 4.0 |
| `wooden-crate-e46521.glb` | Wooden Crate by Polyfork (https://polyfork.dev/asset/wooden-crate-e46521), CC BY 4.0 |
| `plank-trough-baf3d5.glb` | Plank Trough by Polyfork (https://polyfork.dev/asset/plank-trough-baf3d5), CC BY 4.0 |
| `hay-bale-079e8c.glb` | Hay Bale by Polyfork (https://polyfork.dev/asset/hay-bale-079e8c), CC BY 4.0 |
| `beehive-2e70bf.glb` | Beehive by Polyfork (https://polyfork.dev/asset/beehive-2e70bf), CC BY 4.0 |
| `compost-heap-dfec38.glb` | Compost Heap by Polyfork (https://polyfork.dev/asset/compost-heap-dfec38), CC BY 4.0 |
| `split-log-bench-289780.glb` | Split-Log Bench by Polyfork (https://polyfork.dev/asset/split-log-bench-289780), CC BY 4.0 |
| `heavy-timber-picnic-table-1ac060.glb` | Heavy Timber Picnic Table by Polyfork (https://polyfork.dev/asset/heavy-timber-picnic-table-1ac060), CC BY 4.0 |
| `chicken-coop-371f97.glb` | Chicken Coop by Polyfork (https://polyfork.dev/asset/chicken-coop-371f97), CC BY 4.0 |
| `open-woodshed-050a0a.glb` | Open Woodshed by Polyfork (https://polyfork.dev/asset/open-woodshed-050a0a), CC BY 4.0 |
| `fire-lookout-tower-75a129.glb` | Fire Lookout Tower by Polyfork (https://polyfork.dev/asset/fire-lookout-tower-75a129), CC BY 4.0 |
| `firewood-stack-8a2899.glb` | Firewood Stack by Polyfork (https://polyfork.dev/asset/firewood-stack-8a2899), CC BY 4.0 |
| `burro-with-marigold-panniers-1f04ab.glb` | Burro With Marigold Panniers by Polyfork (https://polyfork.dev/asset/burro-with-marigold-panniers-1f04ab), CC BY 4.0 |
| `stream-water-wheel-ea2d68.glb` | Stream Water Wheel by Polyfork (https://polyfork.dev/asset/stream-water-wheel-ea2d68), CC BY 4.0 |
| `oak-tree-50ee7c.glb` | Oak Tree by Polyfork (https://polyfork.dev/asset/oak-tree-50ee7c), CC BY 4.0 |
| `broadleaf-oak-997c22.glb` | Broadleaf Oak by Polyfork (https://polyfork.dev/asset/broadleaf-oak-997c22), CC BY 4.0 |
| `orchard-apple-tree-b21f85.glb` | Orchard Apple Tree by Polyfork (https://polyfork.dev/asset/orchard-apple-tree-b21f85), CC BY 4.0 |
| `hand-water-pump-448037.glb` | Hand Water Pump by Polyfork (https://polyfork.dev/asset/hand-water-pump-448037), CC BY 4.0 |
| `cauldron-on-coals-ddbab6.glb` | Cauldron On Coals by Polyfork (https://polyfork.dev/asset/cauldron-on-coals-ddbab6), CC BY 4.0 |
| `reed-bed-bbbefb.glb` | Reed Bed by Polyfork (https://polyfork.dev/asset/reed-bed-bbbefb), CC BY 4.0 |
| `lily-pads-b0c5d0.glb` | Lily Pads by Polyfork (https://polyfork.dev/asset/lily-pads-b0c5d0), CC BY 4.0 |
| `lake-pebbles-6c0359.glb` | Lake Pebbles by Polyfork (https://polyfork.dev/asset/lake-pebbles-6c0359), CC BY 4.0 |
| `wooden-rowboat-916981.glb` | Wooden Rowboat by Polyfork (https://polyfork.dev/asset/wooden-rowboat-916981), CC BY 4.0 |
| `grain-silo-58ca67.glb` | Grain Silo by Polyfork (https://polyfork.dev/asset/grain-silo-58ca67), CC BY 4.0 |
| `porch-log-cabin-d2f3ef.glb` | Porch Log Cabin by Polyfork (https://polyfork.dev/asset/porch-log-cabin-d2f3ef), CC BY 4.0 |
| `farm-dog-723730.glb` | Farm Dog by Polyfork (https://polyfork.dev/asset/farm-dog-723730), CC BY 4.0 |

许可全文：https://creativecommons.org/licenses/by/4.0/

## 3. 国旗图标
`dist/vendor/flags/*.png`（250 面，ISO 3166-1 alpha-2 + XK）取自 flagcdn.com（flagpedia.net）的免费国旗库。
上游说明其图像来自 Wikimedia Commons 的公有领域国旗图；若再分发，请保留本条来源说明。

## 4. 主题自身的上游
本主题的玩法与数据口径参考自 cyber-probe（MIT）项目；3D 场景、HUD 与数据层为本仓库实现。
