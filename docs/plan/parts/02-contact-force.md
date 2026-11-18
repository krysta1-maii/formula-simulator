# 分册 02：接触、摩擦与坐标一致性

| 项目 | 内容 |
| --- | --- |
| 适用版本 | 0.2.0（提交 fbb401d） |
| 所属批次 | B2，前置 B0、B1 |
| 上游分册 | 01 物理状态与求解器协议 |
| 相关分册 | 03 运行时、04 界面、05 回归 |
| 对应缺陷 | B 报告 4.3、4.4、4.5；主册工作项 B2-1～B2-4 |
| 修订 | r2（2026-11-19）：按分册 06 的 R-01、R-05、R-06、R-07、R-10、A-02、A-03、A-05、A-06、O-12、O-13、O-14 定点回改 |
| 工作量合计 | 3.5 人日 |

## 1. 范围说明

本册处理“力如何落到车身上”这一层：接地点取哪一个、法向力与摩擦力以哪一点为力臂、脉冲作用点属于哪个坐标系、切向力在零速度附近如何切换。四条工作链为 B2-1 低速摩擦状态机、B2-2 脉冲作用点坐标、B2-3 接地点单一来源、B2-4 接地点与力矩的独立复算回归。

不在本册范围：质心积分与状态定义（分册 01 B1-1）、摇臂闭合可行性与角点求解协议（B1-2、B1-3）、求解种子所有权（B1-4）、帧时间语义与几何代际（分册 03）、界面文案与可访问性（分册 04）、轮胎与驱动（阶段三）。本册的验收用例默认运行在 B1 合并后的接口上；B1 未完成时，B2-3 无处取得路面系接地点，B2-1 的接地点滑移速度仍以车身参考点为原点，两者都按第 5 节的契约退回兼容分支，但不作为通过条件。

本册数值均来自 2026-11-19 在 Node 24.22.1 下对 fbb401d 的只读复测，探针脚本写在临时目录，不进入仓库。基线 `npm test` 为静力 47 项加动力学 52 项全绿。

## 2. 现状与证据

| 编号 | 现象 | 代码位置 | 复测数据 |
| --- | --- | --- | --- |
| C-1 | 低速摩擦死区：速度落在 1e-4 与 1e-3 两个阈值之间时摩擦力为零，状态仍报滑移 | 05-body-dynamics.js:324-326、350-360 | 水平路 vx=0.0005 m/s，四轮摩擦力全为 0，`sliding=true`、`atRest=false`；2 s 后 vx 仍为 0.0005，位移 1.0 mm |
| C-2 | 单步摩擦冲量无过零处理，一个子步内速度反向 | 05-body-dynamics.js:350-371 | 水平路 vx=0.01 m/s，单个 2 ms 子步后变为 -0.017459 m/s |
| C-3 | 无法重新驻车：切向速度降到毫米每秒后停不住 | 05-body-dynamics.js:324-327、426-443 | 坡面 10°/10°、μ=0.2 滑动 1 s 后切回水平 μ=0.9，再走 5 s 速度为 8.1e-4 m/s，`holding=false`、`sliding=true`，全程未进入静止 |
| C-4 | 坡面小扰动后持续滑移并反向 | 05-body-dynamics.js:324-327 | 坡面 8°、μ=1.4，初速 vx=0.0005，1 s 后 vx=-3.43e-3 m/s，仍报滑移 |
| C-5 | 脉冲偏移量按车体坐标定义却直接与路面系力求叉乘，力臂原点也不是质心 | 05-body-dynamics.js:178-195、375-383 | 症状：横摆 90° 后俯仰脉冲在车体系产生 (5890, 0, 0) N·m 的侧倾力矩（5890 是缺坐标旋转的症状值，不是基线）；按 R-01 的正确力臂，车体系力矩应为 (0,0,-6880.45) |
| C-6 | 力矩、接触速度与可视化使用两套接地点 | 05-body-dynamics.js:267-268、302-313、351-371、588-603 | 俯仰 0/2/5/10° 时两套接地点水平差 7.22/23.71/63.85/178.81 mm；侧倾 0/2/5/10° 时为 7.22/10.52/15.49/28.90 mm；默认俯仰脉冲开始后 60 ms 采样时 8.53 mm |
| C-7 | 求解失败的回退分支仍用 yaw-only 位置 | 05-body-dynamics.js:253-261 | 回退只替换力臂系数，接触点仍由 05:267-268 生成，与 `solved[i].contact` 不一致 |
| C-8 | 帧率下静默丢时（外部依赖，不计入本册缺陷） | 05-body-dynamics.js:525-537、40-app.js:418、426 | 10 Hz 下单帧 0.1 s 只执行 40 个子步，1 s 墙钟推进 0.8 s；由分册 03 的 B3-1 处理 |

C-1 至 C-4 出自同一结构原因：`atRest`（05:324-326）是每步重算的瞬时谓词，`holding`（05:327）要求平面速度严格小于 1e-4，而动摩擦方向在接地点速度小于 1e-3 时退回“外部切向力反方向”（05:358-360），水平路上该向量为零。运行状态没有锁存、没有停车冲量上限、没有驻车迟滞，因此系统只有“严格静止”和“全力动摩擦”两个可用分支，中间地带既不能停也不能滑。C-1 的 1.0 mm/2 s 与 C-3 的 0.8 mm/s 说明低速段不是“收敛慢”，而是没有收敛路径。C-6 的 7.22 mm 零姿态差来自外倾与前束造成的接触点横向偏移（前轴 dz=±7.218 mm、后轴 dz=±5.022 mm，dx 小于 0.1 mm），与姿态无关，因此现有的驻车、滑移测试从未暴露它：两套点各自自洽，只是不是同一点。

## 3. 任务清单

| 编号 | 标题 | 主要文件 | 依赖 | 合入序 | 工作量 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| B2-2 | 脉冲作用点坐标变换（offset - cgBody） | 05-body-dynamics.js | B0、B1-1 | 1 | 0.5 | C-5 |
| B2-3 | 接地点单一来源 | 03-suspension.js、05-body-dynamics.js | B0、B1-3 | 2 | 1.0 | C-6、C-7 |
| B2-1 | HOLD/SLIP 状态机、摩擦冲量上限与 simRetargetReference | 05-body-dynamics.js | B0、B1-1、B1-3、B2-3（合入顺序） | 3 | 1.5 | C-1～C-4 |
| B2-4 | 力装配统一、接地点与力矩独立复算 | 05-body-dynamics.js、tools/test-dynamics.mjs | B2-3 | 4 | 0.5 | C-6 |

