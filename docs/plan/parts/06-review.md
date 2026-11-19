# 分册 06：五册一致性与施工前裁决

| 项目 | 内容 |
| --- | --- |
| 审核对象 | 主册 `docs/施工计划.md` 与分册 01–05 |
| 审核基线 | 0.2.0，提交 fbb401d；`npm test` 实跑 47/47 + 52/52 通过 |
| 审核日期 | 2026-11-19 |
| 审核者 | reviewer |
| 结论 | 五册总体可用，但当前版本不能直接开工：10 项已知冲突全部成立，另有 20 项遗漏与缺口；须先完成第 6 节的 P0 修订 |

## 1. 审核范围与方法

本次审核的对象是施工计划本身，不是重新审查 0.2.0 的物理实现。依据为主册 198 行、分册 01 241 行、02 204 行、03 297 行、04 292 行、05 340 行；源码抽查覆盖 `00-core.js`、`03-suspension.js`、`05-body-dynamics.js`、`20-car.js`、`22-car-dynamics.js`、`30-ui.js`、`40-app.js` 与 `package.json`。只读验证执行了 `npm test`（47 项静力、52 项动力学全绿），未执行 `npm run test:browser`；浏览器相关断言只核对文档口径，不判断实际页面行为。

方法分四项。第一，建立“缺陷—工作项—审计脚本—回归用例—文档断言”的追踪表，检查编号能否从主册落到分册再落到命令。第二，逐项比对跨册接口的字段名、单位、空值语义与所有权。第三，重算全部工作量、批次数值与性能数字，凡出现两个以上基准值的工况要求指定唯一采样口径。第四，把每条验收命令按“当前仓库能否执行、修复前是否必须失败、修复后是否可判定”三项检查。脉冲力臂另做独立推导，不引用分册 02 的结论。

本审核不修改任何源码、测试、构建产物或其他分册；只新增本文件。

## 2. 冲突裁决表

