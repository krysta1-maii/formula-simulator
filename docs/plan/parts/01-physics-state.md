# 分册 01：物理状态与求解器协议

| 项目 | 内容 |
| --- | --- |
| 适用版本 | 0.2.0（提交 fbb401d） |
| 所属批次 | B1（物理状态与求解器） |
| 交付文件 | `docs/plan/parts/01-physics-state.md` |
| 负责范围 | B 报告 4.2 质心积分、B 报告 4.1 求解器协议、A 报告第 2 项变量遮蔽 |
| 依据 | A 报告 `docs/code-review.md`、B 报告 `docs/code-review-k3.1-pro.md`、主册 `docs/施工计划.md`、分册 06 裁决 |
| 修订 | r2（2026-11-19）：按 `docs/plan/parts/06-review.md` 处理 R-01、R-02、R-07、R-10、A-01、A-03、A-04、O-10、O-11 |

## 1. 范围说明

本册处理三类相互耦合的缺陷：平动积分以车身设计参考点而非质心为状态变量；摇臂闭合求解不报告残差与可行性，异常运动比直接进入阻尼力链路；渲染层每帧把摇臂角写回求解种子，使浏览器结果依赖渲染时序。另含一处变量遮蔽清理及其文档同步。

本册不处理 B 报告 4.3 至 4.5、5.1 至 5.4，也不修改 `src/index.template.html`、`index.html`、`tools/build.mjs` 与既有浏览器测试。接地点统一（B2-3）与脉冲坐标系变换（B2-2）由分册 02 实施；本册只保证质心改造后力臂原点的语义正确，并在 B1-1 中把这两项列为联合门禁。

r2 按分册 06 裁决落实 R-01（脉冲力臂重定后重测）、R-02（种子不变量验收）、R-07/R-10（接口契约与遥测字段）、A-01（禁止静默回退）、A-03（拆分 `converged` 与 `ok`）、A-04（可执行验收）与 O-10/O-11（固定随机 seed、≤30 次为通过条件）。

约束沿用主册：单文件离线交付、零运行时依赖、不使用前端框架、Node >= 18；Node 测试继续以 `new Function` 装载全局脚本，因此新增函数必须挂在全局脚本作用域内，不得改为 ES 模块导出。

## 2. 现状与证据

下表各行均已在本册施工前用只读脚本复现；行号对应提交 fbb401d。

| 编号 | 现状 | 源码位置 | 观测值 | 结论 |
| --- | --- | --- | --- | --- |
| E1 | 平动方程以参考点为积分变量，力矩绕质心 | `05-body-dynamics.js:206-208`、`415-424`、`460-462` | 无外力、初始 `wx=1`，1 s 后参考点位移 0、质心漂移 287.655 mm、`wx` 恒 1 | 质心未被约束，非质心参考点遗漏切向与向心项 |
| E2 | 摇臂闭合失败静默返回角度 | `03-suspension.js:229-247`、`264` | 4.1 工况前角推杆目标 707.834 mm，可达区间下限 725.77 mm，牛顿解 -0.60000，残差 18.63 mm | 迭代耗尽后返回任意角度，无残差、无可行标志 |
| E3 | 角点收敛只含轮架三约束 | `03-suspension.js:218`、`05-body-dynamics.js:665` | 4.1 工况轮架残差 9.9e-11，`converged=true`，`solverOk=true` | 4 mm 级闭合残差对 UI 与测试完全不可见 |
| E4 | 高低行程探测只检查轮架 | `03-suspension.js:269-275` | 4.1 工况运动比 -6.92..6.98，符号翻转 | 探测解可能落在另一分支，运动比无物理意义 |
| E5 | 渲染层写回摇臂角作为物理种子 | `22-car-dynamics.js:959-964` → `03-suspension.js:264` | 每步回写后运动比 -7.38..7.56，阻尼峰值 45.97 kN（不回写 33.38 kN） | 浏览器结果依赖渲染时序，Node 测试不可见 |
| E6 | 默认参数下机构健康 | 同上 | 摇臂残差 0.0000 mm，轮架残差 9.9e-11 | 严格判据不应误伤默认工况 |
| E7 | 非主轴自由转动不守恒 | `05-body-dynamics.js:415-424` | 1 s 能量相对漂移 7.24e-4、世界角动量 5.43e-4 | 显式陀螺项精度上限，决定不变量阈值 |
| E8 | 变量遮蔽 | `05-body-dynamics.js:200-202` | `source` 回退指向积分状态 | 语义错误，当前靠 `reference.source` 恒存在而未触发 |

主册记录的 4.1 工况复核值为目标 707.83 mm、可达下限 709.40 mm、残差 4.02 mm、运动比 -4.20、阻尼峰值 30.7 kN，回写后 46.3 kN。本册复现的残差、运动比与阻尼峰值均在同一量级，差异来自统计窗口、settle 时长与样本时刻：E2 的 725.77 mm 下限对应本册样本的瞬态姿态，E5 的 33.38/45.97 kN 对应 1 s 全窗口峰值。三处差异不改变“目标短于可达下限、几何不可达、回写放大阻尼”的判定。

