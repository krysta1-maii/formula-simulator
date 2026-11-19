# FS-01 0.3.0 物理内核对抗审阅（01-physics）

> **历史评审｜基线：0.3.0 / `45983ca`。** 本文保留原始发现与结论，不代表当前状态。请先查阅 [总报告](00-summary.md) 和 [0.4.x 状态映射](status-mapping.md)；0.4.0 已关闭项只在映射中登记，其他发现以 0.4.1 最终验收为准。当前状态以根 README/DESIGN 及最新验收为准。

| 项目 | 内容 |
| --- | --- |
| 审阅者 | physics-reviewer（共享任务 task-1） |
| 审阅对象 | `formula-simulator` 0.3.0，HEAD `45983ca`，工作区干净 |
| 审阅范围 | [00-core.js](../../../src/js/00-core.js)、[03-suspension.js](../../../src/js/03-suspension.js)、[05-body-dynamics.js](../../../src/js/05-body-dynamics.js)；[test-core.mjs](../../../tools/test-core.mjs)、[test-dynamics.mjs](../../../tools/test-dynamics.mjs)、[test-physics-invariants.mjs](../../../tools/test-physics-invariants.mjs)；`tools/audit/` 的物理/接触脚本 |
| 环境 | Node v24.22.1，linux/x64；没有使用 Chrome；没有运行 `npm run build` |
| 写入范围 | 本报告与 [.tmp-review/physics/](../../../.tmp-review/physics/)；没有修改任何被跟踪文件 |
| 结论 | 未发现 P0；确认 1 项 P1、2 项 P2 物理/状态问题，以及若干 P3 数值/文档/测试缺口。B4.1、B4.2、B4.4、B4.5 的主体修复和 `simBuildModel` 优化确定性成立；B4.3 的复合坡面重新驻车仍不完整 |

## 1. 审阅范围与方法

### 1.1 先读已知结论，再用独立实验复核

先读了 [README.md](../../../README.md)、[DESIGN.md](../../../DESIGN.md)（尤其第 20 节）、[docs/code-review.md](../../../docs/code-review.md)、[docs/code-review-k3.1-pro.md](../../../docs/code-review-k3.1-pro.md)、[docs/plan/acceptance.md](../../../docs/plan/acceptance.md)、[docs/plan/notes/b6-final-review.md](../../../docs/plan/notes/b6-final-review.md) 和 [docs/plan/contracts.v1.md](../../../docs/plan/contracts.v1.md)。已知的 B4.1（摇臂/运动比）、B4.2（质心参考点）、B4.3（低速摩擦）、B4.4（脉冲坐标系）、B4.5（两套接地点）修复不作为“新发现”重复，只检查其完整性、回归和过度声明。

### 1.2 数值实验方式

