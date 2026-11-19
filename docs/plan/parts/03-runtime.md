# 分册 03：帧时间、几何代际与资源生命周期

| 项目 | 内容 |
| --- | --- |
| 适用版本 | 0.2.0（提交 fbb401d） |
| 修订 | r2（2026-11-19） |
| 所属批次 | B3（运行时与资源） |
| 交付文件 | `docs/plan/parts/03-runtime.md` |
| 负责范围 | B 报告 5.1 低帧率丢时、5.2 几何代际、5.3 自检调度、5.4 材质生命周期 |
| 依据 | A 报告 `docs/code-review.md`、B 报告 `docs/code-review-k3.1-pro.md`、主册 `docs/施工计划.md` |

## 1. 范围说明

本册处理四项运行时缺陷：固定步长循环的帧时间语义、车辆几何重建的代际一致性、页面自检的调度与缓存、材质与纹理的生命周期。四者的共同点是物理方程本身没有错，错在物理状态与渲染层、界面层之间的时序与所有权没有显式契约。修复手段是在现有全局脚本结构内增加版本号、会计字段与释放钩子，不引入模块系统、前端框架或运行时依赖。

本册不处理 B 5.3 的 DOM 结构与视觉细节（分册 04）、B 1/B 2 的物理与接触问题（分册 01/02）以及审计框架（分册 05）。对 `30-ui.js` 只改自检缓存、检查项节点复用和帧时间字段写入，不改布局、颜色与 ARIA 文案；对 `tools/test-dynamics-browser.mjs` 只追加检查段，其 `try/finally` 与 Chrome 启动清理由 B4-6 负责。

约束沿用主册：单文件离线交付、零运行时依赖、不使用前端框架、Node >= 18；Node 测试继续用 `new Function` 装载全局脚本，新增函数必须留在全局脚本作用域内。本册编写期间 `npm test` 基线为静力 47 项、动力学 52 项全绿；按任务约定未运行 `npm run test:browser`（调试端口占用），浏览器断言均标注为待执行命令。

## 2. 现状与证据

行号对应提交 fbb401d。E1、E9 为本册用只读 Node 脚本复测或静态清点；E3 的 104.10 mm 与 E6 的测试缺口引自 B 报告与源码核对；其余为源码时序分析，未重跑浏览器。

| 编号 | 现状 | 源码位置 | 观测值 | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 低帧率静默丢时 | `05-body-dynamics.js:23-25`、`525-537`、`40-app.js:414-419` | 1 s 墙钟推进的仿真时间：60 Hz 1.000 s、30 Hz 0.998 s、12 Hz 0.960 s、10 Hz 0.800 s、5 Hz 0.400 s；应用层再截断到 0.05 s 后，12/10/5 Hz 只剩 0.598/0.498/0.248 s | 40 子步上限（80 ms）与两层不同的帧上限叠加，超出部分被 `sim.accumulator = 0` 清除 |
| E2 | 无丢时会计字段 | `05-body-dynamics.js:618-634` | `simInfo` 只有 `accumulator`、`substeps` | 遥测无法区分慢动作与丢时 |
| E3 | 尺寸变化可被 API 绕过 | `40-app.js:336-347` | `setState({wheelbase:3.90},{rebuild:false})` 仍走非重建路径，悬架杆长偏差 104.10 mm（B 5.2） | 公开 API 与测试可制造代际混用 |
| E4 | 参考模型先行替换 | `40-app.js:72-96`、`423-436` | 尺寸变化后 `SIM.reference` 立即换成新几何，`CAR.corners` 要等 85 ms 节流后才重建 | 等待窗口内物理用新参考、场景用旧硬点 |
| E5 | 主循环不检查 pending | `40-app.js:425-436`、`22-car-dynamics.js:1091-1092` | 每帧仍对旧 `CAR.corners` 调用 `updateCar(model)`，该函数只检查 `CAR.built` | 代际一致性完全依赖调用顺序 |
| E6 | 浏览器测试未覆盖代际 | `tools/test-dynamics-browser.mjs:241-246` | 只把轴距改到 3.70 m 后断言 `contactOk` | 104 mm 级偏差可通过现有测试 |
| E7 | 自检在遥测路径重复执行 | `30-ui.js:676-680`、`382-421`、`563-649`；`40-app.js:431-434` | 遥测最高每 110 ms 调用一次，每次都重跑 14 项静态自检；主册记录静态 22 ms、动态 572 ms，B 浏览器实测 11 ms、768 ms | 每秒约 9 次静态自检，占单核 7%–20%；打开模型说明时动态自检同步阻塞 0.77 s |
| E8 | 检查项 DOM 每次重建 | `30-ui.js:633-648` | `refreshChecks` 先清空 `#checkList` 再逐行创建 8 个节点 | 110 ms 周期内持续产生节点垃圾与布局抖动 |
| E9 | 只释放几何，不释放材质 | `20-car.js:175-187`、`22-car-dynamics.js:1156-1159`；材质创建点 `20-car.js:629/685/747/843/909/1108` | B 插桩：一次真实重建 387 次 `BufferGeometry.dispose`、0 次 `Material.dispose`；本册静态清点每次 `buildCar` 新建 7 个实例材质 | 材质、CanvasTexture 与贴花缓存没有释放路径 |
| E10 | 无统一 teardown | `10-scene.js:430-654`、`957-984`、`968` | `MAT`/`TEX`/`envRT`、4 个 `contactRing.clone()`、贴花材质都只增不减 | 页面生命周期内没有资源归零入口 |

E1 的复测方法：`simCreate(DEFAULTS,{settle:0})` 后按 `1/fps` 连续调用 `simAdvance` 共 `fps` 次，读取 `sim.time`；应用层数值把每帧输入先截断到 0.05 s。E9 的 7 个实例材质来自 `buildBodywork` 内的独立 `new THREE.*Material`：滑板块、座舱开口、方向盘屏、进气口、两个侧箱进气口、排气内壁；贴花材质由 `makeTextMaterial` 按 key 缓存，不属于每次重建。

## 3. 任务清单

