# Formula Simulator 代码审查报告

> **历史记录｜审查基线：0.2.0 / `fbb401d`。** 本文保留当时的审查结论和测试计数，不改写也不用于判定当前版本。当前状态以根目录 [README](../README.md)、[DESIGN](../DESIGN.md) 及 [最新验收](plan/acceptance.md) 为准。

| 项目 | 内容 |
| --- | --- |
| 审查对象 | `formula-simulator` · FS-01 动态底盘台 |
| 版本 | `0.2.0`（commit `fbb401d`） |
| 审查日期 | 2026-11-11 |
| 审查方式 | 只读审查，未修改任何源文件 |
| 测试状态 | 本次实跑 `npm test`：静力 47 项 + 动力学 52 项全部通过 |

## 总体评价

这是一个完成度很高的阶段二交付物。物理核心与渲染层解耦干净（Node 下无需 DOM 即可验证），硬点几何作为动力学与渲染的单一事实来源，文档（README / DESIGN）与代码约定一致。本次实跑 `npm test`：静力 47 项 + 动力学 52 项全部通过，含 3000 组静力随机包络、120 组动力学随机包络、bit-identical 确定性与 60/144 Hz 帧率无关性验证。工程质量明显高于一般演示项目。

## 主要优点

- **数值健壮性**：机构反解不收敛时回退到设计斜率（`src/js/05-body-dynamics.js:253`）、速度/角速度限幅、非有限状态自动恢复到平衡（`src/js/05-body-dynamics.js:499`）、试验台边界钳制。半隐式欧拉 + 每步四元数归一化，力/力矩在路面系计算再转回车体系，惯量轴映射（Ixx 侧倾 / Iyy 横摆 / Izz 俯仰）与 `computeBodyInertia` 一致。
- **测试设计**：用 `new Function` 沙箱加载 UMD Three.js + 物理三件套，无需构建即可跑；覆盖机构闭合、接地点共面、运动比、转向标定、遥测与反解一致性等。
- **内存管理正确**：`disposeGroupChildren`（`src/js/20-car.js:175`）用 Set 去重、保留 `userData.shared` 几何与共享材质，重建无 GPU 泄漏。
- **安全 / UX**：所有 `innerHTML` 数据均来自内部常量或数值（`src/js/30-ui.js:433 / 458 / 473 / 882`），无注入面；键盘快捷键正确避开输入框、模态框与 Ctrl/Meta/Alt（`src/js/30-ui.js:1016`）。构建脚本对 `</script>` 和 `$` 替换都做了防护（`tools/build.mjs:18 / 23`）。

## 发现（按影响排序）

### 1. 性能——每子步重复重型机构反解（最值得优化）

`simEvaluate` 每个子步对四角调用 `suspSolveCorner(..., true)`（`src/js/05-body-dynamics.js:243`），`withRatio=true` 会额外做两次反解求运动比，即每角 3 次 Newton 求解；每次 Newton 用有限差分 Jacobian（4 次 `suspEval`），而 `suspEval` 大量 `new THREE.Vector3 / Quaternion` 并 `.clone()`。60 fps 下每帧约 8 子步 + 遥测再算一次，估算每帧数千次 `suspEval`、数万次临时对象分配，GC 压力显著。且 `simBuildModel` 每帧再跑一遍完整 `simEvaluate`（`src/js/05-body-dynamics.js:543`）。

建议：

- 运动比变化缓慢，可解析求导或降频 / 缓存；
- `suspEval` 改用复用 scratch 向量，减少 `.clone()` 与临时对象；
- 遥测复用最近一次积分评估而非重算；
- Jacobian 改解析式。

低端设备上这决定了是否掉帧（掉帧时累加器会丢弃时间，物理变慢）。

### 2. 潜在变量遮蔽（低危，建议澄清）

`simEvaluate` 中 `const state = sim.state`（`src/js/05-body-dynamics.js:200`）遮蔽了全局 setup `state`，随后 `const source = reference.source || state`（`src/js/05-body-dynamics.js:202`）的回退分支实际指向积分状态而非参数对象。当前 `reference.source` 恒由 `computeStatic` 提供，回退永不触发，故无实际错误；但语义误导，若将来 reference 缺 `.source`，`friction` 会静默取默认值。建议把回退改为显式全局或去掉。

### 3. dev-server 路径前缀校验（低危，仅 localhost）

`tools/dev-server.mjs:15` 用 `path.startsWith(root)` 防穿越，缺少分隔符边界，理论上可放行同名前缀的兄弟目录（如 `formula-simulator-secret`）。仅绑定 127.0.0.1 的开发服务器，风险很低；建议改为 `path === root || path.startsWith(root + sep)`。

### 4. 小清理项

- `createDefaultBodyMaterialSet`（`src/js/20-car.js:169`）定义后从未调用，是死代码。
- 截图文件名 `FS-01_static_...`（`src/js/40-app.js:237`）但实际叠加的是动态载荷，命名易误导。
- `updateCar` 无 `bodyQuat` 的回退分支四元数顺序为 Ry·Rx·Rz（`src/js/22-car-dynamics.js:1104`），与文档约定 Ry·Rz·Rx 不一致；该分支在动态路径下基本不可达，小角度下差异为二阶小量，仅一致性问题。
- `updateCar` 回退分支（`src/js/22-car-dynamics.js:1124–1142`）缩进异常，纯外观。

## 建模说明（均为 README 已声明的简化，非缺陷）

- 力矩作用点用仅含横摆的接地点投影（`src/js/05-body-dynamics.js:267`），而视觉用完整机构接地点；侧倾/俯仰引起的接地点面内偏移被忽略，±10° / ±25 mm 内为 mm 级，测试收敛 < 1 N 证实可接受。
- 单簧下质量、切向库仑摩擦仅用于驻车 / 滑移，无轮胎侧偏 / 纵滑——属阶段三范围。
- `simEulerFromQuat` 用 asin 提取俯仰，接近 ±90° 有万向锁退化；当前包线远未触及。

## 审查范围

逐行读了物理核心（`00-core` / `03-suspension` / `05-body-dynamics`）、构建与全部 Node 测试、应用编排（`40-app`）、悬架视觉桥接（`22-car-dynamics`），并对 scene / UI / car 做了针对性检查（内存释放、innerHTML、事件监听、键盘）。`10-scene.js`、`20-car.js`、`30-ui.js` 三个大渲染文件为抽样审查而非逐行；浏览器冒烟测试（需 Chrome）本次未运行。

## 结论

无影响结果正确性的实质 bug，测试全绿。首要改进方向是机构反解的性能与分配开销，其余为低危澄清与清理项。