| 编号 | 分册/位置 | 冲突 | 裁决 | 需回改文件 |
| --- | --- | --- | --- | --- |
| R-01 | 02 §4.2（第 84–86 行） | `leverBody` 声明为相对质心，却取 `[0.95,0,0]` 保持 5890 N·m，并否决“绝对点减 `cgBody`”（会变 6880） | 物理正确性优先，采纳 `offset - cgBody`。设作用点 `P = refPos + R·offset`，则 `P - r_CG = R·(offset - cgBody)`，绕质心力矩为 `R·((offset - cgBody) × F)`。默认 `xCG=(0.455-0.5)×3.55=-0.15975 m`、`F=(0,-6200,0)`，力臂 `[1.10975,-0.30,0]`，`M_z=-6880.45 N·m`；若把 `xCG` 圆整为 -0.160 m，则为 6882 N·m。5890 是缺陷症状，不是基线；若坚持 5890，必须把激励点重新定义为“质心前方 0.95 m”并同步 README/DESIGN，这等于把作用点后移 0.15975 m，属于另一项物理改动，不能隐式保留 | 02、05、01、主册、README、DESIGN |
| R-02 | 01 B1-4（第 166 行） | 验收写“模拟浏览器回写与不回写两组运行，最终 state 逐位相同”，只在解除回写后才成立，且未说明修复前必须红 | 改写为不变量：“外部改写 `corner.angle` 不影响物理状态”。同一参数建两个 sim，A 每步把 `corner.angle` 设为 `baseAngle`，B 设为 `baseAngle + 1.2`，比较完整 state、`sim.time` 与 flags，要求逐位相同（或差 ≤1e-12）。该用例在 fbb401d 必须失败，B1-4 后通过。`grep` 只作静态守卫；浏览器只断言 `getSceneProbe().rockerAngles` 与 `solved[i].rocker.angle` 一致，不再用“两组运行”作为主判据 | 01、05 |
| R-03 | 05 §3.6/§7.1 与主册 §4/§5 | B0 在 05 为 1.3 人日（7 个 Node + 2 个浏览器审计脚本），主册为 1.0；05 内部又出现 B0-1 0.9 与 0.6+0.3 两套拆法 | 统一为 1.3：B0-1 0.6（共享 harness + 8 个 Node 审计脚本）、B0-1b 0.3（2 个浏览器审计脚本）、B0-2 0.2、B0-3 0.2，合计 1.3。主册新增 B0-1b，B0-1 改 0.6、B0-3 改 0.2；05 §3.6 的 B0-1 0.9 改为 0.6，并把“7 个 Node”改为“8 个”。若坚持 1.0，只能删除 B0-1b 并把浏览器基线移到 B4-8，但 M0 将失去浏览器失败基线，不推荐 | 主册、05 |
| R-04 | 01 §5、05 §3/§4、03 §5、04 §5 | `test-physics-invariants.mjs`、`test-runtime.mjs`、`test-ui-browser.mjs`、`tools/audit/*` 的职责与归属交叉；04 称 test-ui-browser 是唯一新增，05 又把 materialCase、spawnCase 放进它 | 冻结三层契约。第一层 `tools/audit/*`：修复前红基线，输出 JSON，退出码 0/1/2，不进入 `npm test`。第二层 `tools/test-*.mjs`：修复后绿回归，可进入 `npm test`/CI，共享 `tools/test-harness.mjs`。第三层 `tools/bench.mjs`：性能基准，单独运行。归属：`test-physics-invariants` 归 01；`test-dynamics` 的 [10][11][12] 归 02；`test-runtime` 归 03；`test-ui-browser` 与 `test-dev-server` 归 04；05 只登记矩阵、脚本骨架与 baseline，不再新建平行的 test 文件。B0 阶段 `npm test` 仍是 47+52，未转绿的用例不得提前并入 | 01–05、主册 |
| R-05 | 02 §3（第 44 行）与主册 §5 | 02 要求 B2-1 合入顺序在 B2-3 之后；主册把 B2-1 列在 B2-3 之前 | 采纳 02 的顺序：B2-2 → B2-3 → B2-1 → B2-4。B2-2 与 B2-3 共用“车体系转路面系”转换，先合；B2-1 依赖新的接地点与法向载荷基线；B2-4 在最后收口力矩分解。主册增加“合入顺序”列，B2-1 的前置写 B1-1/B1-3，并加注“merge-after B2-3” | 02、主册 |
| R-06 | 02 §4.1-7、03 B3-3、04、05、README/DESIGN | 动态自检 8→10；03 仍写 8；浏览器 `>=8`、弹窗 `>=22`、文档“22 项（14+8）”未同步 | 冻结为 14 项静力 + 10 项动力学 = 24 项。03 B3-3 的“`runDynamicSelfTests` 仍返回 8 项”改为 10；浏览器断言改为 `dynamicTests.length >= 10`、`modalItems >= 24`；README 第 19/172/245 行、DESIGN 第 544/640 行改为 10/24；05 §2.3 的“至少 8 项”与 §2.4 的“≥22”同步。新增两项必须按测试名称断言，不能只靠数量下限。另：README 第 19 行还把 Node 动力学写成 45 项，与第 202 行和实测 52 项冲突，B5-1 一并修正 | 02、03、04、05、README、DESIGN |
| R-07 | 01 §6、02 §4.3/§7、02 §5.4 | 01 提出 `simApplyForceAt`，02 要求“统一力装配”与 `contactRoad` 力臂，但 01 没有任务实现，02 仍保留三处手写 `simCross`，无唯一函数名 | 冻结单一契约：`simEvaluate(sim)` 输出 `force`、`moment`、`momentParts:{normal,friction,impulse}`、`corners`；`simApplyForceAt(sim, roadPoint, forceRoad, bucket)` 以 `roadPoint - cgWorld` 累加力与对应 `momentParts`。法向、摩擦、脉冲三条路径都调用它，`momentParts` 之和等于 `moment`（≤1e-9）。`contactRoad` 是唯一接地点，`contactBody` 只给机构与渲染。实现归 B2-4（0.5 人日内可完成），不是悬空的阶段三接口；01 §6 给签名，02 §7 引用同名函数，05 增加“`simEvaluate` 内不得出现裸 `simCross(arm, force)`”的 grep 守卫。`contactRoad/wheelPosRoad` 由 B2-3 输出，不塞进 B1-3；B1-3 只冻结 `frame/rocker/motionRatio/seed` | 01、02、05 |
| R-08 | 主册 §5、05 §7.1、任务书第 8 条 | 任务书写合计 20.7；主册 B0=1.0 时合计 21.4；B1 点值 6.3 超出主册“4–6 人日” | 核算结果：B0 1.3 + B1 6.3 + B2 3.5 + B3 4.5 + B4 3.6 + B5 1.5 + B6 1.0 = 21.7，不是 20.7。主册 B0 改 1.3，B1 范围改 5–7（或 6–7），B0 范围写 1.3；B2/B3/B4/B5/B6 的点值都在范围内。05 的 R1–R5 合计 3.1：若已包含在 B1–B4，必须给出 R1→B1、R2→B2 等的映射；若不含，则总工期 24.8，超过主册批次上限 23，不能声称“不重复计入” | 主册、05 |
| R-09 | 主册 §4/§5 与 01/02/03/04 | 主册把 B3-2/B3-3/B3-4、B2-1、B4-4 的依赖粗化为 B1/B2；04 的 B4-2→B4-3 与 B4-3→B4-2 形成循环；B4-5/B4-6/B4-7/B4-8 可在 B2 前启动，但主册批次入口写 B2 完成 | 主册增加“前置工作项”与“合入顺序”两列。精确依赖：B2-1←B1-1、B1-3（merge-after B2-3）；B2-2←B1-1；B2-3←B1-3；B2-4←B2-3；B3-2←B2、B1-3、B1-4；B3-3←B3-2、B1；B3-4←B3-2、B1-4；B4-4←B1-3、B1-5、B2；B4-3←B4-2；删除 B4-2 对 B4-3 的依赖；B4-5/B4-7 标“可提前”，B4-6/B4-8←B0；B3-1 在 B3-2 之前合入。批次入口只约束主链，提前项单列 | 主册、04 |
| R-10 | 01 B1-3-7、04 B4-4、03 B3-1/B3-3 | `solverOk`、`rockerResidualMm`、`rockerFeasible`、`motionRatioState`、`solved[i].rocker` 与 `#solverBadge`、检查表首行不同义；03 冻结 8 行，04 新增 2 行 | 冻结字段：`solverOk = corners.every(c => c.ok)`，其中 `ok = frame.converged && rocker.feasible && motionRatioState === 'ok'`；`rockerResidualMm = rocker.residual * 1000`（`rocker.residual` 本身用 m）；新增 `solverState`，取值为 `'ok'`、`'degraded'` 或 `'failed'`。UI 首行判据为 `sim.finite && !sim.recovered && solverOk`；残差 <0.1 mm 是独立的“摇臂闭合残差”行，不得并入 `solverOk`。`#solverBadge` 由 `solverState` 驱动，文案“求解降级/求解失败”，只在状态翻转时更新 `aria-live`。检查表行 id 冻结为 10 行：`sim, contact, links, steer, arb, friction, rockerResidual, motionRatio, staticTests, dynamicTests`；03 B3-3 与 04 B4-4 同步 | 01、03、04 |

