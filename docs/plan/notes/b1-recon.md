# B1 施工勘察（b1-recon）

| 项目 | 内容 |
| --- | --- |
| 分支 | `feat/plan-execution` |
| HEAD | `fbb401d`（0.2.0） |
| 依据 | 分册 01（r2）、分册 02 §5、分册 06 裁决、主册 B1 批次 |
| 性质 | 只读勘察；本文件只登记改动点，不写 `src/` |
| 范围 | B1-1 至 B1-6；B1 解冻前不得合入 |

本文件把分册 01 的施工步骤落到当前提交的精确行号，供 B1 各提交按序执行。行号以 `fbb401d` 为准；若 B0 的审计脚本提交改动了 `tools/`，源码行号不变，`tools/` 行号需重新核对。

## 1. 依赖与合入顺序

```
B1-1 质心状态 ──┬── B1-6 遮蔽与文档（随 B1-1）
B1-2 摇臂闭合 ── B1-3 角点结构 ── B1-4 种子所有权 ── B1-5 运动比解析化
```

B1-1 与 B1-2 可并行；B1-3 依赖 B1-2 的返回结构；B1-4 依赖 B1-3 的 seed 字段；B1-5 依赖 B1-2 的闭式解（主册口径），其降级字段与 B1-3 的 `motionRatioState` 对齐，合入顺序放在 B1-4 之后。分册 02 的 B2-3 在 B1-3 的结构上追加 `contactBody/contactRoad/wheelPosRoad`，B2-2 依赖 B1-1 的质心状态；因此 B1 必须先于 B2 合入。

## 2. 精确改动总表

| ID | 文件:行号 | 函数 | 当前实现 | 目标实现 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| B1-1a | `05-body-dynamics.js:108-125` | `simEquilibriumState` | 参考点写入 `x/y/z` | 由 `p0=[0,reference.heave,0]` 经 `simCgFromBodyPoint` 写质心 | — |
| B1-1b | `05-body-dynamics.js:127-151` | `simCreate` | `cornerSeed` 等 | 新增 `cornerRatio`、`flags.solverDegraded`、`flags.solverFailed` | — |
| B1-1c | `05-body-dynamics.js:153-172` | `simReset` | 重置 `cornerSeed` | 同步重置 `cornerRatio` 与两个 flags | B1-1b |
| B1-1d | `05-body-dynamics.js:199-403` | `simEvaluate` | `cg = state + R·cgBody`；`bodyPos=state`；`contactX/Z` 用参考点 | `cg=state`；`refPos` 派生；`bodyPos=refPos`；轮心臂相对质心 | — |
| B1-1e | `05-body-dynamics.js:407-512` | `simIntegrate` | `F/m` 加到参考点 | 语义改为质心加速度；边界注释改为质心边界 | B1-1d |
| B1-1f | `05-body-dynamics.js:541-701` | `simBuildModel` | `bodyPos/heave=state` | `bodyPos/heave=refPos`；`cgWorld=state`；`bodyVelocity` 标注质心速度 | B1-1d |
| B1-1g | `00-core.js:471-561` | `computeStatic` 返回 | 有 `heave/pitch/roll`、`cgBody` | 追加 `referencePoint`；静态方程不改 | — |
| B1-2a | `03-suspension.js:229-247` | `suspRockerAngle` | 24 次牛顿 + 中心差分，返回 number | 圆-圆闭式解，返回 `{angle,residual,feasible,branch}` | — |
| B1-2b | `03-suspension.js:249-251` | `suspCoilLength` | 距离函数 | 不变；新增 `suspRockerResidual` 复用距离 | — |
| B1-3a | `03-suspension.js:257-297` | `suspSolveCorner` | 扁平 `converged/error/rockerAngle/motionRatio` | 分层 `frame/rocker/motionRatio/seed/ok`，保留顶层兼容字段 | B1-2 |
| B1-3b | `03-suspension.js:268-275` | 高低探测 | 两次 `suspSolveRaw`，只看轮架 | 与主解同分支，三点全可行才算比值 | B1-2 |
| B1-3c | `05-body-dynamics.js:243-246` | `simEvaluate` 角点循环 | 消费扁平字段 | 消费 `frame/rocker/ok`，写回 `sim.cornerSeed` | B1-3a |
| B1-3d | `00-core.js:345`、`392-394` | `designLevel/evaluateStatic` | 消费 `motionRatio/coilLength/rockerAngle` | 消费分层字段；`staticSeeds` 保存 `rockerAngle` | B1-3a |
| B1-4a | `03-suspension.js:264` | `suspSolveCorner` 内摇臂解 | 种子取 `corner.angle` | 种子取入参 `seed.rockerAngle`，缺失用 `baseAngle` | B1-3 |
| B1-4b | `22-car-dynamics.js:958-964` | `updateSuspension` | 动态路径写 `corner.angle` 并清 `rockerSolveFailed` | 只写渲染字段，`rockerSolveFailed = !rocker.feasible` | B1-3 |
| B1-4c | `22-car-dynamics.js:1084` | `updateSuspension` 尾部 | `rockerSolveOk` 取渲染自解 | 改为基于物理 `feasible` | B1-4b |
| B1-5a | `03-suspension.js:155-180` | `suspEval` | 无调用计数 | 首行自增 `SUSP_EVAL_COUNT`，提供 `suspEvalReset()`/`suspEvalCount()` | — |
| B1-5b | `05-body-dynamics.js:241-262` | `simEvaluate` 力分支 | `converged` 为真即用瞬时比值 | 解析比值 + 有限/符号/范围三态降级 | B1-3 |
| B1-5c | `03-suspension.js:269-275` | 高低探测 | 两次额外求解 | 删除，改隐函数导数（省 2/3 suspEval） | B1-2 |
| B1-6a | `05-body-dynamics.js:200` | `simEvaluate` | `const state = sim.state` | 改名 `bodyState`，全函数 204-351 同步 | B1-1 |
| B1-6b | `05-body-dynamics.js:202` | `simEvaluate` | `reference.source` 缺失时回退积分状态 | 缺失时抛错（消息含 `reference.source`） | B1-6a |
| B1-6c | `05-body-dynamics.js:413-497` | `simIntegrate` | 局部 `state` | 改名 `bodyState`，消除同类遮蔽 | B1-1 |
| B1-6d | `DESIGN.md:549-578`、`585`、`647-648` | 文档 | “平动以参考点为积分变量” | 质心状态、`p=r_CG-R(q)c`、力臂以质心为原点 | B1-1 |

