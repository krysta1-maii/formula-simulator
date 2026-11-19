# 运行时、性能与工具链对抗审阅（0.3.0）

> **历史评审｜基线：0.3.0 / `45983ca`。** 本文保留原始发现与结论，不代表当前状态。请先查阅 [总报告](00-summary.md) 和 [0.4.x 状态映射](status-mapping.md)；0.4.0 已关闭项只在映射中登记，其他发现以 0.4.1 最终验收为准。当前状态以根 README/DESIGN 及最新验收为准。

| 项目 | 内容 |
| --- | --- |
| 审阅对象 | formula-simulator 0.3.0，HEAD `45983ca` |
| 审阅者 | runtime-reviewer（共享任务 task-4） |
| 审阅日期 | 2026-11-19 |
| 环境 | Node v24.22.1；Google Chrome 156.0.8078.47；linux/x64；审阅期间宿主 loadavg 约 19–42（其他审阅流并发） |
| 写入范围 | 仅 `docs/review/0.3.0/04-runtime.md` 与 `.tmp-review/runtime/`；未修改任何被跟踪源码、测试、文档或 `index.html` |
| 基线复核 | `npm test` 50/50 + 80/80、`test:invariants` 27/27、`test:runtime` 78/78、`test:dev-server` 12/12、`build:check` 通过（1,021,578 B，sha256 `668c59ea…`） |
| 结论 | 未发现 P0/P1 功能正确性缺陷；发现 6 项 P2（测试/审计门禁与页面生命周期为主）和一组 P3 工程问题；0.3.0 的帧时间、几何代际、资源释放主路径实测成立 |

## 0. 结论摘要

1. **帧时间语义实现本身正常。** Node 端 60/30/10/5/4 Hz 实时、2 Hz 约 0.512×、0.5 s/128 子步/0.5 s 积压、长卡顿 droppedTime 记账、暂停冻结、非法 dt 不抛异常均独立复现；500 组随机帧序列的 `advanced + droppedTime + accumulator = wallDt` 恒等式无一次失败。浏览器端用合成 rAF 时钟复测 30/10/5/2 Hz、120 s 卡顿与追赶序列，结果与 Node 一致（60 Hz 首用例受测试驱动器初始化伪影影响，见 §6）。
2. **几何代际主路径正常。** 20 次快速尺寸变更只产生 1 次提交（commitCount 1），提交后 sceneRevision 与 physicsRevision 相等，轮距/轴距跨度 3.580005 m 与 `state.wheelbase=3.58` 一致，`setState(..., {rebuild:false})` 的尺寸变更被正确强制重建；localStorage 在 file:// 下可读写。
3. **资源释放主路径正常。** 16 次重建后 `renderer.info.memory` 保持 411 geometries / 16 textures / 18 programs，活材质 7 个；`FSApp.dispose()` 幂等，`lastTeardown` 释放 7 个实例材质、40 个共享材质、7 个缓存材质、470 个几何、14 个纹理，`rendererMemoryAfter` 的 geometries/textures 均为 0（programs 仍为 1）。
4. **发现集中在“测试与审计门禁”和“页面生命周期”，而不是物理/渲染主路径。** 最值得优先处理的是：`test:runtime` 在子步数不一致时反而判 PASS（§3.1）、`audit:baseline` 的退出码不绑定审计错误/跳过（§3.2）、pagehide 无条件 teardown 导致 bfcache 返回后页面死亡（§3.3）、B5.2/浏览器几何用例的固定等待与同代对比可产生假绿（§3.4）、`ci:browser` 在无 Chrome 时以 SKIP 退出 0（§3.5）、计划中的浏览器帧/几何/teardown 断言未落地（§3.6）。
5. **构建与 dev-server 的原有修复成立，但构建防护存在边界缺口。** `</script>` 只匹配小写、模板占位符缺失不会报错；在临时副本中注入 `</SCRIPT>` 可生成“构建成功但页面无法启动”的产物（§4.1）。dev-server 的路径穿越、编码遍历、NUL、symlink 逃逸、405/HEAD 均通过；dotfile（`.git/config`、`.env`）默认可读属低危加固项（§4.2）。
6. **性能预算在最坏并发负载下仍 PASS，但 bench 以中位数判定、p95 可超预算；`simBuildModel` 优化与旧版的四组模型 JSON 逐字节相同，遥测读取不污染后续物理。** 详见 §2.4/§4.3。

## 1. 审阅范围与方法

逐行或针对性地阅读了 `src/js/40-app.js`、`src/js/05-body-dynamics.js` 的运行时/模型装配路径、`src/js/00-core.js` 的几何 revision 与持久化、`src/js/20-car.js`/`10-scene.js` 的资源释放、`src/js/30-ui.js` 的遥测与自检调度，以及 `tools/build.mjs`、`check-build.mjs`、`dev-server.mjs`、`browser-runner.mjs`、`test-*.mjs`、`tools/audit/`、`tools/audit-browser/`、`bench.mjs`。未修改任何被跟踪文件。

量化实验全部在 `.tmp-review/runtime/` 下，主要五组：

| 实验 | 脚本/日志 | 说明 |
| --- | --- | --- |
| 帧时间矩阵与记账 | `frames.mjs` / `frames.log` | 直接调用 `simAdvance`；60/30/12/10/5/4/3.9/3/2/1/0.5 Hz、120 s 卡顿、暂停、非法 dt、500 组随机序列 |
| test-runtime 假绿故障注入 | `gen-fault-test.mjs`、`test-runtime-fault-masked.mjs`、`test-runtime-fault-unmasked.mjs` | 在临时副本中令某个 60 Hz 帧漏执行 1 个子步，比较原判据与修正判据 |
| `simBuildModel` 新旧对比 | `compare-buildmodel.mjs` / `.log` | 从 `git show 2999731:src/js/05-body-dynamics.js` 取优化前实现，与当前实现同进程对比；四组 setup、200 步后、遥测穿插、不同 source 参数 |
| 浏览器运行时/资源/剖析 | `browser-compact.mjs`、`browser-memory-lifecycle.mjs`、`browser-rebuild-heap.mjs`、`browser-leak-rounds.mjs`、`browser-profile.mjs`、`browser-fps.mjs`、`browser-synth-raf.mjs` 及同名 `.log` | 仅使用 `--remote-debugging-port=0` + 临时 profile；含合成 rAF 时钟、精确堆统计、CPU/分配采样、dispose/pagehide |
| 构建/dev-server | `build-escape.mjs`、`devserver-probe.mjs`、`bad-upper.dom.html`、`good.dom.html` 及日志 | 临时根目录构造 `</SCRIPT>`、缺失占位符、`$&` 替换；真实/临时 dev-server 探测 |