| ID | 标题 | 主要文件 | 依赖 | 工作量（人日） |
| --- | --- | --- | --- | --- |
| B3-1 | 帧时间语义与 droppedTime | `05-body-dynamics.js`、`40-app.js`、`30-ui.js`、README、DESIGN | B2 完成 | 1.0 |
| B3-2 | 几何代际与原子替换 | `00-core.js`、`05-body-dynamics.js`、`20-car.js`、`22-car-dynamics.js`、`40-app.js`、`30-ui.js` | B2、B1-3、B1-4 | 1.5 |
| B3-3 | 自检缓存与检查项增量更新 | `00-core.js`、`05-body-dynamics.js`、`30-ui.js`、`40-app.js` | B3-2、B1 | 1.0 |
| B3-4 | 材质与纹理生命周期 | `20-car.js`、`22-car-dynamics.js`、`10-scene.js`、`40-app.js` | B3-2、B1-4 | 1.0 |

合计 4.5 人日。B3-1 与 B3-2 都修改 `40-app.js`，按 B3-1 → B3-2 顺序合入；B3-3 依赖 B3-2 的 `refreshAll` 判定顺序；B3-4 依赖 B3-2 的 `buildCar` 提交边界与 B1-4 的 `updateSuspension` 改造。B3-3 与 B3-4 在 B3-2 合入后可并行。

## 4. 工作项

### B3-1 帧时间语义与 droppedTime（1.0 人日）

**现状。** `simAdvance`（`05-body-dynamics.js:525-537`）把帧间隔截断到 0.1 s，每帧最多 40 个 2 ms 子步，达到上限后清零累加器；`40-app.js:418` 又先截断到 0.05 s。两层上限不匹配（0.05 s 对应 25 子步，0.1 s 对应 50 子步，而子步上限只允许 40），低帧率下的时间以不可见方式丢失，与 README:164、DESIGN:578 的“掉帧后结果一致”表述冲突。

**目标与策略。** 选择“有界慢动作 + 显式丢弃”，不选纯丢弃：固定步长的整数子步与确定性是阶段二、三回归的基础，纯丢弃会让低帧率下的轨迹跳跃。新语义为单帧最多接受 0.5 s、每帧最多执行 128 个 2 ms 子步（0.256 s）；接受量超出执行能力的部分保留在 backlog（上限 0.5 s），积压可跨帧排空，只有输入超过单帧接受上限或 backlog 满时才计入 `droppedTime`。4 Hz 及以上（帧间隔 ≤0.25 s）单帧可执行完，保持实时；3 Hz 约 0.77×、2 Hz 约 0.51× 慢动作，长暂停后先以追赶帧排空积压再回到 1×。按主册单子步 0.048 ms 计，128 子步约 6.1 ms 物理耗时。

**实施步骤。**

1. `05-body-dynamics.js:23-25` 改为 `SIM_MAX_SUBSTEPS = 128`、`SIM_MAX_FRAME_DT = 0.5`、`SIM_MAX_BACKLOG = 0.5`，并保持两条不变式：`SIM_MAX_SUBSTEPS * SIM_DT >= 0.25`（4 Hz 单帧可执行完）与 `SIM_MAX_BACKLOG >= SIM_MAX_FRAME_DT - SIM_MAX_SUBSTEPS * SIM_DT`（0.5 s ≥ 0.244 s，保证一帧接受量不会超过积压容量）。

2. 重写 `simAdvance`（`525-537`）：

   ```js
   function simAdvance(sim, frameDt) {
     if (!sim || !sim.running || !sim.state) return 0;
     const wallDt = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : 0;
     const accepted = Math.min(wallDt, SIM_MAX_FRAME_DT);
     sim.accumulator += accepted;
     let dropped = wallDt - accepted;
     if (sim.accumulator > SIM_MAX_BACKLOG) {
       dropped += sim.accumulator - SIM_MAX_BACKLOG;
       sim.accumulator = SIM_MAX_BACKLOG;
     }
     let steps = 0;
     while (sim.accumulator >= SIM_DT && steps < SIM_MAX_SUBSTEPS) {
       simStep(sim, SIM_DT); sim.accumulator -= SIM_DT; steps += 1;
     }
     sim.lastSubsteps = steps;
     sim.lastFrameDt = wallDt;
     sim.lastAdvance = steps * SIM_DT;
     sim.droppedTime += dropped;
     sim.timeScale = wallDt > 0 ? sim.lastAdvance / wallDt : 1;
     return steps;
   }
   ```

3. `simCreate`（`127-151`）与 `simReset`（`153-172`）初始化 `lastFrameDt=0`、`lastAdvance=0`、`droppedTime=0`、`timeScale=1`；`simReset` 必须清零，避免维度重建继承旧丢时。

4. `simBuildModel` 的 `simInfo`（`618-634`）增加 `backlog`（即 `accumulator`）、`droppedTime`、`timeScale`、`lastFrameDt`、`lastAdvance`、`maxFrameDt`、`maxSubsteps`，随快照自动进入 `getSnapshot().sim`。

5. `40-app.js:414-419` 删除 0.05 s 截断：物理路径把原始帧间隔交给 `simAdvance` 统一记账，相机路径单独截断到 0.05 s；`updateCamera(Math.min(frameDt, 0.05))`，`simAdvance(SIM, frameDt)`。

6. 遥测（`30-ui.js`）：`syncSimControls`（`651-674`）的 `telemetrySimSteps` 追加 `1.00×`，`simDetail`（`781-786`）追加积压与累计丢时；`refreshChecks` 第一行（`590-595`）改为 `t 1.20 s · 500 Hz · 8 子步 · 1.00× · 丢 0.00 s`，无 `sim` 时的兜底对象（`571-580`）补齐字段。排版由分册 04 决定。

7. 文档同步：README:164 改为“单帧接受上限 0.5 s；每帧最多执行 128 个 2 ms 子步（0.256 s），接受量超出执行能力的部分跨帧保留为积压，积压上限 0.5 s，超过单帧接受上限或积压满后才丢弃并计入 `droppedTime`；低于 4 Hz 时按慢动作推进，长暂停后以追赶帧排空积压；同一仿真时刻的状态与帧率无关”。README:14、README:199 第 7 条、README:212 的帧率对照表行，以及 DESIGN:578、DESIGN:648 同步同一口径，删除“单帧最多 40 个子步”和“掉帧后物理结果一致”的绝对表述。

