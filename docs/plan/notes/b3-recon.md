# B3 施工勘察（b3-recon）

| 项目 | 内容 |
| --- | --- |
| 分支 | 当前工作区分支（HEAD 3d3f408，契约提交） |
| 源码基线 | fbb401d（0.2.0）；工作区已有 B1 未提交改动（00/03/05/22），本轮未再改 src/ 或 tools/ |
| 依据 | docs/plan/contracts.v1.md、分册 03（r2）、tools/audit/audit-frame-time.mjs、tools/audit-browser/audit-browser-contract.mjs |
| 性质 | 只读勘察；本文件只登记改动点、接口与冲突，不写源码、测试或构建产物 |
| 范围 | B3-1 至 B3-4；B3 在 B1/B2 完成前不得解冻 |

工作区当前包含 B0 已加入的 tools/audit 与 tools/audit-browser（未跟踪）以及 package.json 的 audit 脚本改动；src/ 已出现 B1 部分未提交改动（00-core 1 行、03-suspension 204 行、05-body-dynamics 234 行、22-car-dynamics 10 行），因此不是 fbb401d 净树。本文行号以 fbb401d 为基准；当前工作区关键函数行号见 1.1，B1 继续施工后执行前须按函数名重新定位。本轮只读运行 node tools/audit/audit-frame-time.mjs --json（退出码 1；B5.1/10-time、B5.1/5-time、B5.1/5-clamp50-time、B5.1/dropped-field 失败，60/30 Hz 通过），未运行浏览器审计。

## 0. 裁决（lead，2026-11-19）

B3 尚未解冻；本节只冻结两项 audit 口径与解冻前清单，代码在 B3 提交中落实。授权边界：仅允许修改 tools/audit/audit-frame-time.mjs 的 B5.1/5-clamp50-time 实现、tools/audit-browser/audit-browser-contract.mjs 的 B5.3/telemetry-dom 观察配置，以及 tools/audit/baseline/0.2.0.json 中对应两条记录；不得改其他 check 的 id、阈值或实现，不得改 src/。

### 0.1 B5.1/5-clamp50-time：改为“验证截断已移除”

1. check id 保持 B5.1/5-clamp50-time，不再模拟旧的 50 ms 应用层 clamp；删除 runCase(5,50) 这一输入。
2. 用 5 Hz 墙钟驱动：runCase(5) 的 advanced 必须 >=0.98 s/s；另建一个 sim，调用 api.simAdvance(sim, 0.2)，断言本次推进 >=0.19 s 且返回步数 >=90。B3-1 后 0.2 s 应执行约 100 步（0.2 s），旧实现只能执行 40 步（0.08 s），该断言直接证明 50 ms 截断已移除。
3. check 的 metrics 至少记录 advanced、steps、dt:0.2、limitRemoved:true；threshold 写“5 Hz wall advanced >=0.98 and simAdvance(0.2) >=0.19 s / 90 steps”。不再使用 clampMs 字段作为判据。
4. baseline 同步：tools/audit/baseline/0.2.0.json 的 B5.1/5-clamp50-time 从 fail 改为 pass，observed 换成新的 metrics，并从 knownFailures 与 defectEvidence.B5.1.failing 中移除该 id；其他 B5.1 条目不动。该改动与 B3-1 同提交（或紧随其后），否则 audit:baseline 仍会报状态差。

### 0.2 B5.3/telemetry-dom：childList 为唯一判据

1. check id 保持 B5.3/telemetry-dom；MutationObserver 配置改为 childList:true、subtree:true，空闲观察 1 s（sleep 1000）。
2. nodeRebuilds 是唯一通过判据，必须为 0；另设 characterData:true 的辅助 observer 统计 textMutations，只写入 metrics，不作通过条件。模拟时钟、子步数和 timeScale 每 110 ms 变化，textMutations 允许大于 0；若 B3-3 保留节点成功，nodeRebuilds 应为 0。
3. #checkList 不存在时判 fail，不得 skip；检查的 detail/threshold 同步改为“1 s idle childList rebuild count === 0；textMutations 仅记录”。
4. baseline 同步：tools/audit/baseline/0.2.0.json 的 B5.3/telemetry-dom 从 fail 改为 pass，observed 换成 {nodeRebuilds:0, textMutations:N}，并从 knownFailures 与 defectEvidence.B5.3.failing 中移除该 id；其他 B5.3 内容不动。该改动与 B3-3 同提交。

### 0.3 解冻前清单

