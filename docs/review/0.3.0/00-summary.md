# 0.3.0 对抗性审阅总报告

> **历史评审｜基线：0.3.0 / `45983ca`。** 本报告及分报告保留当时的发现与交付判定，不代表当前状态。0.4.0 已关闭项见 [状态映射](status-mapping.md)；其他发现以 0.4.1 最终验收为准，当前状态以根 README/DESIGN 及最新验收为准。

| 项目 | 内容 |
| --- | --- |
| 审阅对象 | `formula-simulator` 0.3.0，HEAD `45983ca62057060611f71150734e45caefac50a2`（工作区干净，仅新增 `docs/review/`） |
| 产物基线 | `index.html` 1,021,578 B，sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`；`build:check --strict` 通过 |
| 审阅方式 | 5 个独立智能体并行对抗审阅 + Lead 独立复现与交叉核对；全部实验在 `.tmp-review/` 下，未修改任何被跟踪文件 |
| 环境 | Node v24.22.1；Google Chrome 156.0.8078.47；linux/x64；无头模式 SwiftShader；宿主 loadavg 19–42 |
| 时间 | 2026-11-19 04:41–05:30（Asia/Hong_Kong） |
| 分报告 | [01-physics.md](01-physics.md)（271 行）、[02-visual.md](02-visual.md)（221 行 + 补充）、[03-ui.md](03-ui.md)（189 行）、[04-runtime.md](04-runtime.md)（286 行）、[05-features-docs.md](05-features-docs.md)（283 行）；补充报告 [06-body-mechanism-fit.md](06-body-mechanism-fit.md) |
| 结论 | **0 个 P0，4 个 P1，19 个 P2，约 30 个 P3**。主路径质量较高，但 0.3.0 目前不能判定为“已完成交付” |

## 1. 审阅组织与基线

五个智能体按领域分工，各自拥有独立的共享任务、写入范围和证据目录：

| 任务 | 智能体 | 范围 | 报告 |
| --- | --- | --- | --- |
| task-1 | physics-reviewer | 六自由度动力学、悬架求解、接触摩擦、确定性 | [01-physics.md](01-physics.md) |
| task-2 | visual-reviewer | 场景、车体、悬架动画、相机、取景、资源重建 | [02-visual.md](02-visual.md) |
| task-3 | ui-reviewer | 控件、遥测、键盘、焦点、响应式、可访问性 | [03-ui.md](03-ui.md) |
| task-4 | runtime-reviewer | 帧循环、几何代际、生命周期、构建、测试与审计链 | [04-runtime.md](04-runtime.md) |
| task-5 | integration-reviewer | 参数链路、导出、持久化、自检、文档一致性 | [05-features-docs.md](05-features-docs.md) |

Lead 除协调外，独立执行了 20 余组探针，包括：CG 高度阶跃与运行态发散、求解失败标志锁存、`dispose()` 后 rAF 异常、bfcache 返回、摇臂不可达工况、动态脉冲求解状态、倾斜路面静动一致性、自由刚体守恒量漂移、1280 布局与自检行挤压、视口提示重叠、截图版本标识等。分报告中标注“Lead 复现”的数值来自这些独立会话，不是智能体之间的转述。

基线复跑结果（本轮实测）：

| 套件 | 结果 |
| --- | --- |
| `npm test`（test:core + test:dynamics） | 50/50 + 80/80 PASS |
| `test:invariants` | 27/27 PASS |
| `test:runtime` | 78/78 PASS |
| `test:dev-server` | 12/12 PASS |
| `test:camera` | 19/19 PASS |
| `test:ui-browser` | 45/45 PASS（独立复跑，产物哈希一致） |
| `bench` | 两轮 PASS |
| `build:check --strict` | 产物与源码一致 |

这些绿灯本身是本次审阅的对象之一。第 4 节的 P2-05 至 P2-10 说明：其中若干套件在对应缺陷存在时仍会全绿。

## 2. 总体结论

0.3.0 在默认参数下的核心链路——固定步长积分、帧时间语义、几何代际、资源释放、悬架几何闭合、相机预设、U1–U4 修复、导出与持久化主路径——经独立复跑成立，没有发现崩溃、渲染错误或默认工况下的物理错误。

问题集中在六个方向：

1. **参数与状态重标定链条**：质心高度滑块会瞬移车身参考点、污染齿条标定，并在“重置姿态”后留下非平衡状态（P1-01）。这是本轮唯一一个用户按正常 UI 操作即可触发、且直接违反 README 承诺的缺陷。
2. **物理求解边界**：复合坡面低速无法重新驻车（P1-02）；摇臂不可达时非法几何仍进入弹簧力链路（P2-01）；求解状态机存在 `ok=false/degraded=false` 的非法组合（P2-02）。
3. **测试与审计门禁可信度**：`test:runtime` 在子步数不一致时反而 PASS（P2-05）；审计基线退出码不绑定错误、可被无 Chrome 环境缩小（P2-06）；几何用例用固定 sleep 且与同代数据比较（P2-07）；`ci:browser` 无 Chrome 时 SKIP 仍退出 0（P2-08）；计划中的浏览器级断言未落地（P2-09）；UI/物理/视觉套件的断言边界过窄（P2-10）。
4. **页面生命周期与构图**：`pagehide` 无条件销毁导致 bfcache 返回后页面死亡（P2-11）；1280 桌面面板遮挡取景与标签（P2-12）；390 竖屏取景裁切且三分之四视角严重溢出（P2-13）；遥测自检行竖排（P2-14）；提示与底栏重叠（P2-15）。
5. **可访问性与文档一致性**：三维相机无键盘路径（P1-03）；画布焦点不可见（P2-16）；选中态未暴露给辅助技术（P2-17）；功能小标签对比度不足（P2-18）；垂向脉冲“在质心处”与实现矛盾（P2-19）；自检“打开即重跑”的承诺不实（P2-03）。
6. **机构与车体包络**：剖视中的摇臂、弹簧—减振器与防倾杆位于车体蒙皮之外，弹簧穿过蒙皮，与 DESIGN“放在车体内部”的表述矛盾（P1-04）。

**交付判定**：不建议在当前状态下宣布 0.3.0 完成。至少应修复 P1-01、P1-02、P1-04 与门禁类 P2（P2-04 至 P2-09），并对 P1-03/P2-12/P2-13 给出明确处置（修复或下调文档声明）。其余 P2/P3 可在阶段三开工前分批收敛。

## 3. P1 发现（4 项）

### P1-01 改变质心高度瞬移车身参考点、污染齿条标定，“重置姿态”失去静力平衡

- **来源**：[05-features-docs.md §3.1](05-features-docs.md)，Lead 独立复现；物理报告与 UI 报告提供了部分侧证。
- **位置**：`src/js/40-app.js:115-120`（`refreshAll` 物理参数分支）、`src/js/05-body-dynamics.js:263-277`（`simRetargetReference`）、`src/js/40-app.js:39-51`（`calibrateRack`）、`src/js/03-suspension.js:559-587`（齿条限幅）、`src/js/05-body-dynamics.js:225-256`（`simReset`）、`src/js/40-app.js:71-105`（`processPendingRebuild`）。
- **复现**：打开页面，暂停并确认静平衡（cgHeight=0.30，载荷 1780/1780/2132/2132 N）；把质心高度拖到 0.35/0.40/0.45/0.50。
- **实际**：车身参考点瞬移 50/100/150/200 mm；四角载荷 8.16/15.82、14.70/42.18、20.17/82.29、29.78/18.73/122.21/122.21 kN；0.50 时齿条饱和 −120 mm、横拉杆拉伸 53.808 mm。点“重置姿态”后载荷仍为 1780/4654/2132/2132 N、齿条 −120 mm、tie 52.092 mm；只有改质量或恢复默认再重置才恢复。运行态 1 s 内可致 heave +453 mm、pitch 4.40°、四轮载荷归零，3 s 仍 +538 mm/9.45°。
- **根因**：`simRetargetReference` 只替换参考模型、保留质心状态，旧质心状态在新 `cgBody` 下等价于参考点平移；随后在异常姿态调用 `calibrateRack`，齿条饱和；`simReset`/`resetDynamics` 不重算齿条，重建路径又是“先 settle 后标定、标定后不再 reset”。
- **影响**：质心高度是文档明确列出的可调参数；正常操作即可产生 4.6–68 倍载荷放大与错误姿态，截图/复制 JSON 会记录异常数据，自检仍可 24/24（见 P2-03）。
- **修复**：保留参考点而非质心（先按 `R(q)·(c_new−c_old)` 平移状态，再 retarget）；用新参考的静力平衡姿态标定齿条；settle 后重标定并再次 reset；成功评估/重置时清除 `solverFailed` 锁存；对载荷/行程包线增加警告。回归覆盖暂停与运行两种状态的 0.30→0.50 扫描、重置、恢复默认。
- **证据**：`.tmp-review/integration/recovery.json`、`cgheight-deterministic.json`、`artifacts/cgheight-bug-0.50-front.png`、`...after-reset-front.png`；Lead 的 `.tmp-review/lead/probe-cg-clean.mjs`、`probe-cg-running.mjs`。

### P1-02 复合坡面低速摩擦无法重新驻车，形成 SLIP 极限环

- **来源**：[01-physics.md §P1-1](01-physics.md)。
- **位置**：`src/js/05-body-dynamics.js:507-530`（HOLD/SLIP 判定）、`:544-631`（逐角摩擦/停止预算）、`:814-845`（dwell）。
- **复现**：`slope=10°、bank=10°、μ=0.3`，沿路面切向注入 0.3 m/s，20 s 后仍为 SLIP：平面速度 4.41e-3 m/s、横摆 1.37e-3 rad/s、`dwell=0`；需求/容量仅 0.838（低于 98% 门限）。μ=0.5 对照 0.662 s 进入 HOLD。UI 可达路径（低附着滑移后把 μ 从 0.2 调到 0.3）同样失败。
- **影响**：坡面+横坡组合下即使附着足够也无法驻车，页面持续显示“滑移”，与 README “静摩擦按法向载荷比例分配，维持坡面驻车”不符。现有低附着自检只测绝对位移，无法发现。
- **根因状态**：逐角滑移方向与横摆耦合形成 2–4 mm/s 极限环是待验证假设；μ=0.5 同阈值可驻车，说明不是单纯 `SIM_ARREST_SPEED` 阈值问题。
- **修复**：低速段改用车身级/3 自由度 QP 静摩擦分配，对平面速度与横摆同时做停止冲量预算，`canPark` 改为“停止冲量可在一个子步内消除平面动量”。回归覆盖 slope+bank 组合、切向扰动、μ retarget。
- **证据**：`.tmp-review/physics/exp7-tilt-repark.mjs`、`exp8-retarget-tilt.mjs`。

### P1-03 三维相机没有键盘操作路径（WCAG 2.1.1）

- **来源**：[03-ui.md §P1-1](03-ui.md)。
- **位置**：`src/js/10-scene.js:1465-1484`（仅 pointer/wheel/dblclick）、`src/js/30-ui.js:1245-1323`（快捷键表无方向键/±/PageUp）。
- **复现**：焦点置于画布，注入 ArrowLeft/ArrowUp/+/−/PageUp；`camera.theta=0.62、phi=1.22、zoom=5.79` 均不变；滚轮可把 zoom 改为 4.2657。
- **影响**：纯键盘/开关设备用户只能使用 5 个预设与重置，无法自由旋转缩放观察悬架机构；项目自述“键盘焦点/快捷键”覆盖可访问性，但该功能不可达。
- **修复**：为画布增加方向键旋转、Shift+方向键平移、`+/−/PageUp/PageDown` 缩放，或提供等价可见控件；帮助模态同步说明；测试断言按键后相机参数变化。
- **证据**：`.tmp-review/ui/exp10.log`。

### P1-04 剖视中的摇臂、弹簧—减振器与防倾杆位于车体表面之外

- **来源**：用户复核指出；Lead 场景探针实测与 Git 溯源，详见 [06-body-mechanism-fit.md §3.1](06-body-mechanism-fit.md)。该几何由 `fbb401d`（0.2.0“悬架动力学改为机构实时反解”）引入：前摇臂与弹簧安装点上移、后轴改低位拉杆，车体包络未同步修改；首轮五个审阅智能体均未覆盖“内部件是否位于车体包络内”这一检查项。
- **位置**：悬架硬点 `src/js/03-suspension.js:24-37`；单体壳 `src/js/20-car.js:740-770`；发动机罩 `src/js/20-car.js:917-927`；弹簧—减振器装配 `src/js/22-car-dynamics.js:848-860`。
- **实测**（默认参数、水平路面、静平衡，车体局部坐标）：前减振器上车体点 y=0.790 m，正下方蒙皮 0.534 m（**+256 mm**）；前防倾杆中心 +183 mm，总成最大 +221 mm；前摇臂板最高 +97 mm；前弹簧上端 0.834 m，约 +0.30 m，比 0.72 m 的前轮顶还高 114 mm。后减振器上车体点 y=0.660 m，变速箱顶 0.440 m（**+220 mm**）；后防倾杆中心 +165 mm（最大 +196 mm）；后弹簧上端约 +0.24–0.27 m。后发动机罩在减振器位置半宽仅约 0.092 m，后弹簧大部分位于罩体与侧箱之间的空隙。前后防倾杆总成 100% 的采样顶点位于蒙皮之上。
- **影响**：剖视（X / M）是 README 的主要展示功能；当前剖视把“内部悬架”画在车体外面，与 DESIGN 20.6“扭杆、轴承座、杠杆臂、叶片、调节环和连接杆都放在车体内部”以及代码注释“inside bodywork, visible in x-ray”直接矛盾，正式文档截图 `docs/03-xray.png` 已带有该现象。正常视图隐藏内部组，驾驶画面不受影响；但前推杆上端高出蒙皮 37 mm，摇臂隐藏后推杆在车体一侧看起来没有附着点。动力学数值不受影响：硬点仍是合法的车体作用点，弹簧/阻尼/防倾杆力与收敛性不变。
- **修复**：优先把摇臂、弹簧—减振器与防倾杆移入车体包络（会改变硬点、运动比与刚度换算，必须重跑运动学、静平衡、脉冲与确定性回归）；或扩大车体并补轴承座、塔顶与开口，保持硬点不变；不要仅隐藏机构。新增包络断言：内部件采样顶点位于车体闭环网格内或低于局部蒙皮，车体侧杆端与蒙皮距离 ≤10 mm。
- **证据**：[evidence/body-fit-front-xray.png](evidence/body-fit-front-xray.png)、[evidence/body-fit-rear-xray.png](evidence/body-fit-rear-xray.png)、`.tmp-review/lead/body-fit.json`、`spring-fit.json`、`probe-body-fit.mjs`。

## 4. P2 发现（19 项）

### 4.1 物理求解边界

| ID | 问题 | 关键证据 | 影响与修复 |
| --- | --- | --- | --- |
| P2-01 | 摇臂不可达时未闭合的 `coilLength` 仍进入弹簧/阻尼力 | `03-suspension.js:382-404/491-511` 保留种子角；`05-body-dynamics.js:397-411` 只检查 `frame.converged`；4.1 工况 376 个样本 `converged=true` 但 `rocker.feasible=false`，残差 18.3–38.2 mm，弹簧峰值 1.5–2.5 kN | 4.1/软悬架的 `rawForce` 为负、被 `max(0,·)` 截断，车体正法向力暂未异常；但非法几何仍生成遥测与中间量，阶段三接入轮胎力后可能放大。力链路门槛改为 `solved.ok` 或显式回退，并加“不可达样本力上限”断言 |
| P2-02 | `motionRatioState`（0.2–0.8）与 `simRatioState`（0.05–2.0）双阈值不一致 | step 118：ratio=0.845683，`motionRatioState='unavailable'`，`ok=false`，但 `degraded=false`，弹簧/阻尼仍更新 | 形成合同禁止的 `solverOk=false` 且 `degraded=false/failed=false` 状态；UI 映射为“求解失败”，警告却写“0 个角点不可达”。统一阈值，任一 `solved.ok=false` 即置 degraded，UI 使用同一状态源 |

### 4.2 状态与自检

| ID | 问题 | 关键证据 | 影响与修复 |
| --- | --- | --- | --- |
| P2-03 | 自检语义与文档承诺不一致，活状态故障可被 24/24 掩盖 | `30-ui.js:508-534` 缓存 revision 未变即返回；README:188/DESIGN:640 称“打开说明时重新运行”；参数变化后仍显示旧动态结果且无陈旧标记；P1-01 故障态下 `runSelfTests()` 仍 14/14、动态 10/10 | 把文档改为“按 revision 缓存”，或强制重跑；显示“当前参数未验证”；增加 live 检查（solverState、rack、tieRod、最大载荷/行程），避免 24/24 与 failed 徽标同时无解释出现 |
| P2-04 | 异常后“恢复默认”不能完全清除失败状态 | 0.50 故障后点恢复默认：state 已等于 DEFAULTS，但 `solverFailed=true`、徽标仍“求解失败”、前轴左右差约 5–10 N；再点一次“重置姿态”才恢复 | 重建顺序改为“标定→reset→settle”或 settle 后再次 reset；成功重标定后清除 `solverFailed/solverFailureSteps`；加“故障→恢复默认→无 badge/载荷对称”回归 |

### 4.3 测试与审计门禁

| ID | 问题 | 关键证据 | 影响与修复 |
| --- | --- | --- | --- |
| P2-05 | `test:runtime` 在子步数不一致时反而 PASS | `tools/test-runtime.mjs:105-110` 在 `steps2 !== refSteps` 时把 `delta` 置 0；故障注入（少 1 子步）仍 PASS 78/78，改为 `Infinity` 后 FAIL 4 | 帧时间验收与 `ci:node` 门禁失效。步数不一致直接失败，并把步数写入 detail |
| P2-06 | `audit:baseline` 退出码不绑定错误/跳过，`audit:update` 可在无 Chrome 时缩小基线 | `tools/audit/run-all.mjs:225-257` 只按 `baseline.pass` 决定退出码；`_cdp.mjs:139-145` 无 Chrome 时 skip 且 report 无 error；`--update-baseline` 只拒绝 `errors.length` | 发布门禁可能绿色但缺少浏览器覆盖；后续无 Chrome 环境可 match 缩小后的基线。退出码加入 `errors===0 && every(pass)`；update 拒绝 skip/失败报告；CI 强制 `FS_REQUIRE_CHROME=1` |
| P2-07 | B5.2 审计与 `test-dynamics-browser` 用固定 sleep + 同代对比，可“未重建也通过” | `audit-browser-contract.mjs:31-72` 仅 `sleep(2600)` 后比较场景轮位与同一 `liveModel()` 的轮位；负载下 16 次重建中位 2.65 s、最大 4.47 s | 重建未提交时场景与 solved 都来自旧代，gap=0 天然通过。改为 `waitFor(pending===false)` 并断言 `sceneRevision===physicsRevision`、轮距跨度、`commitCount` 增量 |
| P2-08 | `ci:browser` 在无 Chrome 或显式跳过时以 0 退出 | `package.json:31`；`browser-runner.mjs:39-57` 无 Chrome 时 `process.exit(0)`；实测 `CHROME_PATH=/nonexistent npm run ci:browser` 三个 SKIP、EXIT=0 | CI 可能全绿但无浏览器覆盖；`ci:browser` 也未包含 `build:check`。脚本内前置 `FS_REQUIRE_CHROME=1`（CI 环境默认），统一 `ci` 脚本加入构建校验 |
| P2-09 | 计划要求的浏览器帧时间/几何 pending/teardown 断言未落地 | `docs/plan/parts/03-runtime.md:100/179/181/237` 要求浏览器侧 timeScale、pending 冻结、revision 相等、dispose 后内存归零；`test-runtime.mjs:16-32` 不加载 `40-app.js/30-ui.js` | 应用编排层（rAF、85 ms 节流、pending 冻结、提交原子性）无自动化回归；合成 rAF 原型已证明可实现。新增 `test-runtime-browser.mjs`，按 C1/C7/C8/C14 落地 |
| P2-10 | 现有套件断言边界过窄：UI 45 项、物理 157 项、视觉无取景断言 | UI 不测 390/320、不查子元素溢出/重叠、不查 `aria-*`/焦点可见性/对比度；物理 157 项对“冻结平面位移”“陀螺项反号”两个变异体仍全绿，低附着滑移用绝对 CG 坐标（默认偏移 0.16 m）属恒真；视觉无“车辆投影在安全区内”断言 | 绿灯不能证明对应性质成立。补 390/320 视口、层间相交、计算样式、对比度断言；滑移改“从初始位置的位移”；引入关键不变量变异测试；视觉加投影包围盒断言 |

### 4.4 页面生命周期

| ID | 问题 | 关键证据 | 影响与修复 |
| --- | --- | --- | --- |
| P2-11 | `pagehide` 无条件 teardown，bfcache 返回后页面死亡 | `40-app.js:586-588` 忽略 `event.persisted`，无 `pageshow` 恢复；`teardownScene` 释放渲染器并置空 `S.scene/camera/renderer`；`animate` 无守卫、未取消 rAF。实测返回后画布消失、`renderer=null`、`Uncaught TypeError ... quaternion`、rAF 停止 | 站外链接后“后退”丢失 3D 演示；`FSApp.dispose()` 同样在下一帧抛错。`persisted` 时跳过 teardown 或在 `pageshow` 重建；`animate` 增加 `if (!S.renderer) return` 并保存/取消 rAF |

### 4.5 视觉与构图

| ID | 问题 | 关键证据 | 影响与修复 |
| --- | --- | --- | --- |
| P2-12 | 1280×900 面板默认展开时相机取景不避让，默认与四个轴向预设被遮挡 | 实测车体 x 范围与被面板覆盖宽度：三分之四 360.5–1090.9（右 177.9 px）、侧视 237.5–1059.7（左 106.5+右 146.7）、前/后视两侧各约 108/131 px、顶视右 146.7 px；四角标签仅 RL/FR 可见 | 桌面常见宽度下五个预设中四个丢失关键几何。按“画布减面板”的有效视口 fit，或进入轴向预设时自动收起面板；标签投影也按安全区判断；测试断言车体/标签包围盒与面板矩形不相交 |
| P2-13 | 390×844 竖屏默认取景右侧溢出 23 px，按 1 的三分之四视角 26.67% 顶点出屏 | 默认 x=57.3–413.0；三分之四 x=−67.1–617.8；四个正交轴向预设完整（28.9–368.2 / 56.6–333.4） | 与 README:259“完整看到赛车”矛盾。给透视预设增加基于车辆包围盒的宽高 fit，或为窄屏单独参数；按 360/390/430 宽度回归 |
| P2-14 | 1280×900 遥测“动态校核”首行名称被压成单字竖排 | `30-ui.js:793` 长值串；`styles.css:801-802` `.check-name{flex:1}` 无 `min-width`、`.check-val` 不换行；右面板 345 px、内容约 303 px | “六自由度积分与求解”九字竖排，主要动态校核项不可读。给名称列 `min-width`/`overflow-wrap`，值列允许换行或改两行网格；加窄面板断言 |
| P2-15 | 1280/1366/1440 下视口提示与底栏“重置视角/截图”重叠 | `styles.css:835-853/873-888` 均为 z-index 40，提示 DOM 在后；1280 实测水平重叠 114.5 px、垂直 12 px；1600 不重叠 | 提示文字压住按钮下缘（`pointer-events:none` 不阻断点击）。提示移到工具栏上方/提高断点/窄屏隐藏；测试断言两矩形不相交 |

### 4.6 可访问性与文档物理断言

| ID | 问题 | 关键证据 | 影响与修复 |
| --- | --- | --- | --- |
| P2-16 | 画布是首个 Tab 站且 `:focus-visible` 命中，但 outline/box-shadow 均为 none | `10-scene.js:1590-1591`；`styles.css:1127-1129` 焦点选择器未含 canvas；实测聚焦后无视觉标记，此时 Space 仍切换仿真 | 键盘用户看不到焦点却触发状态变化。增加 `canvas:focus-visible` 焦点环，或把画布移出 Tab 序列并补齐键盘模型（与 P1-03 一并处理） |
| P2-17 | 单位/相机/路面预设的选中态只改 class/颜色，未暴露 `aria-pressed/checked` | 模板 `index.template.html:78-82/316-318/427-431`；`30-ui.js:154-164/178-185/1065-1069`；AX 树无 pressed/checked | 读屏用户无法确认当前单位/视角/路面；仅颜色对色觉障碍不友好。用 radiogroup/radio 或 `aria-pressed`，同步函数更新属性，测试断言 |
| P2-18 | 功能性小标签对比度不足（`--faint #596678`，7.5–9.5 px） | 对实测底色 `rgb(12,16,23)` 为 3.26:1；视口提示 2.53:1；`--muted #8290a3` 为 5.87:1（合格） | 滑块语义、遥测行标签在低视力/强光下难辨。拆分功能性 token（如 `#7c8a9d`，约 5.43:1），字号提到 ≥10 px；保留装饰性 kicker 用 `--faint` |
| P2-19 | README 称垂向脉冲“在质心处”，实际作用在车身参考点 | README:95；`05-body-dynamics.js:283-302` offset 相对车身参考点；默认 `cgBody=(-0.15975,0.30,0)`，产生 `(0,0,-1086.30) N·m` 俯仰力矩；DESIGN:632 与测试 [11] 均与 README 矛盾 | 按 README 做“纯垂向”验证会得到额外俯仰。改 README 明确作用点与力矩，或把 offset 改为 `cgBody` 并同步测试/文档 |