**验收。** `node tools/test-runtime.mjs --group frame` 与 `npm test`。断言：60/30/12/10/5/4 Hz 在 `settle:0` 下跑 1 s 墙钟，`|Δsim.time − 1| ≤ 1.5·SIM_DT`、`droppedTime === 0`、`backlog < 2·SIM_DT`；2 Hz 时 `Δsim.time ∈ [0.50,0.52]`、`timeScale ∈ [0.50,0.52]`、`droppedTime ∈ [0.23,0.26]`（1 s 两帧、每帧执行 128 步并各自留下约 0.244 s 积压）；60 Hz 跑 5 帧后单帧输入 2.0 s，返回子步 = 128、推进 0.256 s、`droppedTime` 增加 1.5 s、状态有限，该帧 `timeScale ≈ 0.128`；随后 3 个 60 Hz 帧的 `timeScale` 序列约为 `[15.36, 1.20, 0.96]`，backlog 从 0.244 s 降到 0.0047、0.0013、0.0020 s，证明 0.5 s 积压在 2 帧内排空而不是每帧固定丢时；`timeScale > 1` 表示追赶帧，不是错误。同子步数下与 `simRunFor` 参考状态差 < 1e-12；暂停时返回 0 且 `droppedTime` 不变；两条常量不变式成立；`tools/test-dynamics.mjs:224-232` 原样通过。

浏览器侧由具备空闲端口的执行者运行：2 s 后 `sim.timeScale > 0.95`、`sim.droppedTime < 0.02`、`sim.maxFrameDt === 0.5`、`sim.maxSubsteps === 128`；新增 10 Hz 限帧页面用例（`Page.addScriptToEvaluateOnNewDocument` 包装 `requestAnimationFrame`，每 6 次回调转发 1 次）在 2 s 墙钟后 `Δsim.time ∈ [1.85,2.0]`、`droppedTime < 0.05`。

**风险与回滚。** 最坏一帧子步从 40 提到 128，重建帧与长暂停恢复帧的物理耗时会上升；浏览器若显著慢于 Node，应把上限降到 0.2 s 并同步 100 子步（仍覆盖 5 Hz），而不是恢复静默清零。追赶帧的 `timeScale` 可远大于 1（实测约 15×），遥测必须同时显示 backlog 才能解释；若产品不接受追赶帧，可改为“每帧最多追 0.256 s、丢弃剩余积压”，但必须保留 `droppedTime` 字段。回滚：恢复 `0.1/40`、`40-app` 的 0.05 截断与 `simInfo` 字段；B3-1 单独提交，回退不影响 B3-2。

### B3-2 几何代际与原子替换（1.5 人日）

**现状。** 尺寸参数集中在 `REBUILD_KEYS`（`40-app.js:5`），但 `setState` 允许 `options.rebuild=false` 覆盖（`340-341`）；`refreshAll` 在决定重建前就把 `SIM.reference` 换成新几何（`74-78`），而 `CAR.corners` 要等 `processPendingRebuild`（`50-70`）在 85 ms 节流后替换。等待窗口内主循环仍每帧 `simBuildModel` + `updateCar`（`425-436`），`updateCar` 只检查 `CAR.built`，旧硬点可以接收新轮位。B 5.2 用 3.90 m 轴距复现 104.10 mm 杆长偏差；`resetAll`（`30-ui.js:221-236`）也先在旧场景上 `simReset`。

**目标。** 几何身份由尺寸签名唯一确定，物理参考、模型快照、Three 场景携带同一个 `geometryRevision`；尺寸变化无条件重建；pending 期间冻结在上一代匹配模型；提交在同一 rAF 任务内完成并原子替换；跨代组合在 `updateCar` 入口被拒绝并记为诊断异常。

**实施步骤。**

1. `00-core.js` 在 `NUM_LIMITS` 之后新增：

   ```js
   let GEOMETRY_SERIAL = 0;
   let ACTIVE_GEOMETRY_KEY = '';
   const GEOMETRY_REVISIONS = new Map();          // signature -> revision，最多 64 项
   function geometrySignature(source = state) {
     return [source.wheelbase, source.trackFront, source.trackRear,
       source.wheelRadius, source.tireWidthF, source.tireWidthR]
       .map((v) => Number(v).toFixed(6)).join('|');
   }
   function setActiveGeometry(source = state) {
     ACTIVE_GEOMETRY_KEY = geometrySignature(source);
     return geometryRevisionFor(source);
   }
   function geometryRevisionFor(source = state) {
     const key = geometrySignature(source);
     let revision = GEOMETRY_REVISIONS.get(key);
     if (!revision) {
       GEOMETRY_SERIAL += 1; revision = GEOMETRY_SERIAL;
       GEOMETRY_REVISIONS.set(key, revision);
       while (GEOMETRY_REVISIONS.size > 64) {
         let evict = null;
         for (const candidate of GEOMETRY_REVISIONS.keys()) {
           if (candidate !== ACTIVE_GEOMETRY_KEY) { evict = candidate; break; }
         }
         if (!evict) break;                        // 只剩活动项时不淘汰
         GEOMETRY_REVISIONS.delete(evict);
       }
     }
     return revision;
   }
   const PHYSICS_KEYS = ['mass','frontWeightPct','cgHeight','cgLateral','wheelRateF',
     'wheelRateR','dampingF','dampingR','arbFront','arbRear','slope','bank','friction'];
   function physicsSignature(source = state) {
     return PHYSICS_KEYS.map((k) => Number(source[k]).toPrecision(10)).join('|');
   }
   ```

   同一尺寸返回同一 revision，不同尺寸单调递增；6 位小数消除滑块浮点噪声。淘汰策略明确为“只淘汰历史、不淘汰当前活动 revision”：`simCreate`/`simReset` 通过 `setActiveGeometry` 标记当前几何，`while` 循环只删除非活动 key；因此活动值在任意多次调参后仍返回原 revision，被淘汰的非活动旧值允许重新分配（测试按“未淘汰时同值同 revision”断言，不承诺历史值永久稳定）。

2. `computeStatic` 的返回对象（`471-561`）增加 `geometryRevision: geometryRevisionFor(source)`、`physicsSignature: physicsSignature(source)`，并把 `source` 改为 `cloneState(source)`，使参考模型持有参数快照。`05-body-dynamics.js:202` 不再回退：`reference.source` 必须存在，缺失时 `simEvaluate` 抛出消息含 `reference.source` 的错误，不得改用 `state` 或 `DEFAULTS`（与分册 01 的 B1-6、A-01 一致）。该行的抛错实现由 B1-6 落地，B3-2 只保证 `computeStatic` 始终写入快照 `source`，两册联合验收。