合入顺序固定为 B2-2 → B2-3 → B2-1 → B2-4（R-05）。B2-2 与 B2-3 共用同一条“车体系转路面系”的转换，先合入可避免两套转换写法并存；B2-1 的状态机、重新驻车与帧率验收都以统一后的接地点和法向载荷为基线，因此排在 B2-3 之后；B2-4 收口力装配 `simApplyForceAt` 与力矩分解，必须最后合入。依赖上，B2-1 依赖 B1-1（质心状态）、B1-3（角点求解协议）与 B2-3；B2-2 依赖 B1-1；B2-3 依赖 B1-3；B2-4 依赖 B2-3。按合入链串行计算为 0.5 + 1.0 + 1.5 + 0.5 = 3.5 人日，与主册一致；B2-2 与 B2-3 的开发可并行，但提交顺序不变。

## 4. 逐项任务

### 4.1 B2-1 HOLD/SLIP 状态机（1.5 人日，含 simRetargetReference 0.5）

**现状。** 摩擦分支由 `simEvaluate` 内的三个布尔量决定：`atRest`、`holding`、`sliding`（05:324-327）。`holding` 为真时按法向载荷比例施加静摩擦并把平面速度与横摆角速度清零（05:331-344、426-443）；否则施加动摩擦，方向取接地点滑移速度反方向，速度低于 1e-3 时退回外部切向力反方向（05:350-362）。动摩擦大小为 `μN_i`，不含任何冲量上限，因此当 `μN_i·dt` 大于当前动量时必然反向（C-2），而反向后的速度若落入 1e-3 以下则摩擦力归零、速度冻结（C-1、C-3）。

**目标。** 把“每步重算的布尔判定”改为锁存的两态机，并在动摩擦一支加入“本步刹停冲量”上限，使速度在单步内单调归零而不是穿越零点；静止保持由迟滞与驻留计数确认，不再依赖严格等于零。每步的执行顺序固定为：`simEvaluate` 评估载荷与接地点速度并算出纯对象 `contactNext` → `simStep` 按 `contactNext.mode` 计算摩擦力并积分 → 积分后做 SLIP→HOLD 后置检查与速度投影 → 由 `simStep` 提交 `sim.contact = contactNext`（O-13）。`simEvaluate` 不写 `sim.contact`，`simBuildModel` 只读已提交值，因此连续调用遥测不会推进状态机。工作量拆分：状态机与验收 1.0 人日，`simRetargetReference` 及其用例 0.5 人日。

1. 状态结构。`sim.contact = { mode, dwell, since, changes, lastChangeStep, reason, slipSpeed, usage }`，`mode` 取 `'HOLD'` 或 `'SLIP'`；`dwell` 为连续满足驻车条件的子步数，`since` 为进入当前模式的仿真时间，`changes` 为累计切换次数，`lastChangeStep` 为最近一次模式切换的子步序号（取 `Math.round(sim.time / SIM_DT)`，A-05 用它断言帧率无关），`reason` 记录进入 SLIP 的原因（`'demand'`、`'lift'`、`'impulse'`）。`simEvaluate` 返回同结构的纯对象 `contactNext`，不写回 `sim`；`simCreate`（05:127-151）与 `simReset`（05:153-172）初始化为 `HOLD`，与原 `flags.holding=true` 一致。
2. 常数。在 05:23-31 增加 `SIM_ARREST_SPEED = 2e-3`（m/s）、`SIM_ARREST_RATE = 2e-3`（rad/s）、`SIM_ARREST_DWELL = 3`（子步）、`SIM_HOLD_HYSTERESIS = 0.02`。取 2e-3 的理由是：一个 2 ms 子步在 μg≈8.8 m/s² 下可改变速度 0.0176 m/s，未加冲量上限时不可能落进 2e-3，因此该门限只能由刹停冲量达到，不会把正常滑移误判为停车。
3. 转换条件。
   - `HOLD → SLIP`：平面速度超过 `SIM_ARREST_SPEED`、或横摆角速度超过 `SIM_ARREST_RATE`、或四角接地点滑移速度最大值超过 `SIM_ARREST_SPEED`，或 `demand > capacity·(1 - SIM_HOLD_HYSTERESIS)`，或任一角法向力不大于 1e-6 N（离地），或外部切向冲量本身超过容量。速度条件是必要的：HOLD 分支会无条件把平面速度投影为零，若状态仍锁存 HOLD 而车体已在运动，就会出现“瞬移停车”。判定在当步力评估之前完成，用当步载荷，不用上一步残值。
   - `SLIP → HOLD`：平面速度小于 `SIM_ARREST_SPEED`、横摆角速度小于 `SIM_ARREST_RATE`、四角接地点滑移速度最大值小于 `SIM_ARREST_SPEED`、且 `demand ≤ capacity·(1 - SIM_HOLD_HYSTERESIS)` 连续保持 `SIM_ARREST_DWELL` 个子步；满足时清零 `vx`、`vz`、`wy`，置 `since = sim.time` 并累加 `changes`。