## 5. P3 发现（分组摘录）

各报告合计约 40 项，去重后约 30 项。以下按主题列出，详细定位与复现见对应分报告。

**物理与数值**

1. 非主轴自由刚体能量/角动量漂移随角速度增长：60 s 能量漂移 4.9%，3–5 rad/s 时可达 220%；1 s 的 1.88e-3 只是单点监控，不是全局界（[01](01-physics.md) P3-1）。
2. 软悬架 6.5 s 角点行程可达 82–122 mm，远超文档承诺的 ±25 mm，模型无 bump stop；属已声明范围外，但未验证该行程的物理可信度（[01](01-physics.md) §5）。

**视觉与导出**

3. 390/320 底栏横向溢出：390 视口 `clientWidth=368`、`scrollWidth=449`，“重置视角/截图”在首屏外且无滚动提示（[02](02-visual.md) P3-1、[03](03-ui.md) P3-1）。
4. 导出 PNG 右下角仍写 `DESIGN.md v0.2`（`40-app.js:281`）（[02](02-visual.md) P3-2）。
5. 每帧 521 draw call、574 网格、411 几何，对象粒度极细；无头环境不据此判性能，但为实机优化候选（[02](02-visual.md) P3-3）。

**交互与可访问性**

6. 暂停时施加脉冲会静默恢复运行（`05-body-dynamics.js:300`）；暂停时改几何会执行 0.5 s settle 并清零仿真时钟（`40-app.js:77`）（[03](03-ui.md) P3-2/P3-3）。
7. 剪贴板降级路径丢焦点；空格无 `event.repeat` 守卫；快捷键未检查 `isComposing`；`prefers-reduced-motion` 只在启动时读取（[03](03-ui.md) P3-4/5/6/7）。
8. 遥测面板 `aria-label="静态载荷遥测"` 与“动态载荷”内容不符；求解警告与自检结果无 live 播报（[03](03-ui.md) P3-8/9）。
9. 触控目标偏小（单位按钮 27×21、`link-btn` 高约 13 px）；竖屏未处理 `safe-area-inset-bottom`；range 焦点只有约 1.40:1 的光晕（[03](03-ui.md) P3-10/11/12）。
10. 测试断言强度低于文档：材质释放只断言 `>=3`、`openPanelStable` 返回值被忽略、自检只数条数（[03](03-ui.md) P3-13）。