按 R-01 裁决，脉冲力臂应改为 `P - r_CG = R·(offset - cgBody)`，默认参数下俯仰脉冲力矩由 5890 N·m 重定为 6880.45 N·m（`xCG = -0.15975 m`、`F = 6200 N`）。E2、E4、E5 以及 B1-4 的 33.38/45.97 kN 均为旧 5890 N·m 激励下的测量值，只用于剥离渲染回写前后的对照；B2-2 合入后必须按新力臂重测，重测值另行登记，不得继续作为合入阈值。E1、E3、E6、E7、E8 不依赖脉冲力臂，保持有效。

## 3. 任务清单

| ID | 标题 | 主要文件 | 依赖 | 工作量（人日） |
| --- | --- | --- | --- | --- |
| B1-1 | 质心积分与状态定义 | `05-body-dynamics.js`、`00-core.js` | B0 完成 | 2.0 |
| B1-2 | 摇臂闭合可行性判定 | `03-suspension.js` | B0 完成 | 1.5 |
| B1-3 | 角点求解统一状态 | `03-suspension.js`、`00-core.js`、`05-body-dynamics.js` | B1-2 | 1.0 |
| B1-4 | 求解种子所有权与回写解除 | `03-suspension.js`、`22-car-dynamics.js` | B1-3 | 0.5 |
| B1-5 | 运动比解析化与连续性检查 | `03-suspension.js`、`05-body-dynamics.js` | B1-2 | 1.0 |
| B1-6 | 变量遮蔽与文档公式同步 | `05-body-dynamics.js`、`DESIGN.md` | B1-1 | 0.3 |

合计 6.3 人日，与主册一致。B1-2 与 B1-1 可并行；B1-3、B1-4、B1-5 依次串行，因为三者共用 `suspSolveCorner` 的返回结构与种子字段。

## 4. 工作项

### B1-1 质心积分与状态定义（2.0 人日）

**现状。** `simEquilibriumState`（`05-body-dynamics.js:108-125`）把参考点设为状态 `x/y/z`，`simEvaluate` 再用 `cg = r_ref + R(q)c` 求质心（`206-208`），而 `simIntegrate` 把 `F/m` 直接加到该参考点（`415`）。参考点不是质心时，正确关系为 `a_CG = a_ref + α×r + ω×(ω×r)`，现有实现两项皆无。E1 的 287.7 mm 漂移即该缺项的积分结果。

**目标。** 状态变量改为质心位置与质心速度，参考点由 `p = r_CG - R(q)c` 派生；平动方程保持 `m a_CG = ΣF`，转动方程继续绕质心。选择该方案而非补耦合项，是因为后续轮胎力、空气动力和动量检查都直接以质心为作用对象，补项方案会把同样的换算分散到每个力源。

状态定义如下表，单位与路面系一致（m、m/s、rad、rad/s）。

| 字段 | 语义 | 与旧实现的差异 |
| --- | --- | --- |
| `x, y, z` | 质心在路面系的位置 | 原为车身设计参考点 |
| `vx, vy, vz` | 质心在路面系的速度 | 原为参考点速度 |
| `qw..qz` | 车体到路面的姿态四元数 | 不变 |
| `wx, wy, wz` | 车体轴系角速度 | 不变 |
| `referencePoint` | 派生量 `p = r_CG - R(q)(x_CG, h_CG, z_CG)` | 新增，只读 |

参考点与质心的换算即 `p = r_CG - R(q)c` 与 `r_CG = p + R(q)c`，其中 `c = (x_CG, h_CG, z_CG) = reference.cgBody`，`R(q)` 为车体到路面的旋转。默认参数下 `c = (-0.160, 0.300, 0)`，因此平衡时 `state.y` 比 `reference.heave` 高约 0.30 m；`simBuildModel.heave` 必须回算参考点高度，否则遥测与既有断言会偏移该值。

**实施步骤。**

1. 在 `05-body-dynamics.js` 的 `simEquilibriumState` 之前新增两个纯函数，输入输出均为数组，避免额外分配：
   `simBodyPointFromCg(cg, q, cgBody)` 返回 `[cg[0]-arm[0], ...]`；`simCgFromBodyPoint(bodyPoint, q, cgBody)` 返回 `[p[0]+arm[0], ...]`，其中 `arm = simQuatRotate(q, cgBody)`。