3. `05-body-dynamics.js`：`simCreate`（`127-151`）与 `simReset`（`153-172`）调用 `setActiveGeometry(source)` 标记当前几何，并增加 `sim.geometryRevision = sim.reference.geometryRevision`、`sim.steerApplied = source.steer`；`simBuildModel` 返回对象显式带 `geometryRevision: reference.geometryRevision`（`636` 附近）。

4. `22-car-dynamics.js` 增加入口校验。`updateCar`（`1091`）首行改为：

   ```js
   if (!CAR.built) return;
   if (!model || model.geometryRevision !== CAR.geometryRevision) {
     CAR.diag.geometryMismatch = true; return;
   }
   CAR.diag.geometryMismatch = false;
   ```

   `updateSuspension`（`944`）加同一行防御。`buildCar`（`1156`）入口校验 `model.geometryRevision`（缺失即抛错），在 `CAR.built = true`（`1209`）之前写入 `CAR.geometryRevision = revision`，使末尾的 `updateCar(model)`（`1211`）通过校验。`CAR.diag`（`20-car.js:33-58`）增加 `geometryRevision`、`geometryMismatch`。

5. `40-app.js` 的 `PENDING` 改为 `{ rebuild, reason, requestedAt, lastBuildAt, commits, failures, lastPolicy }`，删除 `PENDING.model`。`processPendingRebuild`（`50-70`）在提交成功后才清零 `rebuild`；失败保留并累计 `failures`，连续 3 次调用 `showFatalError`。提交顺序固定为 `simReset(SIM,state,{settle:0.5})` → 重标 `rackShift` → `simBuildModel` → `buildCar`（内部写 revision 并首次 `updateCar`）→ 场景矩阵/覆盖层 → 遥测/自检/标签，全部在同一 rAF 任务内完成。几何代际切换（新 `SIM.reference` 换代、`SIM.geometryRevision`、`CAR.geometryRevision` 与场景重建）只允许出现在 `processPendingRebuild` 内；非几何物理参数变化可在 `refreshAll` 的 physics 分支重算同代 `SIM.reference`，此时 `geometryRevision`/`physicsRevision` 不变。

6. `refreshAll`（`72-96`）按“冻结 → 几何 → 物理 → 转向 → 显示”判定，并删除现有第 74-78 行在 pending 检查之前执行的 `SIM.reference = computeStatic(state)`。新的顺序是：先判断 `PENDING.rebuild`，为真立即返回；再判断 `geometryRevisionFor(state) !== SIM.geometryRevision` 或显式 `rebuild`，命中只调用 `requestRebuild` 并返回，不写 `SIM.reference`、不调用 `simReset`；只有确认几何未变且仅 `physicsSignature` 变化时，才允许在该分支内执行 `SIM.reference = computeStatic(state)`、重标 `rackShift`、重建模型并更新场景；仅 `steer` 变化时只重标 `rackShift`、写回 `steerApplied` 并更新场景；仅显示开关或单位变化时只调用 `UI.refreshTelemetry(UI.lastModel)`、`refreshLabelContent` 与 `updateOverlays`，不调用 `computeStatic`。

7. `setState`（`336-347`）收紧：`dimensionsChanged = geometrySignature(merged) !== geometrySignature(previous)`，`rebuild = dimensionsChanged || options.rebuild === true`；尺寸变化时 `options.rebuild === false` 被忽略并 `console.warn`，同时把 `PENDING.lastPolicy` 写为 `geometry-forced`，其余路径分别写 `explicit`、`params`、`display`，快照 `geometry.policy` 直接读取该字段。`resetAll`（`30-ui.js:221-236`）删除提前 `simReset`，保留 `SIM.running = true`，改由 `refreshAll({ rebuild: true, reason: 'reset' })` 提交；`resetDynamics`（`40-app.js:362-371`）先比较 `geometryRevisionFor(state)` 与 `SIM.geometryRevision`，不一致时直接 `requestRebuild` 并返回，不先 `simReset`（否则会制造一帧真实的代际不一致），一致时才 `simReset` 并更新场景；`exportScreenshot`（`119-123`）在 pending 时用 `UI.lastModel`。

8. 冻结字段定义：`sceneRevision = CAR.geometryRevision`；`physicsRevision = SIM.reference.geometryRevision`（不是 `SIM.geometryRevision`，后者仅作内部同值校验）。`getSnapshot` 增加 `geometry: { sceneRevision, physicsRevision, pending, policy, commitCount, mismatch, dims }`；`getSceneProbe` 增加 `geometryRevision`（= `sceneRevision`）、`physicsRevision`、`geometryMismatch`。`UI.lastModel` 始终是已提交代模型，pending 期间遥测不显示未落地的新代数值。

9. 浏览器测试（`tools/test-dynamics-browser.mjs:246` 之后追加）：注入 rAF 监视器，每帧读取 `getSceneProbe()` 记录 `geometryMismatch`、`stretch.susp`、`physicsRevision` 与 `SIM.resetCount`；执行 `setState({wheelbase:3.9},{rebuild:false})`、等提交、再快速回切 3.55 m；断言 `mismatches === 0`、`stretch.susp < 0.01`、pending 窗口内 `physicsRevision` 与 `resetCount` 逐帧不变、提交帧二者才同时变化、最终 `sceneRevision === physicsRevision`、`state.wheelbase === 3.55`。现有 3.70 m 用例保留。

**验收。** `node tools/test-runtime.mjs --group geometry`、`npm test`、`npm run build && git diff --exit-code index.html`。Node 断言：六个尺寸键逐一修改各产生新 revision；`simBuildModel(SIM)`、`SIM.reference`、`SIM.geometryRevision` 三者相等，且 `physicsRevision === SIM.reference.geometryRevision`；故意错开 `CAR.geometryRevision` 与模型后调用 `updateCar`，`CAR.diag.geometryMismatch === true` 且不写 `corner.angle`；`updateSuspension` 同样被拒绝。淘汰策略单独断言：先 `setActiveGeometry(基态)`，再依次插入 70 个不同尺寸签名，`GEOMETRY_REVISIONS.size <= 64`，`geometryRevisionFor(基态)` 仍返回原 revision；对已被淘汰的非活动旧值只断言“若仍在表中则同值同 revision”，不承诺历史值永久稳定。A-01 联合断言：构造缺失 `reference.source` 的参考模型，`simEvaluate` 必须抛错且错误消息含 `reference.source`（B1-6 未合入时标记为联合验收项）。