## 3. B1-1 状态字段改造

### 3.1 字段语义

| 字段 | 当前 | 目标 | 单位 | 备注 |
| --- | --- | --- | --- | --- |
| `x, y, z` | 设计参考点 | 质心位置 | m | 语义变更，字段名不变 |
| `vx, vy, vz` | 参考点速度 | 质心速度 | m/s | 语义变更 |
| `qw..qz` | 车体→路面 | 不变 | — | — |
| `wx, wy, wz` | 体轴角速度 | 不变 | rad/s | `wx` 侧倾、`wy` 横摆、`wz` 俯仰 |
| `referencePoint` | 无 | 派生 `p = r_CG - R(q)c` | m | 新增只读，不存入 state |
| `bodyPos`（模型输出） | 参考点 | 参考点（派生） | m | 渲染与旧断言兼容 |
| `heave`（模型输出） | 参考点 y | 参考点 y（派生） | m | 数值不变 |
| `cgWorld` | 合成质心 | 直接取 state | m | — |
| `bodyVelocity` | 参考点速度 | 质心速度 | m/s | UI 文案随 B4 更新 |

新增函数（`05-body-dynamics.js`，放在 `simEquilibriumState` 之前）：
```js
simBodyPointFromCg(cg, q, cgBody)   // p = cg - R(q)·c
simCgFromBodyPoint(bodyPoint, q, cgBody) // r = p + R(q)·c
simReferencePoint(sim)              // 取 state 与 reference，返回参考点
```

### 3.2 逐函数联动点

