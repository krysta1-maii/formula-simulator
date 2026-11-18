# 施工契约 v1（B0-0 冻结）

| 项 | 值 |
| --- | --- |
| 版本 | `contracts.v1`（plan-r2） |
| 冻结日期 | 2026-11-19 |
| 适用区间 | B0-0 起至 B6-1；阶段三接入前不失效 |
| 事实来源 | 主册 §5.3、§9；分册 01 §6.1；02 §5；03 §7.6；04 B4-4；05 §3、§4.1 |
| 效力 | 字段名、单位、所有权、命令与基线的唯一来源；与分册重复处，以本文件为准，分册回改引用 |
| 边界 | 只汇总既有裁决与已冻结字段，不新增字段，不改源码 |

## 0. 使用规则

1. 表中的“现状”指 fbb401d，“契约”指对应工作项完成后的冻结语义。施工 agent 不得把现状字段直接当作契约字段使用。
2. 未列入本文件的字段属于内部实现，不得被其他分册、UI 或测试跨模块消费；确需跨册时，先升级本文件版本并回改分册。
3. 字段只增不改：新增字段必须注明引入批次、单位、空值语义与读写方；不得重命名、改单位或改变空值含义。
4. 本文件与主册 §5.3 裁决冲突时，先改主册与契约，再改实现；实现不得先于契约变更。
5. B0-0 只新增本文件，不修改 `src/`、`tools/`、`index.html`、`package.json` 或既有分册。

## 1. 状态与角点 schema

### 1.1 `sim.state`

| 字段 | 类型/单位 | fbb401d 现状 | 契约（目标） | 写者 | 读者 |
| --- | --- | --- | --- | --- | --- |
| `x, y, z` | number / m | 车身设计参考点位置 | 质心在路面系的位置 | `simIntegrate` | `simEvaluate`、`simBuildModel`、`40-app`、测试 |
| `vx, vy, vz` | number / (m/s) | 参考点速度 | 质心在路面系的速度 | `simIntegrate` | `simEvaluate`、`simBuildModel`、测试 |
| `qw, qx, qy, qz` | number / 无量纲 | 车体到路面四元数 | 不变 | `simIntegrate` | `simEvaluate`、`simBuildModel`、`22-car-dynamics` |
| `wx, wy, wz` | number / (rad/s) | 体轴角速度，依次侧倾、横摆、俯仰 | 不变 | `simIntegrate` | `simEvaluate`、`simBuildModel`、测试 |
| `referencePoint` | [3] / m | 未显式导出，由 `cg = state + R·cgBody` 反算 | 派生只读量 `p = r_CG - R(q)·cgBody` | `simBodyPointFromCg`（B1-1） | `simBuildModel`、遥测、测试 |

状态约束：B1-1 后 `x/y/z` 与 `vx/vy/vz` 一律为质心量；参考点只能经 `referencePoint`、`simBodyPointFromCg` 或 `simCgFromBodyPoint` 派生，不得把 `x/y/z` 当参考点。默认 `cgBody = (-0.15975, 0.30, 0)`，平衡时 `state.y` 比 `reference.heave` 高约 0.30 m。

### 1.2 `suspSolveCorner` 角点结构