另复跑 `npm test`、`test:invariants`、`test:runtime`、`test:dev-server`、`build:check`、`ci:node`、`ci:browser`（含无 Chrome 场景）与 `bench`；证据在 `node-regression.log`、`ci-node.log`、`ci-browser-skip.log`、`bench-1.log/json`。

**浏览器计时可信度说明。** 审阅期间宿主 loadavg 长期 20–42，Chrome 主线程/GPU 进程被严重抢占：实际约 0–3 帧/3 s，单次会话可达 88 s。因此本文不把真实墙钟浏览器帧率作为结论依据；帧语义以 Node 直接调用 + 合成 rAF 时钟为准，内存/资源计数（与墙钟无关）仍采用浏览器实测。

## 2. 已核实无问题/修复有效的方面

### 2.1 帧时间语义（Node 直接调用）

`simAdvance` 的常量与实测行为一致：`SIM_DT=1/500`、`SIM_MAX_SUBSTEPS=128`、`SIM_MAX_FRAME_DT=0.5`、`SIM_MAX_BACKLOG=0.5`（`src/js/05-body-dynamics.js:23-26`，`tools/test-runtime.mjs:66-68`）。1 s 墙钟的矩阵（脚本 `frames.mjs`）：

| 帧率 | 推进 sim.time | droppedTime | 结束积压 | 末帧 timeScale |
| ---: | ---: | ---: | ---: | ---: |
| 60 Hz | 1.000000 s | 0 | 0 | 1.08（最后帧补 9 步） |
| 30 Hz | 0.998000 s | 0 | 0.002 s | 0.96 |
| 10 Hz | 0.998000 s | 0 | 0.002 s | 1.00 |
| 5 Hz | 0.998000 s | 0 | 0.002 s | 1.00 |
| 4 Hz | 0.998000 s | 0 | 0.002 s | 1.00 |
| 3 Hz | 0.768000 s | 0 | 0.232 s | 0.768 |
| 2 Hz | 0.512000 s | 0.244 s | 0.244 s | 0.512 |
| 1 Hz | 0.256000 s | 0.500 s | 0.244 s | 0.256 |
| 0.5 Hz | 0.256000 s | 1.500 s | 0.244 s | 0.128 |

- 2 Hz 稳态 5 s：每帧 128 子步、推进 0.256 s、积压 0.244 s、每帧新增 dropped 0.244 s；总计 advanced 2.560 + dropped 2.196 + backlog 0.244 = 5.000 s。
- 120 s 卡顿：128 步、推进 0.256 s、droppedTime 增加 119.5 s、timeScale 0.00213；随后 60 Hz 追赶序列为 `[15.36, 1.2, 0.96, 1.08]`，积压降到 0.004667 / 0.001333 / 0.002 / 0.000667 s。
- 暂停：`sim.running=false` 时连续 60 帧不推进、不改 accumulator、不改 droppedTime；恢复后正常。
- 非法/非数值 dt（NaN、Infinity、负数、undefined、null、字符串）：一律视为 0，不抛异常，timeScale 保持 1。
- 500 组随机帧序列：`advanced + droppedTime + accumulator` 相对 wallDt 的恒等误差均 < 1e-9，0 次失败。
- 边界：dt=0.256 时因浮点得到 127 步、积压 0.002 s；dt=0.256+1e-9 时为 128 步、积压 0；属浮点余数现象，不构成时间丢失（余数仍在积压中）。

**浏览器动画循环复测（合成 rAF 时钟，避免宿主负载影响）**：`browser-synth-raf.mjs` 在 `addScriptToEvaluateOnNewDocument` 中替换 `requestAnimationFrame`，将回调排队并由脚本按指定时间戳泵送。30 Hz 30 帧推进 1.000 s；10 Hz 0.998 s；5 Hz 0.998 s；2 Hz 两帧 0.512 s、积压 0.244 s、timeScale 0.512；120 s 单帧 128 步、推进 0.256 s、dropped +119.5；追赶序列 `[15.36, 1.2, 0.96, 1.08]`。这与 Node 结果一致，证明 `40-app.js:519-561` 的 `animate → simAdvance → simBuildModel` 集成路径没有额外的时间截断或加倍。60 Hz 首用例因驱动器在真实 rAF 与合成时钟切换时第一帧 dt 异常而出现 1.482 s，属测试驱动器伪影（Node 60 Hz 与后续用例均正常），已在 §6 标注；不据此判定实现缺陷。

### 2.2 几何代际、公开 API 与持久化

- `setState` 对六个尺寸键使用 `geometrySignature(merged) !== geometrySignature(previous)`，尺寸变化时忽略 `options.rebuild=false`（`src/js/40-app.js:414-429`）。浏览器实测 `setState({trackFront:1.50},{rebuild:false})`：立即返回 `pending=true`、`geometry.dims.trackFront=1.50`、scene/physicsRevision 仍为旧代；等待后 `pending=false`、revision 变为新值、`dims.trackFront=1.50`，未被静默忽略。
- 20 次快速 `setState({wheelbase:3.20+i*0.02})`：中间快照 `pending=true`、sceneRevision=physicsRevision=1（旧代，冻结）；一次提交后 `pending=false`、sceneRevision=physicsRevision=4、`commitCount=1`、`state.wheelbase=3.58`、`getSceneProbe().wheelPos` 前后轴 x 跨度 3.580005 m、`geometryMismatch=false`。说明 85 ms 节流窗口合并生效、提交原子替换、场景与物理同代。
- `FSApp.reset`/重置按钮走 `refreshAll({rebuild:true,reason:'reset'})` 并在 `processPendingRebuild` 内 `simReset`；恢复默认尺寸会生成新 revision。localStorage 在 file:// 下可读写（`localStorage ok:true`），boot 顺序为 `loadPersistedState → initScene → simCreate → stampReference`（`src/js/40-app.js:563-577`），初始代际由 `simCreate` 的 `setActiveGeometry`/revision 覆盖。
- `simRetargetReference` 拒绝跨代替换（`src/js/05-body-dynamics.js:263-277`），`test-runtime` 的 geometry 组 9 项覆盖 map 上限、active 保护、retarget 抛错、`updateCar`/`updateSuspension` 拒绝跨代模型；这些断言实测通过。