2. `simEquilibriumState`（`108-125`）：先构造平衡姿态下的参考点 `p0 = [0, reference.heave, 0]`，再用 `simCgFromBodyPoint` 写入 `x/y/z`；`vx/vy/vz` 仍为 0。函数签名不变。
3. `simEvaluate`（`199-403`）：`cg` 直接取 `bodyState.x/y/z`，删除 `205-208` 的合成；由 `simBodyPointFromCg` 计算 `refPos`。`bodyPos`（`225`）改为 `refPos`，因为 `suspSolveCorner` 的 `bodyPos.y` 表示参考点高度，见 `03-suspension.js:172` 的 `cb = -bodyPos.y`。轮心臂改为相对质心：`armRelCG = [wheel.x - cgBody.x, -cgBody.y, wheel.z - cgBody.z]`，`cornerY = cg.y + (R(q)armRelCG).y`（`231-234`）。该式与旧式 `refPos.y + (R(q)arm).y` 恒等，因此 `travelMm`、弹簧压缩与既有行程断言的数值不变，改造只影响积分变量与速度项。接地点平面投影（`267-268`）改用 `refPos.x/z`。
4. `simIntegrate`（`407-512`）：`415` 的 `accel = force/mass` 语义变为质心加速度，公式不变；`426-443` 的 holding 清零仍作用于质心平面速度与横摆角速度；`480-491` 的边界常量 `SIM_BOUND_X/Z`（`29-30`）改为质心平面边界并在注释中说明；`493-505` 的非有限恢复调用已更新的 `simEquilibriumState`。
5. `simCreate`（`127-151`）与 `simReset`（`153-172`）签名不变，但需在 sim 对象新增 `cornerRatio: [null,null,null,null]` 与 `flags.solverDegraded/solverFailed`（供 B1-5 使用），并在 reset 时清零。
6. `simBuildModel`（`541-701`）：新增 `refPos` 派生；`bodyPos`（`639`）输出参考点，`heave`（`644`）输出 `refPos.y`，`cgWorld`（`694`）输出质心，`bodyVelocity`（`658`）明确为质心速度并在字段注释中标注。`projection`（`581-583`、`695`）继续用质心投影，无需改动。
7. `00-core.js` 的 `computeStatic`（`249-562`）保持参考点语义：`evaluateStatic` 的 `bodyPos`（`382`）仍是 `{x:0,y:h,z:0}`，静态平衡方程（`378-425`）无需改写；仅需在返回对象（`471-561`）补充 `referencePoint: { x: 0, y: heave, z: 0 }` 与 `cgBody`（已有 `558`）的注释，供 `simEquilibriumState` 与文档引用。
8. 迁移直接比较 `state.y` 与 `reference.heave` 的断言：`05-body-dynamics.js:741`、`744`、`777-779`、`789-791`，`tools/test-dynamics.mjs:205-206`、`210-211`、`223`。统一改用 `simBuildModel(sim).heave` 或新增 `simReferencePoint(sim)`。

**验收。**

```bash
node tools/test-physics-invariants.mjs --group cg   # B0 就绪后的正式入口
node tools/audit/audit-free-body.mjs                # B0 未就绪时的临时入口，输出 JSON
npm test
```

退出码约定与分册 05 一致：0 通过，1 断言失败，2 环境或装载错误。`--group cg` 的用例固定为“无外力、初始 `wx=1 rad/s`、禁用悬挂与重力”，断言 `|cg(1s)-cg(0)| < 1e-9`、`|ref(1s)-ref(0)|` 与 `0.287655 m` 相差 < 1e-4、`|wx(1s)-1| < 1e-12`；三条断言在 fbb401d 上第 1、2 条失败（质心实测 287.655 mm，参考点位移实测 0），第 3 条通过；B1-1 后全部通过。

平衡态另需断言：`simBuildModel(levelSim).heave === reference.heave`（误差 < 1e-12）；`bodyPos.y === heave`；`cgWorld.y - heave === (R(q)cgBody).y`。90° 横摆脉冲的质心速度增量与解析值 `F·Δt/m` 相符（误差 < 1e-6 m/s）；伪侧倾力矩归零属于 B2-2 的验收，与本册联合执行。

**风险与回滚。** 状态语义变化影响全部下游断言，误判风险集中在 `heave` 与 `bodyPos` 的 0.30 m 偏差。控制手段是把上述字段断言纳入 `npm test`，并保留一组旧断言作为“参考点 vs 质心差”的对照。若合并后出现大范围数值漂移，先回退 B1-1 提交，B1-2 至 B1-5 不依赖状态语义，可独立保留。

### B1-2 摇臂闭合可行性判定（1.5 人日）

**现状。** `suspRockerAngle`（`03-suspension.js:229-247`）用 24 次牛顿迭代与中心差分求导，失败时直接返回最后一次角度，不报告残差。目标长度取 `suspDesign(corner).pushLen0`（`126`），种子取 `corner.angle`（`232`）。E2 表明在 4.1 工况下该函数返回 -0.60000，而可达区间下限高于目标 17.9 mm。

**目标。** 推杆—摇臂闭合存在闭式解：摇臂末端在以 `pivot` 为圆心、`ρ = |pushArm_xy|` 为半径的平面上做圆周运动，推杆长度约束等价于该圆与“以推杆点为心、半径 `D = sqrt(L² - uz²)`”的圆的交点。改为闭式解后可同时得到两个分支、残差与可行性。本册已在设计点用该公式复算：四角角度与现行牛顿解一致到 1e-9，闭合残差为 0，两个分支分别为 -0.1006/-1.1437（前角）与 0.1003/1.2342（后角），说明双支枚举在默认几何下可行。

**实施步骤。**

1. 重写函数签名与返回结构：
   ```js
   suspRockerAngle(corner, pushPoint, seed)
     -> { angle, residual, feasible, branch }
   ```
   `branch ∈ {+1,-1}` 表示 `base + psi` 与 `base - psi` 两支；两解重合（|cosPsi| 接近 1）时返回 0；不可达时返回最近可达角并置 `feasible=false`。
2. 计算步骤：`rho = hypot(arm.x, arm.y)`，`phi = atan2(arm.y, arm.x)`，`ux/uy/uz` 为推杆点相对 `pivot + (0,0,arm.z)` 的偏移；`a = hypot(ux, uy)`；`cosPsi = (rho² + a² - (L² - uz²)) / (2 rho a)`。`L² - uz² < 0` 或 `|cosPsi| > 1` 即不可达。可解时 `psi = acos(clamp(cosPsi,-1,1))`，`base = atan2(uy, ux) - phi`。
3. 分支选择：种子为有限数时取 `|angle - seed|` 较小的候选；种子缺失时取离 `rocker.baseAngle` 较近者。选中后以 `suspRockerPoint` 与 `pushPoint` 的三维距离重算残差，返回精确值，不使用三角函数近似。
4. 不可达时按 `cosPsi > 1` 取 `psi = 0`、`cosPsi < -1` 取 `psi = π` 的切点角，返回 `feasible=false`、`branch=0`，并保留 `residual = |实际距离 - L|`；调用方可据此判定 4 mm 级缺口。保留旧实现为 `suspRockerAngleNewton` 仅供对照测试，不进入生产路径。
5. 新增 `suspRockerResidual(corner, pushPoint, angle)` 纯函数，供测试与遥测复用，避免两处各写一份距离计算。