4. 摩擦冲量上限。`simEvaluate` 增加 `dt` 参数（默认 `SIM_DT`，保持既有调用兼容）。SLIP 分支先按饱和库仑得到各角摩擦力 f_i，再计算两个预算：平面动量 `p = m·(vx,vz) + F_ext,t·dt` 与横摆动量 `h = Iyy·wy + L_ext·dt`（`F_ext,t` 即 05:316-320 的 `externalTangent`，含脉冲切向分量；`L_ext` 只取非摩擦项 `momentParts.normal[1] + momentParts.impulse[1]`，即法向与脉冲力矩的 y 分量之和。`momentParts.friction[1]` 是本次要缩放的被控量，只作观测与能量核算，计入预算会把控制量加进被控量，O-14 已裁决）。若合冲量 `|Σ f_i·dt|` 大于 `|p|`，或合横摆冲量大于 `|h|`，按两者的较小比例 `k` 统一缩放 f_i。缩放后若 `k<1`，在速度更新之后、位置更新之前（05:443 与 05:460 之间）把对应分量投影为零：平面预算触发则置 `vx=vz=0`，横摆预算触发则置 `wy=0`。由此单步速度不会反向，归零是投影而不是数值巧合，且本步不会因为残留速度产生额外位移。
5. 与现有标志的映射。`flags.holding = (mode==='HOLD')`、`flags.sliding = (mode==='SLIP')` 保持不变，保证 30-ui.js:588、656、782 与 test-dynamics-browser.mjs:195、213 不需要同步改动；`flags.atRest` 保留为纯运动学谓词，但扩展为平面速度、三轴角速度和四角接地点滑移速度同时小于 `SIM_REST_SPEED`（1e-4），仅供遥测，不参与模式判定。
6. 遥测。`simBuildModel` 的 `sim` 字段（05:618-634）只读已提交的 `sim.contact`，输出投影 `mode`、`dwell`、`changes`、`lastChangeStep`、`slipSpeed`、`usage`（`max |f_i|/(μN_i)`）；05:671 的 `frictionForce` 旁增加 `frictionUse` 数组；每条角点记录增加 `slipVelocity` 与 `contactVelocity`。求解状态与残差不在本册另起名字：`solverOk`、`solverState`、`rockerResidualMm`、`motionRatioState` 直接引用分册 01 冻结的快照字段（R-10），本册只新增切向接触字段。界面展示位置与文案由分册 04 的 B4-4 落地。
7. 自检。在 `runDynamicSelfTests`（05:711-815）增加“低速驻车”与“滑移不反向”两项，动态自检由 8 项变 10 项，页面合计 14+10=24 项（R-06）。新增两项必须按测试名称断言；浏览器断言由 `>= 8` 改为 `>= 10`（test-dynamics-browser.mjs:225），弹窗断言改为 `>= 24`；README 第 19/172/245 行、DESIGN 第 544/640 行与 30-ui 的数量文案由主册 B5-2 统一。
8. 环境切换入口（A-06）。在 05-body-dynamics.js 新增 `simRetargetReference(sim, source)`：`sim.reference = computeStatic(source)`；校验 `computeStatic(source).geometryRevision === sim.geometryRevision`，不一致时抛错（`geometryRevision` 由分册 03 B3-2 提供，未合入时跳过校验）；清空 `sim.cornerSeed = [null, null, null, null]`；保留 `sim.state`、`sim.contact`、`sim.time`、`sim.impulse`。调用点为 `40-app.js` 的 `refreshAll`（72-96）与 `processPendingRebuild`（50-70）：把 `SIM.reference = computeStatic(state)`（76）替换为 `simRetargetReference(SIM, state)`，该行由分册 03 的 B3-2 在同一提交内改调用。本册的重新驻车用例只走这个入口，不再直接给 `SIM.reference` 赋值。

**依赖。** B0 的审计脚本骨架、B1-1 的质心状态（接地点速度力臂以质心为原点）、B1-3 的角点结构（本任务用到 `contact` 与法向力，不直接用 `contactRoad`）、B2-3（合入顺序，见第 3 节）、分册 03 B3-2 的 `geometryRevision`（`simRetargetReference` 的校验项，未合入时跳过校验）。若 B1-1 未合并，`p` 与 `h` 仍可按当前参考点状态计算，模式机可用，但“含旋转滑移”的验收第 6 条需在 B1 后复跑；若 B2-3 未合并，接地点滑移速度仍按 yaw-only 位置计算，状态机判定不受影响，第 6 条同样需在 B2-3 后复跑。

**验收。** 入口命令 `node tools/audit/audit-friction-low-speed.mjs`（修复前退出码 1，B2-1 后 0），逐条断言：

1. 低速停止：水平路、vx=0.0005、`settle:0`，1 个子步后 `|vx| < 1e-12`，4 个子步后 `mode==='HOLD'`，累计位移 `0 ≤ x ≤ 2e-6` m，全程 `x ≥ 0`（当前失败：2 s 后仍为 0.0005 m/s）。
2. 单步过零：水平路、vx=0.01，1 个子步后 `0 ≤ vx < 1e-6`，位移 `0 ≤ x < 1e-4`；当前为 -0.017459 m/s 且 x<0，断言方向相反即失败。
3. 坡面小扰动：slope=8°、μ=1.4、vx=0.0005，4 个子步后 `mode==='HOLD'`、`|v| < 1e-12`、位移小于 1e-4 m（当前：1 s 后 -3.43e-3 m/s 且仍在滑移）。
4. 重新驻车：slope=10°/bank=10°、μ=0.2、`settle:0`、初速 0.4 m/s，滑行 1 s 后调用 `simRetargetReference(sim, 水平 μ=0.9 的参数)` 切到水平（A-06），继续步进；切换前后 `sim.state` 逐位不变、`sim.contact` 逐字段不变、`cornerSeed` 全为 `null`；0.1 s 内 `mode==='HOLD'`，`vx=vz=wy=0`，其后 1 s 位移小于 1e-9 m，且切换后速度模长单调不增（当前：5 s 后仍 8.1e-4 m/s）。
5. 容量边界不抖振：构造 demand/capacity 分别为 0.99 与 1.01 的两组坡面，各运行 5 s，`changes` 分别不超过 0 与 2。
6. 帧率一致（A-05）：同一场景（低附着滑移后切水平）分别以 10、12、30、60、144 Hz 驱动到相同的 `sim.time` 与相同的子步数 0.8 s。驱动循环为：`wall += 1/f`，每帧 `simAdvance(sim, Math.min(1/f, target - sim.time))`，循环条件 `sim.time < target - 1e-12`，末帧按剩余时间截断；不得用固定帧数代替，也不得依赖 `1/f` 恰好整除 2 ms。断言四项：`sim.time` 与子步数完全相同；完整 `state`（x/y/z、vx/vy/vz、qw/qx/qy/qz、wx/wy/wz）逐位相等（用 `===`，不用 1e-12 容差）；`sim.contact` 的 `mode/dwell/changes/lastChangeStep` 完全相同；模式切换的子步序号序列完全相同。断言信息必须打印 `sim.time` 与子步数。帧率造成的时间丢弃由分册 03 的 B3-1 处理，这里只要求状态机与帧率无关。
7. 遥测无副作用（O-13）：同一 sim 连续调用 `simBuildModel` 100 次，`sim.time`、`sim.contact.changes/dwell/since/lastChangeStep` 逐位不变，第 100 次返回的 `sim.mode` 与第 1 次相同。
8. 横摆冲量预算（O-14 裁决）：在 8°/7° 与 10°/10° 两组倾斜工况各做一次 SLIP→HOLD 转换，断言驻车判定使用的横摆预算与独立复算的 `Iyy·wy + (momentParts.normal[1] + momentParts.impulse[1])·dt` 一致（差小于 1e-9）；同时断言该预算不含 `momentParts.friction[1]`：把摩擦项加回会得到可观测差异（大于 1e-3 N·m·s）。当前法向力为竖直力时 `momentParts.normal[1]` 恒为 0，该断言守的是聚合路径与非摩擦口径。
9. 回归：`npm test` 原 52 项全绿，其中 test-dynamics.mjs:152、236、239、242 四条驻车/滑移断言不改阈值。