### 2.3 资源与内存

- 16 次轴距重建（`browser-rebuild-heap.log`）：重建前 `renderer.info.memory` = 411 geometries / 16 textures / 18 programs，重建后完全相同；`totals.instanceMaterialCreated=119`、`instanceMaterialDisposed=112`，差 7 等于当前活材质；`lastBuild.instanceMaterialCreated=7=disposed`、`geometryDisposed=387`。无 GPU 资源增长。
- 3 轮“40 次显示/剖视切换 + 1 次模型弹窗”后（`browser-leak-rounds.log`）：精确 heap 6.79 → 7.22 → 7.36 → 7.43 MB，增量逐轮递减（0.43/0.15/0.07 MB）；renderer geometries 411→412 后稳定，textures 16 稳定，活材质 7 稳定；window 事件监听数 6→6。没有发现与操作次数成正比的泄漏；第一轮增加主要来自首次打开自检列表 DOM、JIT 与缓存。
- `FSApp.dispose()`（`browser-memory-lifecycle.log`）：调用两次返回完全相同的 `lastTeardown`；`lastTeardown` = 7 实例材质、40 共享材质、7 缓存材质、470 几何、14 纹理；`rendererMemoryBefore={411,16,18}`，`rendererMemoryAfter={0,0,1}`（geometries/textures 归零，programs 保留 1）；画布从 DOM 移除；dispose 后 700 ms 内 `requestAnimationFrame` 计数不再增加。主路径释放成立。
- 重建后 `lastBuild` 的计数在 teardown 时被二次累加（见 §4.4），这是诊断口径问题，不造成资源泄漏。

### 2.4 性能与 `simBuildModel` 优化

- 用 `git show 2999731:src/js/05-body-dynamics.js` 的优化前实现与当前实现同进程对比（`compare-buildmodel.log`）：默认、slope 8/bank 7、friction 0.35/steer 0.12、mass 750 四组 `simBuildModel` JSON 长度与内容逐字节相同；各推进 200 个物理步后仍逐字节相同。
- 遥测读取不污染后续物理：同一初始状态的两个 sim，一个每步额外调用两次 `simBuildModel`，500 步后完整 state/time/contact JSON 完全相同；同一 sim 连续 21 次 `simBuildModel` 结果相同；存在 `sim.reference` 时传入不同 `source` 参数不影响模型（`compare-buildmodel.mjs`）。O1 种子所有权没有被 B6 优化破坏。
- `bench.mjs` 两轮（并发负载）：第 1 轮 loadavg 31.6→19.7、wall 70.97 s（`bench-1.log`）；第 2 轮 loadavg 25.2→26.7、wall 100.85 s（`bench-2.log`）。两轮总体均 PASS，但余量差异明显：

| 指标（均值 / 中位 / p95） | 第 1 轮 | 第 2 轮 | 预算 | 判定 |
| --- | --- | --- | ---: | --- |
| 单子步 | 0.0178 / 0.0172 / 0.0238 ms | 0.0351 / 0.0276 / 0.0798 ms | 0.05 ms | 两轮 median PASS；第 2 轮 p95 超预算 |
| 每子步 suspEval | 4.065 / 4.06 / 4.08 次 | 4.065 / 4.06 / 4.08 次 | 30 | PASS |
| `simBuildModel` 热稳定 | 0.0347 / 0.0331 / 0.0612 ms | 0.0595 / 0.0471 / 0.1979 ms | 0.05 ms | median PASS（第 2 轮仅差 6%）；p95 明显超预算 |
| `computeStatic` | 0.0905 / 0.0751 / 0.1981 ms | 0.2439 / 0.1108 / 1.0114 ms | 8 ms | PASS |
| `simCreate` | 16.61 / 16.56 / 21.35 ms | 26.11 / 21.71 / 44.38 ms | 60 ms | PASS |
| 静态自检缓存 | 0.0000 ms、calls=1、runs=1 | 0.0000 ms、calls=1、runs=1 | 不重跑 | PASS |

与 acceptance 的最终值（0.0180/0.0170/0.0257 ms、hot 0.0233 ms、computeStatic 0.0592 ms、simCreate 11.70 ms）相比，并发负载下中位数上升约 1.4–1.9 倍；第 2 轮 `simBuildModel` 中位已达 0.0471 ms（预算 0.05 ms），说明“预算有较大余量”的判断依赖宿主负载，bench 判定应同时报告 p95（见 §4.3）。

### 2.5 构建、dev-server 与常规回归

- `npm test` 50/50 + 80/80、`test:invariants` 27/27、`test:runtime` 78/78、`test:dev-server` 12/12、`ci:node` 退出 0；`build:check` 输出 1,021,578 B、sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`，与 acceptance 一致。
- 构建替换对 `$&`、`$$`、反引号、`$'` 均按字面保留（`build-escape.log`），说明 `replace(..., () => value)` 的函数式替换正确。
- dev-server：`/..%2fREADME.md`、`/%2e%2e/%2e%2e/etc/passwd`、`/a/../../../../etc/passwd`、`/..%5c..%5c...` 均 403；NUL 400；malformed percent 400；POST/PUT/DELETE/OPTIONS 405 + `Allow: GET, HEAD`；HEAD 200 且 body 为空；symlink 指向 root 外 403；绝对形式请求目标返回 404；`/src`、`/src/` 404，无目录列表。
- file:// 离线、localStorage 读写、无外部网络请求（test-ui-browser 的 offline 组）均通过；本次未修改任何跟踪文件。