R-01 的自检影响范围：动态自检中的“固定步长可重复”与“渲染帧率不影响物理”是同一激励的 A/B 比较，不依赖 5890 的绝对值；“垂向脉冲衰减”用 heave 激励，不受俯仰力臂影响；需要重测的是 4.1 工况、`audit-rocker-reach` 的阻尼峰值、`audit-seed-writeback` 的 A/B/C 对照与 B1-4 的种子独立性。

### 2.1 追加裁决（审核中发现，非任务书列出的 10 项）

| 编号 | 位置 | 问题 | 裁决 | 需回改文件 |
| --- | --- | --- | --- | --- |
| A-01 | 01 B1-6（第 196–202 行） | 把 `reference.source` 缺失时的回退从 `state` 改为 `DEFAULTS`。若 `reference.source` 缺失且模型 `friction=0.2`，`DEFAULTS.friction=1.4` 仍使容量放大 7 倍；05 的 `audit-shadowing` 却要求“容量比值 = 1 或明确抛错” | 不允许静默回退。`simEvaluate` 要求 `reference.source` 存在；缺失时抛出带字段名的错误，或由调用方显式传入 `source`。B3-2 已把 `computeStatic` 的 `source` 改为参数快照，正好可作为唯一来源。01 的验收命令相应改为“缺失时抛错且消息含 `reference.source`” | 01、03、05 |
| A-02 | 02 B2-3 第 118 行 | 回退接地点用 `gravityLocal` 的反方向作“路面法向”投影，但 `gravityLocal` 是重力在路面系中的分量，不是路面法向；倾斜路面会得到 `contact.y ≠ 0` | 回退投影必须用路面系法向 `[0,1,0]`（或 `frame.q` 变换世界法向），不能在路面系内用重力反方向。验收增加 8°/7° 倾斜与 10° 侧倾两组，断言 `abs(contact.y) < 1e-6` 且重算力臂与 `contactRoad` 一致 | 02、05 |
| A-03 | 01 B1-3 第 128–144 行 | 第 1 步保留顶层 `converged` 以兼容既有测试，第 5 步又把它改成“轮架收敛且摇臂可行”；02 §5 用法向力分支又依赖 `converged` | 拆分语义：`converged` 保持“轮架三约束收敛”；新增 `ok = converged && rocker.feasible && ratio` 表示综合可用。02 §5 的法向力主解/回退分支改用 `frame.converged`，不得用综合 `ok`；05 的审计矩阵分别记录两者 | 01、02、05 |
| A-04 | 01 B1-1 第 83–90 行 | 验收块用 `node --input-type=module` 的 heredoc，但正文是 `#` 开头的注释，不是合法 JavaScript，无法执行 | 改为真实脚本：`node tools/test-physics-invariants.mjs --group cg`，断言 `abs(Δcg) < 1e-9`、参考点位移 0.287655 m ± 1e-4、`abs(Δwx) < 1e-12`；若 B0 未就绪，提供 `tools/audit/audit-free-body.mjs` 作为临时入口。删除伪代码验收块 | 01、05 |
| A-05 | 02 B2-1 第 71–73 行 | 第 6 条同时要求“末态逐位相同（偏差小于 1e-12）”和“模式切换发生的子步序号完全一致”，但“逐位”与“≤1e-12”是两种判据；`sim.contact` 只记录 `changes` 与 `since`，没有子步序号 | 二选一：同子步序列下比较完整 state 逐位相同，或统一用 ≤1e-12；为帧率用例增加 `sim.contact.lastChangeStep`（或测试用计数器）记录模式切换的子步序号。驱动循环必须累计墙钟、末帧按剩余时间截断，并在断言中报告 `sim.time` 与子步数；不得用固定 `fps` 次循环代替 | 02、05 |
| A-06 | 02 §5.3 第 176 行 | 重新驻车用例需要 `simRetargetReference(sim, source)`，但主册与 01/03 都没有这个工作项；B2-1 验收又直接赋值 `SIM.reference` | 把 `simRetargetReference` 正式并入 B2-1（0.5 人日内）：重算 `computeStatic`、清空 `cornerSeed`、保留 `state` 与 `contact`，并校验新旧 `geometryRevision` 一致；若归 B3-2，则 B2-1 的用例必须推迟到 B3 之后，不能现在写“直接赋值等价于 40-app.js:76” | 02、03、主册 |

## 3. 跨册接口契约核对表