1. 分册 05/B0-3 创建或登记 tools/test-runtime.mjs；脚本仅覆盖 frame/geometry/selftest/assets 四组，不并入 npm test 的 47+52，但加入 package.json 的 test:runtime 与 ci:node（npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server）。
2. 两处 audit 改动与 baseline 两条记录只随 B3-1（B5.1）与 B3-3（B5.3）提交；解冻前不得提前修改 tools/。其他 audit check 一律不动。
3. 施工顺序按 lead 裁决保持 B3-1 → B3-2 → B3-3/B3-4 → B4-4；30-ui/40-app 由 40-app 单点合并；B4-6 runner 先迁移或只追加独立块。
4. B3 解冻前不写 src/；本文件只登记裁决与清单。

## 1. 前置接口与解冻条件

B3 的四项都不能在 B1/B2 之前冻结，原因不在文件冲突，而在字段语义：B3-2 的 geometryRevision 被 B2-1 的 simRetargetReference 用作校验；B3-3 的 10 项动态自检由 B2-1 增加；B3-4 的 updateCar 守卫要落在 B1-4 改写后的 updateSuspension 之前。解冻条件按主册与契约：

1. B1-1 的质心状态、B1-3 的角点分层结构、B1-4 的种子所有权、B1-5 的 solverDegraded/solverFailed 已合入。
2. B2-1 的 sim.contact 投影与 simRetargetReference、B2-3 的 contactRoad/wheelPosRoad 已合入。
3. tools/test-runtime.mjs 的脚本注册（test:runtime、ci:node）由 B0-3/分册 05 先落地；当前 package.json 只有 audit 脚本，尚无 test:runtime。

### 1.1 当前工作区行号重定位

B1 部分改动已把 05 的关键函数整体后移；下表给出勘察时的实际位置（当前工作区），完整区间以 B1 最终合并为准：

| 函数 | fbb401d 起始行 | 当前工作区起始行 | 备注 |
| --- | ---: | ---: | --- |
| simBodyPointFromCg/simReferencePoint | 无 | 108/118 | B1-1 已实现，B3-2 的 calibrateRack 应改用 |
| simCreate | 127 | 168 | 已带 cornerRatio/solverDegraded/solverFailed |
| simReset | 153 | 198 | 已同步清零新增字段 |
| simEvaluate | 199 | 248 | 已改为质心语义；reference.source 缺失已抛错 |
| simAdvance | 525 | 601 | 帧时间语义仍是旧实现，B3-1 目标 |
| simBuildModel | 541 | 617 | bodyPos/heave 已改参考点；solverOk 已分层 |
| simInfo | 618 | 703-721 | 已含 solverDegraded/solverFailed；B3-1 加帧时间字段 |
| solverOk | 665 | 755 | B1-3 已改为 corners.every(ok) |
| runDynamicSelfTests | 711 | 801 | 当前仍 8 项；B2-1 后 10 项，B3-3 生成器化 |
| updateCar | 1091 | 1095 | B1-4 已改 updateSuspension 的显示路径 |
| buildCar | 1156 | 1160 | B3-2 写 geometryRevision 的位置 |
| updateSuspension | 944 | 944 | B1-4 已移除物理种子回写，保留显示副本 |

B1 当前工作区已实现的接口（未提交）：sim.state 为质心、simReferencePoint 可用、simEvaluate 缺 reference.source 抛错、solverOk 分层、updateSuspension 只写显示副本。B3-2 仍需补 computeStatic 的 source 快照与 geometryRevision/physicsSignature；B3-1 仍需重写 simAdvance；B3-3 仍需生成器化 runDynamicSelfTests。

## 2. 精确改动

### 2.1 B3-1 帧时间语义（1.0 人日）