**风险与回滚。** 主要风险是状态机在容量边界抖振，以及刹停冲量把“应当继续下滑”的工况误判为可驻车。前者由 2% 迟滞、3 子步驻留与 `changes` 计数覆盖；后者由驻车条件同时要求 `demand` 小于容量排除，容量不足时驻留计数不会累积。第二个风险是刹停缩放同时影响摩擦力矩，使滑移中的侧倾/俯仰响应略有变化；120 组随机包线（test-dynamics.mjs:244-280）与浏览器滑移用例（:208-216）用于兜底。回滚方式为整体 revert B2-1 提交，审计脚本保留作为“已知失败”基线；不设长期特性开关，避免两套摩擦路径同时存在。

### 4.2 B2-2 脉冲作用点坐标变换（0.5 人日）

**现状。** `simApplyImpulse`（05:178-195）把 `offset` 按车体坐标定义（俯仰脉冲 0.95 m 沿车体 x，侧倾脉冲 0.90 m 沿车体 z），`simEvaluate`（05:375-383）直接计算 `simCross(impulse.offset, impulse.force)`：既没有把车体力臂旋转到路面系，也没有把力臂原点从车身参考点移到质心。C-5 的实测结果是横摆 90° 后俯仰脉冲变成 5890 N·m 的侧倾力矩。5890 是这条缺陷的症状值，不是基线；R-01 裁定后正确值为 6880.45 N·m。

**目标。** 作用点按 `P = refPos + R(q)·offset` 定义，`offset` 是相对车身参考点的车体系绝对点；绕质心的力臂为 `leverBody = offset - cgBody`；脉冲力只在路面系定义一次（`forceRoad`），力矩为 `M = (R(q)·leverBody) × forceRoad`。因 `R` 保持叉乘结构，`(R·a)×(R·b) = R·(a×b)`，车体系中与之等价的写法是 `R·(leverBody × (R⁻¹·forceRoad))`；该式只作核对恒等式，不引入第二种力定义。力臂原点与 B2-3 的接地点力臂统一为质心。

1. 数据结构：`sim.impulse = { kind, label, offset, forceRoad, until }`。`offset` 保留现有数值 `[0,0,0]`、`[0,0,0.90]`、`[0.95,0,0]`，语义是车体系绝对点；`forceRoad` 是路面系力 `[0,-6800,0]`、`[0,-4200,0]`、`[0,-6200,0]`。全册只定义 `forceRoad` 一种力方向，不设车体系力字段；`leverBody` 是计算中间量，不存进 `sim.impulse`。
2. 计算：在 05:375-383 改为 `const leverBody = [impulse.offset[0]-cgBody[0], impulse.offset[1]-cgBody[1], impulse.offset[2]-cgBody[2]]; const leverRoad = simQuatRotate(q, leverBody); const localMoment = simCross(leverRoad, impulse.forceRoad);`；`force` 的累加与 `externalTangent`（05:316-320）直接使用 `impulse.forceRoad`。`q` 在 05:204、`cgBody` 在 05:206 已就绪，无需新增状态。
3. 默认数值（xCG=-0.15975 m、cgHeight=0.30 m，零姿态 `R=I`）：俯仰 `offset=[0.95,0,0]` → lever `[1.10975,-0.30,0]`，`M=(0,0,-6880.45)` N·m；侧倾 `offset=[0,0,0.90]` → lever `[0.15975,-0.30,0.90]`，`M=(3780,0,-670.95)` N·m；垂向 `offset=[0,0,0]` → lever `[0.15975,-0.30,0]`，`M=(0,0,-1086.30)` N·m。三值在零姿态成立；纯横摆下因 `R^T·forceRoad = forceRoad`，车体系力矩仍为这三值；含俯仰或侧倾时按 `(R·leverBody) × forceRoad` 逐姿态计算，模长不再恒等于 6880.45。俯仰的 6880.45 N·m 是本册主基线（xCG 圆整为 -0.160 m 时为 6882 N·m，仅作记录）。
4. 需重定的脉冲基线（R-01 强制，旧值一律作废）：(a) 0°/90°/24 姿态扫描的力差与力矩差；(b) 4.1 工况（600 kg、前后 50 N/mm、阻尼比 0.05、ARB 0）的阻尼峰值与运动比区间，旧 30.7 kN / 46.3 kN 与 -4.20 不再作为验收值；(c) 浏览器 26 项中侧倾与俯仰脉冲的峰值断言；(d) README:79-81 与 DESIGN 20.2、20.6 的表述，把“在质心处 / 右侧 0.90 m / 车头方向 0.95 m”改为“作用点为相对车身参考点的车体系偏移，绕质心力矩由 `offset - cgBody` 计算”，并补一句“脉冲力为路面系竖直力，绕质心力矩由 `(R·(offset−cgBody)) × forceRoad` 计算”。以上由主册 B5-1 与分册 05 的 audit-impulse-frame、audit-seed-writeback、audit-rocker-reach 落地。
5. 与 B2-4 的衔接：B2-2 合入时 `simApplyForceAt` 尚未实现（R-07 归 B2-4），本步先按上式内联计算；B2-4 合入后统一改为 `simApplyForceAt(sim, P, impulse.forceRoad, 'impulse')`（`P = refPos + R·offset`），数值必须逐位不变（由 B2-4 的等价性断言守护）。
6. 遥测：`simInfo.impulse` 仍只暴露标签（05:632），`sim.impulse` 不进入快照，避免 UI 依赖内部结构。