| 契约项 | 定义位置 | 消费方 | 核对结果 | 裁决/回改 |
| --- | --- | --- | --- | --- |
| 状态 `x/y/z`、`vx/vy/vz` | 01 B1-1 | 02 §5.1、03 B3-2、04 B4-4 | 语义明确：B1-1 后为质心；02 的“`contact - state`”与 01 一致 | 保留；02 §5.1 的 B1-1 前兼容写法只用于旧基线，不得进入生产路径 |
| `referencePoint`、`bodyPos`、`heave` | 01 B1-1 第 6 步 | 03 B3-2、04 B4-4、05 | 01 定义 `bodyPos=refPos`、`heave=refPos.y`；03 B3-2 第 142 行仍写“`reference.source` 回退 `state` 的语义不变”，与 B1-6 冲突 | 03 改为“`reference.source` 必须存在”；01 B1-6 与 A-01 同步 |
| `suspSolveCorner` 返回 `frame/rocker/motionRatio/seed` | 01 B1-3 | 02 §5、04 B4-4 | 01 的返回结构没有 `contactRoad/wheelPosRoad`；02 §5 却把它们列为 B1-3 的最小字段 | 02 §5 表格改标“B2-3 输出”；B1-3 只冻结求解协议四组字段；02 B2-3 第 1 步保留“追加四个字段”的写法 |
| `contactBody/contactRoad/wheelPosRoad` | 02 B2-3 | 01 §6、03 B3-2、04 B4-4 | 02 第 2 步让 `corner.contact = solved.contactRoad`，但 01 §6 又说 `simEvaluate` 输出 `contact`；两个来源未标主从 | 冻结：`suspSolveCorner` 输出 `contactBody/wheelPosBody/contactRoad/wheelPosRoad`；`simEvaluate.corners[i].contact = contactRoad`；其余模块只读 `corner.contact`；`contactBody` 只给渲染 |
| `ForceEvaluation`、`momentParts` | 01 §6（未给 schema）、02 B2-4 | 02 §4.4、05 | 01 只给散文描述，02 要求新增 `momentParts`；没有字段总表 | 在 01 §6 增加完整 schema 表：`force[3]`、`moment[3]`、`momentParts{normal,friction,impulse}`、`corners[i].contact/contactVelocity/normal/friction`、`cg`、`flags`；02 B2-4 按表实现 |
| `simApplyForceAt` | 01 §6 | 02 §7、阶段三 | 01 只说“新增”，无工作项、无验收、无调用点；02 仍三处手写叉乘 | 按 R-07 在 B2-4 实现并替换三处；01 §6 签名冻结；05 加 grep 守卫 |
| `sim.contact` 与 `simInfo.mode/usage/slipSpeed` | 02 B2-1 第 1/6 步、02 §7.6 | 04 B4-4、05 | 02 一方面写 `sim.contact.mode`，另一方面冻结 `sim.mode`、`sim.usage`、`sim.slipSpeed`；浏览器用例读 `getSnapshot().sim.mode` | 明确扁平化：内部 `sim.contact` 为唯一状态对象；`simBuildModel.simInfo` 输出 `mode/usage/slipSpeed/dwell/changes/reason`；`getSnapshot().sim` 只读这些投影；02 §7.6 改为“快照字段” |
| 快照字段总表 | 01 B1-3、02 B2-1/B2-4、03 B3-1/B3-2/B3-3/B3-4、04 B4-4 | 全部 | 五册各自追加字段，没有一处汇总；同名不同义风险高 | 主册或 01 增加“`simBuildModel` 快照契约 v1”表，列出字段、单位、空值、引入批次；后续分册只增不改 |
| `geometryRevision`、`sceneRevision`、`physicsRevision` | 03 B3-2 | 04 B4-8、05 | 定义了 `geometryRevision` 与 `physicsSignature`，但 `getSnapshot.geometry.physicsRevision` 没有定义来源；验收却要求 `sceneRevision === physicsRevision` | 明确 `sceneRevision = CAR.geometryRevision`、`physicsRevision = SIM.geometryRevision`；若两者同源则删除 `physicsRevision` 或定义为“`SIM.reference.geometryRevision`”；04 的断言按定义改写 |
| `CAR.assets.lastBuild` | 03 B3-4 | 03 验收、05 | 只定义 `lastBuild` 字段，未定义其内部结构；验收却读 `lastBuild.instanceMaterialCreated === 7` | 定义 `lastBuild = { instanceMaterialCreated, instanceMaterialDisposed, geometryDisposed, textureDisposed, at }` 为“本次构建”计数，累计计数另放 `totals`；验收按此断言 |
| `solverOk`、`solverState`、残差单位 | 01 B1-3-7、04 B4-4 | 01/02/05/浏览器 | 01 说 `solverOk` 为四角 `ok`（含运动比）；04 说“四角综合通过条件”，UI 又加“残差 <0.1 mm”；`rocker.residual` 在 01 B1-2 是模型单位（m），B1-3 验收却按 mm 写 | 按 R-10 冻结；明确 `rocker.residual` 单位 m、`rockerResidualMm` 单位 mm；UI 的 0.1 mm 是独立行判据，不改变 `solverOk` 定义 |
| 自检数量 | 02/03/04/05/README/DESIGN | 浏览器、UI、文档 | 8 vs 10、22 vs 24、Node 45 vs 52 三组数字并存 | 按 R-06 统一为 14+10=24、Node 52；README 第 19 行“45”改“52” |
| 浏览器测试归属 | 01 §5、02 §6、03 §5、04 §5、05 §4 | CI | 同一文件被四个分册追加；03 说追加到 test-dynamics-browser，05 说 test-ui-browser，04 说 test-ui-browser 是新文件 | 按 R-04 归口：`test-dynamics-browser` 只由 03/04 追加独立段；`test-ui-browser` 只由 04 创建；05 的 browser audit 单独两个脚本；任何提交不得改 `try/finally` 与启动流程 |
| npm scripts 与 CI | 04 B4-8、05 §3.4/§5 | 本地与 CI | `build --check` 与 `build:check` 两套；`REQUIRE_CHROME` 与 `FS_REQUIRE_CHROME` 两个变量；05 的 `ci:node` 含 test:invariants/test:runtime，04 的 CI 只跑 `npm test`；05 的 `ci:browser` 直接 node 调用，绕过 `pretest` 构建 | 冻结唯一命令表：`build:check`（`tools/check-build.mjs`）为唯一产物门禁；`FS_REQUIRE_CHROME` 为唯一严格变量；CI 的 node job 跑 `npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server && npm run build:check`；browser job 用 `npm run` 以触发 `pretest:*`，并统一退出码：test=1，audit=2 |
| `simRetargetReference` | 02 §5.3 | B2-1、B3-2 | 无工作项、无归属；02 验收又直接赋值 | 按 A-06 并入 B2-1 或 B3-2；若并入 B3-2，B2-1 用例推迟并改依赖 |