| # | 文件:行号 | 函数/位置 | 当前实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| 1 | 05-body-dynamics.js:23-25 | 顶部常量 | SIM_MAX_SUBSTEPS=40、SIM_MAX_FRAME_DT=0.1 | SIM_MAX_SUBSTEPS=128、SIM_MAX_FRAME_DT=0.5、新增 SIM_MAX_BACKLOG=0.5；两条不变式见分册 03 |
| 2 | 05-body-dynamics.js:601-613（fbb401d 525-537） | simAdvance | 累加后最多 40 步，到上限把 accumulator 清零 | 接受量 ≤0.5 s；执行 ≤128 步；超出执行能力的量保留为 backlog；sim.droppedTime、sim.lastFrameDt、sim.lastAdvance、sim.timeScale、sim.lastSubsteps 同帧更新 |
| 3 | 05-body-dynamics.js:168-230（fbb401d 127-172） | simCreate/simReset | 无帧时间字段 | 初始化/清零 droppedTime=0、lastFrameDt=0、lastAdvance=0、timeScale=1；simReset 必须清零 |
| 4 | 05-body-dynamics.js:703-721（fbb401d 618-634） | simBuildModel.simInfo | 只有 accumulator/substeps/stepHz | 增加 backlog、droppedTime、timeScale、lastFrameDt、lastAdvance、maxFrameDt、maxSubsteps；与 B2-1 的 mode/dwell 等合并在同一对象，不互相覆盖 |
| 5 | 40-app.js:414-419 | animate 首段 | clamp(now-last,0,0.05) 同时喂相机与物理 | 物理用原始 frameDt，相机单独 Math.min(frameDt,0.05)；simAdvance 成为唯一截断/记账点 |
| 6 | 30-ui.js:651-674 | syncSimControls | telemetrySimSteps 只有 Hz/子步 | 追加 timeScale；simClock 保持；无 SIM 时兜底字段补齐 |
| 7 | 30-ui.js:590-595、781-786 | refreshChecks 首行、simDetail | 首行 t·Hz·子步；simDetail 无积压 | 首行追加 timeScale 与 droppedTime（只加时间字段，判据归 B4-4）；simDetail 追加 backlog/droppedTime |
| 8 | README:164、DESIGN:578；README:14/199/212、DESIGN:648 | 文档 | “单帧最多 40 子步”“掉帧后结果一致” | 0.5 s 接受上限、128 步执行、0.5 s 积压、droppedTime、4 Hz 以下慢动作；由 B5-1/B5-2 统一改，B3 只提交代码与测试 |

关键约束：audit 的 droppedOf(sim)（audit-frame-time.mjs:7-17）只读 sim.droppedTime（或 sim.dropped/flags/info/stats 别名），不读 simBuildModel.sim。因此字段必须同时写在 sim 对象与 simInfo 投影中，不能只写快照。

### 2.2 B3-2 几何代际（1.5 人日）

| # | 文件:行号 | 函数/位置 | 当前实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| 1 | 00-core.js:38 之后 | 新函数 | 无几何版本 | geometrySignature、geometryRevisionFor、setActiveGeometry、physicsSignature；GEOMETRY_REVISIONS 上限 64，淘汰只跳过 ACTIVE_GEOMETRY_KEY |
| 2 | 00-core.js:471-561 | computeStatic 返回 | source 为调用者对象 | 返回 geometryRevision、physicsSignature；source 改为 cloneState(source) 快照，供 A-01/B1-6 读取 |
| 3 | 05-body-dynamics.js:168-230（fbb401d 127-172） | simCreate/simReset | 无版本 | setActiveGeometry(source)；sim.geometryRevision=reference.geometryRevision；sim.steerApplied=source.steer |
| 4 | 05-body-dynamics.js:617 起（fbb401d 541-636） | simBuildModel | 返回 reference 合并对象 | 显式输出 geometryRevision；几何换代时由 simReset 产生新 reference，模型与场景同代 |
| 5 | 40-app.js:6-10、45-48、50-70 | PENDING/requestRebuild/processPendingRebuild | PENDING.model 存在；提交时先 simReset 再 build | 删除 PENDING.model；增加 reason/commits/failures/lastPolicy；提交只在同一 rAF 内完成；几何换代只在此处发生 |
| 6 | 40-app.js:72-96 | refreshAll | 第 74-78 行先 computeStatic 并写 SIM.reference，pending 检查在其后 | 删除 pending 前的 SIM.reference 赋值；pending 或几何过期只 requestRebuild 并返回；同代物理变化才允许 simRetargetReference(SIM,state)；steer 只重标 rack；显示开关不调 computeStatic |
| 7 | 40-app.js:336-347；30-ui.js:221-236；40-app.js:362-371、119-123 | setState/resetAll/resetDynamics/exportScreenshot | 尺寸可被 rebuild:false 覆盖；resetAll 先 simReset 再重建；screenshot 总用 liveModel | 尺寸变化强制 rebuild 并写 policy=geometry-forced；resetAll 删除提前 simReset；resetDynamics 先比 revision 再 reset；screenshot pending 时用 UI.lastModel |
| 8 | 40-app.js:260-334、390-405 | getSnapshot/getSceneProbe | 只有 pendingRebuild | geometry:{sceneRevision,physicsRevision,pending,policy,commitCount,mismatch,dims}；探针加 geometryRevision/physicsRevision/geometryMismatch；定义见第 3 节 |
| 9 | 22-car-dynamics.js:1095、944、1160 起（fbb401d 1091/1156） | updateCar/updateSuspension/buildCar | updateCar 只查 CAR.built；buildCar 无 revision | 两处入口拒绝 model.geometryRevision !== CAR.geometryRevision 并置 CAR.diag.geometryMismatch；buildCar 入口校验、写 CAR.geometryRevision 后才 CAR.built=true 并调 updateCar |
| 10 | 20-car.js:33-58 | CAR.diag | 无几何字段 | 增加 geometryRevision、geometryMismatch；供 getSceneProbe 与审计读取 |