## 3. P2 发现

### 3.1 P2：`test:runtime` 在子步数不一致时反而判 PASS（测试门禁假绿）

**证据。** `tools/test-runtime.mjs:105-110`：

```js
const steps2 = Math.round(sim.time / physics.SIM_DT);
physics.simRunFor(ref, 0);
const delta = steps2 === Math.round(ref.time / physics.SIM_DT)
  ? Math.abs(sim.state.y - refState[0]) + ...
  : 0;                       // <-- 不一致时 delta 被置 0
check(fps + ' Hz state matches fixed stepping', delta <= 1e-12, ...);
```

在临时副本中令 60 Hz 用例的第 4 帧不执行（少 1 个子步）：原判据输出 `PASS 78/78 checks`，四个 `state matches fixed stepping` 均为 `ok … [0.00e+0]`；仅把 `: 0` 改为 `: Infinity` 后，同样输入输出 `FAIL 4 check(s) failed`（`test-runtime-fault-masked.mjs` / `test-runtime-fault-unmasked.mjs`，日志 `test-runtime-fault.log`）。

**期望 vs 实际。** 期望“帧率切换后步数/状态与固定步进一致”；实际当步数不一致时该三元表达式把差值归零，恰好绕过要检查的条件。**影响**：`test:runtime` 是 acceptance 条件 7（帧时间语义）与 ci:node 的门禁；任何导致每帧少/多执行子步的回归都可能以 78/78 通过，而 state 差异只有在步数一致时才被检查。**修复方向**：步数不一致直接失败（`delta = Infinity` 或先 `check('... step count', steps2 === refSteps)`），并把 `steps2/refSteps` 写入 detail。**置信度**：高（已故障注入复现）。

### 3.2 P2：`audit:baseline` 的退出码不绑定审计错误/跳过，`audit:update` 可在无 Chrome 时缩小基线

**证据。**
- `tools/audit/run-all.mjs:225-239` 计算了 `aggregate.pass = errors.length === 0 && reports.every(pass)`；但 `:255-257` 在 `--expect-baseline` 时只按 `baseline.pass` 决定退出码，`aggregate.errors` 不参与；`tools/audit/run-all.mjs:148-169` 的 `compareAllToBaseline` 也只比较各 check 的 pass/fail，不检查 `report.error`。
- `tools/audit-browser/_cdp.mjs:139-145`：Chrome 缺失且未设置 `FS_REQUIRE_CHROME` 时调用 `audit.skip(...)` 并返回；此时 report 无 error、无 check；`tools/audit/run-all.mjs:241-249` 的 `--update-baseline` 只在 `errors.length` 时拒绝，因此会写出一个不含浏览器 check 的基线。之后同一无 Chrome 环境执行 `--expect-baseline`，由于基线本身也不含这些 ID，`missing-in-report` 不会出现，基线可 match。
- 本次尝试直接用 `CHROME_PATH=/nonexistent` 复现时，`_cdp.findChrome` 仍回退到 `/usr/bin/google-chrome`，浏览器组实际运行（`baseline-nochrome.json` 仍为 51 checks，`audit:baseline` match），故 skip 路径未在活体环境强制复现；上述结论来自源码分支与退出码的直接阅读，标记为“高置信静态结论、动态复现受限”。

**期望 vs 实际。** 期望“基线审计只有在所有脚本成功、无错误、无跳过时才通过”；实际 `--expect-baseline` 可在存在审计 error 或浏览器 skip 的情况下以 0 退出。**影响**：发布门禁 `npm run audit:baseline` 可能给出绿色但缺少错误/浏览器覆盖；`audit:update` 若在无 Chrome 的机器执行，会把浏览器合同从基线中静默删除。**修复方向**：`--expect-baseline` 退出码加入 `errors.length === 0 && reports.every(report.pass)`；`--update-baseline` 拒绝 `report.pass===false`/`skipped.length>0` 的报告；基线记录 skipped/required 脚本清单；CI 始终设置 `FS_REQUIRE_CHROME=1`。**置信度**：高（源码逻辑明确）；动态复现受固定 Chrome 路径限制。

### 3.3 P2：`pagehide` 无条件 teardown，bfcache 返回后页面死亡

**证据。** `src/js/40-app.js:586-588`：

```js
window.addEventListener('pagehide', () => {
  if (typeof teardownScene === 'function') teardownScene();
}, { once: true });
```

处理器忽略 `event.persisted`，也没有 `pageshow` 恢复入口；`teardownScene`（`src/js/10-scene.js:1652-1743`）释放渲染器、移除画布并把 `S.scene`/`S.camera`/`S.renderer` 置 null；`animate`（`src/js/40-app.js:519-561`）没有 teardown 守卫，也没有在 teardown 时取消 rAF。

浏览器实测（`browser-memory-lifecycle.log`，合成 `pagehide({persisted:true})` 后 `pageshow({persisted:true})`）：pagehide 后画布从 DOM 移除、`FSApp.ready` 仍为 true；pageshow 后画布仍不存在、`getAssetStats().renderer=null`、`dataset.fsReady` 仍为 `"1"`；同时捕获 `Uncaught TypeError: Cannot read properties of null (reading 'quaternion')`（teardown 后下一次 animate 在相机/场景访问时抛错），rAF 停止。

**期望 vs 实际。** 期望 browser 前进/后退（bfcache）返回时页面仍可用，或至少检测到 persisted 并跳过 teardown/在 pageshow 重建；实际只要发生 pagehide 就永久销毁应用，返回后是空白视口且不再渲染。**影响**：用户点击站外链接再后退（Chrome 桌面 bfcache 常见路径）会丢失 3D 演示；`FSApp.dispose()` 作为公开 API 使用时也会在下一帧抛出未捕获异常。**修复方向**：pagehide 中判断 `event.persisted`，persisted 时不 teardown；或在 pageshow 中重建；最外层 animate 增加 `if (!booted || !S.renderer) return;` 并保存/取消 rAF id；teardown 完整移除监听、断开 ResizeObserver。**置信度**：高（合成事件已复现；真实跨页 bfcache 未在无头环境导航验证，见 §6）。