物理三件套通过 `new Function` + 内嵌 Three.js 在 Node 中只读加载，和 [test-dynamics.mjs](../../../tools/test-dynamics.mjs#L8-L21) 的 UMD/VM 方式一致；实验脚本、旧版本源码、变异体全部放在 [.tmp-review/physics/](../../../.tmp-review/physics/)，不进入仓库跟踪范围。复现命令汇总在 [.tmp-review/physics/README.md](../../../.tmp-review/physics/README.md)。

| 实验 | 目的 | 脚本 |
| --- | --- | --- |
| E1 | 自由刚体：线动量、绕质心角动量、能量、四元数范数；长时/高角速度/非主轴 | [exp1-freebody.mjs](../../../.tmp-review/physics/exp1-freebody.mjs) |
| E2 | 姿态/转向/行程网格：轮架闭合、摇臂可达、运动比、状态标记 | [exp2-suspension.mjs](../../../.tmp-review/physics/exp2-suspension.mjs) |
| E2b | UI 可达的极端参数 + 多脉冲 6.5 s：力峰值、退化、非法状态 | [exp2b-dynamic-envelope.mjs](../../../.tmp-review/physics/exp2b-dynamic-envelope.mjs) |
| E3 | 纯横摆、静摩擦分配、边界、复合坡面初探 | [exp3-contact.mjs](../../../.tmp-review/physics/exp3-contact.mjs) |
| E4 | `simBuildModel` 优化前（2999731）与当前输出逐字节对照 | [exp4-simbuildmodel.mjs](../../../.tmp-review/physics/exp4-simbuildmodel.mjs) |
| E5/E5b | 4.1/软悬架下的求解状态与不可达摇臂力 | [exp5-rocker-status.mjs](../../../.tmp-review/physics/exp5-rocker-status.mjs)、[exp5b-unreachable-force.mjs](../../../.tmp-review/physics/exp5b-unreachable-force.mjs) |
| E6/E7/E7b/E8 | 容量边界、复合坡面重新驻车、低附着滑移后提高 μ | [exp6-hold-deadband.mjs](../../../.tmp-review/physics/exp6-hold-deadband.mjs)、[exp7-tilt-repark.mjs](../../../.tmp-review/physics/exp7-tilt-repark.mjs)、[exp7b-repark-scan.mjs](../../../.tmp-review/physics/exp7b-repark-scan.mjs)、[exp8-retarget-tilt.mjs](../../../.tmp-review/physics/exp8-retarget-tilt.mjs) |
| E9/E9b | 完整状态重复运行、帧率/抖动喂入 | [exp9-determinism.mjs](../../../.tmp-review/physics/exp9-determinism.mjs)、[exp9b-jitter.mjs](../../../.tmp-review/physics/exp9b-jitter.mjs) |
| E10 | 现有 120 组随机包线的求解退化统计 | [exp10-random-envelope.mjs](../../../.tmp-review/physics/exp10-random-envelope.mjs) |
| 变异体 | 证明测试盲区：陀螺项反号、平面位移不积分 | [mutant/](../../../.tmp-review/physics/mutant/)、[mutant2/](../../../.tmp-review/physics/mutant2/) |

### 1.3 基线复跑

| 命令 | 结果 |
| --- | --- |
| `npm test` | `PASS 50/50` + `PASS 80/80` |
| `node tools/test-physics-invariants.mjs` | `PASS 27/27` |
| `node tools/audit/run-all.mjs --group physics` | 23 checks，0 failed |
| `node tools/audit/run-all.mjs --group contact` | 12 checks，0 failed |

所有脚本只读；没有运行构建，没有写 `index.html`。本轮没有浏览器实验，物理核心是 DOM-free 的，Node 加载足以覆盖本轮问题；UI 影响部分用 [30-ui.js](../../../src/js/30-ui.js) 的源码路径核对，未做浏览器复现。

## 2. 已核实无问题或修复有效的方面

### 2.1 质心积分、参考点、线动量和四元数

E1 在零外力、零重力、无悬架的自由刚体上复核：

- 三个主轴的 1 rad/s 工况：质心位移 0，线动量变化 0；参考点位移与 `2·perp·sin(0.5)` 的解析值一致（如 x 轴 287.655 mm 对 287.655 mm）。
- 四元数每步归一化后范数误差 ≤ 2.22e-16（10 s、5000 步；39 rad/s 的 500 步同样为 0）；没有发现“每步归一化失效”。
- [simBuildModel](../../../src/js/05-body-dynamics.js#L892) 的旧/新输出对照：从 `git archive 2999731` 导出旧版 05，和当前 00/03 组合加载；7 组工况（默认、8°/7°、μ0.35+转向、750 kg、软悬架、极端尺寸、低附着）× 4 个状态（0、60 步 pitch、250 步 roll、100 步）× 3 次重复，共 84 组 `JSON.stringify` 全部逐字节相同。B6 的优化确定性声明在本实验范围内成立；但仓库内没有这条 A/B 自动测试，只有 bench 和文档声明（见 §4.2）。

结论：B4.2 的质心积分和参考点派生“主路径”修复有效；“质心参考点漂移”不是当前问题。脉冲力臂属于 B4.4，见 §2.3。

### 2.2 B4.1 的阻尼尖峰修复有效

4.1 工况（600 kg、前后 50 N/mm、ζ=0.05、ARB=0、pitch 脉冲）在 1000 步内：

- 既有 [audit-rocker-reach.mjs](../../../tools/audit/audit-rocker-reach.mjs) 实测峰值阻尼 **1.7336 kN**（旧报告为 41.94 kN），低于 15 kN 阈值；
- 我们的 E5 独立复跑同样为 1.7336 kN；默认工况峰值阻尼约 1.38 kN；未发现新的 10 kN 级阻尼尖峰。
- [simRatioState](../../../src/js/05-body-dynamics.js#L150-L164) 的 0.05–2.0 / 设计值 0.3–3× 守卫确实阻止了 -7.58 那类运动比直接进入阻尼力。

结论：B4.1 的“异常运动比进入阻尼力”主缺陷已修复；但摇臂不可达时的弹簧力路径仍有残留（§3.2）。

### 2.3 B4.4 脉冲坐标系与 B4.5 接地点

- [test-dynamics.mjs](../../../tools/test-dynamics.mjs#L455-L547) 的 [11] 脉冲测试、[audit-impulse-frame.mjs](../../../tools/audit/audit-impulse-frame.mjs) 的 24 个 yaw 姿态和复合姿态测试均通过；脉冲力臂按 `R(q)·(offset−cgBody)` 计算，未再出现旧报告的 yaw 90° 时“俯仰脉冲变侧倾”。
- [test-dynamics.mjs](../../../tools/test-dynamics.mjs#L549-L729) 的 [12] 和 [audit-contact-gap.mjs](../../../tools/audit/audit-contact-gap.mjs) 通过；我们扫描 pitch/roll/复合坡面时，`contactRoad.y` 约 1e-12，`contactPoints` 与 `solved.contact` 一致，未发现第二套接地点。
- `momentParts.normal+friction+impulse` 与总力矩的逐分量差 ≤1e-9（既有测试和 [audit-contact-gap.mjs](../../../tools/audit/audit-contact-gap.mjs) 覆盖）。

### 2.4 确定性与帧率

- E9：同一输入两次 1000 步的 13 个状态分量完整比较，最大差 **0**；`contact` JSON 完全相同。现有 [test-dynamics.mjs](../../../tools/test-dynamics.mjs#L232) 的“bit-identical”断言只比较 `referencePoint.y`、`qx`、`wz` 三个标量，但独立完整状态实验通过，说明当前实现确实确定；问题在断言强度，不在当前结果。
- 既有 10/12/30/60/144 Hz 测试通过；60/144 Hz 的 2.4 s 对照状态差 <1e-9。E9b 用 1000 个抖动帧合成 2.0 s，会因浮点累加少一个 2 ms 子步（1199 对 1200），状态差约 8.15e-10；59.94 Hz 的 144 帧比 60 Hz 多一个子步，状态差约 2.5e-10。这个量级符合 acceptance 的“时间差 ≤ 一个固定子步”的容差，但强于 README “帧率不改变物理状态”的一般表述（§4.2）。
- E2b 的 8 组 UI 可达极端参数 + 多脉冲 6.5 s 均有限、无 NaN、无非负法向载荷；但其中 6 组出现摇臂不可达/运动比不可用（§3.2、§3.3），说明“有限”不等于“求解健康”。

## 3. 发现（按严重度）

### P1-1 复合坡面（slope+bank）下低速摩擦无法重新驻车，形成 SLIP 极限环

**位置**：[05-body-dynamics.js:507-530](../../../src/js/05-body-dynamics.js#L507-L530)（HOLD/SLIP 判定）、[05-body-dynamics.js:544-631](../../../src/js/05-body-dynamics.js#L544-L631)（逐角摩擦/停止预算）、[05-body-dynamics.js:814-845](../../../src/js/05-body-dynamics.js#L814-L845)（dwell 与 SLIP→HOLD）。

**最小复现**：

```bash
node .tmp-review/physics/exp7-tilt-repark.mjs
node .tmp-review/physics/exp8-retarget-tilt.mjs
```

参数：`slope=10°, bank=10°, friction=0.3`（均在 [NUM_LIMITS](../../../src/js/00-core.js#L20-L22) 的 ±10°、0.2–1.8 内），`settle=0.5 s`；沿路面重力切向注入 0.3 m/s。运行 20 s 后：

| 观测量 | 期望 | 实际 |
| --- | --- | --- |
| 模式 | HOLD（需求 0.838×容量 <1） | **SLIP**，从未 HOLD |
| 平面速度 | <2e-3 m/s 并归零 | 4.41e-3 m/s（vx=-2.93e-3，vz=3.30e-3） |
| 横摆角速度 | 归零 | 1.37e-3 rad/s（峰值 1.72e-3） |
| `contact.dwell` | 达到 3 后转 HOLD | 0 |
| 需求/容量 | 0.838 | 0.838（`canPark` 的 98% 门限满足） |

对照：同一几何 `μ=0.5`（需求/容量 0.503）在 0.662 s 进入 HOLD；`8°/7°` 的 `μ=0.20`（0.937）和 `μ=0.22`（0.852）在 10 s 仍不 HOLD，而 `μ=0.24`（0.781）在 1.094 s 进入 HOLD。可见失败带不是单纯“接近 1.0 容量”，约在 0.56–0.94 容量之间也会出现。

更贴近 UI 的复现（[exp8](../../../.tmp-review/physics/exp8-retarget-tilt.mjs)）：默认低附着预设 `10°/10°, μ=0.2`，`settle=1.5`，`vx=0.4`，运行 1 s 后 `simRetargetReference` 到 `10°/10°, μ=0.3`（几何不变，只改 μ），再运行 15 s：模式仍为 **SLIP**，末速 3.60e-3 m/s，`holdAt=null`；改为 μ=0.5 时 0.402 s 进入 HOLD。应用层确实走这条路径：`friction` 在 [40-app.js](../../../src/js/40-app.js#L6) 的 `PHYSICS_KEYS` 中，[refreshAll](../../../src/js/40-app.js#L115-L119) 对它调用 `simRetargetReference`，而 [simRetargetReference](../../../src/js/05-body-dynamics.js#L263-L277) 明确保留车身状态和 `sim.contact`。因此“低附着滑移后把 μ 调高”是用户可达的操作，不是纯 API 实验。

**影响**：在坡面+横坡组合下，车辆即使有足够附着也无法重新驻车，会持续以数 mm/s 蠕动/轻微横摆；页面模式显示“滑移”，与 [README.md](../../../README.md#L162-L174) 的“静摩擦按法向载荷比例分配，维持坡面驻车”不符。低速自检 [低附着六自由度滑移](../../../src/js/05-body-dynamics.js#L1257-L1263) 和 [test-dynamics [7]](../../../tools/test-dynamics.mjs#L247-L250) 都只测绝对位移，不能发现此问题（见 §4.1）。

**可能机制（待验证假设）**：低速时逐接地点滑移方向与横摆耦合，摩擦合力的方向并不正好与车身平动动量相反，形成速度约 2–4 mm/s 的极限环；不是简单的 `SIM_ARREST_SPEED=2e-3` 阈值问题（μ=0.5 同样阈值可以驻车）。需要把“逐角方向 + kYaw/kPlanar 缩放”和“车身级静摩擦冲量”拆开做下一步实验才能定主因。

**修复方向**：在低速段用车身级（或 3 自由度 QP）静摩擦分配替代逐角方向启发式；对平面速度和横摆同时做停止冲量预算；在 `dwell` 判定前增加低速阻尼/正则化；把 `canPark` 的判定从“2e-3 速度”改为“停止冲量可在一个子步内消除平面动量”。回归测试应覆盖 slope+bank 组合、0.3 m/s 扰动、低附着滑移后提高 μ 的 retarget，而不是只测 slope-only 8°/μ=1.4。

**置信度**：高（可重复；控制组 μ=0.5 正常）。

### P2-1 摇臂不可达时，未闭合的 `coilLength` 仍进入弹簧力，只有运动比被拦截

**位置**：[03-suspension.js:382-404](../../../src/js/03-suspension.js#L382-L404)（不可达时保留种子角）、[03-suspension.js:491-511](../../../src/js/03-suspension.js#L491-L511)（`ok` 与 `rocker.feasible` 分层）、[05-body-dynamics.js:397-411](../../../src/js/05-body-dynamics.js#L397-L411)（力链路只检查 `frame.converged`）。

**复现**：

```bash
node .tmp-review/physics/exp5b-unreachable-force.mjs
node .tmp-review/physics/exp5-rocker-status.mjs
```

4.1 工况 1000 步：

- 376 个角点样本 `frame.converged=true` 但 `rocker.feasible=false`；
- 独立审计 [audit-rocker-reach.mjs](../../../tools/audit/audit-rocker-reach.mjs) 的最大残差 **38.249 mm**（1.834 s，`ok=false`）；力链路内部种子角的最大残差 18.264 mm；
- 残差最大处弹簧力约 **-1509 N**；不可达状态下弹簧绝对峰值 **2257 N**；软悬架 heave 脉冲为 **2468 N**；极端尺寸组合为 **2671 N**；未出现 >15 kN 的阻尼尖峰。补充统计（[exp5c](../../../.tmp-review/physics/exp5c-positive-unreachable.mjs)）：4.1/软悬架中这些不可达样本的 `rawForce` 全部 ≤0，法向力被 `max(0,·)` 截断，因此**车体没有从这些角获得额外正法向力**；极端尺寸样本存在 `rawForce=2672 N` 的不可达样本，但其闭合残差仅 0.2 mm。问题集中在“非法几何仍生成弹簧/阻尼中间量和遥测”，不在已测样本的车体正法向力。
- 4.1 的整体弹簧峰值 5351.8 N（发生在 `rocker.feasible=true` 的可行态），阻尼峰值 1.7336 kN。

**期望 vs 实际**：当 `rocker.feasible=false` 时，`ok=false`，且 [suspRockerAngle](../../../src/js/03-suspension.js#L354-L406) 已明确“hold seed angle”；此时 `coilLength` 来自未闭合的杆系，不应继续作为真实弹簧长度进入力链路，或至少应进入与轮架不收敛相同的设计斜率回退。实际 [simEvaluate](../../../src/js/05-body-dynamics.js#L397-L402) 只用 `solved.frame.converged` 分支，`solved.rocker.feasible`/`solved.ok` 被忽略；[05-body-dynamics.js:403-411](../../../src/js/05-body-dynamics.js#L403-L411) 的回退只在 `frame.converged=false` 时触发。`simRatioState` 只守住了运动比，没有守住弹簧长度。

**影响**：在合法软悬架/大行程工况下，弹簧/阻尼中间量可基于闭合误差 18–38 mm 的杆系计算，量级可达 1.5–2.5 kN；4.1/软悬架样本中 `rawForce` 为负，被法向力截断，当前车体受力未出现异常（极端样本有 2.67 kN/0.2 mm 的正向样本）。但“异常值不进入力链路”的修复并不完整：非法几何仍生成 `springForce`/`dampingForce`/`springCompressionMm`，阶段三接入轮胎力、或参数组合改变时可能放大；现有审计只检查“ok 时残差”和“阻尼峰值”，不检查不可达时的弹簧/阻尼项（§4.2）。

**修复方向**：把力链路门槛从 `frame.converged` 改为 `solved.ok`（或至少 `frame.converged && rocker.feasible`）；不可达时使用明确的回退（设计斜率/上一有效长度/零力并标记），并增加“不可达样本上的弹簧力上限”断言。

**置信度**：高（代码路径直接可见；4.1/软悬架/极端组合均可复现）。

### P2-2 `motionRatioState` 与 `simRatioState` 双阈值不一致，形成 `solverOk=false` 且 `degraded=false` 的非法状态和 UI 误报

**位置**：[03-suspension.js:503-511](../../../src/js/03-suspension.js#L503-L511)（`0.2 < ratio < 0.8` 才 `ok`）、[05-body-dynamics.js:150-164](../../../src/js/05-body-dynamics.js#L150-L164)（力守卫接受 0.05–2.0、设计值 0.3–3×）、[05-body-dynamics.js:805-812](../../../src/js/05-body-dynamics.js#L805-L812)（只有 `evaluation.degraded` 才置 `solverDegraded`）、[05-body-dynamics.js:682](../../../src/js/05-body-dynamics.js#L682)（`solverOk` 取 `solved.ok`）。

**复现**：

```bash
node .tmp-review/physics/exp5-rocker-status.mjs
```

4.1 工况 step 118（t=1.738 s）左前/右前：

```text
frameConverged=true, rockerFeasible=true, rockerResidual=0,
ratio=0.845683, motionRatioState='unavailable', ok=false
ev.solverOk=false, ev.degraded=false, sim.solverDegraded=false
spring=-765.17 N, damping=-768.24 N
```

软悬架 heave 脉冲 step 125（t=1.752 s）同样出现 ratio=0.831935、`motionRatioState='unavailable'`、`solverOk=false`、`degraded=false`。原因很直接：0.845 刚超过 [03-suspension.js:507](../../../src/js/03-suspension.js#L507) 的 0.8 上限，但仍在 [simRatioState](../../../src/js/05-body-dynamics.js#L154-L158) 的 0.05–2.0、0.3–3× 设计值范围内，于是力链路接受该比值并更新 `sim.cornerRatio`，而 `suspSolveCorner.ok` 返回 false。

**影响**：这不是力误差，但违反 [contracts.v1.md](../../../docs/plan/contracts.v1.md#L161-L167) 的 `solverState` 语义：`solverOk === false` 而 `solverDegraded/solverFailed` 都为 false 属于非法状态。[solverStateOf](../../../src/js/30-ui.js#L733-L739) 会把它映射成 `'failed'`，页面徽标显示“求解失败”；[warning 文案](../../../src/js/30-ui.js#L1022-L1032) 统计的 `failedCorners` 只数 `rockerFeasible=false`，于是会出现“求解失败：0 个角点不可达”的自相矛盾提示。合法的软悬架脉冲会误报失败。

**修复方向**：统一两套阈值（`suspSolveCorner.ok` 与 `simRatioState` 用同一判据，或让 `simRatioState` 也返回 `ok` 并驱动 `solverDegraded`）；只要任一 `solved.ok=false` 就置 `degraded`；UI 的 `failedCorners` 同时统计 `motionRatioState!=='ok'`，徽标与检查行使用同一状态源。

**置信度**：高（确定性复现；合同条文明确）。

### P3-1 非主轴自由刚体的能量/角动量漂移随时间与角速度增长，1 s 的 1.88e-3 不能当全局界

**位置**：[05-body-dynamics.js:688-770](../../../src/js/05-body-dynamics.js#L688-L770)（半隐式欧拉、2 ms 固定步长）、[05-body-dynamics.js:28](../../../src/js/05-body-dynamics.js#L28)（`SIM_ANGULAR_LIMIT=40`）。

**复现**：`node .tmp-review/physics/exp1-freebody.mjs`；零外力/零重力，初始非主轴 `ω`，记录相对能量 `|ΔE|/E0` 与 `|Δ|L||/|L0|`：

| 初始 ω (rad/s) | 1 s | 10 s | 60 s |
| --- | ---: | ---: | ---: |
| (1, 0, 0) 主轴 | 0 | 0 | — |
| (1, 1, 1) | 1.878e-3 | 8.067e-3 | **4.904e-2** |
| (3, -2, 5) | 1.690e-2 | 1.811e-1 | **2.204（220%）** |
| (20, 15, 10) | 4.610e-1 | **1.645（164.5%）** | — |
| (39, 39, 39) | 6.762e-1（1 s） | — | —（0.1 s 已 68.1%） |

角动量幅值漂移同量级（(3,-2,5) 60 s 为 0.815）；纯主轴 39 rad/s 的漂移为 0；线动量/CG 位移仍为 0；四元数范数误差 ≤2.2e-16。也就是说，问题不是“质心或归一化坏了”，而是“非主轴欧拉方程 + 显式 2 ms 积分”的长期能量误差。

**判断**：B6 的 A1 已披露“1 s 非主轴 1.88e-3、未自动断言”；本实验补充的是**漂移不封顶**：60 s 到 4.9%（1,1,1）和 220%（3,-2,5），高角速度 0.1 s 到 68%。如果阶段三在更高转速/更长时间下复用这套积分器，1 s 的 2e-3 不能作为“稳定性”界，只能算单点监控。当前 UI 默认脉冲不会触及 20–39 rad/s，普通低附着横摆也远低于此，因此本轮定为 P3 数值/文档风险，而不是当前功能阻断。

**修复方向**：对自由刚体转动采用子步/RK4 或能量-角动量投影；或在阶段三明确限制“本积分器只适用于小角速度/短时”；补 non-principal 能量/角动量断言（同时能抓住 §4.1 的陀螺项反号变异体）。

**置信度**：高（数值可复现；公式本身正确，属于积分误差）。

### P3-2 升沉脉冲的文档位置与实现/测试矛盾

**位置**：[README.md:95](../../../README.md#L95) 写“在质心处施加向下 6800 N”；实现 [05-body-dynamics.js:287](../../../src/js/05-body-dynamics.js#L287) 的 heave `offset=[0,0,0]` 是相对**车身参考点**，不是质心；[test-dynamics.mjs:527-535](../../../tools/test-dynamics.mjs#L527-L535) 也明确期望 heave 脉冲产生 `M_z=-1086.30 N·m` 的俯仰力矩。DESIGN 20.6 的“offset 相对车身参考点、绕质心力臂 offset−cgBody”与实现一致，README 的“在质心处”是错的。

**影响**：文档读者会以为 heave 脉冲是纯升沉；实际该脉冲在默认参数下附带 -1086.3 N·m 的俯仰力矩（约为 pitch 脉冲 -6880.45 的 16%），[低附着/垂向自检](../../../src/js/05-body-dynamics.js#L1191-L1204) 和 [阻尼测试](../../../tools/test-dynamics.mjs#L204-L223) 都同时激励俯仰。不是数值错误，是输入语义/文档不一致。

**修复方向**：二选一——把 README 改成“在车身参考点处，激励升沉+俯仰”；或把 heave 的 offset 改为 `−cgBody` 使作用点真正在质心，并同步修改测试/验收的 -1086.3 基线。建议保留现有测试基线，修正文档，避免阶段三误用。

**置信度**：高。

## 4. 测试与文档缺口

### 4.1 P2 测试假绿：冻结平面位移与陀螺项反号的变异体都能全绿

这不是“当前实现已经错了”，而是“现有 157 项 Node 检查不足以证明这些物理维度”。我在 [.tmp-review/physics/mutant/](../../../.tmp-review/physics/mutant/) 和 [mutant2/](../../../.tmp-review/physics/mutant2/) 做了两个临时变异体，只改副本，不改仓库：

| 变异 | 物理含义 | 结果 |
| --- | --- | --- |
| `gyroscopic = −simCross(ω, Iω)` | 陀螺力矩反号；非主轴转动会明显错误 | `test-core 50/50`、`test-dynamics 80/80`、`test-invariants 27/27` 全绿 |
| 删除 `bodyState.x += vx·dt` 与 `z += vz·dt` | 平面位移完全不积分；车不会滑移 | 同样 50/50、80/80、27/27 全绿；低附着工况仍被判“滑移” |

第二个变异体暴露了具体断言问题：

- [test-dynamics.mjs:247-250](../../../tools/test-dynamics.mjs#L247-L250) 用 `Math.hypot(slide.state.x, slide.state.z) > 0.1` 判断“低附着释放平面自由度”，但 B1-1 之后 `state.x` 是质心，默认 `xCG=(45.5%−50%)·3.55=-0.15975 m`（[00-core.js:181-182](../../../src/js/00-core.js#L181-L182)），初始绝对位置就有 0.1598 m，因此**无论是否滑移都会 >0.1**；正确的量是从 `x0/z0` 起的位移。
- 页面自检 [05-body-dynamics.js:1257-1263](../../../src/js/05-body-dynamics.js#L1257-L1263) 更弱：`slideDistance > 0.05` 且没有 `sliding` 标志；初始 0.1598 m 已经恒真。变异体实测 `slideDistance=0.1598`、`mode=SLIP`，自检会通过。
- 陀螺项反号全绿的原因是自由刚体不变量只测了主轴 `wx/wy/wz=1`，而非主轴 `ω=(1,1,1)` 才会让 `ω×Iω` 非零；[test-physics-invariants.mjs:79](../../../tools/test-physics-invariants.mjs#L79) 和 [audit-free-body.mjs:61](../../../tools/audit/audit-free-body.mjs#L61) 都只跑 500 步单轴。

**修复方向**：滑移断言改为初始位置差；增加非主轴自由刚体的能量/角动量；对力链路加 force/status 上限；把“bit-identical”从三个标量扩到全状态。

### 4.2 P3 断言过弱、共享公式或覆盖缺口

| # | 位置 | 问题 | 建议 |
| ---: | --- | --- | --- |
| 1 | [test-core.mjs:97](../../../tools/test-core.mjs#L97) | ARB `arbRate·t²` 公式复算与实现同一表达式，属恒真校验 | 独立有限元/解析梁或至少独立数值推导 |
| 2 | [test-dynamics.mjs:91](../../../tools/test-dynamics.mjs#L91) | `springRateCoil = springRates / motionRatio²` 是实现的同一公式 | 用外部标定值或直接测力-位移 |
| 3 | [test-dynamics.mjs:154-159](../../../tools/test-dynamics.mjs#L154-L159) | 水平动态载荷与同一 `computeStatic` 参考比较，静态/动态共享静态解 | 从非平衡初始姿态收敛，或独立手算四角载荷 |
| 4 | [test-dynamics.mjs:168](../../../tools/test-dynamics.mjs#L168) | 倾斜“动态收敛”从静态平衡启动，只验证不自行偏离 | 加 5–10 mm/0.5° 初始扰动并要求收敛 |
| 5 | [test-dynamics.mjs:232](../../../tools/test-dynamics.mjs#L232) | bit-identical 只比较 3 个标量；我们完整状态实验通过但断言不覆盖 | 比较全部 13 个状态 + contact |
| 6 | [test-dynamics.mjs:237-241](../../../tools/test-dynamics.mjs#L237-L241) | 60/144 Hz 都是 2 ms 的整数倍；抖动/59.94 Hz 会差一个子步（E9b） | 增加非整除帧、抖动帧，并明确“允许一个子步” |
| 7 | [test-dynamics.mjs:255-291](../../../tools/test-dynamics.mjs#L255-L291) | 120 组随机只跑 0.6 s 且只查 finite/非负载荷；同 seed 复跑 0 退化，但 6.5 s 可达工况出现 318 个不可达角点样本、391 个 notOk 角点样本（E2b） | 延长到 5 s、加入 solverOk/残差/力上限 |
| 8 | [test-dynamics.mjs:377-391](../../../tools/test-dynamics.mjs#L377-L391) | 容量边界用 slope 16.55°/16.70°，超出 `NUM_LIMITS.slope` ±10°；从 HOLD 启动、不扰动，1.01 即使从未滑移也能过 | 用 slope+bank 内组合、先给 0.3 m/s 扰动、断言模式/位移 |
| 9 | [test-physics-invariants.mjs:79](../../../tools/test-physics-invariants.mjs#L79)、[audit-free-body.mjs:61](../../../tools/audit/audit-free-body.mjs#L61) | 只测单轴 1 rad/s、500 步；无 `ω=(1,1,1)`、无能量/角动量 | 见 §4.1 |
| 10 | [audit-rocker-reach.mjs:168-211](../../../tools/audit/audit-rocker-reach.mjs#L168-L211) | `ok-residual` 只查 `ok` 时残差；本次 `maxResidualMm=38.249`（ok=false）未被阈值化；不查不可达时的弹簧力 | 增加不可达残差上限和 force 上限 |
| 11 | [audit-friction-low-speed.mjs:65-76](../../../tools/audit/audit-friction-low-speed.mjs#L65-L76)、[:118-166](../../../tools/audit/audit-friction-low-speed.mjs#L118-L166) | 坡面扰动只用 slope-only 8°/μ1.4；重新驻车只测 level | 增加组合坡面/低附着后提高 μ 用例 |
| 12 | [test-dynamics.mjs:295](../../../tools/test-dynamics.mjs#L295) + [05-body-dynamics.js:1259](../../../src/js/05-body-dynamics.js#L1259) | 动态自检只数“至少 10 项”；其中“低附着滑移”用绝对 CG 位置，恒真 | 改位移差；断言模式/位移/速度 |
| 13 | [README.md:232](../../../README.md#L232) | “相同输入 bit-identical”“120 组随机无 NaN/负法向载荷”被写成实现质量结论；实际断言范围更窄 | 把文档改为“测试覆盖范围”，或补强断言 |
| 14 | [docs/plan/acceptance.md:87](../../../docs/plan/acceptance.md#L87) | 文档声称 `simBuildModel` 四组模型 JSON 与优化前逐字节相同；仓库没有 A/B 自动测试，只有 bench 和文档。E4 的 84/84 对照通过 | 把旧版导出/JSON 哈希对照纳入回归，或把 84 组结果固化为 fixture |

另外，[docs/plan/acceptance.md:46](../../../docs/plan/acceptance.md#L46) 与 [:155](../../../docs/plan/acceptance.md#L155) 已明确“动量与能量未设独立自动断言”，这一点是诚实披露；本报告补充的是 60 s/高角速度的量化结果（§3.4），建议把“1 s 1.88e-3”从“监控值”改成“仅单点观测，不能作为全局界”。

### 4.3 文档过度声明

- [README.md:162-174](../../../README.md#L162-L174) 的“静摩擦按法向载荷比例分配，维持坡面驻车”在复合坡面且 demand/capacity 低至 0.56 时仍不成立（§P1-1）；应限定“在已验证的 slope-only/低 demand 工况”，或修复状态机。
- [README.md:95](../../../README.md#L95) 的 heave “在质心处”与实现/测试矛盾（§P3-2）。
- [README.md:232](../../../README.md#L232) 与 [DESIGN.md:649](../../../DESIGN.md#L649) 的“120 组随机无 NaN/负法向载荷”是真实通过的结果，但不能推出“求解健康”；E2b 的 6.5 s 可达工况有大量摇臂不可达和最终 `solverFailed`（§P2-1、§P2-2）。这是“有限性”与“物理正确性”的区别，建议在文档中写明。
- [DESIGN.md:696](../../../DESIGN.md#L696) 的 teardown 覆盖声明是另一份报告（b6 A2）的范围，本报告未重复。

## 5. 覆盖限制

1. **没有浏览器实验**。物理三件套是 DOM-free 的，Node 加载与生产构建共用同一源码；但 [solverStateOf](../../../src/js/30-ui.js#L733) 的 UI 徽标/警告没有在 Chrome 中实际截图复现，只做了源码路径核对。若要确认“求解失败：0 个角点不可达”的真实渲染，需要一次无头 Chrome 交互。
2. **复合坡面的初速是直接注入**。用户没有“横向推车”按钮，但低附着滑移后提高 μ 的路径是 UI 可达的（[40-app.js:6](../../../src/js/40-app.js#L6)、[:115-119](../../../src/js/40-app.js#L115-L119)、[05:263-277](../../../src/js/05-body-dynamics.js#L263-L277)）；第一段 0.3 m/s 注入本身不是 UI 手势。P1 已用 retarget 场景补强，但仍不是浏览器端到端。
3. **极限行程**：软悬架 6.5 s 可到 82–122 mm 角点行程，远超文档承诺的 ±25 mm；模型没有 bump stop，弹簧仍线性，运动比可到 8.08。这属于“文档只承诺 ±25 mm 闭合”的已声明范围外，本轮未把它列为独立缺陷，但没有验证 82 mm 时的物理可信度。
4. **时间尺度**：自由刚体只测到 60 s；接触/悬架 6.5–20 s；没有 10 分钟级、长距离或高帧率压力测试。
5. **旧版本对照**只用了 2999731 一个提交，隔离的是 `simBuildModel` 优化；没有覆盖全部历史提交的逐字节一致性。
6. **根因假设**：P1 的“逐角摩擦方向+横摆极限环”目前是假设，尚未把 `kYaw`、逐角方向、停止预算分别关掉做消融；报告没有把它写成确定结论。
7. **未测**：`sim.flags.boundary` 的粘滞标志（一次越界后只在 reset 清除）、`solverFailed` 的粘滞、极端的 NaN 注入恢复路径；这些只在代码阅读中注意到，未纳入本轮定量结论。

## 6. 结论与优先级

**没有 P0。** 0.3.0 的 B4.1 阻尼尖峰、B4.2 质心/动量、B4.4 脉冲坐标系、B4.5 接地点唯一性，以及 `simBuildModel` 优化的字节确定性，在本轮独立实验中都成立；现有 50+80+27 回归全绿。

**建议优先级**：

1. **P1-1**：先修复合坡面低速摩擦/重新驻车，并把回归从“绝对位移+有限性”改为“从初始位置起的位移+模式+速度+需求/容量”。这是当前唯一会让合法 UI 工况持续蠕动/无法驻车的问题。
2. **P2-1**：把弹簧力链路从 `frame.converged` 提升到 `solved.ok`（或显式回退），并增加不可达样本的力上限断言。
3. **P2-2**：统一 `motionRatioState`/`simRatioState` 阈值和 `solverDegraded` 派生，避免合法软悬架被 UI 误报“求解失败”。
4. **测试补强**：非主轴自由刚体能量/角动量；滑移位移差；完整状态 bit-identical；非整除/抖动帧；复合坡面 retarget；不可达摇杆的弹簧力。
5. **文档**：heave 脉冲位置、坡面驻车声明、120 组随机包线的“有限性≠物理正确性”、1 s 能量漂移的“单点监控”限定。

---

审阅者：physics-reviewer；日期：2026-11-19；本文件为 task-1 的唯一报告产物。