浏览器断言：`setState({wheelbase:3.9},{rebuild:false})` 立即返回 `pending === true`、`policy === 'geometry-forced'`、`sceneRevision` 仍为旧值；pending 窗口用 rAF 逐帧断言 `physicsRevision`（`SIM.reference.geometryRevision`）与 `sim.resetCount` 不变，且 `stretch.susp` 始终 < 0.01；400 ms 后 `pending === false`、`sceneRevision === physicsRevision`、`stretch.susp < 0.01`（修复前同一路径为 104.10 mm）；快速两次改尺寸只产生一次最终提交（`commitCount` 增加 ≤ 2）且 `contactOk` 为真。

**风险与回滚。** pending 期间非几何参数调整要等 85 ms 窗口加一次重建才应用，属可接受延迟；重建失败时保留 `PENDING.rebuild` 重试，连续失败进入既有 `showFatalError`。`computeStatic` 的 `source` 改为快照后，`05-body-dynamics.js:202` 必须能读到该快照；缺失即抛错（A-01），不再有回退兼容分支，B1-6 与本册同步合入。回滚按 B3-2 单独提交回退，B3-1、B3-3 不依赖 `geometryRevision`；把 `updateCar` 代际分支改为恒假会重新引入 104 mm 回归，不推荐。

### B3-3 自检缓存与检查项增量更新（1.0 人日）

**现状。** `refreshTelemetry`（`30-ui.js:676-680`）每次调用都执行 `runSelfTests(state)`，主循环每 110 ms 调用一次（`40-app.js:431-434`）；`refreshChecks`（`563-649`）每次清空并重建 8 行 DOM（R-10 后冻结为 10 行）；`refreshSelfTests`（`382-421`）在打开模型说明时同步运行动态自检，现状 8 项时 B 浏览器实测 768 ms。没有参数版本概念，所有结果只能重算。

**目标。** 静态与动态自检按 `setupRevision` 缓存；静态自检完全离开周期遥测路径；动态自检只在显式打开模型说明或调用 API 时运行，并按测试分片让出主线程；检查项只创建一次，之后仅写变化的文本与 class。分册 04 负责加载指示器、布局与 ARIA，本册只定义缓存键、行标识与更新协议。

**实施步骤。**

1. 在 B3-2 的 `00-core.js` 基础上增加复合 setup 签名与修订号：`setupSignature(source) = geometrySignature(source) + '#' + physicsSignature(source)`；模块级 `SETUP_REVISION = 0`、`SETUP_SIGNATURE = ''`；`noteSetupChange(source)` 在签名变化时自增并返回。复合签名恰好覆盖 6 个几何键与 13 个物理键，`steer`、`units`、显示开关不参与，因此拖动转向或切换单位不会触发重算。

2. `30-ui.js` 的 `UI`（`5-18`）增加 `selfTestCache: { revision, staticTests, dynamicTests, dynamicRevision, runs: { static, dynamic } }` 与 `checkRows: {}`；`UI.selfTests` 保留为静态缓存别名。新增 `ensureStaticSelfTests({ force } = {})`：用 `noteSetupChange(state)` 取 revision，命中缓存直接返回，否则调用一次 `runSelfTests` 并计数。

3. `refreshTelemetry` 第 679 行改为 `ensureStaticSelfTests();`；`refreshSelfTests` 的静态部分改用同一函数。新增 `ensureDynamicSelfTests({ force = false, onProgress } = {})`：命中 `dynamicRevision === revision` 时直接返回，否则启动分片执行并在完成时写入 `UI.dynamicTests`。`openModelModal`（`359-370`）因此不再同步阻塞，`FSApp.runDynamicSelfTests()` 保持同步语义供测试使用。

4. 把 `05-body-dynamics.js` 的 `runDynamicSelfTests`（`711-814`）改写为生成器 `function* simDynamicSelfTestSteps(source, tests)`，在每次 `record` 后 `yield tests[tests.length - 1]`；原函数用生成器排空，返回数组与顺序不变，数量按 R-06 为 10 项（新增两项来自分册 01/02 的求解与运动比检查）。新增 `runDynamicSelfTestsChunked(source, { onTest, onDone, sliceMs = 50 })`：在一个 `while (performance.now() - start < sliceMs)` 循环里 `iterator.next()`，超过切片就 `setTimeout(pump, 0)`。一档通常完成 1–3 项检查，首档包含 `settle 2.5 s` 仿真，可能略超 50 ms；总时长与首档在 B2-1 合入后重测，阈值按 O-15 用实测值加 50% 裕度。分册 01 会改动该函数的字段消费，合入时以生成器版本为准重新套用其断言。

5. `refreshChecks`（`563-649`）改为固定行模式，行 id 与顺序按 R-10 冻结为 10 行：`sim、contact、links、steer、arb、friction、rockerResidual、motionRatio、staticTests、dynamicTests`。首次创建 `div.check-item` 及图标、名称、数值三个子节点并存入 `UI.checkRows[id]`；之后只比较并写入变化的 `textContent`，仅在 `ok` 变化时切换 `is-ok/is-warn` 与图标字符；容器不再 `textContent = ''`。职责边界：B3-3 只建立 10 行节点骨架、缓存与增量写入协议；`sim` 首行的判据（`sim.finite && !sim.recovered && solverOk`）与 `rockerResidual`、`motionRatio` 两行的取值/判据由 B4-4 提供，在 B4-4 合入前两行显示 `—`；B3-1 只向 `sim` 行追加时间缩放与丢时字段，不改判据。分册 04 只负责样式与 `aria` 属性。

6. `40-app.js` 快照增加 `setupRevision`、`selfTestRuns: { static, dynamic }`；`getSnapshot` 第 262 行的回退改为 `UI.selfTestCache.staticTests || runSelfTests(state)`。边界：04 不得直接调用 `runSelfTests` 或清空 `#checkList`。文档数量同步：README:19、README:172、README:245 与 DESIGN:544、DESIGN:640 的“22 项（14+8）”统一改为“24 项（14+10）”，浏览器断言改为 `dynamicTests.length >= 10`、`modalItems >= 24`；README:19 的 Node 动力学 45 项与实测 52 项的冲突由 B5-1 一并修正。新增两项必须按测试名称逐项断言，不能只靠数量下限。