### 3.4 P2：B5.2 审计与 `test-dynamics-browser` 的固定等待/同代对比可产生“未重建也通过”

**证据。**
- `tools/audit-browser/audit-browser-contract.mjs:31-72`：`setState({wheelbase:3.90},{rebuild:false})` 后仅 `sleep(2600)`，然后比较 `afterScene.wheelPos`（场景）与 `after.solved.wheelPos`（同一 `liveModel()` 求解结果）的 x/z 差，并只记录 `afterWheelbase` 而不设阈值。若 2.6 s 时 `pendingRebuild` 仍为 true，场景和 `solved` 都来自旧代，二者天然一致（gap=0），`B5.2/geometry-generation` 会 PASS；它没有断言 `pending===false`、`sceneRevision===physicsRevision`、`state.wheelbase` 与实际轮距、或模型已是新代。
- `tools/test-dynamics-browser.mjs:146-151` 同类：`setState({wheelbase:3.70}); sleep(1800);` 后检查 `rebuilt.state.wheelbase===3.70 && rebuilt.contactOk`；`state.wheelbase` 来自输入状态、`contactOk` 来自旧 `liveModel()`，即使重建尚未提交也能通过。
- 并发负载下的重建耗时实测（`browser-rebuild-heap.log`，16 次重建，loadavg 约 25–32）：单次提交耗时 1.45–4.47 s，中位数约 2.65 s——已超过 B5.2 的 2.6 s 固定等待，也接近/超过 dynamics-browser 的 1.8 s+1.2 s 等待。正常情况下重建约百毫秒级，但测试门禁在并发 CI 下会进入上述假绿窗口。
- 正确行为已由合成 rAF 实验验证（`browser-synth-raf.log`）：20 次快速尺寸变更后中间 `pending=true`、旧 revision，泵 8 帧（96 ms 合成时间）后 `pending=false`、revision 4/4、跨度 3.580005 m、`mismatch=false`；说明代码本身正确，问题在断言等待与观测对象。

**修复方向**：所有几何用例改为 `waitFor('pendingRebuild === false')`，并断言 `geometry.sceneRevision === geometry.physicsRevision === 当前 geometryRevision`、`state.wheelbase` 与 `getSceneProbe().wheelPos` 前后轴跨度一致、`geometry.commitCount` 增量与请求次数一致；删除固定 sleep。**置信度**：高（源码 + 负载实测 + 合成时钟成功路径）。

### 3.5 P2：`ci:browser` 在无 Chrome/显式跳过时以 0 退出（SKIP 当通过）

**证据。** `package.json:31` 的 `ci:browser` 只是 `npm run test:browser && npm run test:camera && npm run test:ui`；三个脚本内部 `browserGate`（`tools/browser-runner.mjs:39-57`）在未设置 `FS_REQUIRE_CHROME=1` 时对缺失 Chrome 执行 `process.exit(0)`，在 `FS_SKIP_BROWSER=1` 时同样退出 0。实测（`ci-browser-skip.log`）：

```text
CHROME_PATH=/nonexistent npm run ci:browser
SKIP dynamic: no Chrome/Chromium binary found ...
SKIP camera: no Chrome/Chromium binary found ...
SKIP ui: no Chrome/Chromium binary found ...
EXIT=0
```

`FS_SKIP_BROWSER=1 npm run ci:browser` 亦为 EXIT=0。同时 `ci:node`（`package.json:15`）与 `ci:browser` 都不包含 `build:check`；非 UI 浏览器测试直接加载已提交的 `index.html`（`tools/test-dynamics-browser.mjs:32`、`test-camera.mjs:64`）。

**影响**：CI 若直接使用仓库提供的 `ci:browser`，无 Chrome 时会全绿但没有浏览器覆盖；源码变更而产物过期时也可能测试旧产物。README/acceptance §6.2 要求“CI 必须设置 FS_REQUIRE_CHROME=1”，但脚本本身没有落实，属于可被默认路径触发的发布风险。**修复方向**：在 `ci:browser` 内导出/前置 `FS_REQUIRE_CHROME=1`（跨平台用 node 包一层），CI 环境变量 `CI=1` 时默认 required；把 `build:check` 纳入统一 `ci` 脚本；浏览器测试启动前校验产物哈希。**置信度**：高（命令实测）。

### 3.6 P2：计划要求的浏览器帧时间/几何 pending/teardown 断言没有落地

**证据。** `docs/plan/parts/03-runtime.md` 明确写入了浏览器验收：
- `:100`：B3-1 浏览器侧“2 s 后 `sim.timeScale>0.95`、`droppedTime<0.02`、`maxFrameDt=0.5`、`maxSubsteps=128`”，以及用 `Page.addScriptToEvaluateOnNewDocument` 包装 rAF 的 10 Hz 限帧用例；
- `:179/181`：B3-2 浏览器断言 `pending` 窗口逐帧 `physicsRevision`/`resetCount` 不变、提交后 `sceneRevision===physicsRevision`、快速两次改尺寸 `commitCount` 增量 ≤2；
- `:237`、`:258-271`（C1/C7/C8/C14）：连续 10 次重建后 renderer geometries/textures/programs 漂移上限；`FSApp.dispose()` 后 `lastTeardown`、`renderer.info.memory.geometries===0`、`textures===0`、`MAT/TEX` 清空、再次调用无副作用。

实际仓库中：`test-runtime.mjs` 只加载 `00-core/03-suspension/05-body-dynamics/20-car/22-car-dynamics`（`:16-32`），不加载 `40-app.js`/`30-ui.js`，因此不覆盖 `animate`、`refreshAll`、`processPendingRebuild`；`grep` 全部 `tools/test-*.mjs` 没有 `addScriptToEvaluateOnNewDocument`、没有 `timeScale` 的浏览器断言、没有 `lastTeardown` 断言；B5.2 的浏览器审计只有一次 3.90 m 变更（§3.4），test-dynamics-browser 的几何断言也不检查 revision/pending。acceptance §6 只承认“能量/动量”和“`FSApp.dispose()` teardown”两处缺口，未记录帧时间/几何 pending 的浏览器缺口。