关键约束：B2-1 的 simRetargetReference(sim, source)（02-contact-force.md:64）会重算 reference、校验 geometryRevision、清空 cornerSeed、保留 state/time/contact。refreshAll 的同代物理分支应调用它，而不是再次直接写 SIM.reference = computeStatic(state)；几何提交路径用 simReset（需要重置 state），不要在 settle 后再调 simRetargetReference，否则种子会被二次清空。

### 2.3 B3-3 自检调度（1.0 人日）

| # | 文件:行号 | 函数/位置 | 当前实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| 1 | 00-core.js 新函数 | setup 版本 | 无 | setupSignature = geometrySignature + '#' + physicsSignature（6+13 键）；noteSetupChange 自增 SETUP_REVISION；steer/units/显示开关不参与 |
| 2 | 30-ui.js:5-18 | UI | 只有 selfTests | 增加 selfTestCache:{revision,staticTests,dynamicTests,dynamicRevision,runs}、checkRows:{}；UI.selfTests 保留别名 |
| 3 | 30-ui.js:676-679 | refreshTelemetry | 每次执行 runSelfTests(state) | 改为 ensureStaticSelfTests()；周期路径不再重算静态自检 |
| 4 | 30-ui.js:382-421 | refreshSelfTests | 同步跑静态+动态，清空 #selfTestList | 静态走缓存；动态按 setupRevision 缓存并按需分片；openModelModal:359-370 不再阻塞；列表仅在结果变化时更新 |
| 5 | 30-ui.js:563-649 | refreshChecks | 8 行，textContent='' 后逐行创建 | 冻结 10 行 id（第 4 节）；首次建节点，之后只写变化 textContent、只在 ok 变化时切 class；首行判据和新增两行由 B4-4 填，B3-1 只追加时间字段 |
| 6 | 05-body-dynamics.js:801 起（fbb401d 711-814） | runDynamicSelfTests | 同步构造 8 项（B2-1 后 10 项） | 拆生成器 simDynamicSelfTestSteps，每次 record 后 yield；新增 runDynamicSelfTestsChunked（50 ms 片），同步 API 仍返回完整 10 项；首片含 settle 2.5 s |
| 7 | 40-app.js:260-334、406-407 | 快照/API | UI.selfTests 兜底 | 增加 setupRevision、selfTestRuns:{static,dynamic}；兜底改 UI.selfTestCache.staticTests；显式 API 保持 |
| 8 | README:19/172/245、DESIGN:544/640；test-dynamics-browser.mjs:225,251 | 文档/浏览器断言 | 22 项（14+8），动态 >=8 | 24 项（14+10），动态 >=10，弹窗 >=24；新增两项按名称断言；文档由 B5 统一 |

### 2.4 B3-4 资源生命周期（1.0 人日）

| # | 文件:行号 | 函数/位置 | 当前实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| 1 | 20-car.js:5-61 | CAR | 无资源账 | 增加 assets:{instanceMaterials:Set, totals, lastBuild, lastTeardown}；totals 累计，lastBuild 固定五项（第 3 节） |
| 2 | 20-car.js:175-187 | disposeGroupChildren | 只收集几何、跳过 shared、移除子节点 | 同时收集材质与贴图；跳过 MAT/TEX 注册表、CAR.decalCache、userData.shared；实例材质 dispose 并计数；userData.__disposed 幂等；返回计数累加 totals |
| 3 | 20-car.js:629/685/747/843/909/1108 | buildBodywork 创建点 | 6 处、7 个独立材质 | 改为 instanceMaterial(new THREE.*Material({...}))；创建计数写 totals 与 lastBuild |
| 4 | 10-scene.js:5-22、1560-1633 | S/initScene | 无 teardown 标记 | 增加 S.teardownDone；teardownScene 放在 initScene 之后；场景/注册表/渲染器按序释放 |
| 5 | 10-scene.js:648-655、957-984 | setupEnvironment/buildOverlay | TEX.env 已 dispose 但无标记；contactRing clone 无归属 | 给 TEX.env 补 __disposed；contactRing/leader 作为场景实例计入 sceneMaterialsDisposed，不混入 7 个车身实例计数 |
| 6 | 22-car-dynamics.js:1160-1163（fbb401d 1156-1159） | buildCar 入口 | 直接调 disposer | 先重置 lastBuild（含 at），再 dispose 旧组，再新建；提交后固定本次计数 |
| 7 | 40-app.js:255-412 | bindGlobalAPI/快照 | 无 dispose API | 增加 dispose:teardownScene、getAssetStats()、assets 只读投影；pagehide 注册一次；不暴露 Set |
| 8 | DESIGN.md:665 之后 | 文档 | 无所有权表 | 新增 20.10 资源所有权与 teardown，写共享/缓存/实例三类与释放顺序 |