**验收。** `node tools/test-runtime.mjs --group selftest` 与 `npm test`。Node 断言：6 个几何键与 13 个物理键逐一修改各使 `noteSetupChange` 增加 1；`steer`、`units`、`xray`、`showLabels` 不增加；`runSelfTests` 返回 14 项、`runDynamicSelfTests` 返回 10 项，新增两项按分册 01/02 冻结的名称断言，其余各项的 `ok`、`detail` 与改造前逐项相同；生成器排空结果与同步结果相等。

浏览器断言：打开模型说明后 `dynamicTests.length >= 10`、`#selfTestList li` 数量 `>= 24`；启动后 2 s 内 `selfTestRuns.static === 1`，再等 2 s 不变；`setState({mass:820})` 后为 2；`setState({units:'kg'})`、`setState({steer:5})` 不变；两次打开模型说明 `selfTestRuns.dynamic === 1`，参数变化后再打开为 2；对 `#checkList` 挂 `MutationObserver` 观察 3 s，`childList` 记录 0；第二次打开 < 30 ms。分片预算按 O-15：B2-1 合入并完成 10 项后，在生产构建上实测总时长 `T_total` 与首档时长 `T_first`，弹窗完成上限设为 `1.5·T_total`、单次长任务上限设为 `1.5·T_first`，实测值写入测试常量 `SELFTEST_BUDGET`；不预设固定秒数。现有 `248-252` 的“≥22 项”改为“≥24 项”，等待改为 `1.5·T_total + 500 ms`。

**风险与回滚。** 缓存键漏掉参数会导致结果陈旧；用 19 键穷举测试兜底，并在 `PHYSICS_KEYS` 上方注明新增物理参数必须同步。分片把现状 768 ms（8 项）摊到多帧，10 项后总时长以 O-15 的实测 `T_total` 为准；若分片后仍超过 `1.5·T_total`，回退到“打开时同步运行一次但只运行一次”，缓存与节点复用保留。生成器与分册 01 冲突时，可先只做缓存与 DOM 复用，分片作为独立后续提交。

### B3-4 材质与纹理生命周期（1.0 人日）

**现状。** `disposeGroupChildren`（`20-car.js:175-187`）只收集几何体、跳过 `userData.shared`，随后移除子节点，完全不处理材质与纹理。`buildCar` 每次尺寸重建都调用它（`22-car-dynamics.js:1156-1159`），而 `buildBodywork` 内有 6 处独立 `new THREE.*Material` 创建点、共 7 个实例材质（`20-car.js:629、685、747、843、909、1108`，其中 909 在左右循环内各建一个）。贴花材质由 `makeTextMaterial`（`409-427`）按 key 缓存，贴花几何每次重建新建。B 插桩结果为 387 次几何释放、0 次材质释放；页面没有统一 teardown。

**目标。** 按所有权分三类释放：

| 类别 | 资源 | 创建位置 | 重建时 | teardown 时 |
| --- | --- | --- | --- | --- |
| 共享 | `MAT.*`（含 clone）、`TEX.*`、`CAR.shared.*`、渲染器、场景、灯光 | `10-scene.js:430-654`、`20-car.js:67-162` | 保留 | 释放 |
| 缓存 | `CAR.decalCache` 的材质与 CanvasTexture | `20-car.js:409-427` | 保留 | 释放 |
| 实例 | 7 个 `buildBodywork` 材质、非 `userData.shared` 几何、`contactRing.clone()` 与 leader 材质 | `20-car.js:629/685/747/843/909/1108`、`10-scene.js:968-980` | 释放 | 释放 |

**实施步骤。**

1. `20-car.js` 的 `CAR` 增加 `assets: { instanceMaterials: new Set(), totals, lastBuild, lastTeardown }`，其中 `totals = { instanceMaterialCreated, instanceMaterialDisposed, sceneMaterialsDisposed, sharedMaterialDisposed, cachedMaterialDisposed, geometryDisposed, textureDisposed }` 为累计计数；`lastBuild = { instanceMaterialCreated, instanceMaterialDisposed, geometryDisposed, textureDisposed, at }` 只描述本次构建，`at` 用 `performance.now()`；`lastTeardown` 结构另定。新增 `instanceMaterial(material)`，把材质加入集合、`totals.instanceMaterialCreated` 与 `lastBuild.instanceMaterialCreated` 各加一并返回原对象；6 个创建点、7 个实例改为 `instanceMaterial(new THREE.*Material({...}))`，材质参数不变。

2. 扩展 `disposeGroupChildren(group, { materials = true, textures = true } = {})`：一次 `traverse` 同时收集几何、材质（含数组）与 `map/alphaMap/emissiveMap/normalMap/roughnessMap/metalnessMap/aoMap/envMap`；几何按 `userData.shared` 跳过并计数；材质按 `Object.values(MAT)` 与 `CAR.decalCache.values()` 组成的保留集合跳过并分别计数；其余材质释放贴图后 `dispose()`；若该材质在 `instanceMaterials` 中则计入 `instanceMaterialDisposed` 并删除，否则计入 `sceneMaterialsDisposed`（覆盖 `contactRing.clone()` 等场景期实例）；用 `userData.__disposed` 保证幂等。返回 `{ geometryDisposed, materialDisposed, sceneMaterialsDisposed, textureDisposed, skipped }` 并累加到 `CAR.assets.totals`，同时把 `geometryDisposed`、`textureDisposed`、`instanceMaterialDisposed` 增量写入 `lastBuild`；`buildCar` 开头重置 `lastBuild` 的五项（含 `at`）。

3. `10-scene.js` 在 `initScene` 之后新增 `teardownScene()`：先 `disposeGroupChildren(S.scene)` 释放实例并取得返回计数；再遍历 `MAT`、`TEX`、`CAR.shared`、`CAR.decalCache`，对未被 `userData.__disposed` 标记的资源逐个 `disposeOnce`（`setupEnvironment` 在 `TEX.env.dispose()` 后补标记）；然后释放 `S.envRT`、`S.keyLight.shadow.map`、`S.renderer` 并移除画布；最后清空注册表与 `CAR.shared`、`CAR.decalCache`，把 `S.initialized` 置假，并记录 `lastTeardown { instanceMaterialsDisposed, sceneMaterialsDisposed, sharedMaterialsDisposed, cachedMaterialsDisposed, geometriesDisposed, texturesDisposed, at }`，各项均为本次实际调用 `dispose` 的次数，不追求与场景内引用数的等式。以 `S.teardownDone` 保证幂等。本册不承诺同一页面 teardown 后重新 boot；`FSApp.dispose()` 用于泄漏测试的最后一次调用与页面卸载。