## 4. 编号、依赖与工作量核对

### 4.1 编号追踪

| 检查项 | 结果 |
| --- | --- |
| 主册工作项 | B0-1/2/3、B1-1…B1-6、B2-1…B2-4、B3-1…B3-4、B4-1…B4-8、B5-1/2、B6-1，均有分册或主册条目 |
| 缺失编号 | 05 的 `B0-1b` 与 `R1–R5` 未进主册；主册的 B5-1/B5-2/B6-1 在分册中没有实施步骤，只指向“主册”自身，形成循环 |
| 缺陷编号 | 01 用 E1–E8，03 用 E1–E10，04 用 E1–E15，05 混用 B4.1–B4.5、B5.1–B5.4、A1–A4、O1、U1–U6；同一“E1”在不同分册含义不同，`B4.1`（缺陷）与 `B4-1`（工作项）只差一个连字符。建议统一为 `P01-E1`、`P02-C1`、`P05-D4.1` 形式，并在主册加“缺陷—工作项—脚本—测试”四列追踪表 |
| 审计脚本数量 | 05 目录列 8 个 Node 审计（free-body、rocker-reach、friction-low-speed、impulse-frame、contact-gap、frame-time、seed-writeback、shadowing）加 2 个浏览器审计；B0-1 文字写“7 个 Node”，少算一个。`audit-browser-contract` 覆盖 B5.2/B5.3/B5.4/O1 四项，`audit-ui` 覆盖 U1–U4/U6；需在表中标明每个脚本对应的缺陷，避免“7 个”与“8 个”再次漂移 |

### 4.2 依赖核对

| 工作项 | 主册写法 | 分册写法 | 裁决 |
| --- | --- | --- | --- |
| B2-1 | B1 | B0、B1-1、B1-3；merge-after B2-3 | 主册补 B1-1/B1-3 与 merge-after |
| B2-2 | B1 | B0、B1-1 | 主册补 B1-1 |
| B2-3 | B1 | B0、B1-3 | 主册补 B1-3 |
| B2-4 | B2-3 | B2-3 | 一致 |
| B3-1 | B2 | B2 | 一致；但需注明先于 B3-2 合入 |
| B3-2 | B2 | B2、B1-3、B1-4 | 主册补 B1-3/B1-4 |
| B3-3 | B2 | B3-2、B1 | 主册改 B3-2、B1 |
| B3-4 | B2 | B3-2、B1-4 | 主册改 B3-2、B1-4 |
| B4-2 | B2 | “B4-3 的断言可共用”（非依赖） | 删除对 B4-3 的伪依赖；B4-2 仍受 B4 批次入口 B2 约束；B4-3 依赖 B4-2 |
| B4-4 | B1、B2 | B1-3、B2（正文又提 B1-5） | 改为 B1-3、B1-5、B2 |
| B4-5/B4-6/B4-7 | — | 可立即开始/ B0 后 | 主册批次入口不能写“B2 完成”；标“可提前” |
| B4-8 | B0 | B0 | 一致 |
| B5-1/B5-2 | B3、B4 | 无分册实施步骤 | 需指定 owner 与文件，见遗漏 O-01 |
| B6-1 | B5 | 无分册实施步骤 | 可在主册保留，但需给出可执行验收命令 |

### 4.3 工作量核对

| 批次 | 分项合计 | 主册“建议工作量” | 核对 |
| --- | ---: | ---: | --- |
| B0 | 1.3（0.6+0.3+0.2+0.2） | 1.0 | 不一致；统一为 1.3，主册范围同步 1.3 |
| B1 | 6.3（2.0+1.5+1.0+0.5+1.0+0.3） | 4–6 | 6.3 超出上限 0.3；改 5–7 或 6–7 |
| B2 | 3.5（1.5+0.5+1.0+0.5） | 3–4 | 通过 |
| B3 | 4.5（1.0+1.5+1.0+1.0） | 3–5 | 通过 |
| B4 | 3.6（0.5+0.5+0.5+0.5+0.3+0.5+0.3+0.5） | 3–4 | 通过 |
| B5 | 1.5（1.0+0.5） | 1–2 | 通过 |
| B6 | 1.0 | 1 | 通过 |
| 合计 | 21.7（B0=1.3）；21.4（B0=1.0） | — | 任务书第 8 条的 20.7 是笔误；若 R1–R5 3.1 不含在 B1–B4，则 24.8 |

另需核对 05 §7.1 的“B0+R1–R5 合计 4.4（B0 1.3 + R1–R5 3.1）”与 §3.6 的“B0-1 0.9、B0-2 0.2、B0-3 0.2”。两套账的 B0 都是 1.3，但 B0-1 的粒度不同：§3.6 的 0.9 把 2 个浏览器脚本放在 B0-1 内，§7.1 则拆成 B0-1 0.6 与 B0-1b 0.3。读者若把 0.9 与 B0-1b 的 0.3 相加会得到 1.6；必须明确 B0-1b 是从 0.9 中拆出，推荐统一采用 §7.1 的 0.6+0.3+0.2+0.2，并在 §3.6 同步。