**依赖。** B0、B1-1。`cgBody` 与 `q` 均已存在；B1-1 完成后力臂仍按 `offset - cgBody` 计算，不随积分变量改变，因此本任务可与 B1-1 并行开发。

**验收。** 入口命令 `node tools/audit/audit-impulse-frame.mjs`（修复前退出码 1，B2-2 后 0）：

1. 横摆 0°：俯仰脉冲的路面系力矩为 `(0,0,-6880.45)` N·m，分量容差 1e-6。
2. 横摆 90°：有脉冲与无脉冲两次评估的力矩差旋转到车体系后为 `(0,0,-6880.45)`，`|ΔM_x| < 1e-9`、`|ΔM_z + 6880.45| < 1e-9`；同一工况的路面系力矩差为 `(-6880.45,0,0)`。当前症状是车体系 `(5890,0,0)`，断言方向相反即失败。
3. 横摆 0 至 345°、步长 15° 的 24 个姿态下，车体系力矩差的 z 分量与 -6880.45 的偏差均小于 1e-9，x、y 分量小于 1e-9。
4. 复合姿态（侧倾 10°、俯仰 10°）：`ΔM` 与独立复算的 `(R·leverBody) × forceRoad` 逐分量一致（差小于 1e-9）。不得断言固定值 6880.45：路面系竖直力在复合姿态下不保该模长（纯横摆才保）。
5. 垂向与侧倾脉冲：车体系力矩差分别为 `(0,0,-1086.30)` 与 `(3780,0,-670.95)`，容差 1e-6。不得再断言“垂向脉冲力矩为零”。
6. 有/无脉冲两次评估的差只含脉冲项：`|ΔM - (R·leverBody) × forceRoad| < 1e-9`，且力差等于 `forceRoad`（姿态无关），说明悬挂项未被扰动。

**风险与回滚。** 有两项必须被接受的行为变化。第一，力臂原点由车身参考点改为质心，俯仰脉冲力矩由 5890 变为 6880.45 N·m（增 16.8%），侧倾与垂向脉冲同时获得俯仰分量（-670.95 与 -1086.30 N·m），全部脉冲类基线按第 4 步重定。第二，脉冲力为路面系竖直力，不随姿态旋转：纯横摆工况与旧行为完全一致，复合姿态下力矩按 `(R·leverBody) × forceRoad` 变化，模长可能偏离 6880.45。若将来需要“力随车身转动”的车体系语义，必须另立契约并重测全部复合姿态基线，不得在本册局部改。回滚为 revert 单文件改动，不影响其他工作项。

### 4.3 B2-3 接地点单一来源（1.0 人日）

**现状。** 每个角点有两套接地点。05:267-268 只用横摆角把设计轮位旋到路面系，得到 `corner.contact = [state.x + cy·x + sy·z, 0, state.z - sy·x + cy·z]`，用于法向力矩（05:306）、静摩擦力矩（05:337）、动摩擦力矩（05:364）、接地点速度（05:351）、轮载标注与接地点阴影（经 05:561-570 的 `contactPoints` 到 10-scene.js:1042、1110）。另一套由机构解 `suspSolveCorner` 给出车体系接触点（03-suspension.js:281-290），在 05:593 用完整四元数转到路面系，只进入 `solved` 快照和 22-car-dynamics.js:958、1112。C-6 量化了两者差异：即使姿态为零也有 7.22 mm，来自外倾与前束造成的接触点横向偏移；姿态增大后由完整四元数项主导，10° 俯仰时达 178.81 mm。

**目标。** 每个角点只产生一个路面系接地点，法向力矩、摩擦力矩、接地点速度、遥测与可视化全部消费它；求解失败时的回退也用完整四元数，不用 yaw-only。

1. 角点求解输出（B2-3 追加，R-07：B1-3 只冻结 `frame/rocker/motionRatio/seed`，接地点字段不进 B1-3）：`suspSolveCorner` 的返回增加 `contactBody`、`wheelPosBody`、`contactRoad`、`wheelPosRoad`，后两者由前者经 `R(bodyQuat)·p + bodyPos` 一次算出；`contactBody` 只给机构与渲染，`contactRoad` 是唯一接地点。`simEvaluate.corners[i].contact = contactRoad`，其余模块只读 `corner.contact`。签名如下，字段语义见第 5 节：

   ```js
   // 03-suspension.js，在现有返回对象上追加四个字段
   contactBody: [x, y, z],     // 车体系接触点（保留）
   wheelPosBody: [x, y, z],    // 车体系轮心（等价于现有 wheelPos）
   contactRoad: [x, y, z],     // 路面系接触点，唯一来源
   wheelPosRoad: [x, y, z]     // 路面系轮心，唯一来源
   ```

2. 力评估（05:229-286）：删除 05:267-268 的 yaw-only 公式，改为 `corner.contact = solved.contactRoad.slice()`、`corner.wheelPos = solved.wheelPosRoad.slice()`。无机构解的分支（`geometry` 或 `design` 缺失）用完整四元数构造：`const p0 = simQuatRotate(q, [wheel.x, 0, wheel.z]); const p1 = [state.x+p0[0], state.y+p0[1], state.z+p0[2]];` 再沿路面系法向 `n = [0,1,0]` 投影到平面，`contact = p1 - n·(n·p1)`，等价于 `contact.y = 0`（A-02）。不得用 `gravityLocal` 的反方向：`gravityLocal` 是重力在路面系中的分量，只有水平路面才与法向平行，倾斜或横坡下会得到 `contact.y ≠ 0`；若后续改用世界系表达，则 `n = applyQuaternion(frame.q, [0,1,0])`。这样回退点仍严格落在路面上，且随俯仰/侧倾一起转动。
3. 力臂统一：05:306、337、364 三处力臂统一写成 `corner.contact - cg`（分册 01 完成后 `cg` 即状态位置，可写成 `corner.contact - state`）；05:351 的接地点速度力臂改为同一个 `corner.contact - cg`，删除以 `state.x/y/z` 为原点的重复写法。这是“旋转滑移”的物理来源，四角速度必须由同一点出发计算。
4. 遥测与可视化：05:561-570 的 `contactPoints` 继续读 `corner.contact`（自动变成统一值）；`wheelCenters` 改用 `solved.wheelPos`，不再用 `contact + (0,R,0)`，因为转向与外倾下轮心不在接地点正上方一个半径处。05:588-604 的 `solved` 映射不再二次做四元数变换，直接拷贝 `corner.contact` 与 `corner.wheelPos`，保证“一次求解、一处存储”。
5. 视觉核对：10-scene.js:1042、1110 的阴影与标注锚点自动随 `contactPoints` 更新；22-car-dynamics.js:958、1112 的消费点不变。默认俯仰脉冲开始后 60 ms 采样时接触点移动不超过 8.53 mm，属可接受视觉变化。