| 字段 | 类型/单位 | 现状 | 归属 | 写者 | 读者 |
| --- | --- | --- | --- | --- | --- |
| `frame.converged` | bool | 顶层 `converged`，仅轮架 | B1-3 | `suspSolveCorner` | `simEvaluate` 法向力分支、遥测、测试 |
| `frame.error` | number / m | 顶层 `error` | B1-3 | `suspSolveCorner` | 遥测、审计 |
| `rocker.angle` | number / rad | 顶层 `rockerAngle` | B1-3 | `suspSolveCorner` | 弹簧/阻尼、`22-car-dynamics` 渲染 |
| `rocker.residual` | number / m | 无 | B1-3 | `suspSolveCorner` | 遥测（乘 1000 后为 mm）、审计 |
| `rocker.feasible` | bool | 无 | B1-3 | `suspSolveCorner` | 法向力降级、遥测、UI |
| `rocker.branch` | number / +1、-1、0 | 无 | B1-3 | `suspSolveCorner` | 高低探测一致性、测试 |
| `motionRatio` | number / 无量纲 | 顶层 `motionRatio`，可为 null | B1-3 | `suspSolveCorner` | 弹簧/阻尼、遥测 |
| `motionRatioState` | string / `'ok'`、`'unavailable'` | 无 | B1-3 | `suspSolveCorner` | 遥测、UI、阶段三 |
| `seed` | 对象 / rad | 无 `rockerAngle` | B1-3 | `suspSolveCorner` | 物理层下一子步；渲染层禁止读写 |
| `ok` | bool | 无 | B1-3 | `suspSolveCorner` | 遥测、种子总线、阶段三 |
| `coilLength` | number / m | 顶层 `coilLength` | B1-3 | `suspSolveCorner` | 弹簧力、遥测 |
| `contactBody` | [3] / m | 顶层 `contact`（车体系） | B2-3 | `suspSolveCorner` | 机构、渲染；不进入力矩 |
| `wheelPosBody` | [3] / m | 顶层 `wheelPos` | B2-3 | `suspSolveCorner` | 机构、渲染 |
| `wheelPosRoad` | [3] / m | 由 `simBuildModel` 二次变换 | B2-3 | `suspSolveCorner` | `wheelCenters`、渲染 |
| `contactRoad` | [3] / m | 由 `simBuildModel` 二次变换 | B2-3 | `suspSolveCorner` | 力臂、接地点速度、遥测、可视化 |

角点约束：

1. `seed = { thL, thU, spin, rockerAngle }`，由物理层独占；渲染层只能读 `rocker.angle` 的显示副本，不得写 `seed` 或 `corner.angle` 作为求解初值。
2. `frame.converged` 只表示轮架三约束收敛；`ok = frame.converged && rocker.feasible && motionRatioState === 'ok'`。法向力主解/回退分支只看 `frame.converged`，综合状态看 `ok`（A-03）。
3. `contactRoad = R(bodyQuat)·contactBody + bodyPos`，由 `suspSolveCorner` 一次算出；约束 `abs(contactRoad.y) < 1e-6`（路面系 y 向上）。回退分支用 `n = [0,1,0]` 投影，不得用 `gravityLocal` 的反方向。
4. `contactBody`、`wheelPosBody` 只给机构与渲染；力矩、接地点速度、`contactPoints`、可视化锚点只读 `contactRoad`。
5. 顶层兼容字段 `converged/error/motionRatio/coilLength/wheelPos/rockerAngle` 可由 B1-3 保留，但消费方必须使用分层字段；兼容字段不进入阶段三契约。

## 2. ForceEvaluation 与 simApplyForceAt

### 2.1 `simEvaluate` 返回结构（ForceEvaluation）

| 字段 | 类型/单位 | 语义 | 写者 | 读者 |
| --- | --- | --- | --- | --- |
| `force[3]` | number / N | 路面系合力 | `simEvaluate` | `simIntegrate`、`simBuildModel` |
| `moment[3]` | number / N·m | 绕质心力矩 | `simEvaluate` | `simIntegrate`、`simBuildModel` |
| `momentParts.normal` | [3] / N·m | 法向力矩之和 | `simApplyForceAt` | `simBuildModel`、B2-4 测试 |
| `momentParts.friction` | [3] / N·m | 摩擦力矩之和 | `simApplyForceAt` | 同上 |
| `momentParts.impulse` | [3] / N·m | 脉冲力矩 | `simApplyForceAt` | 同上 |
| `corners[i].contact` | [3] / m | 路面系接地点，等于 `contactRoad` | `simEvaluate` | 力臂、遥测、可视化 |
| `corners[i].contactVelocity` | [3] / (m/s) | 接地点速度 | `simEvaluate` | 摩擦、阶段三轮胎 |
| `corners[i].normal` | number / N | 法向力 | `simEvaluate` | 摩擦、遥测 |
| `corners[i].friction` | [3] / N | 路面系摩擦力 | `simEvaluate` | 遥测、测试 |
| `cg` | [3] / m | 质心位置 | `simEvaluate` | 力臂、测试 |
| `flags` | 对象 / bool | `{holding,sliding,finite,boundary,recovered}` | `simEvaluate` | `simIntegrate`、遥测 |