| 函数 | 行号 | 改动 | 验收要点 |
| --- | --- | --- | --- |
| `simEquilibriumState` | 108-125 | `p0=[0,reference.heave,0]`，`x/y/z = simCgFromBodyPoint(p0,q,cb)` | 平衡时 `refPos==[0,heave,0]` |
| `simCreate` | 127-151 | 新增 `cornerRatio:[null×4]`；`flags.solverDegraded=false`、`solverFailed=false` | 字段存在且初值正确 |
| `simReset` | 153-172 | 同 `simCreate` 的清零；保留 `resetCount` | 重置后种子与比值全空 |
| `simEvaluate` | 204-268 | 204 取 q；205 删 `cgArm`；`cg=[x,y,z]`；`refPos=simBodyPointFromCg`；225 `bodyPos=refPos`；231-234 `armRelCG=[wheel.x-cb.x,-cb.y,wheel.z-cb.z]`；`cornerY=cg.y+(R·armRelCG).y`；`cornerVelocityY=v.y+(ω_road×R·armRelCG).y`；267-268 用 `refPos.x/z` | 旧式与新式在任意姿态下恒等（差 <1e-12） |
| `simIntegrate` | 413-497 | 415 语义注释；426-443 holding 不变；460-462 位置积分的是质心；480-491 边界注释改“质心边界”；493-505 恢复调新 `simEquilibriumState` | 无外力时 `v` 不变 |
| `simBuildModel` | 544、586-587、639-665 | 544 局部 state 保留；`bodyVec` 用 `refPos`；586-587 机构变换基座用参考点；639 `bodyPos=refPos`；644 `heave=refPos.y`；658 `bodyVelocity` 注释；665 `solverOk=corners.every(c=>c.ok)` | 平衡时 `heave==reference.heave` |
| `computeStatic` | 249-562 | 382 `bodyPos` 仍是参考点；392 传 `staticSeeds`；返回加 `referencePoint:{x:0,y:heave,z:0}` | 静力 47 项全绿 |

### 3.3 力臂与速度联动

`moment` 的力臂已相对质心（`05:306`、`337`、`364`），B1-1 后 `cg` 直接取 state，公式不变。脉冲力矩（`05:379-382`）仍用 `simCross(impulse.offset, impulse.force)`，B1-1 只要求力臂原点改为“质心偏移”：`offset - cgBody` 后再旋转，实现在 B2-2；本册在 B1-1 的验收中只断言线速度增量与 `F·Δt/m` 相符，力矩方向与 6880.45 N·m 归 B2-2。

接地点速度 `05:351-356` 当前用 `state.x/y/z`，B1-1 后语义正确（相对质心的臂），无需改公式；B2-3 会用 `contactRoad` 替换来源。

### 3.4 验收

```bash
node tools/test-physics-invariants.mjs --group cg   # 期望：修复前 1，B1-1 后 0
npm test                                            # 期望：迁移断言后 52/52
```

断言：无外力、`wx=1`、1 s 后 `|cg(1s)-cg(0)|<1e-9`、`|ref(1s)-ref(0)|=0.287655 m±1e-4`、`|wx-1|<1e-12`；平衡态 `heave==reference.heave`（<1e-12）、`bodyPos.y==heave`、`cgWorld.y-heave==(R·cgBody).y`。

## 4. B1-2 摇臂闭合可行性

**当前实现（`03:229-247`）**：24 次牛顿迭代，中心差分 `h=1e-5`，误差阈值 `1e-11`，导数阈值 `1e-9`，步长夹紧 ±0.25；失败返回最后角度。目标长度 `suspDesign(corner).pushLen0`（`03:126`），种子 `corner.angle`（`03:232`）。

**目标实现**：圆-圆闭式解。

```js
suspRockerAngle(corner, pushPoint, seed)
  -> { angle, residual, feasible, branch }
```

`rho=hypot(arm.x,arm.y)`，`phi=atan2(arm.y,arm.x)`，`u=P-(pivot+(0,0,arm.z))`，`a=hypot(u.x,u.y)`，`D2=L²-u.z²`；`c=(rho²+a²-D2)/(2·rho·a)`；`|c|>1` 或 `D2<0` 为不可达。可解时 `psi=acos(clamp(c,-1,1))`，`base=atan2(u.y,u.x)-phi`，两支 `base±psi`；按 `|angle-seed|` 选支，`branch=+1/-1`；两解重合 `branch=0`；不可达取切点角、`feasible=false`、`branch=0`，残差用 `suspRockerPoint` 三维距离重算。

设计点复算已确认与牛顿解一致到 1e-9、残差 0，双支为 `-0.1006/-1.1437`（前）与 `0.1003/1.2342`（后）。保留 `suspRockerAngleNewton` 仅作对照。

**验收**：`--group rocker`；默认 ±25 mm 行程角度差 <1e-9；`mulberry32(20261119)` 1000 组，可行时残差 <1e-9，不可行时残差 >0 且不抛错；4.1 工况 `feasible=false`、残差 >1e-3。预期 fbb401d 红（无可行标志），B1-2 后绿。

## 5. B1-3 角点结构与 02 交接

**返回结构（`03:282-296`）**：