**影响**：0.3.0 修复声明中“帧时间语义由 test-runtime 覆盖”“B5.2 由 audit-browser 覆盖”成立但只覆盖 Node 层或弱浏览器层；真正包含 rAF、85 ms 节流、pending 冻结、提交原子性的应用编排没有自动化回归。合成 rAF 实验已证明这些断言可稳定实现（30/10/5/2 Hz、120 s 卡顿、20 次尺寸变更、dispose 均可测），因此这不是环境不可行，而是测试未落地。**修复方向**：新增 `tools/test-runtime-browser.mjs`（端口 0 + rAF 注入 + 合成时间戳），按 `03-runtime.md` 的 C1/C7/C8/C14 落地；teardown 断言按实际语义修正（见 §4.4/§4.5）。**置信度**：高（计划文本与测试文件对照 + 本次可运行原型）。

## 4. P3 发现（清单）

### 4.1 P3：构建脚本的 `</script>` 防护只匹配小写，占位符缺失不报错

- `tools/build.mjs:21-23` 只检查 `source.includes('</script>')`；HTML 结束标签大小写不敏感。临时副本注入 `</SCRIPT>`/混合大小写后构建**成功**，产物含大写结束标签；注入小写则正确抛错（`build-escape.log`）。把大写坏产物在无头 Chrome 加载：无 `data-fs-ready`、`errorScreen` 仍 hidden、加载遮罩未完成；同目录正常产物 `data-fs-ready="1"`（`bad-upper.dom.html` vs `good.dom.html`）。
- `tools/build.mjs:25-31` 只在“模板中还存在占位符”时报错；把 `/*__APP__*/` 从模板删掉后构建仍返回成功（`build-escape.log` 的 `missing placeholder BUILT (bad)`），生成无应用代码的页面。`check-build` 从同一套源码重算，因此也会“一致通过”。
- 影响：当前源码没有这种字符串，故非现网缺陷；但构建门禁无法防止未来源码/模板编辑导致的静默坏产物，且 `ci:browser` 可被 skip 绕过（§3.5）时风险叠加。修复：大小写不敏感匹配 `/<\/script\b/i`，对每个占位符断言恰好替换一次且替换后不存在；增加 HTML 语法/启动冒烟（或至少 `renderIndexHtml` 后检查 app 标记）。置信度：高（已复现）。

### 4.2 P3：dev-server 默认暴露仓库 dotfiles（仅 localhost）

`tools/dev-server.mjs:18-33` 只做目录边界，未做文件白名单；`resolveRequestPath(root,'/.git/config')` 返回 200，实测 `GET /.git/config`、`GET /.git/HEAD` 均可读；临时根目录下 `GET /.env` 返回 200 和明文内容（`devserver-probe.log`）。服务绑定 127.0.0.1，且跨源 fetch 受同源/CORS 限制，风险低；但本地任意进程或本机恶意页面通过导航仍可读取。修复：deny `.git`、`.env`、`node_modules` 等路径，或仅暴露构建所需白名单；加 `X-Content-Type-Options: nosniff`。置信度：高（静态 + 实测）。

### 4.3 P3：bench 以中位数判定，p95 可超预算；coldRounds 命名易误导

- `tools/bench.mjs:271-320` 的判定对 `simBuildModel` 使用 `hotStable`（三轮中位数）与 `singleSubstep.median`；两轮并发负载下 `simBuildModel` 的 `hotP95` 分别为 0.0612 / 0.1979 ms，均超过 0.05 ms 预算，但总体 PASS（`bench-1.json`、`bench-2.json`）。第 2 轮 median 0.0471 ms 已接近预算。如果预算是“绝大多数帧”的上限，应同时约束 p95/mean；若预算只约束典型值，应在文档/输出中明确。
- `tools/bench.mjs:142-150` 的 `coldRounds` 每个 round 先建一个 fresh sim，然后在该 sim 上跑 200×20 次构建；只有第一次是真正的 cold，后续是热路径，因此 `coldStable` 的名称/注释比实际语义强。`coldStart` 单独测首调是合理的。
- 影响：性能结论与预算口径可能被误读；不影响当前远低于预算的 PASS。修复：输出中并列 median/p95 判定，或限定 p95；把 coldRounds 改名为 freshSimWarmupRounds 或在文档说明。置信度：高（JSON/源码）。

### 4.4 P3：`lastBuild` 在 teardown 时被二次累加；`policy` 提交成功后仍可能显示 pending

- `src/js/20-car.js:286-290`：`disposeGroupChildren` 无条件把 disposed 计数加到 `CAR.assets.lastBuild`；teardown 调用 `disposeGroupChildren(S.scene)`（`src/js/10-scene.js:1664`）后，`lastBuild.instanceMaterialCreated=7` 但 `instanceMaterialDisposed=14`、`geometryDisposed=851`（387+464，`browser-memory-lifecycle.log`）。`contracts.v1.md:141` 明确 `lastBuild` “本次构建计数，不是累计值”，teardown 后已不成立。修复：teardown 传 `{updateLastBuild:false}`，或 teardown 后重置 `lastBuild`；为 `disposeGroupChildren` 增加选项并用测试覆盖。
- `src/js/40-app.js:93-95` 提交成功后未更新 `PENDING.lastPolicy`；快速尺寸变更期间 `refreshAll` 在 `:109` 写入 `'pending'`，提交后快照仍为 `policy:'pending'` 而 `pending:false`、`commitCount:1`（`browser-synth-raf.log`、`browser-compact.log`）。诊断/契约消费者可能误判状态。修复：成功提交时写 `lastPolicy='committed'` 或原始 reason 并清空 reason；失败路径保留 failed 状态。置信度：高（浏览器实测）。