### 4.4 数字口径

| 项目 | 各分册数字 | 裁决 |
| --- | --- | --- |
| 4.1 工况残差 | 01: 18.63 mm（下限 725.77）; 主册/05: 4.02 mm（下限 709.40）; 05: 4.02–4.52 mm; B 报告: 3.59 mm | 指定唯一主基线：600 kg、50/50 N/mm、阻尼比 0.05、ARB 0、settle 1.5 s、俯仰脉冲、取“首个不可达样本”的残差 4.02 mm；其余标为敏感性样本，不作为通过阈值 |
| 4.1 运动比 | 主册 -4.20; 01 -6.92..6.98 / 回写 -7.38..7.56; 05 -4.20..-6.73; B 报告 -7.58..7.35 | 同上：主基线取首个不可达样本 -4.20；峰值范围单列；审计用“无符号跳变 + 区间”而非单点 |
| 4.1 阻尼峰值 | 主册 30.7 / 回写 46.3; 01 33.38 / 45.97; 05 A=33.38、B=46.42; B 报告 41.94 | 统一统计窗口（脉冲后 2 s 峰值）与采样点；主基线标 30.7（复核）/46.3（回写），其余作为敏感性；R-01 重定后必须重测 |
| 脉冲力矩 | 02/05: 5890; 01: 未给数值；B 报告: 约 5890 | 改为 6880.45 N·m（约 6882），并按 R-01 重定 0°/90°/24 姿态与 4.1 全部脉冲基线 |
| 脉冲时长 | README 与 05: 0.12 s；02 C-6 与 05 audit-contact-gap: “60 ms” | 0.12 s 是总时长；“60 ms”只能表述为“脉冲开始后 60 ms 采样”，不能写成“60 ms 脉冲” |
| 几何偏差 | 03: 轴距 3.90 m 时杆长偏差 104.10 mm；05 audit-browser-contract: 场景轮位 1.775 m（差 175 mm） | 两个指标不同：104 mm 是杆长/硬点闭合偏差，175 mm 是轮位 x 偏差；分别命名并各自给阈值，不能互相替代 |
| suspEval | 主册 88 次/子步；01 B1-5 目标 ≤30，备选 ≤60；05 A1 ≤30 | 生产验收 ≤30；备选 ≤60 只能作为“带记录的临时降级”，05 的 A1 仍按 30 判，否则不得合入 |
| Node 测试数 | README 19: 47+45；README 202/主册/05: 47+52 | 统一 47+52；README 第 19 行修正 |
| 自检数 | 8/22（现状）; 02 要求 10; 03 仍 8; 05 至少 8/≥22 | 统一 10/24，按 R-06 |

## 5. 遗漏项清单