| 字段 | 类型 | 单位/取值 | 说明 |
| --- | --- | --- | --- |
| `frame.converged` | bool | — | 轮架三约束，仅此含义（A-03） |
| `frame.error` | number | m | `max(abs(f))` |
| `rocker.angle` | number | rad | 闭式解 |
| `rocker.residual` | number | m | 推杆闭合残差 |
| `rocker.feasible` | bool | — | 几何可达 |
| `rocker.branch` | number | +1/-1/0 | 分支 |
| `motionRatio` | number 或 null | — | 不可用时 null |
| `motionRatioState` | string | `'ok'`/`'unavailable'` | — |
| `seed` | object | `{thL,thU,spin,rockerAngle}` rad | 物理层所有 |
| `ok` | bool | — | `frame.converged && rocker.feasible && motionRatioState==='ok'` |
| 顶层 `converged/error/rockerAngle/coilLength/motionRatio` | 兼容 | — | 保留至调用点迁移完成 |

**高低探测（`03:268-275`）**：主解种子分别求解 high/low；三点 `frame.converged` 与 `rocker.feasible` 同时成立，且 `branch` 与主解一致（退化时角度差 <1e-6）才计算 `motionRatio`。

**与 02 的交接（只登记）**：B2-3 在返回对象追加 `contactBody`、`wheelPosBody`、`contactRoad`、`wheelPosRoad`（`02:114-124`）；`contactRoad = R(bodyQuat)·contactBody + bodyPos`，为唯一接地点（`02:185-188`）；`simEvaluate.corners[i].contact = contactRoad`（`02:124`）。B1-3 不新增这些字段，也不改 `simEvaluate` 的 `contact` 输出点（`05:267-268` 在 B2-3 才替换）。02 没有角点级 `status` 字段；接触状态 `sim.contact`（mode/dwell/…）由 B2-1 建立（`02:190-201`），求解状态用 `ok` 与 `solverState`，二者不得混用。

**验收**：`--group corner`；4.1 工况 `frame.converged=true` 而 `ok=false`；默认参数 `ok=true`、残差 <1e-9；500 步分支一致率 100%。预期 fbb401d 红，B1-3 后绿。

## 6. B1-4 种子所有权

| 位置 | 当前行为 | 替代方案 |
| --- | --- | --- |
| `03:264` | `suspRockerAngle(corner, state.P, corner.angle)` | 改读入参 `seed.rockerAngle`，缺失用 `corner.rocker.baseAngle` |
| `03:232` | `let angle = Number.isFinite(seed) ? seed : baseAngle`（B1-2 重写后该行消失） | 由新签名接收 `{angle,...}` 或数值种子 |
| `03:295` | `seed:{thL,thU,spin}` | 追加 `rockerAngle` |
| `22:959-961` | 动态路径写 `corner.angle` 并清 `rockerSolveFailed` | 只写 `corner.angle = solved.rocker.angle`、`rockerSolveFailed = !solved.rocker.feasible` |
| `22:962-964` | 无解时渲染层调用 `solveRockerAngle` | 保留为静态/首帧显示兜底，结果不回流物理 |
| `22:1084` | `rockerSolveOk` 取渲染自解标志 | 改为物理 `feasible` 驱动（B1-4b 已写） |
| `40:395` | 探针读 `corner.angle` | 保持，来源变为物理快照 |
| `05:137/161/243-244` | `sim.cornerSeed` 初始化、重置、每步写回 | 保持；这是唯一物理种子链 |

**验收**：`--group seed`。同一 source 建两个 sim，A 每步 `corner.angle=baseAngle`、B `+1.2`，比较 14 个 state 字段、`sim.time`、5 个 flags，要求逐位相同。fbb401d 实测首子步即差，默认俯仰 300 步最大 0.61 m、4.1 工况 1.28 m；B1-4 后绿。`grep -n "corner.angle" src/js/03-suspension.js` 无输出为静态守卫。

## 7. B1-5 运动比解析化

**公式**：轮架约束 `f(q;y)=0`，`q=(thL,thU,spin)`，隐函数 `dq/dy=-J_f^{-1}∂f/∂y`；推杆点 `P=P(q,y)`，`dP/dy=∂P/∂q·dq/dy+∂P/∂y`；推杆约束 `g(θ,P)=0` 给 `dθ/dy=-(g_P·dP/dy)/g_θ`；线圈长度 `L(θ)` 给 `dL/dy=L_θ·dθ/dy`；`motionRatio=dL/dy`，与 `03:274` 的 `(lHigh-lLow)/(2ε)` 同号，`05:248` 的 `dLdDelta=-ratio` 不变。

**调用次数预算**（`suspEval`）：