### 4.5 P3：审计脚本独立性与证据元数据

- **B4.5 审计同源对比**：`tools/audit/audit-contact-gap.mjs:19-31` 把 `model.contactPoints` 与 `model.solved[i].contact` 相减；但两者都由 `evaluation.corners[i].contact` 构造（`src/js/05-body-dynamics.js:949-953` 与 `:1007`），x/z 恒相同，距离实际只检查 y=0，故 `B4.5/default-sample` 与 `B4.5/attitudes` 无法发现“两套接地点”回归；只有 `/contact-plane`、`/fallback-full-quaternion` 有独立信息。修复：由硬点/姿态独立重算一个接地点，或强制物理层产生两个字段做差分。
- **B5.4 浏览器阈值弱于声明**：`tools/audit-browser/audit-browser-contract.mjs:97-103` 只要求 `material>=3 && geometry>0`；`tools/test-ui-browser.mjs:383-386` 同口径（`>=3 && >0`）。而实际一次重建是 7/387，DESIGN 20.10 的 7/7 等式只在 Node synthetic assets 组覆盖。修复：浏览器断言 `instanceMaterialCreated-Disposed===7`、`geometryDisposed>=300`、连续重建活材质数不增长；用 `getAssetStats().totals` 做等式。
- **审计 provenance 硬编码**：`tools/audit/_harness.mjs:6-7` 固定 `APP_VERSION='0.3.0'`、`COMMIT='fbb401d'`；`fbb401d` 是 0.2.0 提交，而当前 HEAD 为 `45983ca`，acceptance 记录的是 `cbed2d6`。所有 audit JSON/基线都声称在 `fbb401d` 上运行（本次 `baseline-nochrome.json` 仍输出 `commit:"fbb401d"`）。修复：从 `git rev-parse --short HEAD`/package 读取并在报告中记录 dirty 状态；加版本一致性检查。置信度：高（文本 + 生成物）。

### 4.6 P3：浏览器测试基础设施的并发/超时/端口脆弱性

- `tools/browser-runner.mjs:150-156` 的 watchdog 在 launch 前启动，只在 `cleanup()`（`client.close`）时 `clearTimeout`；因此 90 s 限制的是**整个测试会话**而非 launch。UI 测试 acceptance 单次 54–69 s，只剩 21–36 s 余量；本次并发负载下一份紧凑浏览器会话耗时 88.2 s，另一份在 90 s 被 `FAIL browser environment: timed out` 终止（`browser-compact.log`、首份 `browser-runtime.log`）。修复：ready 后清除/重建 watchdog，或改名 `sessionTimeoutMs` 并按测试总时长设定；单次 evaluate 用独立超时。
- `tools/audit-browser/_cdp.mjs:49` 固定随机区间 `9300+rand*500`，`tools/capture-docs.mjs:21` 使用 `9600+rand*200`；并发运行可能撞端口，Chrome 启动失败或 CDP 连到别的页面；`browser-runner` 已正确使用 `--remote-debugging-port=0` + `DevToolsActivePort`，应把同一做法用于审计/截图。修复：端口 0 + 读 `DevToolsActivePort`，或用随机高位端口并校验 `/json/version` 的 profile 路径。
- `tools/capture-docs.mjs:23-53` 的 `openPage` 在 target 等待失败时没有 try/finally 关闭已 spawn 的 Chrome/profile；`check-build.mjs:50-62` 的临时文件 unlink 也不在 finally 中。属工具清理项。

### 4.7 P3：其他

- `tools/test-runtime.mjs:55-60` 的 `frames()` 把每帧累计 `sim.droppedTime` 相加，而不是取最终差值；当前 2 Hz 用例只有 2 帧，恰好等于最终值（0.244），若扩展到 3+ 慢帧会过计。修复：记录初值，最后 `sim.droppedTime - initial`。
- `tools/audit/audit-frame-time.mjs:77-88` 对 10/5 Hz 的判据允许 `advanced < 0.98`，只要 `advanced+dropped >= 0.98` 且 dropped>0；因此“10/5 Hz 退化为慢动作并显式丢时”也会通过 B5.1，而 `test:runtime` 对 10/5 要求 `advanced≈1、dropped=0`。审计与测试口径不一致，建议审计同样要求 10/5 实时，或把 2 Hz 慢动作单列。
- `src/js/40-app.js:281` 截图署名仍为 `DESIGN.md v0.2`，而 0.3.0 页脚/版本为 v0.3.0；导出 PNG 的版本标识过期。修复：用 `APP_VERSION` 或 `designVersion` 常量。
- `README.md:180` 的“超过上限的输入才丢弃并计入 droppedTime”容易被读成“只有单帧 >0.5 s 才丢”；实际 2 Hz 稳态每帧接受 0.5 s、因 128 子步排空能力只有 0.256 s，积压触顶后仍会丢弃 0.244 s/帧。属口径精度问题，建议改为“超过单帧接受上限或积压上限（含排空能力不足造成的积压触顶）”。
- `src/js/10-scene.js:1743` teardown 后 `MAT/TEX` 对象未清空（仅逐个 dispose 并标记），与 `docs/plan/parts/03-runtime.md:237` 的“MAT/TEX 为空”断言不一致；由于不支持同页 re-boot，当前无功能影响，但若未来补测该断言会失败。建议清空或修正计划口径。

## 5. 测试与文档缺口（汇总）