**运行时与工具链**

11. 构建脚本只匹配小写 `</script>`，注入 `</SCRIPT>` 可生成“构建成功但页面无法启动”的产物；模板占位符缺失不报错（[04](04-runtime.md) §4.1）。
12. dev-server 默认暴露仓库 dotfiles（`.git/config`、`.env`，仅 localhost）（[04](04-runtime.md) §4.2）。
13. bench 以中位数判定，`simBuildModel` p95 为 0.0612/0.1979 ms，高于 0.05 ms 预算；`coldRounds` 命名易误导（[04](04-runtime.md) §4.3）。
14. `lastBuild` 在 teardown 时被二次累加；`policy` 提交成功后仍可能显示 pending（[04](04-runtime.md) §4.4）。
15. 审计脚本硬编码 `COMMIT=fbb401d`、固定调试端口、90 s watchdog 覆盖整个会话（[04](04-runtime.md) §4.5/§4.6）。
16. 截图署名仍 v0.2（与第 4 项同源）；构建产物仅匹配大小写敏感结束标签（与第 11 项同源）。

**功能与文档**

17. README/DESIGN 称线圈刚度约 517 N/mm，实测前轴 525.9 N/mm。
18. 前轮转角 UI 写“仅机构展示”，实测通过运动比改变四角载荷约 ±101/±116 N。
19. DESIGN 20.6 称参数面板有“运动比”区，实际只有遥测显示。
20. “归零路面/水平”只清 slope/bank，不清摩擦；lowGrip 后点水平仍 μ=0.20。
21. `getSnapshot().selfTests` 只有 14 项静态，24 项需另开 modal/动态 API，README 表述可被误读。
22. README 的动力学自检顺序与实现顺序不一致。
23. acceptance 报告 HEAD 仍写 WIP 提交 `cbed2d6`，当前 HEAD 为 `45983ca`。
24. README 文件结构漏列 `src/js/03-suspension.js`。
25. `setText('bodyHeave', ...)` 目标 DOM 不存在（死代码）；加/减速/脉冲的 8–82 kN 载荷没有包线警告（与 P1-01 同源）。
26. 相机不持久化，刷新后从顶视回到三分之四（README 只承诺参数持久化，不构成过度声明）。
27. 0.2.0 把后轴从高位拉杆改为低位推杆（`wheelLocal.push` y 由 +0.195 改为 −0.185），但 `22-car-dynamics.js:845` 仍标记为 `pullrod`，DESIGN.md:50/133 仍写“后轴采用拉杆”；命名与文档未同步。