**依赖。** B0、B1-3（求解协议 `frame/rocker/motionRatio/seed`）。`contactBody/contactRoad/wheelPosRoad` 由本任务输出，不要求 B1-3 预置；B2-4 依赖本任务的字段。若分册 01 最终把接地点放在 `simEvaluate` 而不是 `suspSolveCorner`，第 2 步改为消费该处输出，其余断言不变。

**验收。** 入口命令 `node tools/audit/audit-contact-gap.mjs --group contact`（修复前退出码 1，B2-3 后 0）。本阶段只跑第 1～4 条；力矩一致性已按 O-12 移交 B2-4，第 5 条静态对照由 `npm test` 的 `[12]` 段承担；分组名由分册 05 的脚本骨架落地：

1. 唯一性：在俯仰 0/2/5/10°（并另测侧倾 0/2/5/10°）下，对每个角点断言 `|eval.corners[i].contact - (R·contactBody + ref)| < 1e-6` m、`|model.contactPoints[i] - eval.corners[i].contact| < 1e-9`、`|model.solved[i].contact - eval.corners[i].contact| < 1e-9`、`|contact.y| < 1e-6`。修复前同一断言在 0° 即为 7.22 mm，直接失败。
2. 平面约束：所有姿态与所有 `solved` 记录的 `contact[1]` 绝对值小于 1e-6 m，保留 test-dynamics.mjs:139 的同名检查并扩展到 10° 姿态。
3. 独立复算：用 `suspSolveCorner` 在相同 `bodyPos/bodyQuat/rackShift` 下重新求解，其 `contactRoad` 与模型中消费值逐分量一致（差值小于 1e-9）。
4. 回退分支（A-02）：把 `sim.reference.suspension` 置空后，在水平、8°/7° 倾斜与 10° 侧倾三组工况各评估一次；回退点满足 `|contact.y| < 1e-6`，且与 yaw-only 公式的水平差大于 10 mm，证明回退用了完整四元数；用同一 `contact` 重算力臂 `contact - cg`，与 `contactPoints[i]` 逐分量一致（小于 1e-9）。
5. 静态对照不回退：test-dynamics.mjs:155-166 的倾斜面动态/静力载荷对照仍小于 1 N。已在 /tmp 副本上把法向与摩擦力臂改为机构接地点预先验证：8°/7° 的对照误差为 0.48 N，-10°/-10° 为 0.53 N，均低于 1 N 门限，说明本改动不会破坏静力基准。

**风险与回滚。** 主要风险是接地点移动带来的载荷重分配与视觉位移。载荷重分配已用副本量化（最大 0.53 N），远小于 1 N 门限；默认脉冲下视觉位移 8.53 mm，10° 姿态下 178.81 mm 属大姿态而非默认工况。第二个风险是 `contactBody` 与 `contactRoad` 混用；用第 5 节的命名与一条代码评审规则约束：05 中不得再出现 `state.x + cy * wheel.x` 形式的接地点构造。回滚为 revert B2-3，B2-4 依赖其字段，须同时回退。

### 4.4 B2-4 力装配统一与力矩独立复算（0.5 人日）

**现状。** `evaluation.moment` 是法向、摩擦、脉冲三项累加的结果，但三处力矩分别手写在 05:306-311、337-341、364-368 与 379-382，没有统一入口；测试只观察总力矩与最终姿态，没有单独验证每一项的力臂来源，因此 C-6 这类“算错但自洽”的错误不会被现有断言发现。

**目标。** 冻结并实现 `simApplyForceAt(sim, roadPoint, forceRoad, bucket)`，法向、摩擦、脉冲三条路径全部经它累加力与力矩；把力矩拆成可核对的三个分量；新增独立复算与 grep 守卫，使接地点、力臂、力矩三者任何一处不一致时测试立即失败。

1. 累加器（裁决 r1，实现细节，不进入 `contracts.v1` 字段表）：`simEvaluate` 入口创建 `sim._evalAccum = { force: [0,0,0], momentParts: { normal: [0,0,0], friction: [0,0,0], impulse: [0,0,0] } }`，在 `try/finally` 的收尾处读取 `force` 与 `momentParts` 并 `delete sim._evalAccum`。该字段是瞬时中间量，不进入 `simBuildModel` 快照，其他函数不得依赖；`simEvaluate` 每次调用（含 `simBuildModel` 的遥测调用）都必须重建并清理。
2. 新增 `simApplyForceAt(sim, roadPoint, forceRoad, bucket)`：只读写 `sim._evalAccum`，`const arm = [roadPoint[0]-cg[0], roadPoint[1]-cg[1], roadPoint[2]-cg[2]]; const m = simCross(arm, forceRoad);`，把 `forceRoad` 累加到 `accum.force`，把 `m` 累加到 `accum.momentParts[bucket]`，`bucket` 取 `'normal'`、`'friction'`、`'impulse'`。`sim._evalAccum` 缺失时抛错，错误消息必须含 `_evalAccum`，不得静默新建。四参签名与分册 01 §6 冻结的一致。
3. `moment` 由三个 `momentParts` 相加得到，不再单独累加；三项之和与 `moment` 的差小于 1e-9。
4. 替换三条路径的四处手写叉乘：法向 05:306-311、摩擦的静分支 05:337-341、摩擦的动分支 05:364-368、脉冲 05:379-382，全部改为调用 `simApplyForceAt`（摩擦两个分支共用 `'friction'` 桶）。脉冲路径传 `roadPoint = refPos + R·offset` 与 `impulse.forceRoad`（B2-2 的公式），合入后数值必须逐位不变。
5. `momentParts = { normal, friction, impulse }` 随 `simEvaluate` 返回，`simBuildModel` 透传，供遥测与测试共用。
6. 独立复算测试：对每个角点计算 `cross(contact - cg, [0, N_i, 0])` 与 `cross(contact - cg, f_i)`，分别与 `momentParts.normal`、`momentParts.friction` 比对，容差 1e-6 N·m。
7. grep 守卫：`awk '/^function simEvaluate/,/^}/' src/js/05-body-dynamics.js | grep -c 'simCross('` 必须为 0；`simCross` 在 05 中只允许出现在 `simApplyForceAt` 函数体与四元数辅助函数处。