不变量：`momentParts.normal + friction + impulse` 与 `moment` 逐分量差 < 1e-9；`corners[i].contact` 必须直接取自 `contactRoad`，不得二次变换。

### 2.2 `simApplyForceAt` 签名

```js
simApplyForceAt(sim, roadPoint, forceRoad, bucket)
// roadPoint: [x,y,z] 路面系，m
// forceRoad: [Fx,Fy,Fz] 路面系，N
// bucket: 'normal' | 'friction' | 'impulse'
// force += forceRoad
// momentParts[bucket] += (roadPoint - cgWorld) × forceRoad
```

| 项 | 冻结规定 |
| --- | --- |
| 力臂原点 | `cgWorld`（B1-1 后即 `sim.state.x/y/z`） |
| 调用方 | B2-1 摩擦、B2-2 脉冲、B2-4 法向；三条路径统一 |
| 返回 | 无返回值，纯累加；不得隐式修改 `sim.state` |
| 禁止 | `simEvaluate` 内不得出现裸 `simCross(arm, force)`；05 的 grep 守卫须为 0 |
| 新增力类别 | 只增加 `bucket` 取值，不改函数签名；阶段三轮胎力、空气动力、驱动扭矩一律经此函数 |

### 2.3 `sim.contact` 与 `contactNext`

| 字段 | 类型/单位 | 语义 | 提交时机 |
| --- | --- | --- | --- |
| `mode` | string / `'HOLD'`、`'SLIP'` | 锁存的切向状态 | 每子步积分后 |
| `dwell` | integer | 连续满足驻车条件的子步数 | 每子步积分后 |
| `since` | number / s | 进入当前模式的仿真时间 | 模式切换时 |
| `changes` | integer | 累计切换次数 | 模式切换时 |
| `lastChangeStep` | integer | 最近一次切换的子步序号 | 模式切换时 |
| `reason` | string 或 null | 进入 SLIP 的原因 | 进入 SLIP 时 |
| `slipSpeed` | number / (m/s) | 四角接地点滑移速度最大值 | 每子步 |
| `usage` | number / 无量纲 | `max abs(f_i)/(μN_i)` | 每子步 |

所有权：`simStep` 是唯一提交者；`simEvaluate` 只返回纯对象 `contactNext`，不写 `sim.contact`；`simBuildModel` 只读已提交值。快照 `getSnapshot().sim` 输出上述字段的只读投影，测试不得依赖 `sim.contact` 内部对象。

## 3. 遥测快照、检查表与 solverState

### 3.1 求解与角点遥测字段

| 字段 | 类型/单位 | 定义 | 写者 | 读者 |
| --- | --- | --- | --- | --- |
| `solverOk` | bool | `corners.every(c => c.ok)` | B1-3 | UI 首行、浏览器、阶段三 |
| `solverState` | string / `'ok'`、`'degraded'`、`'failed'` | `#solverBadge` 唯一驱动源 | B4-4 | UI、浏览器 |
| `rockerResidualMm` | number[4] / mm | `rocker.residual * 1000` | B1-3 | UI 残差行、浏览器 |
| `rockerFeasible` | boolean[4] | 四角推杆—摇臂可达性 | B1-3 | UI、浏览器 |
| `motionRatioState` | string[4] / `'ok'`、`'unavailable'` | 四角运动比状态 | B1-3 | UI、阶段三 |
| `solved[i].rocker` | 对象 / `{angle,residual,feasible,branch}` | `angle` rad、`residual` m | B1-3 | UI、浏览器 |
| `sim.solverDegraded` | bool | 短时降级 | B1-5 | B4-4 派生 `solverState` |
| `sim.solverFailed` | bool | 持续失败 | B1-5 | B4-4 派生 `solverState` |
| `bodyPos` / `heave` / `cgWorld` / `bodyVelocity` | [3] m / m / [3] m / [3] (m/s) | 参考点位置 / 参考点 y / 质心位置 / 质心速度 | B1-1 | UI、测试、阶段三 |