| 路径 | 组成 | 四角合计 |
| --- | --- | --- |
| 现状 | 4 角 × 3 求解 × 约 7 次/求解 | 84–88（实测 88） |
| B1-5 目标 | 4 角 ×（主解约 7 次 + `∂f/∂y` 1 次） | 约 32 |
| 同上 + 复用末次差分 | `∂f/∂y` 取上一子步缓存 | 约 28 |
| 解析 Jacobian 备选 | 每迭代 1 次而非 4 次 | 约 16 |

以 `suspEvalCount()` 实测为准，不以估算合入；生产验收 ≤30，30–60 只能作独立实验分支的临时降级。计数器加在 `03:155` 的 `suspEval` 首行，提供 `suspEvalReset()/suspEvalCount()`。

**降级（`05:241-262`）**：比值有效条件为有限、`0.05<ratio<2.0`、与 `|row.dLdDelta|` 之比在 [0.3,3]、与上一步相对差 <20%；失败用上一有效值，首次用 `|row.dLdDelta|`，置 `solverDegraded`；连续 10 步置 `solverFailed`。`frame.converged` 只决定法向力主解/回退，不用综合 `ok`。

**验收**：`--group ratio`；解析值与中心差分相对误差 <1e-3；默认脉冲 500 步无符号跳变；4.1 工况走降级且力有限；`suspEval≤30`。预期 fbb401d 红（88 次、±6.9 跳变），B1-5 后绿。

## 8. B1-6 变量遮蔽与文档

`05:200` 的 `const state = sim.state` 遮蔽全局 setup；`05:202` 的 `reference.source || state` 回退指向积分状态。改动：200 改名 `bodyState`；`simEvaluate` 内 `state.` 全部同步，行号为 204、208、209、211、225、226、233、267、268、324-326、351；`simIntegrate`（407-512）内 413、417、432-437、440-442、445-450、452-457、460-462、464、475-478、480-489、494-497 一并改名。`202` 改为缺失即抛错（消息含 `reference.source`），或由调用方显式传入快照。`simBuildModel`（541-701）的局部 `state` 不改名，仅加注释，避免无关改动。

`DESIGN.md:549-578` 改写状态与公式（质心状态、`p=r_CG-R(q)c`、力臂以质心为原点），`585` 补 `δ_i` 与力臂说明，`647-648` 补新测试。验收 `--group shadow`：删除 `reference.source` 后抛错且消息含字段名；fbb401d 红，B1-6 后绿。

## 9. 验收命令与红绿

| 命令 | fbb401d | B1 后 | 关键断言 |
| --- | --- | --- | --- |
| `node tools/test-physics-invariants.mjs --group cg` | 红（质心 287.655 mm） | 绿 | 质心 <1e-9，参考点 0.287655 m |
| `--group rocker` | 红（无 feasible） | 绿 | 4.1 工况不可达、残差 >1e-3 |
| `--group corner` | 红（converged 混同） | 绿 | `frame.converged=true`、`ok=false` |
| `--group seed` | 红（0.61/1.28 m） | 绿 | 逐位相同 |
| `--group ratio` | 红（88 次、符号跳变） | 绿 | ≤30 次、无跳变 |
| `--group shadow` | 红（静默回退） | 绿 | 抛错含 `reference.source` |
| `npm test` | 绿 47+52 | 迁移后绿 | 迁移清单见 §10 |
| `npm run test:browser` | 不运行（端口） | 不运行 | 由 CI 在空闲端口执行 |

上表命令由 B0 的 harness 提供；B0 未就绪时用 `tools/audit/audit-free-body.mjs` 等临时入口执行同等断言。所有新脚本退出码：0 通过、1 断言失败、2 环境错误。

## 10. 风险与基线变化

### 10.1 会失效的现有测试

| 位置 | 内容 | 处理 |
| --- | --- | --- |
| `05:741`、`744` | 自检用 `state.y - reference.heave` | 改用 `simBuildModel(sim).heave` |
| `05:777-779` | 确定性比较 `state.y` | 改比较 `heave`，或保留质心 `state.y` 作补充 |
| `05:789-791` | 帧率比较 `state.y` | 同上 |
| `tools/test-dynamics.mjs:205-206`、`210-211` | 阻尼峰值/尾部用 `state.y` | 改用 `model.heave` |
| `tools/test-dynamics.mjs:223` | 逐位比较 `state.y` | 改比较 `heave` 或质心 `state.y`（二选一并注明） |
| `tools/test-dynamics.mjs:231` | 帧率比较 `state.y` | 同上 |
| `tools/test-dynamics.mjs:102` | `contact.y` 断言 | B1-1 后仍成立（接地点仍在路面） |
| `30-ui.js:741-752` | heave/bodyPos 显示 | 数值不变（参考点派生），无需改 |