| 编号 | 遗漏项 | 影响 | 建议 |
| --- | --- | --- | --- |
| O-01 | B5-1/B5-2 没有分册实施步骤，主册分册列写“主册”，形成自引用；README/DESIGN 的每条物理断言未绑定测试编号 | 文档同步不可执行，阶段三准入第 4 条无法验收 | 新增分册 07 或把 B5-1/B5-2 并入 05 §4.2；给出 README/DESIGN 行号、断言、对应测试 id 的三列表 |
| O-02 | B4-4 验收要求 4.1 参数下“模态框存在 `#selfTestList li.is-fail`”，但没有任何自检项被指定为在该参数下必然失败 | 该断言可能永远不成立，B4-4 无法验收 | 改为断言 `#solverBadge` 与残差行；若要保留 `li.is-fail`，明确由哪条新增自检（B2-1 低速项或 B1-3 求解项）产生 |
| O-03 | CI 命令四套：`build --check`、`build:check`、`git diff index.html`、`npm run build && ...`；环境变量两套：`REQUIRE_CHROME` 与 `FS_REQUIRE_CHROME`；04 的 CI 只跑 `npm test`，不跑 05 的 `test:invariants`/`test:runtime` | CI 可能验证旧产物或漏跑新回归 | 按第 3 节“npm scripts 与 CI”行冻结唯一命令表；CI 的 node job 显式列出全部命令 |
| O-04 | 05 的 browser audit 与 04 的 `test-ui-browser` 都覆盖 U1–U4/U6；05 的 materialCase/spawnCase 与 03/04 的归属不清 | 同一断言两处维护，合并冲突 | 按 R-04 归属；05 只保留两个 audit 脚本，04 的 test-ui-browser 只保留 UI 组 |
| O-05 | 03 B3-3 冻结 8 行检查表，04 B4-4 增加“摇臂闭合残差”“运动比连续性”两行；03 B3-1 又改首行文案 | 两处同时改 `refreshChecks`，必冲突；行 id 不稳定 | 按 R-10 冻结 10 行与顺序；B3-1 只加时间字段，B4-4 只改首行判据与新增两行，合并顺序写入主册 |
| O-06 | 03 B3-2 仍按现状在 `refreshAll` 中先执行 `SIM.reference = reference`，pending 检查在其后；文档只写“pending 时直接返回”，未明确删除这一行 | E4“旧硬点接收新参考”仍会发生，B3-2 的核心修复可能失效 | 明确：pending 期间不得写 `SIM.reference`、不得 `simReset`；所有替换在 `processPendingRebuild` 的同一 rAF 内完成；验收在 pending 窗口逐帧断言 `SIM.reference.geometryRevision` 未变 |
| O-07 | 03 B3-2 的 `GEOMETRY_REVISIONS` 最多 64 项，淘汰后“回到原值仍返回原 revision”不再成立，与验收冲突 | 长时间调参后 revision 语义变化，测试可能偶发失败 | 要么去掉“回到原值同 revision”的强断言，改为“同值同 revision（未淘汰时）”；要么不淘汰当前活动 revision，只淘汰历史 |
| O-08 | 05 §4.2 的 U5 浏览器阈值“三点误差 ≤5%”，04 B4-5 的 Node 断言是 1e-12；U6 退出码 2，04 B4-6 是 1，04 的 `CHROME_PATH=/bin/false` 默认又可能 SKIP 退出 0 | 同一行为三套判据，无法判定 | 统一：Node 线性断言 1e-12；浏览器仅验证 `height/load` 比例与零载；test 脚本失败退出 1、audit 环境错误退出 2、缺 Chrome 默认 SKIP（严格变量失败） |
| O-09 | 04 B4-1 的验收命令 `npm run test:ui` 由 B4-8 创建；若 B4-1 先合入，命令不存在 | 验收不可执行 | 明确 B4-8 先于 B4-1 合入，或 B4-1 先用 `node tools/capture-docs.mjs`/手工探针，B4-8 后再补自动断言 |
| O-10 | 01 B1-2 的随机 1000 组/500 步连续性验收没有固定随机种子；02/05 的随机包线有 `mulberry32`，但新测试未提 | 结果不可复现，CI 可能偶发 | 在 01/05 的验收中写死 seed 与样本数；所有随机测试使用同一 `mulberry32(seed)` |
| O-11 | 01 B1-5 的“备选 ≤60”与主册/05 的“≤30”并存；性能预算把 `simBuildModel` 单列，但 05 的 A1 又把模型耗时并入 ≤0.05 ms | 合入时无法判断是否达标 | 生产路径必须 ≤30；备选 60 只能作为独立实验分支并记录偏差；A1 分两行：每子步 ≤30、模型 ≤0.05 ms |
| O-12 | 02 B2-3 的验收第 5 条“由 B2-4 实现”，但 B2-3 的入口命令 `audit-contact-gap.mjs` 要求全部通过 | B2-3 单独合入时该脚本必失败，无法按批次验收 | 把第 5 条移到 B2-4 的验收；B2-3 的 audit 分组只跑第 1–4 条，B2-4 跑完整组 |
| O-13 | 02 B2-1 要求 `simEvaluate` 无副作用，但又把 `dwell/changes` 存在 `sim.contact`，未说明谁提交、何时提交 | 遥测调用 `simBuildModel` 可能推进状态机，或读到陈旧状态 | 明确 `simEvaluate` 返回 `contactNext` 纯对象；`simStep` 在积分后提交 `sim.contact`；`simBuildModel` 只读已提交值；增加“连续 100 次 `simBuildModel` 不改变 `changes/dwell`”断言 |
| O-14 | 02 B2-1 的横摆冲量预算只写 `L_ext` 为外部切向力，未含法向力产生的横摆力矩 | HOLD 清零 `wy` 时可能漏掉法向力对横摆的贡献，重新驻车判定偏差 | 明确 `L_ext` 包含法向力矩、摩擦力矩与脉冲力矩的 y 分量；在 8°/7° 与 10°/10° 工况各加一条 `wy` 预算断言 |
| O-15 | 03 B3-3 的“动态自检 2.5 s 内齐全”与新增两项后的 572 ms→更长总时长、首片 150 ms 未重测 | 分片预算可能不达标 | B2-1 合入后重测 `runDynamicSelfTests` 总时长与首片；把 2.5 s 上限改为实测 + 50% 裕度，或把两项放入后续分片 |
| O-16 | 04 B4-6 的 `withChrome` 失败退出码、`browserGate` 默认 SKIP 与 05 的 U6/审计退出码未统一；`capture-docs` 是否参与门禁也未定 | CI 与本地行为不一致 | 按 O-08 统一；capture-docs 默认不参与门禁，仅在 `docs:capture` 中运行 |
| O-17 | 05 §4.2 的 A4 清理项指向 `tools/test-static.mjs`，但该文件不存在；04 B4-7 把断言放进 `test-dynamics.mjs` | 断言无处落地 | 删除 `test-static.mjs` 引用，统一放 `test-dynamics.mjs` 或 `test-core.mjs` |
| O-18 | 03 B3-1 的 `SIM_MAX_BACKLOG=0.5` 需要 250 子步才能排空，但 `SIM_MAX_SUBSTEPS=128`，文档未说明“积压跨帧排空”的行为 | 恢复帧后可能连续多帧慢动作，用户误判卡顿 | 在 B3-1 明确“backlog 可跨帧保留，最多 128 步/帧”；验收加“长暂停后连续 3 帧的 timeScale 序列” |
| O-19 | 05 §7.1 的 R1–R5 与 B1–B4 工作项没有一一映射；主册 B5-1/B5-2 也没有测试编号 | 工期与验收责任不清 | 增加 R1→B1-1/3/5、R2→B2-1/3/4、R3→B3-1/2/3/4、R4→B4-1…B4-6、R5→B4-8 的映射；每项写“包含在哪个工作项的 0.x 人日内” |
| O-20 | 01/03/04 的 E 编号、05 的 B4.x 缺陷编号与主册的“B 4.x”没有统一前缀 | 评审与提交信息易混淆 | 采用 `P01-E1`、`P02-C1`、`P03-E1`、`P04-E1`、`P05-D4.1`；主册保留“B 报告 4.1”全称 |

## 6. 施工前必须完成的修订清单

### P0（阻断 B0 开工，必须先改文档）