1. **应用编排层无自动化测试**：`40-app.js` 的 `animate/refreshAll/processPendingRebuild/setState/resetAll/exportScreenshot` 与 `30-ui.js` 的遥测缓存未进入 Node 测试；浏览器侧只有 UI 的间接断言。B3-1/B3-2 计划中的浏览器断言（`docs/plan/parts/03-runtime.md:100/179/181/237`）未落地，acceptance §6 未记录这些缺口（只记录能量/动量与 teardown）。这是本轮 P2-3.6。
2. **teardown 覆盖仍缺**：acceptance §6.2 已承认 `FSApp.dispose()` 未自动断言；本次独立浏览器测量验证了实际行为，但 `lastBuild` 口径（§4.4）与 `programs=1` 的语义需要一并定义。
3. **几何 pending 的测试口径**：B5.2 与 dynamics-browser 的固定 sleep/状态断言无法证明“使用了新代”；应改为 revision/commitCount/span 断言（§3.4）。
4. **Node 18/20 未实测**：本机只有 Node v24.19/v24.22；静态扫描未发现非浏览器路径使用 Node >18 的 API（`WebSocket` 只在已 gate 的浏览器工具中），但 `engines >=18` 的下限仍只有声明，无矩阵证据。`test:ui`/`test:browser`/`test:camera`/audit browser 依赖 Node 21+ 全局 WebSocket，与 README 一致。
5. **浏览器证据的可复现性**：Chrome 156 + SwiftShader；queue 案例的固定 sleep 与 watchdog 余量在并发负载下脆弱；bench 证据放在被忽略的 `.tmp-test` 日志（b6-final-review 已指出），本次 bench 也只在 `.tmp-review`，建议把关键原始 JSON 附到受版本控制的记录。
6. **计数口径**：`test-runtime` 的 `frames()` 过计 dropped（§4.7）；`test-runtime` 失败时输出“78/78 checks”而非通过数（`:233`），易误读；建议统一为 `passed/total`。
7. **文档一致性**：README 的帧时间“超过上限才丢弃”表述、DESIGN 20.10 与 `03-runtime.md` 的 `lastBuild/MAT/TEX` 口径、截图 v0.2 署名、审计 `commit fbb401d` 与 0.3.0 HEAD 不一致（§4.5/§4.7）。

## 6. 覆盖限制

- 审阅期间宿主 loadavg 19–42，其他审阅 agent 并发运行 Chrome/Node；**真实墙钟浏览器帧率与耗时不可作为时序结论**。帧语义结论来自 Node 直接调用与合成 rAF 时钟；内存/资源计数与墙钟无关，仍可用。浏览器真实页面在极端负载下出现 0–3 帧/3 s，正是 §4.6 watchdog 超时与 §3.4 固定等待风险的来源，但不是应用实现的独立证据。
- 合成 rAF 实验的 60 Hz 首用例受“真实 rAF → 合成时钟”切换的第一帧 dt 伪影影响（1.482 s），已从结论中剔除；30/10/5/2 Hz、120 s 卡顿、几何提交均与 Node 一致。
- bfcache 结论通过合成 `pagehide({persisted:true})`/`pageshow` 事件验证；没有在无头环境做真实跨页导航/历史返回，因此真实 Chrome bfcache 的用户可见影响需一次人工导航复核。
- 未安装 Node 18/20，未验证 `engines >=18` 的下限；未在硬件 GPU 上测渲染性能；未运行完整 10 连跑 UI/完整 `npm run audit`（避免与并发审阅争抢浏览器）；审计 skip 路径的活体复现受 `_cdp.findChrome` 固定回退路径限制，§3.2 的该部分为高置信静态结论。
- 未修改任何被跟踪文件；`git status --short` 本审阅结束时只应出现 `?? docs/review/`（以及其他审阅流自己的报告），`.tmp-review/` 为忽略目录。本报告的实验脚本与日志全部在 `.tmp-review/runtime/`。

## 7. 证据索引（可复现命令）

```bash
# 1. 帧时间矩阵与记账
node .tmp-review/runtime/frames.mjs

# 2. test-runtime 假绿注入对比
node .tmp-review/runtime/gen-fault-test.mjs
node .tmp-review/runtime/test-runtime-fault-masked.mjs    # PASS 78/78
node .tmp-review/runtime/test-runtime-fault-unmasked.mjs  # FAIL 4
# 原版
node tools/test-runtime.mjs

# 3. simBuildModel 优化前后
node .tmp-review/runtime/compare-buildmodel.mjs

# 4. 浏览器运行时/资源（需 Chrome 156；均使用端口 0 + 临时 profile）
node .tmp-review/runtime/browser-synth-raf.mjs
node .tmp-review/runtime/browser-compact.mjs
node .tmp-review/runtime/browser-memory-lifecycle.mjs
node .tmp-review/runtime/browser-rebuild-heap.mjs
node .tmp-review/runtime/browser-leak-rounds.mjs
node .tmp-review/runtime/browser-profile.mjs

# 5. 构建/dev-server
node .tmp-review/runtime/build-escape.mjs
node .tmp-review/runtime/devserver-probe.mjs

# 6. 门禁与基准
CHROME_PATH=/nonexistent npm run ci:browser   # 三个 SKIP，EXIT=0
npm run ci:node
node tools/bench.mjs --out .tmp-review/runtime/bench-1.json
node tools/bench.mjs --out .tmp-review/runtime/bench-2.json
```

日志/数据：`frames.log`、`test-runtime-fault.log`、`compare-buildmodel.log`、`browser-synth-raf.log`、`browser-compact.log`、`browser-memory-lifecycle.log`、`browser-rebuild-heap.log`、`browser-leak-rounds.log`、`browser-profile.log`、`build-escape.log`、`devserver-probe.log`、`ci-browser-skip.log`、`ci-node.log`、`node-regression.log`、`bench-1.log/json`、`bench-2.log/json`，均位于 `.tmp-review/runtime/`。

## 8. 审阅结论

0.3.0 的运行时主路径（固定步长、慢动作与 droppedTime、几何代际、重建资源释放、`simBuildModel` 优化确定性）经独立复跑成立，未发现会直接导致物理结果错误或页面启动失败的 P0/P1 缺陷。需要优先处理的是门禁可信度与页面生命周期：`test:runtime` 的步数判据、audit baseline 的退出码/更新路径、B5.2/浏览器几何用例的固定等待、`ci:browser` 的 SKIP 语义、bfcache 返回后页面死亡，以及计划中的浏览器断言未落地。它们共同决定了 0.3.0 的“全绿”是否真的覆盖了应用编排层，建议在阶段三开工前至少修复 §3.1–§3.5，并把 §3.6 的浏览器 runtime 测试作为配套回归。