## 3. 与 B1/B2 的接口

### 3.1 状态与参考点

契约 contracts.v1.md:24-32 冻结 B1-1 后 sim.state.x/y/z 与 vx/vy/vz 为质心量；参考点只能由 referencePoint/simBodyPointFromCg 派生。B3 的直接消费点：

- 40-app.js:23-32 的 calibrateRack 把 sim.state 的 x/y/z 直接作为 suspRackForSteer 的 bodyPos。B1-1 后这是质心坐标，必须改用 simReferencePoint(SIM)（或 SIM.referencePoint）；否则每次重建/标定齿条都带 0.30 m 的 y 偏移。
- 40-app.js:458-472 的 boot、50-70 的提交、362-371 的 resetDynamics 都调用 calibrateRack，三处需同改。
- 40-app.js:18-21 的 liveModel 与 simBuildModel 继续用派生 bodyPos/heave，不得把 state.x/y/z 当参考点；快照 bodyPos 来自模型，不直接取 SIM.state。
- B3-2 的 updateCar 使用 model.bodyPos 与 model.solved[i].wheelPos，不使用 sim.state；B1-1 后仍成立。

### 3.2 几何与物理版本

契约 contracts.v1.md:136-142 冻结：sceneRevision = CAR.geometryRevision；physicsRevision = SIM.reference.geometryRevision；geometry.pending/policy/commitCount/mismatch/dims 由 B3-2 写；assets.totals 与 assets.lastBuild 由 B3-4 写；lastBuild = {instanceMaterialCreated, instanceMaterialDisposed, geometryDisposed, textureDisposed, at}，累计值不得写进 lastBuild。

B2-1 的 simRetargetReference 校验 computeStatic(source).geometryRevision === sim.geometryRevision；B3-2 必须保证：computeStatic 返回带 revision；simCreate/simReset 写 sim.geometryRevision；同代物理刷新调用 simRetargetReference，几何换代只走 processPendingRebuild 的 simReset；不一致时由 simRetargetReference 抛错，B3-2 不得降级为直接赋值。

### 3.3 接触投影

B2-1 在 simBuildModel.sim 增加 mode/dwell/since/changes/lastChangeStep/reason/slipSpeed/usage（02-contact-force.md:62），B2-3 把 contactRoad/wheelPosRoad 放到 suspSolveCorner（契约 :49-59）。B3 的边界：

- B3-1 只往同一 simInfo 对象追加帧时间字段，不得重建该对象、不得覆盖 mode 等字段；仿真状态标志 flags.holding/sliding 与 sim.mode 同时存在，UI 过渡期继续用 flags（30-ui:588、656、782 与浏览器测试 :195、:213 暂不改）。
- 22-car-dynamics.js:1116 当前读 solvedCorner.wheelPos；B2-3 后应改读 wheelPosRoad（或 B2-3 保留的顶层兼容字段），不得用 contactBody 驱动渲染；getSceneProbe.wheelPos 继续来自 corner.wheelRoot。
- simBuildModel 的 contactPoints（05:561-565）在 B2-3 后只允许来自 contactRoad；B3-2 的几何守卫不得触碰该字段。

### 3.4 solverOk / solverState

契约 contracts.v1.md:118-130、159-167 冻结：solverOk = corners.every(c => c.ok)，solverState 由 B4-4 从 solverDegraded/solverFailed/solverOk 派生；0.1 mm 残差是独立的 rockerResidual 行。B3 的边界：

- B3-3 只创建 10 行节点骨架与增量写协议；首行 sim.finite && !sim.recovered && solverOk 与 rockerResidual/motionRatio 两行的值/判据由 B4-4 提供，B3-3 不得自行实现。
- B3-1 只向首行追加 timeScale/droppedTime，不得改首行 ok 判据。
- B3-2 的 getSceneProbe 不要用 CAR.diag.rockerSolveOk 覆盖 getSnapshot.solved[i].rocker/model.solverOk；两者语义不同（渲染诊断 vs 物理综合），B4-4 的徽标只读 solverState。
- 22-car-dynamics.js:959-964 的渲染回写在 B1-4 后应只写显示副本；B3-2 的 updateCar 守卫必须放在该循环之前，不能改写 solvedCorner.rocker。