### 3.2 运行时、几何与资源快照

| 命名空间 | 字段 | 归属 | 说明 |
| --- | --- | --- | --- |
| `sim` | `backlog, droppedTime, timeScale, lastFrameDt, lastAdvance, maxFrameDt, maxSubsteps` | 03 B3-1 | 帧时间语义；`maxFrameDt=0.5`、`maxSubsteps=128` |
| `sim` | `mode, dwell, since, changes, lastChangeStep, reason, slipSpeed, usage` | 02 B2-1 | `sim.contact` 的只读投影 |
| `—` | `setupRevision`、`selfTestRuns:{static,dynamic}` | 03 B3-3 | 自检缓存与运行次数 |
| `geometry` | `sceneRevision, physicsRevision, pending, policy, commitCount, mismatch, dims` | 03 B3-2 | `sceneRevision = CAR.geometryRevision`；`physicsRevision = SIM.reference.geometryRevision` |
| `assets.totals` | `instanceMaterialCreated, instanceMaterialDisposed, geometryDisposed, textureDisposed, sharedMaterialDisposed, cachedMaterialDisposed` | 03 B3-4 | 累计计数 |
| `assets.lastBuild` | `instanceMaterialCreated, instanceMaterialDisposed, geometryDisposed, textureDisposed, at` | 03 B3-4 | 本次构建计数，不是累计值 |
| `assets.lastTeardown` | 对象 | 03 B3-4 | 结构由 B3-4 定义；本契约只冻结名称 |

### 3.3 检查表 10 行（顺序冻结）

| # | 行 id | 名称 | 判据 | 维护 |
| ---: | --- | --- | --- | --- |
| 1 | `sim` | 六自由度积分与求解 | `sim.finite && !sim.recovered && solverOk` | B4-4 改；B3-1 只追加时间字段 |
| 2 | `contact` | 四轮接地 | `model.contactOk` | 沿用现状 |
| 3 | `links` | 悬架杆长偏差 | `diag.linkCount > 0 && diag.maxSuspLinkStretchMm < 1 && diag.rockerSolveOk` | 沿用现状 |
| 4 | `steer` | 齿条 / 横拉杆 | `diag.tieRodStretchMm < 5 && diag.rockerSolveOk` | 沿用现状 |
| 5 | `arb` | 防倾杆连接 | `diag.arbCount === 2 && diag.arbFront && diag.arbRear && diag.arbStretchMm < 0.5` | 沿用现状 |
| 6 | `friction` | 坡面摩擦 | `model.frictionDemand <= model.frictionCapacity + 1e-9` | 沿用现状 |
| 7 | `rockerResidual` | 摇臂闭合残差 | 四角 `rockerFeasible` 且 `max rockerResidualMm < 0.1` | B4-4 新增 |
| 8 | `motionRatio` | 运动比连续性 | 按 `motionRatioState` 统计不可用角数；持续失败加 `is-error` | B4-4 新增 |
| 9 | `staticTests` | 静力自检 | 14 项全部通过 | 沿用现状 |
| 10 | `dynamicTests` | 动态自检 | 10 项全部通过 | B2-1 增至 10，B3-3 生成器化 |

### 3.4 `solverState` 语义