**验收。** 对默认参数、±25 mm 行程的 4 个角点，闭式解与旧牛顿解的角度差 < 1e-9，残差 < 1e-12；对 `mulberry32(20261119)` 生成的 1000 组随机姿态与行程（固定 seed、固定样本数；俯仰与侧倾在 ±10° 内均匀采样，行程在 ±25 mm 内均匀采样），`feasible=true` 时 `residual < 1e-9`，`feasible=false` 时残差 > 0 且函数不抛异常、不返回非有限值；4.1 工况必须返回 `feasible=false` 且 `residual > 1e-3`。分支连续性：以 1e-4 rad 步长扫描推杆点位置，`branch` 不得在同一可行区间内跳变。

**风险与回滚。** 主要风险是分支选错导致摇臂视觉翻转或运动比符号错误。控制手段是双分支枚举、与旧解对照、以及 B1-5 的连续性检查。若闭式解在极端姿态出现数值退化（`a` 接近 0），退回 `suspRockerAngleNewton` 并把该情况记为 `feasible=false`，不静默返回。

### B1-3 角点求解统一状态（1.0 人日）

**现状。** `suspSolveCorner`（`03-suspension.js:257-297`）返回 `converged`（仅轮架）、`error`（轮架残差）、`rockerAngle`、`motionRatio` 等扁平字段。`05-body-dynamics.js:243-246` 与 `00-core.js:392-394` 各自按字段名消费，缺少统一判据。高低探测（`269-275`）只用轮架 `converged`。

**目标。** 一次求解同时给出轮架、摇臂、运动比三部分状态；高低探测与主解同分支；`converged` 保持轮架语义，新增 `ok` 作为综合判据（A-03）。

**实施步骤。**

1. 返回结构改为分层对象，并保留 `error`、`converged`、`motionRatio`、`coilLength`、`wheelPos` 等顶层字段以兼容既有测试：
   ```js
   {
     thL, thU, spin, wheelPos, wheelQuat, contact, pushPoint,
     frame: { converged, error },
     rocker: { angle, residual, feasible, branch },
     coilLength,
     motionRatio, motionRatioState,   // 'ok' | 'unavailable'
     ok,                              // frame.converged && rocker.feasible && motionRatioState === 'ok'
     seed: { thL, thU, spin, rockerAngle }
   }
   ```
2. 摇臂求解（替换 `264`）使用入参种子而非 `corner.angle`：
   `const rocker = suspRockerAngle(corner, state.P, seed && Number.isFinite(seed.rockerAngle) ? seed.rockerAngle : corner.rocker.baseAngle)`。`seed.rockerAngle` 写回返回对象，物理层据此维护种子链。
3. 高低探测（`268-275`）以主解种子分别求解 high/low，要求三点 `frame.converged` 与 `rocker.feasible` 同时成立；分支一致性判据为 `high.rocker.branch === rocker.branch && low.rocker.branch === rocker.branch`，任一方 `branch === 0` 时改用角度差 < 1e-6 判定。线圈长度统一用 `suspCoilLength(corner, solution.rocker.angle)`，不再用主解角度套探测点。
4. 仅在三点全部可行时计算 `motionRatio = (lHigh - lLow) / (2 * epsilon)`；否则置 `null` 与 `motionRatioState = 'unavailable'`，不得用“轮架收敛”代替。
5. 语义拆分（A-03）：顶层 `converged` 只表示轮架三约束收敛，含义与现状一致，分册 02 的法向力主解/回退分支只读 `frame.converged`；`ok = frame.converged && rocker.feasible && motionRatioState === 'ok'` 表示综合可用。`withRatio=false` 的调试调用不消费 `ok`，只读 `frame` 与 `rocker`。生产调用方（`05-body-dynamics.js:243`、`00-core.js:345`、`392`）按用途选择：力计算分支用 `frame.converged`，遥测与门禁用 `ok`。
6. `00-core.js` 的 `staticSeeds`（`377`）在 `evaluateStatic`（`392-394`）中保存完整种子（含 `rockerAngle`），否则静态平衡每次从 `baseAngle` 重启，闭式解可能交替选支。
7. 遥测字段与 UI 契约（R-10）：`simBuildModel`（`05-body-dynamics.js:541-701`）新增 `rockerResidualMm`（四角数值，`rocker.residual * 1000`，单位 mm；`rocker.residual` 本身用 m）、`rockerFeasible`（布尔数组）、`motionRatioState`（字符串数组）、`solverOk`（`665` 改为 `corners.every(c => c.ok)`）、`solverState`（`'ok' | 'degraded' | 'failed'`，按四角 `ok`、降级计数与连续失败子步派生）；`40-app.js` 的 `getSnapshot`（`260-335`）透传上述字段与 `solved[i].rocker`。DOM 展示由分册 04 的 B4-4 落地：`30-ui.js` 的 `refreshChecks`（`563-649`）在 `rows`（`590-631`）中增加一行“摇臂闭合残差”，判据为四角 `feasible` 且最大残差 < 0.1 mm，值文本显示 `max` 残差与失败角数；`refreshTelemetry`（`676` 起）在四角行显示残差。本册只冻结字段与判据，DOM 改动随 B4-4 合并。