### 3.5 simRetargetReference

B2-1 定义 simRetargetReference(sim, source)（02-contact-force.md:64）：重算 computeStatic(source)、校验 geometryRevision、清空 sim.cornerSeed、保留 state/contact/time/impulse。B3-2 的三个调用点：

1. refreshAll 的“仅物理参数变化”分支：simRetargetReference(SIM, state)，不重建车辆；
2. 不得在 pending/几何过期分支调用；
3. 几何提交路径用 simReset，提交后不再调 simRetargetReference（否则会清空 settle 后的种子）。

B2-1 原文把 processPendingRebuild 也列为调用点；实际上提交必须重置 state，建议 B2/B3 在联调时确认该处保留 simReset，避免“环境切换”和“几何重建”混用同一入口。

## 4. 审计脚本与 test-runtime 映射

### 4.1 审计 check id 与阈值

| audit id | 脚本:行号 | 阈值 | B3 对应 | test-runtime 落点 |
| --- | --- | --- | --- | --- |
| B5.1/60hz | audit-frame-time.mjs:61-68 | advanced >= 0.98 | B3-1 | --group frame：60 Hz 1 s 推进 >=0.98 |
| B5.1/30hz | :69-76 | 同上 | B3-1 | --group frame |
| B5.1/10-time | :78-90 | advanced>=0.98 或 advanced+dropped>=0.98 且 dropped>0 | B3-1 | --group frame：10 Hz 推进 0.998 |
| B5.1/5-time | :78-90 | 同上 | B3-1 | --group frame：5 Hz 推进 0.998 |
| B5.1/5-clamp50-time | :50-56,78-90 | 改为 5 Hz advanced>=0.98 且 simAdvance(0.2)>=0.19 s/90 步 | B3-1 | §0.1；audit 同条改实现 |
| B5.1/dropped-field | :92-106 | 低帧率 case 有 droppedTime 或已实时 | B3-1 | --group frame：typeof sim.droppedTime === number |
| B5.2/geometry-generation | audit-browser-contract.mjs:31-72 | wheelGapMax<=1e-6 m、linkStretchMm<=0.001、diag<=0.001 | B3-2 | 浏览器段；Node 侧 --group geometry 验 revision |
| B5.3/telemetry-dom | :74-88 | childList rebuild 0/1 s；characterData 仅记录 | B3-3 | §0.2；audit 同条改观察配置 |
| B5.4/material-release | :90-114 | materialDisposed>=3 且 geometryDisposed>0 | B3-4 | --group assets Node 单测；浏览器审计计数 |
| O1/chunked-vs-one-shot | :116-142 | body/quat <=1e-9，damping/travel <=1e-6 | B1-4 后保持 | 既有浏览器审计，B3 不新增 |
| A2/source-contract | audit-shadowing.mjs:27-33 | source 存在且 friction 0.2 | B3-2/A-01 | --group geometry 或 sourceContract |
| A2/no-silent-fallback | audit-shadowing.mjs:34-46 | 缺失 source 抛含 reference.source 的错误，或容量比 1 | B1-6+B3-2 | 同上；B3-2 只保证快照 source 存在 |

### 4.2 两个审计冲突及裁决

两项已由 §0 裁决；以下只保留原因分析，施工按 §0.1/§0.2 执行。

1. B5.1/5-clamp50-time 已过时。 audit 在 runCase(5,50) 里把每帧输入预先截到 50 ms，模拟的是旧 40-app.js:418 的应用层截断。B3-1 删除该截断后，sim 只看到 0.05 s 输入，1 s 墙钟推进 0.248 s 且 droppedTime=0（因为丢失发生在 audit 的调用侧，sim 无法知道 0.2 s 的原帧长），该 check 必然失败。可选处理：05 把 runCase(5,50) 改为 runCase(5,500)（或删除该 case，保留 raw 5 Hz），并重生成 baseline；否则 B3-1 无法让 audit:runtime 转绿。不建议为通过该 case 在 simAdvance 增加“第二帧长”参数，那会把应用层截断重新引入物理层。
2. B5.3/telemetry-dom 的 characterData:true 与“只写变化文本”矛盾（裁决见 §0.2：childList 为唯一判据）。 模拟时钟运行，首行 t 1.20 s、子步数、timeScale 每 110 ms 变化；B3-3 保留节点后 childList 为 0，但 characterData 必然 >0，audit 仍失败。建议 05 把 observer 改为 childList:true,subtree:true，只断言“没有重建节点”；若坚持 characterData，则阈值不能为 0（至少 ≤ 每周期变化字段数）。B3-3 的验收采用“childList 0 + 文本只在值变化时写”。