| 取值 | 条件 | `#solverBadge` | 其他 UI |
| --- | --- | --- | --- |
| `'ok'` | `sim.solverFailed === false`、`sim.solverDegraded === false` 且 `solverOk === true` | 隐藏 | 首行与残差行按各自判据显示 |
| `'degraded'` | `sim.solverDegraded === true` 且 `sim.solverFailed === false` | 显示“求解降级” | 残差/运动比行可加 `is-error`；首行不通过 |
| `'failed'` | `sim.solverFailed === true` | 显示“求解失败” | 首行不通过；警告置顶 |

派生优先级 `failed > degraded > ok`。`solverOk === false` 而两标志均为 false 属于非法状态：B1-3/B1-5 必须补 `solverDegraded` 或 `solverFailed`，B4-4 验收拒绝该组合，不得让徽标隐藏而首行告警。`solverOk` 不包含 0.1 mm 残差阈值，残差阈值只属于 `rockerResidual` 行。徽标只在状态翻转时更新 `textContent`、`hidden` 与一次 `aria-live` 播报，不得每帧写入。

## 4. 脉冲基线与 4.1 工况

### 4.1 脉冲力臂

作用点取参考点前方 0.95 m：`P = refPos + R(q)·offset`，`r_CG = refPos + R(q)·cgBody`，因此力臂 `P - r_CG = R(q)·(offset - cgBody)`，绕质心力矩 `M = (R(q)·(offset - cgBody)) × forceRoad`。冻结为 `leverBody = offset - cgBody`，`P` 与 `cgBody` 都相对参考点。

| 项 | 冻结值 |
| --- | --- |
| 参考点相对 offset | `[0.95, 0, 0]` m（车头方向） |
| `cgBody`（默认） | `[-0.15975, 0.30, 0]` m |
| `leverBody` | `[1.10975, -0.30, 0]` m |
| 俯仰脉冲力 | `[0, -6200, 0]` N，总时长 0.12 s |
| 零姿态力矩 | `(0, 0, -6880.45)` N·m（取 `xCG=-0.160` 时为 -6882 N·m） |
| 禁止 | 5890 是缺陷症状，不得作为基线；不得用 `[0.95,0,0]` 作为“相对质心”的 `leverBody` |

0° 时路面系力矩为 `(0,0,-6880.45)`；横摆 90° 时车体系力矩差仍为 `(0,0,-6880.45)`，`abs(ΔM_x) < 1e-9`、`abs(ΔM_z + 6880.45) < 1e-9`。重定范围：02 §4.2 第 1–6 条、05 的 `audit-impulse-frame`/`audit-seed-writeback`/`audit-rocker-reach`、01 的 4.1 基线与 B1-4 对照、README 第 81 行、DESIGN 20.2；heave/roll 的 offset 不变，但同组用例需重跑。

### 4.2 4.1 工况基线（引用 05 §4.1）

| 项 | 冻结值 |
| --- | --- |
| 参数 | 600 kg；前后轮心 50 N/mm；阻尼比 0.05；ARB 0 |
| 时间 | settle 1.5 s；SIM_DT 2 ms；脉冲总时长 0.12 s；开始后 60 ms 采样；统计窗口为脉冲后 2 s 峰值 |
| 主基线 | 首个不可达样本残差 4.02 mm、运动比 -4.20、阻尼 30.7 kN；回写 46.3 kN 仅作敏感性样本 |
| 引用规则 | 01/02/04 只引用本表，不各自定义工况；R-01 重定后本表全部按 6880.45 N·m 重测，原值只作缺陷症状 |

## 5. 测试文件归属与命令

### 5.1 归属