4. `40-app.js` 的 `bindGlobalAPI` 增加 `dispose: teardownScene` 与 `getAssetStats()`（返回 `totals`、`lastBuild`、`lastTeardown`、`renderer.info.memory`，不暴露 Set）；`getSnapshot` 增加只读 `assets` 投影；在 `window` 的 `pagehide` 上注册一次 `teardownScene`。

5. 文档：DESIGN 在 20.9 后新增“20.10 资源所有权与 teardown”，写入上表与释放顺序。

**验收。** `node tools/test-runtime.mjs --group assets` 与 `npm test`。Node 断言：构造含 7 个实例材质、2 个 `MAT` 共享材质、1 个贴花缓存材质、10 个几何（2 个 `userData.shared`）的 `THREE.Group`，并把共享与缓存材质挂到组内网格，调用后实例材质释放 7、共享与缓存释放 0、非共享几何释放 8、共享几何 0，组为空；第二次调用不抛错、不重复计数；`lastBuild` 含 `{ instanceMaterialCreated, instanceMaterialDisposed, geometryDisposed, textureDisposed, at }` 五个字段且创建/释放数相等，累计值从 `totals` 读取。

浏览器断言：一次轴距重建后 `assets.lastBuild.instanceMaterialCreated === 7`、`assets.lastBuild.instanceMaterialDisposed === 7`、`assets.lastBuild.geometryDisposed > 300`、`assets.totals.sharedMaterialDisposed === 0`、`assets.totals.cachedMaterialDisposed === 0`；连续 10 次重建后 `renderer.info.memory.geometries` 与 `textures` 相对基线漂移 ≤ 2 与 ≤ 1，`renderer.info.programs.length` 漂移 ≤ 2，`decalCache.size` 与 `Object.keys(MAT).length` 不变；调用 `FSApp.dispose()` 后 `lastTeardown.instanceMaterialsDisposed === assets.totals.instanceMaterialCreated`、`lastTeardown.sharedMaterialsDisposed > 0`、`renderer.info.memory.geometries === 0`、`textures === 0`、`instanceMaterials.size === 0`、MAT/TEX 为空，再次调用无副作用。另在 CDP 中包裹 `THREE.Material.prototype.dispose` 计数作为与 B 报告同口径的对照：修复前 0，修复后与 7 次实例释放一致。

**风险与回滚。** 最大风险是误释放仍被引用的共享材质，尤其是 `MAT.xray`、`MAT.carbonWing` 与贴花缓存；保留集合来自注册表并由 Node 单测覆盖。teardown 顺序错误可能让 Three 内部持有已释放对象；按“场景 → 注册表 → 渲染器”执行并在浏览器断言无页面错误。回滚：把 `disposeGroupChildren` 的 `materials` 默认值改回 `false`，保留计数；B3-4 单独提交，不影响 B3-1 至 B3-3。

## 5. 验收

```bash
npm test                                    # 既有 47 + 52 项保持全绿
node tools/test-runtime.mjs --group frame    # B3-1
node tools/test-runtime.mjs --group geometry # B3-2
node tools/test-runtime.mjs --group selftest # B3-3 纯函数部分
node tools/test-runtime.mjs --group assets   # B3-4
npm run build && git diff --exit-code index.html
# 浏览器用例由具备空闲调试端口的执行者运行，本册编写期间未执行：
node tools/test-dynamics-browser.mjs
```

`tools/test-runtime.mjs` 沿用 `tools/test-dynamics.mjs:13-20` 的 `new Function` 装载方式，加载 `00-core.js`、`03-suspension.js`、`05-body-dynamics.js`、`20-car.js`，并为 `20-car.js` 注入 `MAT`、`TEX`、`S` 桩对象。该文件加入 `package.json` 的 `test:runtime` 脚本并挂到 `npm test` 末尾；若 B0-3 尚未落地，先以独立命令执行，不改既有 `test` 脚本。

| 编号 | 验收点 | 判据 |
| --- | --- | --- |
| C1 | 10/12/30/60/5 Hz 实时 | 1 s 墙钟内 `abs(Δsim.time − 1) ≤ 3 ms`，`droppedTime = 0` |
| C2 | 4 Hz 边界 | 帧间隔 0.25 s 仍实时，`backlog ≤ 2.1 ms` |
| C3 | 2 Hz 慢动作 | `Δsim.time ≈ 0.512 s`、`timeScale ≈ 0.512`、`droppedTime ≈ 0.244 s`，每帧执行 128 步并保留约 0.244 s 积压 |
| C4 | 恢复帧与跨帧排空 | 2 s 停滞帧推进 0.256 s、丢 1.5 s，进入时积压 0.5 s、离开时 0.244 s；随后 3 帧 `timeScale` ≈ `[15.36, 1.20, 0.96]`，积压逐帧降到 0.0047/0.0013/0.0020 s |
| C5 | 状态一致性 | 同子步数下与 `simRunFor` 参考差 < 1e-12 |
| C6 | 常量匹配 | `SIM_MAX_SUBSTEPS · SIM_DT ≥ 0.25`（4 Hz）且 `SIM_MAX_BACKLOG ≥ SIM_MAX_FRAME_DT − SIM_MAX_SUBSTEPS · SIM_DT` |
| C7 | 尺寸强制重建 | `setState({wheelbase:3.9},{rebuild:false})` 返回 `policy='geometry-forced'`、`pending=true` |
| C8 | pending 冻结 | 等待窗口内每帧 `geometryMismatch=false`、`physicsRevision`（`SIM.reference.geometryRevision`）与 `sim.resetCount` 不变、`stretch.susp < 0.01` |
| C9 | 提交原子性 | 提交后 `sceneRevision === physicsRevision`，104.10 mm 偏差消失 |
| C10 | 快速连续改尺寸 | 仅最终尺寸落地，`commitCount` 增加 ≤ 2，`contactOk=true` |
| C11 | 自检缓存 | 周期路径静态自检 1 次；19 键逐一修改各加 1；steer/units/显示开关不加 |
| C12 | 检查项节点复用 | 3 s 内 `#checkList` 的 `childList` 变更 0 次 |
| C13 | 动态自检分片（10 项） | 首开长任务 ≤ `1.5·T_first`、完成时间 ≤ `1.5·T_total`（B2-1 合入后实测并写入 `SELFTEST_BUDGET`）；二次打开 < 30 ms |
| C14 | 资源计数平衡 | 每次重建 `lastBuild.instanceMaterialCreated = lastBuild.instanceMaterialDisposed = 7`，`lastBuild` 含五项；`totals` 中共享/缓存累计释放 0；teardown 后渲染器内存归零 |
| C15 | 长期稳定 | 10 次重建后渲染内存漂移 ≤ 2 几何 / ≤ 1 纹理；20 次重建 + 强制 GC 堆增长 < 4 MB |