### 4.3 浏览器断言的 CDP 方法

tools/audit-browser/_cdp.mjs:48-135 已提供：headless Chrome（SwiftShader、1280×900）、Runtime.enable/Page.enable/Page.bringToFront、Runtime.evaluate（returnByValue:true、awaitPromise:true）、evaluateJson（外层 JSON.stringify）、等待 FSApp.ready；audit-browser-contract.mjs:23-25 提供 waitFrames（rAF Promise）。

B3 追加断言时使用：

- pending 逐帧：先 ctx.evaluate 注入 rAF 循环，记录 FSApp.getSnapshot().geometry.physicsRevision、FSApp.getSceneProbe().stretch.susp 与 sim.resetCount，再 setState({wheelbase:3.9},{rebuild:false})，等 2-3 帧后提交，读回收数；断言 pending 区间 physicsRevision 与 resetCount 恒定、stretch.susp<0.01、提交帧才变。
- 10 Hz 限帧：在页面加载前用 Page.addScriptToEvaluateOnNewDocument 注入 requestAnimationFrame 包装（每 6 次转发 1 次，保留时间戳），再 Page.reload() 并重等 FSApp.ready；测量 2 s 墙钟内 sim.time，断言 Δ∈[1.85,2.0]、droppedTime<0.05。不要用固定 setInterval 驱动物理。
- DOM 复用：ctx.evaluate 注入 MutationObserver，观察 #checkList 的 childList；建议不观察 characterData（见 4.2）。
- 材质释放：先确认 window.THREE.Material/BufferGeometry 存在，patch 两者的 prototype.dispose 计数；再触发轴距重建，断言 materialDisposed>=3（B3-4 目标 7）且 geometryDisposed>0。
- 弹窗数量：FSApp.openModel() 后等动态分片完成，读 #selfTestList li 数量 >=24，dynamicTests.length>=10；等待时间用 1.5·T_total+500 ms（T_total 由 B2-1 合入后实测）。
- teardown：FSApp.dispose() 后读 getAssetStats().renderer 与 assets.lastTeardown，断言 geometries/textures 归零、注册表清空、二次调用无异常；浏览器关闭前再收 page-errors。

## 5. 风险

| 风险 | 具体表现 | 控制/验收 |
| --- | --- | --- |
| pending 期间误写 reference | refreshAll 第 74-78 行或 resetAll:226 提前 simReset，旧场景配新参考，104.10 mm 回归 | 删除 pending 前赋值；所有几何换代只在 processPendingRebuild；rAF 逐帧断言 physicsRevision/resetCount 不变 |
| revision 淘汰破坏语义 | 64 项 map 满后淘汰活动值，“回到原值同 revision”偶发失败 | setActiveGeometry 标记活动 key；淘汰跳过它；测试先插 70 个签名再验活动值；非活动旧值只保证未淘汰时稳定 |
| 材质三类混淆 | 把 MAT.xray/MAT.carbonWing 或 CAR.decalCache 当实例释放，导致壳体贴图丢失；或漏掉 contactRing.clone() | disposeGroupChildren 保留集合来自 MAT/TEX/CAR.decalCache/CAR.shared；场景期 contactRing 计 sceneMaterialsDisposed；teardown 按场景→注册表→渲染器 |
| 10 项动态自检分片 | 首片含 settle 2.5 s 仍可能 >50 ms；总时长随 B2-1 增至 10 项 | 生成器按 record yield；B2-1 合入后实测 T_total/T_first，阈值 1.5×；同步 API 仍返回 10 项；modal 断言 >=24 |
| 审计与实现口径冲突 | B5.1/5-clamp50 仍模拟旧截断；B5.3 观察 characterData | 见 4.2，先由 05 改 audit/baseline，否则 B3 不能宣称 audit 转绿 |
| B1-1 质心语义 | calibrateRack 仍把 sim.state 当参考点 | 改用 simReferencePoint(SIM)；三处调用点同改；B1-1 验收后回归 |
| B2-1 retarget 混用 | 在几何提交后调用 simRetargetReference 清空 settle 种子；或 pending 中调用 | 同代物理分支才调用；提交用 simReset；B2/B3 联调确认 process 调用点 |
| solver 语义越权 | B3-3 自行实现首行判据或把 CAR.diag.rockerSolveOk 当 solverOk | 首行/两行归 B4-4；B3-2 probe 保留渲染诊断，快照 solverOk 由 B1-3 模型提供 |
| B4 文件重叠 | 30-ui/40-app 同一快照字段、同一首行被 B3/B4 双改 | 见第 6 节顺序；B3-3 先冻结 10 行骨架，B4-4 后填判据；40-app 快照一次合并 |