## 6. 已核实成立的部分

对抗审阅同样确认了大量声明与修复有效，以下均有独立复跑或实测：

| 方向 | 结论 |
| --- | --- |
| 物理 B4.1 | 阻尼尖峰从 41.94 kN 降至 1.7336 kN；4.1 弹簧峰值 5.3518 kN 发生在可行态 |
| 物理 B4.2/B4.4/B4.5 | 质心/线动量、脉冲坐标系、接地点唯一性成立；杆长偏差 ≤1.9e-8 mm、防倾杆连接 ≤7e-14 mm、摇臂残差 ~1e-13 mm |
| 确定性 | `simBuildModel` 新旧实现 84 组输入逐字节一致；默认 24/24 自检稳定 |
| 帧语义 | 60/30/10/5/4 Hz 实时、2 Hz 约 0.512×、120 s 卡顿 128 子步/0.256 s/dropped 119.5；500 组随机序列恒等式 0 失败 |
| 几何代际 | 20 次快速改尺寸 → 1 次提交；revision 相等、跨度 3.580005 m 与 `state.wheelbase` 一致 |
| 资源 | 16 次重建后 411 几何/16 纹理/18 programs 稳定；`dispose()` 幂等，geometries/textures 归零 |
| U1–U4 | 844×390 横屏、空格竞争、面板 inert/焦点回返、暂停四字段同步均有效 |
| 相机 | `test-camera` 19/19；正交相机三视口无裁剪；导出 PNG 可生成 |
| 视觉重建 | 连续 5 次轴距重建后 574 网格/411 几何/16 纹理稳定，无旧对象残留；轮胎接地穿透 1.4–2.1 mm |
| UI 主路径 | 模态焦点陷阱、存储恢复、复制、自检列表读屏可读、`prefers-reduced-motion` 启动路径均正常 |
| 构建 | `build:check --strict` 一致；dev-server 路径穿越/NUL/symlink/405 防护通过 |