长期堆与 GPU 测量建议：浏览器以 `--enable-precise-memory-info` 启动，重建前后各调用一次 CDP `HeapProfiler.collectGarbage`，比较 `performance.memory.usedJSHeapSize`；GPU 侧以 `renderer.info.memory` 与 `renderer.info.programs.length` 为代理指标，SwiftShader 的绝对值不代表真实驱动，季度性人工复核时用 DevTools Memory 时间线记录 100 次重建曲线。该测量作为周任务，不阻塞单次提交。

文档一致性检查：

```bash
grep -n "单帧最多 40 个子步" README.md DESIGN.md          # 应无输出
grep -n "droppedTime\|SIM_MAX_FRAME_DT\|0.5 s" README.md DESIGN.md
grep -n "geometryRevision" DESIGN.md README.md
grep -n "24 项\|14 + 10\|14+10" README.md DESIGN.md
grep -n "22 项\|8 项动力学" README.md DESIGN.md      # 应无输出
grep -n "20.10 资源所有权" DESIGN.md
```

## 6. 风险与回滚

| 风险 | 触发条件 | 影响 | 应对与回滚 |
| --- | --- | --- | --- |
| 低帧率策略被误读为卡顿 | B3-1 合入 | 用户看到 0.5× 时钟 | 遥测同时显示 `timeScale`、`backlog`、`droppedTime`；README 明确“4 Hz 以下慢动作” |
| 提高子步上限放大重建帧耗时 | B3-1 合入 | 重建瞬间一次长帧 | 重建已触发丢时记账；必要时把上限降到 0.2 s、子步 100 |
| pending 窗口内参数延迟 | B3-2 合入 | 数值晚 85 ms 生效 | 窗口内冻结显示，提交时统一应用；失败重试 3 次后报错 |
| 双缓冲缺失导致闪烁 | B3-2 合入 | 提交瞬间视觉跳变 | 提交在单个 rAF 任务内完成，浏览器不绘制中间态；若评审要求严格双缓冲，另拆 `buildCar(target)` 暂存组，追加 0.5 人日 |
| 自检缓存键遗漏参数 | B3-3 合入 | 自检结果陈旧 | 19 键穷举测试；新增物理参数必须同步 `PHYSICS_KEYS` |
| 分片总时长超过 `1.5·T_total` | B3-3 合入 | 模态框结果晚到 | 回退为“打开时同步运行一次”，保留缓存与节点复用 |
| 误释放共享材质 | B3-4 合入 | 画面材质丢失或报错 | 注册表保留集合、Node 单测与 teardown 顺序；回滚 `materials:false` |
| 浏览器测试被多个分册同时修改 | B3-2、B3-4、B4-6 | 合并冲突 | 只追加独立检查段，不改 `try/finally` 与启动流程 |

回滚边界：四个工作项各自独立提交（`fix(runtime): ...`），B3-1 至 B3-4 之间只有 `40-app.js` 的调用顺序依赖，回退任一提交后其余功能仍可用；若整体回退 `geometryRevision`，B3-3 的缓存键仍可由 `geometrySignature + physicsSignature` 独立工作。任何回退后必须重跑 `npm test` 与 C1、C5、C9 三组断言。

## 7. 对阶段三的扩展约束

1. **帧时间语义进入接口冻结。** `simAdvance` 的“接受上限、积压、丢弃、时间缩放”语义不得退回静默清零；轮胎纵滑、驱动扭矩和空气动力会抬高单子步成本，届时必须用实测耗时重新标定 `SIM_MAX_FRAME_DT` 与 `SIM_MAX_SUBSTEPS`，并把最坏帧耗时写入性能预算。
2. **物理与渲染单向。** `sceneRevision` 与 `physicsRevision` 必须同代；渲染层不得写物理角点、求解种子或几何引用（与分册 01 的 B1-4 一致）。阶段三的轮胎力、驱动扭矩和空气动力只能经物理层接口施加，渲染层只消费 `simBuildModel` 快照。
3. **几何版本覆盖新增可调几何。** 翼片角度、悬架硬点、轮胎尺寸等新参数必须加入 `geometrySignature` 并触发同一条重建路径；遥测快照、导出配置与审计日志把 `geometryRevision` 作为必填字段。
4. **自检调度不得进入渲染路径。** 新增的轮胎滑移、驱动和空气动力检查必须是可按 `setupRevision` 缓存的纯函数；长测试分片或移到 Worker，单次主线程阻塞目标 < 100 ms。任何“每帧运行自检”的实现都视为回归。
5. **资源所有权注册表化。** 新增材质、纹理和几何必须登记到 `MAT`、`TEX`、`CAR.shared` 或实例工厂；`FSApp.dispose()` 的 teardown 计数契约纳入准入检查，单文件离线与零运行时依赖不变。
6. **遥测字段稳定。** `sim.backlog/droppedTime/timeScale/maxFrameDt/maxSubsteps`、`geometry.{sceneRevision,physicsRevision,pending,policy,mismatch,commitCount}`（其中 `sceneRevision = CAR.geometryRevision`、`physicsRevision = SIM.reference.geometryRevision`）、`assets.totals.{instanceMaterialCreated,instanceMaterialDisposed,geometryDisposed,textureDisposed,sharedMaterialDisposed,cachedMaterialDisposed}`、`assets.lastBuild.{instanceMaterialCreated,instanceMaterialDisposed,geometryDisposed,textureDisposed,at}` 与 `assets.lastTeardown` 作为稳定字段，只增不改；UI 与测试不得依赖未列出的内部字段。
7. **文档断言绑定测试。** README:164、DESIGN:578、DESIGN:640、DESIGN:648 中关于帧率、几何版本、自检缓存与资源释放的每条断言，在分册 05 的回归矩阵中登记对应测试编号；B5-1 汇总时以本册第 5 节的 C1–C15 为准。