**验收。** 4.1 工况下 `frame.converged=true` 而 `ok=false`（该分裂是本项修复的核心观测）、`rocker.feasible=false`、`rocker.residual` 在 3.5–20 mm，且 `simBuildModel.rockerResidualMm` 的最大值与之相符、`solverState` 不为 `'ok'`；默认参数下 `frame.converged=ok=true`、`rocker.residual < 1e-9`、`motionRatio` 与旧实现一致（误差 < 1e-9）；500 步默认脉冲（`DEFAULTS`，settle 1.2 s，俯仰脉冲）中高低探测分支一致率 100%；`npm test` 的机构闭合段（`tools/test-dynamics.mjs:101-116`）全绿。

**风险与回滚。** `ok` 变严格而 `converged` 不变，随机包线（`tools/test-dynamics.mjs:244-280`）可能出现 `ok=false`，须把该测试的断言从“全部收敛”改为“有限、非负、且降级有标记”；`frame.converged` 的既有语义不得改动，否则分册 02 的法向力分支会跟着变。若分层结构导致调用方遗漏，保留一段兼容适配（顶层字段照旧填充），逐个调用点迁移后再删除。

### B1-4 求解种子所有权与回写解除（0.5 人日）

**现状。** `22-car-dynamics.js:959-964` 在动态路径中把 `solved.rockerAngle` 写入 `corner.angle`，`03-suspension.js:264` 又把它当作牛顿种子。渲染层因此参与了物理求解初值的决定。E5 显示回写使运动比范围从 -6.92..6.98 扩到 -7.38..7.56，阻尼峰值从 33.38 kN 升到 45.97 kN；33.38 kN 为不回写、45.97 kN 为回写，二者是剥离渲染回写前后的对照量，用于证明耦合存在；脉冲力臂按 R-01 重定为 6880.45 N·m 后须重测。

**目标。** `cornerSeed` 归物理层独占，`corner.angle` 降级为渲染只读输出；渲染层不再调用物理求解器重新求角。

**实施步骤。**

1. `03-suspension.js:264` 改为只读入参种子（B1-3 已改），删除对 `corner.angle` 的引用。全文件检索确认没有第二处。
2. `22-car-dynamics.js:944-965` 改写：动态路径取 `solvedCorner.rocker.angle` 与 `solvedCorner.rocker.feasible`，只写 `corner.angle` 与 `corner.rockerSolveFailed`；静态路径（`model.solved` 为空）保留 `solveRockerAngle`（`903-942`）作为显示兜底，其结果不回流物理。
3. `corner.angle` 与 `corner.rockerSolveFailed` 在 `03-suspension.js:75-79` 的初始化注释中标注 render-only；物理层禁止读取，测试用 `grep` 断言。
4. `22-car-dynamics.js:1084` 的 `rockerSolveOk` 改为基于物理结果：`CAR.corners.every((c) => !c.rockerSolveFailed)`，其值在 B1-4 第 2 步已由 `feasible` 驱动。
5. `40-app.js:395` 的 `getSceneProbe().rockerAngles` 保持不变，它读取的仍是同名字段，但来源已变为物理快照。

**验收。** 主判据是“外部改写 `corner.angle` 不影响物理状态”的不变量用例。做法：用同一 `source`、同一 `settle` 建两个 sim，施加同一脉冲；A 在每步 `simStep` 前把四角 `corner.angle` 设为 `corner.rocker.baseAngle`，B 设为 `corner.rocker.baseAngle + 1.2`；逐步比较完整状态（`x/y/z`、`vx/vy/vz`、`qw/qx/qy/qz`、`wx/wy/wz`）、`sim.time` 与 `sim.flags`（`holding`、`sliding`、`finite`、`boundary`、`recovered`），要求逐位相同（或差 ≤1e-12）。

该用例在 fbb401d 上必须失败：本册实测首个子步即出现差异，300 步内默认俯仰最大差 0.61 m，4.1 工况最大差 1.28 m；B1-4 后必须通过。用例覆盖默认参数与 4.1 参数两组，脉冲取 `pitch` 与 `roll`，两组均 settle 1.2 s、步数固定 300。静态守卫：`grep -n "corner.angle" src/js/03-suspension.js` 无输出，只作提交前检查，不作为主判据。浏览器侧只断言 `getSceneProbe().rockerAngles[i]` 与遥测 `solved[i].rocker.angle` 一致，不再用“回写/不回写两组运行”作为主判据。

**风险与回滚。** 解除回写后，静态重建路径仍由渲染层自解摇臂角，与动态路径存在极小的视觉差异；该差异只影响首帧，可接受。若出现画面机构抖动，回退到“渲染层写显示副本 `corner.displayAngle`”的命名隔离方案，物理种子保持不变。

### B1-5 运动比解析化与连续性检查（1.0 人日）