1. **冻结“接口契约 v1”**：在 01 增加状态、角点、`ForceEvaluation`、`simBuildModel` 快照四张字段表；在 02 增加 `contactRoad`、`sim.contact`、`momentParts` 三张表；在 04 增加 UI 字段与行 id 表。上述字段表同名同义，后续分册只引用不重定义。回改：01/02/03/04/05。
2. **R-01 脉冲力臂**：全部 5890 改为 6880.45（约 6882）；02 §4.2 第 1–6 条、05 的 audit-impulse-frame/seed-writeback/rocker-reach、01 的 4.1 基线与 B1-4 对照全部重测；README 第 81 行明确“参考点前方 0.95 m”，DESIGN 20.2 同步。回改：01/02/05/README/DESIGN/主册。
3. **R-07 力装配**：冻结 `simApplyForceAt(sim, roadPoint, forceRoad, bucket)` 与 `momentParts`，在 B2-4 实现并替换三处手写叉乘；`contactRoad` 由 B2-3 输出；05 加 grep 守卫。回改：01/02/05。
4. **R-10 UI 契约**：冻结 `solverOk/ok/solverState`、残差单位、10 行检查表；03 B3-3 与 04 B4-4 按同一行 id 改写；`#solverBadge` 只由 `solverState` 驱动。回改：01/03/04。
5. **R-03/R-08 工作量**：B0=1.3（0.6+0.3+0.2+0.2），主册新增 B0-1b，B1 范围 5–7，总 21.7；明确 R1–R5 是否含在 B1–B4，若不含则总 24.8 并重排批次。回改：主册/05。
6. **R-09 依赖与合入顺序**：主册增加“前置工作项/合入顺序”列；B2-1 after B2-3；B3-2←B1-3/B1-4；B3-3/B3-4←B3-2；B4-2/B4-3 去循环；B4-5/B4-6/B4-7/B4-8 标“可提前”。回改：主册/04。
7. **R-06 自检数量**：14+10=24；03 的“仍返回 8”改 10；浏览器 `>=10`、弹窗 `>=24`；README/DESIGN/05 同步；README 第 19 行 45→52。回改：02/03/04/05/README/DESIGN。
8. **R-02 B1-4 验收**：改为“外部改写 `corner.angle` 不影响物理”，明确 fbb401d 红、B1-4 后绿；浏览器只做渲染一致性。回改：01/05。
9. **A-01 变量遮蔽回退**：`reference.source` 缺失必须抛错或显式传入 source，不能回退 `DEFAULTS`；05 的 audit-shadowing 同步。回改：01/03/05。
10. **A-02 接地点回退法向**：用 `[0,1,0]`，不用 `gravityLocal` 反方向；补倾斜路面断言。回改：02/05。

### P1（B1/B2 开工前完成）

11. **A-03 `converged` 语义**：`converged` 只表示轮架；`ok` 表示综合；02 §5 用 `frame.converged`。回改：01/02/05。
12. **A-04 可执行验收**：删除 B1-1 的伪 heredoc，改为 `test:invariants --group cg` 或 audit 脚本；所有验收命令给出退出码与实测输出。回改：01/05。
13. **A-05 帧率一致**：B2-1 改为同一 `sim.time`/子步数比较；明确 `simAdvance` 的截断方式。回改：02/05。
14. **A-06 `simRetargetReference`**：并入 B2-1 或 B3-2，写清签名、调用点与验收。回改：02/03/主册。
15. **4.1 唯一基线**：在 05 §4.2 顶部放“4.1 工况定义”表（参数、settle、脉冲、采样、统计窗口），01/02/04 只引用。回改：01/02/04/05。
16. **B3-2 pending 冻结**：删除 `refreshAll` 中 pending 前的 `SIM.reference` 赋值；定义 `sceneRevision/physicsRevision/lastBuild`；处理 64 项淘汰。回改：03。
17. **B3-3/B4-4 行与分片**：10 行 id、`#solverBadge`、`selfTestRuns`、动态 10 项后的 2.5 s 预算。回改：03/04。
18. **B4 工具链**：统一 `build:check`、`FS_REQUIRE_CHROME`、退出码、`test:ui` 先于 B4-1、CI 跑全量新测试。回改：04/05。

## 7. 结论

五册的计划质量总体达标：每册都有现状证据、逐项步骤、验收、风险与回滚，物理缺陷的定位与主册的批次设计基本成立。基线 `npm test` 47+52 全绿，说明这不是重新审查项目，而是把已知缺陷转成可执行工程计划；这一点五册做到了。

但当前版本不能直接发放施工。10 项已知冲突全部成立，其中 R-01（脉冲力臂）、R-07（力装配/接地点契约）、R-10（求解状态与 UI 字段）会直接改变物理结果或导致返工，R-03/R-08/R-09 会使工期与依赖失真；另有 A-01、A-02 两处会把“修复”写成新的物理错误。按现有文本开工，B2 与 B4 很可能在验收阶段发现基线对不上，进而大面积重定阈值。

建议 lead 先做一次只改文档的“契约冻结”提交：按第 6 节 P0 的 1–10 项回改主册与 01–05，产出 plan-r2；再让各分册作者确认自己消费的字段与命令。P0 完成后，B0 可以按 1.3 人日启动，M0 的 12 项失败基线才有可追溯的判据。P1 可在 B1/B2 开工前并行完成，不阻塞 B0。

本次审核只读验证了 `npm test`，未运行 `npm run test:browser`；浏览器相关条目均为文档口径核对，实施者合并前仍需在空闲端口实跑一次。除本文件外，未修改任何文件。