## 7. 修复路线图

**第一阶段（阻断发布，1–3 天量级）**

1. P1-01：参考点保持 + 正确姿态齿条标定 + settle 后二次 reset + 清除求解锁存 + 载荷/行程包线警告；新增 cgHeight 扫描、重置、恢复默认浏览器回归。
2. P1-02：低速摩擦改为车身级静摩擦分配/停止冲量预算；回归覆盖 slope+bank 与 μ retarget。
3. P2-04、P2-03 的锁存/陈旧标记：与 P1-01 同一改动面，一并修复。
4. P2-05 至 P2-08：测试与审计门禁四处小改，成本低、收益高，应在下一次全绿声明前完成。
5. P1-04：完成“机构收入车体”或“重做车体包络”的设计决策并实现，补包络断言；若本轮不修复，必须撤回 README/DESIGN 中“内部”的表述与剖视交付截图，不能一边展示外部机构一边声称内部结构。该项与 P1-01/P1-02 同为发布阻断。

**第二阶段（发布前或紧接发布）**

5. P1-03 + P2-16：相机键盘路径与画布焦点环作为同一次键盘/焦点改造。
6. P2-11：bfcache 生命周期修复与 dispose 守卫。
7. P2-12/P2-13/P2-14/P2-15：取景安全区、竖屏 fit、自检行布局、提示重叠；都属于布局层，可一次提交。
8. P2-09/P2-10：浏览器 runtime 测试与套件断言补强，至少先覆盖本轮暴露的四个假绿场景。