**现状。** 运动比由两次额外求解（`03-suspension.js:269-275`）按 `±1e-3 m` 差分得到，每角共 3 次 Newton，实测每子步 88 次 `suspEval`（主册性能表）。`05-body-dynamics.js:245-262` 只在 `solved.converged` 为假时才降级（B1-3 后该字段为 `solved.frame.converged`），对有限但符号错误的比值没有防护。

**目标。** 用隐函数导数给出运动比，把每子步 `suspEval` 降到 30 次以内；对非有限、符号跳变、超范围三类异常建立显式降级。

**实施步骤。**

1. 解析链：轮架约束 `f(q; y) = 0`，`q = (thL, thU, spin)`，对参考点高度 `y` 求隐函数导数 `dq/dy = -J_f^{-1} ∂f/∂y`；`∂f/∂y` 由 `y + 1e-6` 的一次 `suspEval` 与主解末次残差差分得到，或直接复用上一子步的值（变化缓慢）。推杆约束 `g(θ, P(q,y)) = 0` 给出 `dθ/dy`，线圈长度 `L(θ)` 给出 `dL/dy`。运动比取 `motionRatio = dL/dy`，与 `03-suspension.js:274` 的 `(lHigh - lLow) / (2 * epsilon)` 同号；`05-body-dynamics.js:248` 的 `dLdDelta = -instantRatio` 换算保持不变。计数上，省掉高低两次求解后每角约 7 次 `suspEval`，四角合计约 28 次；若 `∂f/∂y` 走额外求值而为 32 次，用缓存压到 30 次以内。
2. 在 `03-suspension.js` 顶部新增 `let SUSP_EVAL_COUNT = 0`，`suspEval` 首行自增，并提供 `suspEvalReset()/suspEvalCount()`；计数开销为一次加法，生产路径保留。
3. 连续性检查放在 `05-body-dynamics.js:241-262`：记录 `sim.cornerRatio[i]`。比值有效条件为有限、`0.05 < ratio < 2.0`、与设计值绝对值之比在 [0.3, 3]（`row.dLdDelta` 为负值，比较取 `Math.abs`）、与上一步比值相对差 < 20%。失败时用上一有效值，首次失败用 `Math.abs(row.dLdDelta)`，并置 `sim.flags.solverDegraded = true` 与 `cornerRatioFallback[i] = true`；连续 10 个子步失败置 `solverFailed = true`。
4. 备选路径（O-11）：若解析导数在预算内不稳定，保留高低探测但复用主解的 Jacobian 缓存。生产路径的合入条件仍是 ≤30 次/子步；30–60 只允许作为独立实验分支的临时降级，须单列基线、记录偏差与回退计划，不得随主路径合入，也不得修改主册与分册 05 的 A1 判据。
5. `sim.flags.solverDegraded` 与 `solverFailed` 只作内部标志，对外统一经 `solverState` 暴露（B1-3 第 7 步，取值 `'ok'|'degraded'|'failed'`）；残差与运动比状态字段按同一契约输出，两处不得各起一套名字。

**验收。** 解析运动比与中心差分（步长 1e-3 m）在默认参数、±25 mm 行程 5 个固定采样点（-25/-15/0/15/25 mm）上的相对误差 < 1e-3；`DEFAULTS`、settle 1.2 s、俯仰脉冲、500 步内运动比无符号跳变、无 NaN（固定用例，不取随机）；4.1 工况进入降级路径且力保持有限；`suspEvalCount()` 在单个 2 ms 物理子步 ≤30 次为**通过条件**，`simBuildModel` 单独统计且 ≤30 次、耗时 ≤0.05 ms；若实测落在 30–60，只能按第 4 步的临时降级登记，不判定通过；Node 24 下单子步耗时 ≤ 0.05 ms（10^4 步基准）。确定性：同一输入两次运行的最终状态逐位相同。

**风险与回滚。** 分支切换处解析导数不连续，可能产生短时尖峰；由连续性检查兜底并计数。回滚方式是把 `SIM_ANALYTIC_RATIO` 常量置为 false，回到高低探测路径，接口与降级标志不变。

### B1-6 变量遮蔽与文档公式同步（0.3 人日）

**现状。** `05-body-dynamics.js:200` 的 `const state = sim.state` 遮蔽全局 setup 对象，`202` 的 `reference.source || state` 回退因此指向积分状态。`DESIGN.md:565` 明确写着“平动方程以车体参考点为积分变量”，与 B1-1 的目标冲突。

**目标。** 消除遮蔽回退歧义；让 DESIGN 20.2 与新的状态定义、方程、力臂原点一致。

**实施步骤。**

1. `05-body-dynamics.js:200` 改为 `const bodyState = sim.state`，函数体内 `state.` 全部替换为 `bodyState.`（涉及 `204-225`、`234`、`267-268`、`306`、`324-327`、`337`、`351-355`、`364`，以及本函数其余引用，改后以 grep 核对）；`202` 不得回退 `DEFAULTS`（A-01）：`simEvaluate` 要求 `reference.source` 存在，缺失时抛出消息含 `reference.source` 的错误（如 `throw new Error('simEvaluate: reference.source is required')`），或由调用方显式传入参数快照；实现取其一，不得静默取默认参数，因为 `friction` 等字段的默认值与用户设置可相差 7 倍。`simCreate`、`simReset`、`computeStatic` 的调用链保证 `source` 恒存在。
2. `simIntegrate`（`407`）存在同类局部变量，一并改名 `bodyState`，涉及 `413`、`417`、`432-437`、`445-462`、`475-497`，避免下一处回退再次被遮蔽。
3. `DESIGN.md` 20.2（`549-578`）改写：状态改为质心位置 `r_CG` 与质心速度 `v_CG`；补公式 `p = r_CG - R(q)c`；平动改为 `m v̇_CG = m g + ΣN_i e_y + Σf_i + F_impulse`；转动保留 `I ω̇ + ω×(Iω) = Σ(r_i - r_CG)×F_i`，并注明脉冲作用点同样以质心为力臂原点。删除“平动方程以车体参考点为积分变量”一句。
4. `DESIGN.md` 20.3（`585`）补一句：`δ_i` 由参考点位姿计算，力作用于接地点，力臂相对质心；20.7（`647-648`）补充新增的不变量测试与解析轨迹结果。