### 10.2 会变化的数值基线

| 基线 | 现值 | B1 后预期 | 说明 |
| --- | --- | --- | --- |
| 自由刚体质心漂移 | 287.655 mm | <1e-9 m | 同时参考点位移由 0 变为 287.655 mm |
| 4.1 工况闭合残差 | 18.63 / 3.71 mm（本册样本） | 重测 | 闭式解与种子链改变落点，不可沿用 |
| 4.1 工况运动比 | -6.92..6.98 | 重测 | 不可达时走降级，峰值不再出现 |
| 4.1 工况阻尼峰值 | 33.38 / 45.97 kN（本册） | 重测 | 主册 30.7/46.3 kN 为旧力臂基线，按 R-01 重测后重新登记 |
| 运动比 ±7.6 | 浏览器回写结果 | 重测 | B1-4 后回写不再影响物理 |
| 默认工况载荷差 | <1 N（实测 ~0） | 预期保持 <1 N | 机构解等价，但需逐项复跑 |
| 60/144 Hz 差 | <1e-9 | 预期保持 | 固定步长未改 |

### 10.3 施工风险

1. **静力选支抖动**：`computeStatic` 的 `staticSeeds`（`00:377`、`392-394`）若不保存 `rockerAngle`，闭式解可能在平衡迭代中交替选支，导致静力 47 项偶发失败。B1-3 必须与 B1-2 同批验证。
2. **`converged` 误用**：02 的法向力分支只看 `frame.converged`。若实现中把 `ok` 用于该分支，4.1 工况会整体走回退，载荷基线偏移，且 B2 的验收无法对齐。
3. **解析导数符号**：`motionRatio=dL/dy` 必须与 `03:274` 同号；写反会使弹簧与阻尼力方向反转，默认工况立即发散。用中心差分对照，误差 <1e-3。
4. **性能回退**：解析运动比若引入额外 `suspEval`，可能超过 30 次。以计数器实测为准，超标即按临时降级单列，不得静默合并。
5. **B1-1 与 B2-2 同行冲突**：`05:379-382` 的脉冲力矩在 B1-1（力臂减 `cgBody`）与 B2-2（旋转到路面系）各改一次，需约定顺序，避免合并冲突。
6. **测试迁移遗漏**：`state.y` 语义变化影响 §10.1 全部断言，迁移前这些测试会红；逐条改完后 `npm test` 必须回到 52/52，且新增的 `--group cg` 转绿。

### 10.4 审计阈值重定记录

`B4.1/motion-ratio-continuity` 的原判据 `maxJump <= 0.02` 只适用于默认小行程；4.1 低阻尼工况的大行程使运动比在 40 ms 内从 0.51 升到 0.79，实测逐步变化 0.074，且不可达段结束后恢复值仍属同一装配支。经 lead 裁决，该 check 拆为两项同时成立：`signFlips === 0`（相邻步 ratio 不跨 0、branch 不换支）与 `maxJump <= 0.1`；metrics 增记 `signFlips`、`maxStep`、`maxStepTime`。阈值按物理行程重定，不放宽符号/分支判据；求解器未做平滑或限幅。B1-5 的 `sim.cornerRatio` 连续性（20%）与 `suspSolveCorner` 的分支保持策略不变。

## 11. 提交切分

| 提交 | 内容 | 前置 | 验收 |
| --- | --- | --- | --- |
| 1 | B1-1 + 断言迁移 + B1-6 的 `simEvaluate` 改名 | 无 | `--group cg` 绿，`npm test` 52/52 |
| 2 | B1-2 闭式解（保留旧实现） | 1 | `--group rocker` 绿 |
| 3 | B1-3 分层结构与静态种子 | 2 | `--group corner` 绿，静力 47 项绿 |
| 4 | B1-4 种子所有权与渲染只读 | 3 | `--group seed` 绿 |
| 5 | B1-5 解析运动比与降级 | 3 | `--group ratio` 绿，≤30 次 |
| 6 | B1-6 其余（`simIntegrate` 改名、抛错、DESIGN 同步） | 1 | `--group shadow` 绿，文档断言对齐 |

每个提交只动所属文件；B1-4 的 `22-car-dynamics.js` 改动不得夹带渲染重构；B1-5 的性能改动与功能改动分开评审。