**第三阶段（阶段三开工前）**

9. P2-17/P2-18：选中态语义与对比度。
10. P2-01/P2-02：力链路门槛与求解状态机统一。
11. P2-19 与第 5 节文档类 P3：一次文档提交收敛数值、措辞、顺序、版本与 HEAD。
12. 物理 P3-1/P3-2：自由刚体长期守恒与极限行程的建模决策（修复或明确声明边界）。

## 8. 测试补强清单

1. `tools/test-dynamics-browser.mjs`：cgHeight 0.30→0.50（暂停/运行）、重置、恢复默认，断言参考点位移 <1 mm、载荷 <2× 静态、`|rack|<5 mm`、`tieRod<1 mm`、`solverState=ok`。
2. 物理回归：slope×bank×μ 矩阵 + 0.3 m/s 切向扰动 + μ retarget，断言“从初始位置的位移”、模式、速度、dwell、需求/容量。
3. 力链路：不可达摇臂样本上断言弹簧/阻尼不超过上限，且 `solved.ok=false` 时使用回退。
4. 求解状态机：断言 `ok/degraded/failed` 互斥一致，UI 警告统计所有失败原因。
5. `test-runtime`：步数不一致直接失败；浏览器版新增 `test-runtime-browser.mjs`（rAF 注入、合成时间戳、pending 冻结、dispose 内存归零）。
6. 几何：所有用例改 `waitFor(pending===false)`，断言 `sceneRevision===physicsRevision`、轮距跨度、`commitCount` 增量。
7. UI：390/320 视口、底栏 `scrollWidth<=clientWidth`、面板与车体/标签矩形不相交、`aria-pressed/checked`、`canvas:focus-visible` 计算样式、对比度、200% 缩放、触控尺寸。
8. 视觉：五个预设 × 三视口的车辆投影包围盒落在安全区内；导出 PNG 的尺寸、文本与版本号断言。
9. 自检：第二次打开是否重跑、参数变化后的陈旧标记、活故障下的行为。
10. 构建/审计：大写 `</SCRIPT>`、缺失占位符、`$&`；`audit:baseline` 退出码、`audit:update` 拒绝 skip、CI 强制 Chrome。
11. 变异测试（可选但建议）：至少保留“陀螺项反号”“冻结平面位移”“漏执行子步”三个变异体作为门禁自检。
12. bfcache：合成 `pagehide({persisted:true})`/`pageshow`，断言画布仍在、无未捕获异常；`dispose()` 后下一帧无异常。
13. 车体包络：对摇臂、弹簧—减振器、防倾杆、齿条与差速器采样顶点，断言位于车体闭环内或低于局部蒙皮；车体侧杆端与蒙皮距离 ≤10 mm；前后轴、默认/倾斜/脉冲三种姿态各测一次。