**验收。** 遮蔽用例：`node tools/test-physics-invariants.mjs --group shadow`（或 `node tools/audit/audit-shadowing.mjs`）断言：删除 `reference.source` 后调用 `simEvaluate` 抛错，且 `error.message` 含 `reference.source`；该用例在 fbb401d 上失败（回退到积分状态、`friction` 取默认值），B1-6 后通过。另断言 `grep -n "const state = sim.state" src/js/05-body-dynamics.js` 无输出；`node --check`（构建脚本 `tools/build.mjs` 已含）通过；`npm test` 全绿；DESIGN 20.2 中不再出现“以车体参考点为积分变量”，且公式符号与 `simEquilibriumState`、`simEvaluate` 的变量名一致（`cgBody`、`cg`、`refPos`）。

**风险与回滚。** 文档改动无运行时风险；风险在于再次漂移。按主册原则，20.2 的每条物理断言在分册 05 的回归矩阵中登记对应测试编号。

## 5. 本册回归测试建议

各任务节的验收统一由下文脚本承载。命令约定如下，其中 `--group` 取值与任务 ID 对应；脚本由分册 05 的 B0-1 审计框架托管，若 B0 尚未就绪，可先用内联脚本执行同等断言。

```bash
node tools/test-physics-invariants.mjs --group cg        # B1-1
node tools/test-physics-invariants.mjs --group rocker    # B1-2
node tools/test-physics-invariants.mjs --group corner    # B1-3
node tools/test-physics-invariants.mjs --group seed      # B1-4
node tools/test-physics-invariants.mjs --group ratio     # B1-5
node tools/test-physics-invariants.mjs --group shadow    # B1-6
npm test                                                  # 全量回归
```

新增 `tools/test-physics-invariants.mjs`，沿用 `new Function` 装载方式，包含以下断言组；涉及缺陷的组在修复前必须失败、修复后转绿，其余（动量能量、静态/动态一致）作为回归监控。B1 不变量测试固定使用 `mulberry32(20261119)` 并写死样本数；其他测试文件可固定各自的常量，但必须写在用例旁；所有随机测试不接受运行时 seed（O-10）。

1. 自由刚体解析轨迹：主轴侧倾 1 rad/s，`|Δcg| < 1e-9`，参考点位移与 `0.287655 m` 相差 < 1e-4，`|Δwx| < 1e-12`。
2. 动量与能量：主轴工况相对漂移 < 1e-12；非主轴工况 < 2e-3（当前实测 7.24e-4，作为回归监控而非守恒证明）。
3. 90° 横摆脉冲：质心速度增量与 `F·Δt/m` 相差 < 1e-6 m/s；与 B2-2 联合断言车体系侧倾力矩 < 1e-6 N·m（力臂按 R-01 重定为 6880.45 N·m 后重测）。
4. 摇臂可达性：4.1 工况 `feasible=false` 且残差 > 1e-3；默认参数 ±25 mm 行程残差 < 1e-12。
5. 分支一致性：高低探测与主解 `branch` 全等；退化时角度差 < 1e-6。
6. 种子独立性（R-02）：同一参数建两个 sim，A 每步把 `corner.angle` 设为 `baseAngle`、B 设为 `baseAngle + 1.2`，比较完整 state、`sim.time` 与 `sim.flags`，要求逐位相同；fbb401d 上首个子步即失败（默认俯仰 300 步最大差 0.61 m），B1-4 后通过。
7. 运动比连续性：默认参数、settle 1.2 s、俯仰脉冲 500 步无符号跳变；解析值与差分值相对误差 < 1e-3。
8. 性能计数：单子步 `suspEval` ≤ 30 为通过条件，`simBuildModel` 单独记录且 ≤30；30–60 只按临时降级登记，不判通过（O-11）。
9. 静态/动态一致：level 工况 `computeStatic` 与 `simBuildModel` 的四角载荷差 < 1e-6 N。
10. 旧断言迁移清单：`05-body-dynamics.js:741/744/777-779/789-791`、`tools/test-dynamics.mjs:205-206/210-211/223` 改为参考点派生量；迁移后保留一条“旧写法在新语义下会失败”的反向用例，防止回退。

浏览器侧不新增用例：`tools/test-dynamics-browser.mjs:184` 的 `scene.solverOk` 保留为辅助判据，主断言改为 `getSceneProbe().rockerAngles[i]` 与遥测 `solved[i].rocker.angle` 一致。本册不运行 `npm run test:browser`（端口占用）。

## 6. 与阶段三的接口约束

### 6.1 接口契约 v1（冻结，后续分册只引用不重定义）