**依赖。** B2-3（统一接地点）。本任务改动物理路径（统一力装配），但只做等价替换；数值等价由验收第 5 条与 `npm test` 守护。

**验收。** 入口命令 `node tools/audit/audit-contact-gap.mjs --group full`（完整组，含从 B2-3 移交的力矩一致性条目，O-12）与 `npm test` 的 `[12]` 段：

1. 三项分解之和等于总力矩，差小于 1e-9。
2. 累加器生命周期：在 `simEvaluate` 之外调用 `simApplyForceAt` 必须抛错且消息含 `_evalAccum`；`simEvaluate` 与 `simBuildModel` 返回后 `sim._evalAccum === undefined`；连续 100 次 `simBuildModel` 不残留该字段，也不改变 `sim.contact`。
3. 法向力矩独立复算差小于 1e-6 N·m，摩擦力矩同理，覆盖水平、8°/7° 倾斜、10° 俯仰与低附着滑移四种工况。
4. 水平对称工况（驻车，或 vz=0、wy=0 的直线滑移）下 `|momentParts.friction[1]| < 1e-6`（左右对称摩擦不产生横摆力矩）。
5. `normalMomentX/Z`（05:571-572）与由 `contactPoints`、`loads` 重算的值一致，差小于 1e-6 N·m。
6. 等价性：以 B2-1 合入后的 HEAD 为对照基线，`simApplyForceAt` 改造前后同一组确定性用例的最终 state 逐位相同（含 B2-2 的脉冲工况）。
7. grep 守卫输出为 0。

**风险与回滚。** `simApplyForceAt` 是纯累加替换，风险集中在力臂原点写错（必须是质心）、bucket 漏记与 `_evalAccum` 未清理，三者由验收第 1、2、7 条覆盖。字段命名若与分册 01 的 `ForceEvaluation` 冲突，以分册 01 为准并在同一提交更新本册用例。回滚为 revert B2-4，B2-3 与 B2-1 不依赖其字段。

## 5. 与分册 01 的接口契约

本册消费的求解协议由分册 01 的 B1-3 冻结（`frame/rocker/motionRatio/seed`），接地点四字段由 B2-3 在同一结构上追加（R-07）。下表按归属列出本册消费的全部字段；分册 01 若调整命名，须在同一提交更新本册第 4.3 节的引用与审计脚本。

| 字段 | 归属 | 语义 | 本册用途 |
| --- | --- | --- | --- |
| `frame.converged` | B1-3 | 轮架三约束是否收敛；A-03 冻结后不得用综合 `ok` | 决定法向力走主解还是回退分支（05:247-261） |
| `rocker.feasible`、`rocker.residual` | B1-3 | 摇臂可达性与闭合残差（单位 m） | 遥测 `rockerResidualMm`（mm），本册不改变判定 |
| `coilLength`、`rockerAngle` | B1-3 | 线圈长度与摇臂角 | 弹簧力与可视化 |
| `motionRatio`、`motionRatioState` | B1-3 | 运动比及其状态（`'ok'` 或 `'unavailable'`） | 遥测，本册不消费 |
| `seed` | B1-3 | 求解种子，物理层所有 | 渲染层不得回写（B1-4） |
| `contactBody` | B2-3 | 接地点车体坐标 | 机构与渲染，不进入力矩 |
| `wheelPosBody`、`wheelPosRoad` | B2-3 | 轮心车体与路面坐标 | `wheelCenters` 与轮心可视化 |
| `contactRoad` | B2-3 | 接地点路面坐标，唯一来源 | 法向与摩擦力矩、接地点速度、遥测、可视化 |

**5.1 contactRoad 契约。**

| 项 | 规定 |
| --- | --- |
| 定义 | `contactRoad = R(bodyQuat)·contactBody + bodyPos`，由 `suspSolveCorner` 一次算出 |
| 约束 | `\|contactRoad.y\| < 1e-6`（路面系 y 向上，路面为 y=0）；回退分支用 `n = [0,1,0]` 投影 |
| 唯一性 | `simEvaluate.corners[i].contact` 直接赋值为 `contactRoad`；`contactPoints`、力矩、接地点速度与可视化只读它 |
| 禁止 | 05 中不得再出现 `state.x + cy * wheel.x` 形式的 yaw-only 接地点；`contactBody` 不参与力矩 |

**5.2 sim.contact 契约。** 写者唯一为 `simStep`：`simEvaluate` 只返回纯对象 `contactNext`，`simBuildModel` 只读已提交值；快照 `simInfo` 输出下表字段，`getSnapshot().sim` 只读这些投影（O-13）。

| 字段 | 类型 | 语义 | 提交时机 |
| --- | --- | --- | --- |
| `mode` | `'HOLD'` 或 `'SLIP'` | 锁存的切向状态 | 每子步积分后 |
| `dwell` | 整数 | 连续满足驻车条件的子步数 | 每子步积分后 |
| `since` | 秒 | 进入当前模式的仿真时间 | 模式切换时 |
| `changes` | 整数 | 累计切换次数 | 模式切换时 |
| `lastChangeStep` | 整数 | 最近一次切换的子步序号 | 模式切换时 |
| `reason` | 字符串或 `null` | 进入 SLIP 的原因 | 进入 SLIP 时 |
| `slipSpeed` | m/s | 四角接地点滑移速度最大值 | 每子步 |
| `usage` | 无量纲 | `max \|f_i\|/(μN_i)` | 每子步 |

**5.3 momentParts 契约。**

| 字段 | 内容 | 不变量 |
| --- | --- | --- |
| `normal` | 四角法向力对质心的力矩之和 | 竖直法向力下 y 分量恒为 0；由 `simApplyForceAt(..., 'normal')` 累加 |
| `friction` | 四角切向摩擦力对质心的力矩之和 | 与法向力矩使用同一 `contactRoad` |
| `impulse` | 脉冲力对质心的力矩 | 等于 B2-2 的 `(R(q)·leverBody) × forceRoad` |
| 合计 | `moment = normal + friction + impulse` | 逐分量差小于 1e-9 |