| 文件 | 归属 | 用途 |
| --- | --- | --- |
| `tools/test-physics-invariants.mjs` | 01 | 自由刚体、摇臂、角点、种子独立、运动比、变量遮蔽；分组由 01 §5 维护 |
| `tools/test-dynamics.mjs` [10][11][12] | 02 | HOLD/SLIP、脉冲坐标、接地点唯一性与力矩分解；[13] 渲染回退四元数归 04 |
| `tools/test-runtime.mjs` | 03 | 帧时间、几何代际、自检、变量遮蔽的 sourceContract |
| `tools/test-ui-browser.mjs` | 04 | 视口、键盘、焦点、状态、求解展示、离线 |
| `tools/test-dev-server.mjs` | 04 | dev-server 路径纯函数与集成 |
| `tools/test-dynamics-browser.mjs` | 04（B4-6 迁移 runner） | 现有动态冒烟；03/04 只追加独立检查段，不改 `try/finally` 与启动流程 |
| `tools/test-camera.mjs` | 04（B4-6 迁移 runner） | 相机冒烟；与动态测试共用 runner |
| `tools/browser-runner.mjs` | 04 | Chrome 启动、CDP、清理、`browserGate` |
| `tools/check-build.mjs` | 04 | 构建一致性；`build:check` 唯一产物门禁 |
| `tools/audit/_harness.mjs` | 05 | 共享 `loadPhysics/makeSetup/check/mulberry32` |
| `tools/audit/*` | 05 | 修复前红基线、JSON 报告、baseline；不进入 `npm test` |
| `tools/bench.mjs` | 05 | 性能基准；单独运行，不进快速层 |

### 5.2 npm 命令

| 命令 | 覆盖 | 退出码 |
| --- | --- | --- |
| `npm test` | 静力 50 + 动力学 80（B4 后实测） | 0 通过，1 失败 |
| `npm run test:core` | 静力 50 | 0/1 |
| `npm run test:dynamics` | 动力学 80，含 [10][11][12][13] 追加段 | 0/1 |
| `npm run test:invariants` | 01 的物理不变量 | 0/1 |
| `npm run test:runtime` | 03 的帧时间、几何、自检 | 0/1 |
| `npm run test:dev-server` | 04 的 dev-server 边界 | 0/1 |
| `npm run test:ui` | 04 的浏览器 UI 组 | 0/1；缺 Chrome 默认 0 并 SKIP，`FS_REQUIRE_CHROME=1` 时 1 |
| `npm run test:browser` | 页面动力学 26 项 | 同上 |
| `npm run test:camera` | 相机 20 项 | 同上 |
| `npm run build` | 唯一写入 `index.html` | 0/1 |
| `npm run build:check` | `index.html` 与源码逐字节一致 | 0 一致，1 不一致 |
| `npm run audit` | 全部审计；B0 阶段按设计失败 | 0 全部通过，1 断言失败，2 环境/装载错误 |
| `npm run audit:baseline` | 与 0.2.0 快照逐条比较 | 0 一致，1 漂移，2 环境错误 |
| `npm run audit:update` | 人工更新 baseline | 0/1/2；CI 不调用 |
| `npm run audit:physics`、`npm run audit:contact`、`npm run audit:runtime`、`npm run audit:ui` | 分组审计 | 0/1/2 |
| `npm run ci:node` | `npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server` | 任一失败即非零 |
| `npm run ci:browser` | `npm run test:browser && npm run test:camera && npm run test:ui` | 任一失败即非零；用 `npm run` 触发 `pretest:*` 构建 |

### 5.3 退出码与环境变量

| 项 | 冻结规定 |
| --- | --- |
| 测试脚本 | 断言失败退出 1；装载失败允许抛错/退出 1；不得用 `exit(0)` 掩盖失败 |
| 审计脚本 | 0 全部通过；1 断言失败；2 环境或装载错误；stdout 只输出 JSON，stderr 输出人读日志 |
| 浏览器 runner | 缺 Chrome 默认 SKIP 退出 0；`FS_REQUIRE_CHROME=1` 时退出 1；`FS_SKIP_BROWSER=1` 显式跳过退出 0；两变量同设冲突退出 1；启动/协议/端口错误退出 2 |
| 工具变量 | `FS_REQUIRE_CHROME`、`FS_SKIP_BROWSER`、`CHROME_PATH` 为唯一变量名；不使用 `REQUIRE_CHROME` |
| 构建 | 只有 `npm run build` 写 `index.html`；`build:check` 不写盘；`pretest:browser/camera/ui` 先构建 |
| 审计阶段 | B0 阶段 `npm run audit` 退出 1 是预期；`audit:baseline` 退出 0 才算基线建立成功 |