## 9. 证据索引

- 分报告：本目录 `01-physics.md` 至 `05-features-docs.md`，共 1250 行；补充报告 `06-body-mechanism-fit.md`。
- 关键图片：`evidence/cgheight-0.50-export.png`、`evidence/cgheight-reset-still-failed.png`、`evidence/portrait-default.png`、`evidence/bottom-hint-overlap-1280.png`、`evidence/checklist-layout-1280-2x.png`、`evidence/cgheight-0.50-live-ui.png`、`evidence/body-fit-front-xray.png`、`evidence/body-fit-rear-xray.png`。
- 物理：`.tmp-review/physics/exp5-rocker-status.mjs`、`exp5b-unreachable-force.mjs`、`exp7-tilt-repark.mjs`、`exp8-retarget-tilt.mjs`。
- 视觉：`.tmp-review/visual/probe-layout.mjs`、`probe-framing.mjs`、`probe-final.mjs`、`probe-rebuild.mjs`、`shots/`。
- UI：`.tmp-review/ui/exp1`–`exp10` 系列、`crop-overlap-zoom.png`、`official-test-ui.log`。
- 运行时：`.tmp-review/runtime/frames.log`、`test-runtime-fault.log`、`browser-synth-raf.log`、`browser-memory-lifecycle.log`、`browser-rebuild-heap.log`、`build-escape.log`、`ci-browser-skip.log`、`bench-1/2.json`。
- 功能：`.tmp-review/integration/recovery.json`、`cgheight-deterministic.json`、`session.json`、`artifacts/`。
- Lead 探针：`.tmp-review/lead/probe-cg-clean.mjs`、`probe-cg-running.mjs`、`probe-cg-ui.mjs`、`solver-latch-browser.mjs`、`bfcache-test.mjs`、`dispose-test.mjs`、`layout-check-row.mjs`、`probe-frametime.mjs`、`probe-freebody-energy.mjs`。