**5.4 质心原点与求解失败。** B2-1 的接地点速度、B2-2 的力臂、B2-3 的力矩都要求“以质心为原点”。B1-1 完成后状态位置即质心，力臂写成 `contact - state`；未完成时用 `contact - evaluation.cg`，只用于旧基线，不得进入生产路径。求解失败时 `contactRoad` 仍由最佳迭代的 `contactBody` 经完整四元数给出；分册 01 的降级策略只影响弹簧力与运动比，不影响接地点来源（A-03：法向力分支只看 `frame.converged`）。

**5.5 环境切换。** `simRetargetReference(sim, source)` 归 B2-1（见 4.1 第 8 步），职责为重算 `computeStatic`、校验 `geometryRevision`、清空 `cornerSeed`、保留 `state` 与 `contact`。本册的重新驻车用例只调用它，不再直接给 `SIM.reference` 赋值。

**5.6 冲突处理。** 本册与分册 01 同时修改 `simEvaluate` 返回字段时，以分册 01 的 `ForceEvaluation` 结构为准；`contact`、`contactNext`、`momentParts` 作为其子字段并入，不另开平行返回对象。UI 侧字段沿用 01 冻结的 `solverOk`、`solverState`、`rockerResidualMm`、`motionRatioState`，本册不另起名字（R-10）。

## 6. 本册回归测试建议

测试分三层，与分册 05 的分工是：本册给出用例、断言与阈值，分册 05 负责脚本骨架、npm scripts 与 CI 编排。

| 位置 | 内容 | 失败判据 |
| --- | --- | --- |
| `tools/audit/audit-friction-low-speed.mjs` | 4.1 节验收第 1～5 条（第 6～8 条进 test-dynamics `[10]`），输出 JSON | 修复前退出码 1，B2-1 后 0 |
| `tools/audit/audit-impulse-frame.mjs` | 4.2 节验收第 1～6 条 | 修复前退出码 1，B2-2 后 0 |
| `tools/audit/audit-contact-gap.mjs` | `--group contact`：4.3 节第 1～4 条；`--group full`：再加 4.4 节第 1～6 条 | 修复前退出码 1；B2-3 后 contact 组 0，B2-4 后 full 组 0 |
| grep 守卫（R-07） | `awk '/^function simEvaluate/,/^}/' src/js/05-body-dynamics.js \| grep -c 'simCross('` | 输出非 0 即失败 |
| `tools/test-dynamics.mjs` 新增 `[10] 接触状态机` | 低速停止、单步过零、重新驻车、容量边界、帧率一致（A-05）、遥测 100 次无副作用（O-13）、横摆预算（L_ext 只取 normal+impulse，O-14 裁决） | 任一 `check` 失败即非零退出 |
| `tools/test-dynamics.mjs` 新增 `[11] 脉冲坐标` | 横摆 0/90°、24 姿态扫描与复合姿态的力矩差（6880.45 基线） | 同上 |
| `tools/test-dynamics.mjs` 新增 `[12] 接地点唯一性` | 0/2/5/10° 四角一致性、力矩分解复算、`simApplyForceAt` 等价性 | 同上 |

审计脚本退出码约定：0 通过、1 断言失败、2 环境或配置错误（R-04 与 O-08），修复前为 1、修复后为 0；审计脚本不进入 `npm test`。执行顺序建议：先跑三个审计脚本确认失败基线，再跑 `npm test` 确认既有 52 项，最后合并新用例。新增用例必须使用 `simCreate(source, { settle: 0 })` 或显式记录 `sim.time` 起点，避免 settle 推进时钟造成“帧率一致”类断言误判：settle 会推进 `sim.time`，test-dynamics.mjs:224-232 的 2.4 s 即含 0.4 s settle。

浏览器层只补一条：低附着滑移切回水平后 `window.FSApp.getSnapshot().sim.mode` 应为 `'HOLD'`，且 `sim.holding` 为真；现有 test-dynamics-browser.mjs:195、213 的断言不改。由于 Node 测试不经过渲染层，本册不覆盖渲染回写，该耦合由分册 01 B1-4 处理。

## 7. 对阶段三轮胎与驱动的接口约束

1. 接地点只有一个。轮胎模型接收 `contactRoad` 与由该点算出的接地点速度 `v_t = v_CG + ω × (contactRoad - r_CG)`，不得自行用设计轮位重新构造接地点；05 中“用横摆角把设计轮位旋到平面”的写法在本册之后不再允许出现。
2. 力的落点统一。轮胎切向力以 `{ fx, fz, mz }` 路面系分量输出，经 `simApplyForceAt(sim, contactRoad, forceRoad, bucket)` 装配到合力与合力矩（R-07），力臂由该函数内部按 `roadPoint - cgWorld` 计算。禁止为新力另写叉乘，也禁止单独开一条“只加力不加力矩”的路径；新增力类别只增加 `bucket` 取值，不改函数签名。
3. HOLD 兜底保留。轮胎模型接入后，`|v_t| < SIM_ARREST_SPEED` 时仍由 HOLD 分支接管（静态摩擦按载荷比例分配），轮胎模型只负责 SLIP 分支的切向力；否则阶段三会重新引入 C-2 的单步过零。`sim.contact.mode` 仍是唯一的状态出口。
4. 驱动与制动力。车轮扭矩经轮胎转成接地点纵向力，反作用扭矩必须进入车体横摆与俯仰方程，并使用同一个接地点力臂；驱动/制动产生的切向力要计入 `demand`，否则 `HOLD → SLIP` 判定会漏掉油门与刹车。
5. 坐标系与单位。路面系 +x 向前、+y 向上、+z 向右，单位 N、m、s、rad；所有力臂以质心为原点。阶段三若引入局部路面高度，接触点的平面约束改为“落在路面曲面”，但 `contactRoad` 仍是唯一来源，`contact.y ≈ 0` 的断言改为“在路面内”。
6. 快照字段冻结。`getSnapshot().sim` 中的 `mode`、`usage`、`slipSpeed`、`dwell`、`changes`、`reason`、`lastChangeStep` 是 `sim.contact` 的只读投影（O-13），06 冻结的 `solverOk`、`solverState`、`rockerResidualMm`、`motionRatioState` 由分册 01 维护；两者在 0.4.0 前保持名称与量纲不变，轮胎模型的滑移率与滑移角作为新字段追加，不替换旧字段。