## 6. 施工期禁止事项

1. **渲染写物理**：渲染层不得写 `sim.state`、`sim.cornerSeed`、`seed`、`sim.contact`、`sim.reference`；`corner.angle` 仅为渲染显示副本。外部改写 `corner.angle` 不得改变物理状态（R-02）。
2. **两套接地点**：禁止 `state.x + cy * wheel.x` 形式的 yaw-only 接地点；`contactRoad` 是唯一来源，`contactBody` 不参与力矩。
3. **回退 DEFAULTS**：`reference.source` 缺失必须抛出含字段名的错误；不得回退 `state` 或 `DEFAULTS`（A-01）。
4. **外部写 `corner.angle`**：物理层不得读取 `corner.angle`；种子只从 `seed.rockerAngle` 进入，渲染层不得把 `corner.angle` 写回求解器。
5. **裸叉乘**：`simEvaluate` 内不得出现 `simCross(arm, force)`；法向、摩擦、脉冲必须经 `simApplyForceAt`，`momentParts` 三桶齐全。
6. **`simEvaluate` 有副作用**：不得在 `simEvaluate` 中提交 `sim.contact` 或修改 `sim.state`；只返回 `contactNext`。
7. **两套状态语义**：`frame.converged` 只表示轮架；不得把 `converged`、`ok`、`solverOk` 混用或重命名。
8. **两套测试**：不得新建平行 test 文件；`audit` 只做修复前红基线，未转绿的测试不得提前进入 `npm test`；每文件只属于一个 owner。
9. **未统一基线**：不得以 5890、60 ms 脉冲、8 项动态自检、22 项总自检作为验收值；按第 4 节与 R-06 执行。
10. **依赖与交付**：不得新增运行时依赖、不得改为 ES Modules 或前端框架、不得让渲染层直接构造物理力；单文件离线与 Node >=18 约束不变。

## 7. 变更流程与 B0-0 验收

1. 任何字段新增、重命名、单位变化或空值语义变化，先改本文件并提升 `contracts.vN`，再改主册 §5.3、对应分册与测试；禁止“先改代码后补文档”。
2. 分册与本文件重复的字段表只保留引用；分册不得再定义第二套同名字段。
3. B0-0 验收：本文件存在；表格字段名与来源章节一致；与 01 §6.1、02 §5、03 §7.6、04 B4-4、05 §3/§4.1 逐条对照无矛盾；B0-0 首版只新增本文件，7.1 回改只动本文件与 01/05 的指定句子；不修改源码、测试与 `package.json`。
4. 契约冻结后，B0-1 的审计脚本、B1–B4 的实现与 B5 的文档均引用本文件；发现冲突时先提交 `docs(plan):` 修订，再提交代码。

### 7.1 B0-0 已裁决（2026-11-19）

| # | 议题 | 裁决原文 | 已落到 |
| --- | --- | --- | --- |
| 1 | 随机种子 | 各测试文件固定常量即可，B1 不变量用 20261119、B5 矩阵用例用 20261031；契约只要求固定且记录在用例旁，不要求两个数相同 | 01 §5；05 §4.1、§4.2、§6.2 |
| 2 | 审计分组 | `audit:physics` 组包含 free-body、rocker-reach、seed-writeback、shadowing 四个；shadow 不单列 npm script，归入 physics；05 §4.2 与 §3.4 的 scripts 对齐 | 05 §3.4、§4.2 |
| 3 | dev-server 归属 | dev-server 归 `test-dev-server`（04），`test-runtime` 不含 dev-server | 05 §4.3 A3 |

本次 7.1 回改范围：本文件与 01/05 的上述句子；不改源码。
