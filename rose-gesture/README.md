# Wine Red Roses — Gesture Hologram

九朵酒红玫瑰的实时手势全息体验。

**打开页面：http://127.0.0.1:4173/rose-gesture/**

## 手势

- 🖐️ **张开手掌** → 花束逐渐消散成酒红/绿色微光粒子，花瓣变淡，花束消失；
- ✊ **合拢手掌 / 握拳** → 粒子回聚，重新组成九朵玫瑰与绿色枝叶；
- 开合幅度连续控制消散程度，使用 One Euro + 指数平滑，没有生硬跳变。

如果当前浏览器拿不到摄像头画面，页面会出现提示；可以点击「自动演示」或「鼠标体验」查看同样的完整效果。建议使用 Safari，或在 Chrome 中允许摄像头与硬件加速。

## 结构

- 九朵酒红玫瑰、九根在底部自然并拢的花茎、十二片通过叶柄连接在花茎上的绿叶；
- 没有丝带、蝴蝶结或外包装；
- GLB：`assets/rose_cluster.glb`，315,036 三角面，30 个独立节点；
- 消散粒子：`assets/rose_particles.bin`，46,000 个粒子，包含花瓣、叶片和花茎；
- 金色微尘：`assets/gold_particles.json`，1,510 个粒子，在完整花束上提供细节光点。

## 实现

- MediaPipe Hand Landmarker，本地 CPU/WASM，不录制、不上传；
- 张开→消散，握拳→聚合；手离开画面一段时间后，花束缓慢回到完整状态；
- 实体花束在消散时逐渐失去不透明度，粒子由花瓣/花茎/叶片表面取样并向外漂浮，高消散阶段再渐隐；
- Three.js 实时渲染，深色背景、轮廓光、Bloom 和金色微尘；
- 自动演示与鼠标体验作为无摄像头/无权限时的回退。

## 预览

- `renders/gesture-ui_1440x1600.png`：实时界面与花束；
- `renders/dissolve-mid_1440x1600.png`：约 42% 消散状态，实体花束半透明、粒子开始漂浮。

## 文件

- `index.html` / `app.js` / `style.css`：交互页面；
- `assets/rose_cluster.glb`：可放入白色线框立方体的完整花束模型；
- `assets/rose_particles.bin`：消散粒子数据；
- `assets/gold_particles.json`：金色微尘；
- `assets/vendor/`：本地 Three.js 与后期处理依赖。