## 6. 施工顺序、B4 重叠与建议分工

顺序：

    B0 完成
      └─ B1（B1-1/B1-3/B1-4/B1-5、B1-6）
           └─ B2（B2-1、B2-3、B2-4）
                └─ B3-1（05 帧时间 + 40 animate + 30 遥测）
                     └─ B3-2（00/05/40/22/20 几何代际）
                          ├─ B3-3（30/05 自检缓存与分片）
                          └─ B3-4（20/10/22/40 资源）
                               └─ B4-4（30-ui 首行/两行/solverBadge）

B3-1 必须先于 B3-2 合入（同一个 40-app.js 的 animate/refreshAll 上下文）；B3-2 必须先于 B3-3 与 B3-4（revision 字段与 buildCar 提交边界）；B3-3 必须先于 B4-4（同一 refreshChecks 的 10 行骨架）；B3-4 可在 B3-2 后与 B3-3 并行。B4-1/B4-2/B4-3/B4-5/B4-7 与 B3 无文件交集，可在 B2 后并行；B4-6 的浏览器 runner 迁移应先于 B3 的浏览器追加段，或 B3 只以独立块追加、不碰 try/finally。

文件重叠：

| 文件 | B3 触碰 | B4 触碰 | 建议 |
| --- | --- | --- | --- |
| 40-app.js | B3-1 animate、B3-2 refreshAll/PENDING/setState/snapshot、B3-3 setupRevision/selfTestRuns、B3-4 dispose/assets | B4-4 solverState 首行、B4-6 浏览器 runner 无关、B4-8 build | 40-app 由单一集成者按 B3-1→B3-2→B3-3/B3-4→B4-4 顺序合并 |
| 30-ui.js | B3-1 syncSimControls/simDetail、B3-3 refreshTelemetry/refreshSelfTests/refreshChecks | B4-4 首行判据与新增两行、B4-2 键盘、B4-3 面板 | B3-3 先冻结 10 行 id；B4-4 后填判据；B4-2/B4-3 独立函数可并行 |
| 05-body-dynamics.js | B3-1 simAdvance、B3-2 revision、B3-3 生成器 | 无 B4 | B1/B2 先合；B3 三项在同一文件按序 |
| 20-car.js/10-scene.js/22-car-dynamics.js | B3-2 revision/guard、B3-4 assets/dispose/teardown | 无 B4（B1-4 改 updateSuspension） | B3-2 先，B3-4 后；B1-4 已改 22 |
| tools/test-dynamics-browser.mjs | B3-2 pending、B3-3 24 项、B3-4 材质/teardown | B4-6 runner 迁移 | B4-6 先行或只追加独立块；不改 try/finally |
| package.json/README/DESIGN | test:runtime、数量/帧率文案 | B0-3、B4-8、B5-1/B5-2 | B0-3 加脚本，B5 统一改文档；B3 不重复改 README/DESIGN |

建议分工：

1. 40-app 集成者：B3-1 的 animate、B3-2 的 PENDING/refreshAll/setState、B3-3/B3-4 的快照字段。理由：40-app.js 是唯一被四项同时触碰的文件，合并成本高于实现成本。
2. 物理/自检实现者：B3-1 的 05:525-537 与 B3-3 的 05:711-814 生成器；与 B1/B2 的 simAdvance、simInfo 字段直接相邻。
3. 几何实现者：B3-2 的 00-core 签名/revision、05 字段、22 守卫、20 diag；需要与 B2-1 simRetargetReference 联调。
4. 资源实现者：B3-4 的 20/10/22 与 FSApp.dispose；需要 B3-2 的 buildCar 边界先落地。
5. B4-4 实现者：在 B3-3 之后改 refreshChecks 首行判据、新增 rockerResidual/motionRatio 两行与 #solverBadge；不改 10 行 id/顺序。B4-6 负责浏览器 runner 与清理，B5 负责 README/DESIGN 的数量与帧率文案。

两处裁决已定（§0.1/§0.2）；解冻前由 05 完成 tools/test-runtime.mjs 的注册（§0.3），B3 施工时随 B3-1/B3-3 同提交修改两处 audit 与 baseline。解冻前不写 src/，B3-1/B3-3 的验收不再被两个过时断言卡住。