**状态 `sim.state`**：`x,y,z` 为质心位置（m），`vx,vy,vz` 为质心速度（m/s），`qw..qz` 为车体到路面四元数，`wx,wy,wz` 为体轴角速度（`wx` 侧倾、`wy` 横摆、`wz` 俯仰，rad/s），`referencePoint` 为派生参考点 `p = r_CG - R(q)c`（只读，m）。阶段三不得把 `x/y/z` 当作参考点。

**角点求解 `suspSolveCorner`**（B1-3 只冻结 `frame/rocker/motionRatio/seed` 四组）：

| 字段 | 语义 | 单位/取值 |
| --- | --- | --- |
| `frame.converged` | 轮架三约束收敛，仅此含义 | bool |
| `frame.error` | 轮架残差 `max(abs(f))` | m |
| `rocker.angle` / `.residual` | 摇臂角 / 推杆闭合残差 | rad / m |
| `rocker.feasible` / `.branch` | 几何可达 / 分支 | bool / +1、-1、0 |
| `motionRatio` / `motionRatioState` | 运动比 / 可用性 | 无量纲 / `'ok'`、`'unavailable'` |
| `seed` | `{ thL, thU, spin, rockerAngle }`，下一子步种子 | rad |
| `ok` | `frame.converged && rocker.feasible && motionRatioState === 'ok'` | bool |

`contactBody/contactRoad/wheelPosBody/wheelPosRoad` 由 B2-3 追加，不属于 B1-3；`frame.converged` 与 `ok` 不得合并（A-03）。

**力评估 `simEvaluate`**：

| 字段 | 语义 | 单位 |
| --- | --- | --- |
| `force[3]` | 路面系合力 | N |
| `moment[3]` | 绕质心力矩 | N·m |
| `momentParts{normal,friction,impulse}` | 分项力矩，三项和等于 `moment`（≤1e-9） | N·m |
| `corners[i].contact` / `.contactVelocity` | 路面系接地点（取自 `contactRoad`）/ 接地点速度 | m / m/s |
| `corners[i].normal` / `.friction` | 法向力 / 摩擦力 | N |
| `cg` / `flags` | 质心位置 / `{holding,sliding,finite,boundary,recovered}` | m / bool |

**力装配 `simApplyForceAt`**（实现归 B2-4，本册只冻结签名与调用方）：

```js
simApplyForceAt(sim, roadPoint, forceRoad, bucket)
// roadPoint [x,y,z] 路面系，m；forceRoad [Fx,Fy,Fz] 路面系，N
// bucket 'normal' | 'friction' | 'impulse'
// force += forceRoad; momentParts[bucket] += (roadPoint - cgWorld) × forceRoad
```

调用方为 B2-1 摩擦、B2-2 脉冲、B2-4 法向；`simEvaluate` 内不得出现裸 `simCross(arm, force)`（分册 05 的 grep 守卫），三条路径的 `momentParts` 之和等于 `moment`。

**遥测字段**（`simBuildModel` 与 `getSnapshot`）：

| 字段 | 定义 | 单位 |
| --- | --- | --- |
| `solverOk` | `corners.every(c => c.ok)` | bool |
| `solverState` | `'ok'` / `'degraded'` / `'failed'` | 字符串 |
| `rockerResidualMm` | 四角 `rocker.residual * 1000`；`rocker.residual` 用 m | mm |
| `motionRatioState` | 四角数组 | 字符串[4] |
| `bodyPos` / `heave` / `cgWorld` / `bodyVelocity` | 参考点位置 / 参考点 y / 质心位置 / 质心速度 | m / m / m / m/s |

UI 首行判据为 `sim.finite && !sim.recovered && solverOk`；残差 <0.1 mm 是独立的“摇臂闭合残差”行，不并入 `solverOk`；10 行检查表 id 由 B3-3 与 B4-4 冻结。

### 6.2 阶段三约束

1. 状态契约：`sim.state` 的 `x/y/z` 为质心位置，`vx/vy/vz` 为质心速度；参考点只以派生量出现（`simBodyPointFromCg`）。阶段三的轮胎模型不得假设 `x/y/z` 是参考点。
2. 力接口：`simApplyForceAt(sim, roadPoint, forceRoad, bucket)`（见 6.1），内部以 `roadPoint - cgWorld` 计算力矩并累加到对应 `momentParts`；轮胎力、空气动力与驱动扭矩一律经该接口施加，禁止各自叉乘。
3. 接地点与接触速度：`simEvaluate` 需输出每角 `contact` 与 `contactVelocity`（当前 `05-body-dynamics.js:351-356` 局部计算后丢弃），B2-3 完成后作为唯一来源供轮胎滑移率使用。
4. 角点状态：`frame / rocker / motionRatio / seed` 四组与 `motionRatioState` 冻结；阶段三新增字段只增不改，`frame.converged` 只表示轮架三约束，综合可用性一律看 `ok`（A-03）。
5. 失败语义：`feasible=false` 或 `motionRatioState='unavailable'` 时，轮胎模型不得使用该角运动比，必须走显式降级并计入遥测；`solverState` 取 `'degraded'` 或 `'failed'` 时参与阶段三的力预算检查。
6. 确定性：求解不得读取渲染层字段；同参数、同步长下最终状态逐位相同，`suspEvalCount()` 可作为性能回归指标。
7. 性能预算：单子步 ≤ 0.05 ms、`suspEval` ≤ 30 次；阶段三接入轮胎力后重新标定，不在本册承诺范围内。