说明：`.tmp-review/` 是仅存在于本工作区的证据目录，已通过 `.git/info/exclude` 本地忽略，不随仓库提交；如需移交，请连同对应脚本与日志一并复制。

复跑基线命令：

```bash
npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server
FS_REQUIRE_CHROME=1 npm run test:camera
FS_REQUIRE_CHROME=1 npm run test:ui
node tools/check-build.mjs --strict
```

## 10. 覆盖限制与残余风险

1. **渲染环境**：无头 Chrome + SwiftShader，不是 GPU 实机；不对帧率、抗锯齿、真实设备上的阴影/透明排序下结论。宿主 loadavg 19–42，真实墙钟浏览器帧率不可用，帧语义结论以 Node 与合成 rAF 为准。
2. **设备与辅助技术**：移动端为 DevTools 设备模拟（DPR=1），未在真实手机、软键盘、安全区下验证；未使用真实屏幕阅读器；200% 缩放为视口折半模拟。
3. **bfcache**：用合成 `pagehide/pageshow` 事件复现，未做真实跨页导航验证。
4. **物理**：复合坡面初速为直接注入（retarget 路径已覆盖）；未覆盖 10 分钟级长时、车轮离地、极限行程物理可信度；P1-02 根因仍是待验证假设。
5. **视觉**：未做逐三角形相交检测、像素 diff、DPR=2、±10°/±25 mm 极限行程；右键/中键/Shift 平移与双击重置只有源码核对与部分实测。
6. **门禁**：审计脚本在无 Chrome 时的缩小基线路径为高置信静态结论，动态复现受固定 Chrome 路径限制；变异测试只做了两个变异体。
7. **版本矩阵**：Node 18/20、其他浏览器、真实 CI 环境未测；本轮未由智能体执行 `npm run build`（避免重写产物），产物一致性由 Lead 的 `build:check` 与哈希核对保证。
8. **审阅自身**：分报告之间对严重度的口径略有差异（例如视觉报告不含 UI 的 P1）；本总报告按统一口径重排，分报告保留原始证据与上下文。首轮视觉线只验证了杆长闭合、接地点、取景与资源重建，没有检查“内部机构是否位于车体包络内”，P1-04 由用户复核触发补充；这说明检查清单缺少装配关系类断言，已在 [06-body-mechanism-fit.md](06-body-mechanism-fit.md) §6 记录。

## 11. 验收判定

0.3.0 的默认工况与已声明修复整体可靠，但当前状态不满足“可交付完成”的标准，理由有三：

1. **P1-01 是可被正常 UI 操作触发的参数链路缺陷**，直接违反 README 的“重置姿态回到静力平衡”承诺，且自检与浏览器测试均无法发现。
2. **P1-02 使“坡面驻车”这一 README 明示能力在合法参数组合下不成立**，现有测试因断言过弱而全绿。
3. **门禁类 P2 使“全绿”本身失去证明力**：子步数假绿、审计退出码、固定 sleep、SKIP=0、缺浏览器编排断言，意味着后续修复也难以用现有套件证明。
4. **P1-04 使剖视展示与设计文档不一致**：内部悬架被画在车体之外，弹簧穿过蒙皮；只要 README 仍以剖视作为主要卖点、DESIGN 仍声称部件在车体内部，该缺陷就属于交付声明不成立。

建议的发布条件：修复 P1-01、P1-02、P1-04、P2-04 至 P2-08，并为每项补一条能失败的回归；P1-03、P2-12、P2-13 若不在本轮修复，应同步下调 README/DESIGN 的相应声明，避免文档承诺高于实现。完成上述后，0.3.0 的主路径质量足以支撑阶段三开工。

---

**审阅组织**：lead（root）+ physics-reviewer、visual-reviewer、ui-reviewer、runtime-reviewer、integration-reviewer；**日期**：2026-11-19；**写入范围**：`docs/review/0.3.0/`（新增）；未修改任何被跟踪文件。
