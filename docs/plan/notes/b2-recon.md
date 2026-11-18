# B2 施工勘察（b2-recon）

| 项目 | 内容 |
| --- | --- |
| 分支 | `feat/plan-execution` |
| HEAD | `fbb401d`（0.2.0）；`src/` 尚未改动，`tools/audit/` 与 `package.json` 已由 B0 提交 |
| 依据 | `docs/plan/contracts.v1.md` §1/§2/§4；分册 02（r2）；分册 01 §6.1；`tools/audit/{friction-low-speed,impulse-frame,contact-gap}.mjs` |
| 性质 | 只读勘察；本文件是 B2 施工清单，不写 `src/` 与 `tools/` |
| 状态 | B1 施工中，B2 未解冻；行号以 `fbb401d` 为准，B1 合入后按符号重新锚定。r1 三处裁决已于 2026-11-19 回写分册 02，本文 §8 标注“已裁决” |

结论：四个工作项的技术路径在 `contracts.v1` 下成立。原三处施工级缺口已于 2026-11-19 裁决并回写分册 02：`simApplyForceAt` 用 `sim._evalAccum` 累加器、横摆预算只取 normal+impulse、脉冲力统一为 `forceRoad`。§8 保留裁决原文与反例，B2-1 与 B2-4 可据此开工。

## 1. 解冻条件与 B1 交接

B2 只消费 B1 的以下输出，不重定义；B1 未定稿的字段一律不得在 B2 中先行建立。

| 交接项 | B1 归属 | B2 消费点 | 未定稿时不能开工的步骤 |
| --- | --- | --- | --- |
| `sim.state.x/y/z`、`vx/vy/vz` 为质心量；`referencePoint`、`simBodyPointFromCg`、`simReferencePoint` | B1-1 | 05:206-208 的 `cg`、05:225 的 `bodyPos`、05:379 的力臂、05:460-462 的积分 | B2-2 的作用点 `P=refPos+R·offset`、B2-1 的 `cgWorld`、B2-4 的力矩原点 |
| `corners[i].frame.converged`（仅轮架）、`rocker.{angle,residual,feasible,branch}`、`motionRatioState`、`seed.{thL,thU,spin,rockerAngle}`、`ok`、`coilLength` | B1-3 | 05:243-262 力分支、05:588-604 快照、`solverOk`（05:665） | B2-3 第 1 步（在分层结构上追加四字段）、B2-1 的 `frame.converged` 分支 |
| `sim.cornerSeed[i]` 为唯一种子源；`corner.angle` 仅渲染副本 | B1-4 | 05:243-244 | B2-3 的 `suspSolveCorner` 调用、B2-1 的重新驻车用例 |
| `reference.referencePoint`、`model.bodyPos/heave`（参考点）、`model.cgWorld`（质心） | B1-1 | 05:586-593 快照、05:639-644 | 可暂缺；缺省时 B2 用 `cgBody` 推导，不得写死数值 |
| `cornerY`、`cornerVelocityY` 改为相对质心的臂 | B1-1 | 05:233-234、05:246-252 | B2-1 的弹簧行程与接地点速度预算 |
| `geometryRevision`、`sim.geometryRevision` | B3-2 | `simRetargetReference` 的校验项 | 可降级：两者均 `undefined` 时跳过校验，不得抛错 |

解冻判据（全部满足）：`npm test` 回到 47+52；`node tools/test-physics-invariants.mjs` 六个分组全绿；contact 组的 12 条仍能跑到各自断言。依赖提醒：B1-2 把 `suspRockerAngle` 返回结构改成对象后，`audit-rocker-reach.mjs:62-65` 需 05 同步（当前把返回值当数值传给 `suspRockerPoint`）；`audit-seed-writeback.mjs:46/54` 只读 `evaluation.corners[].dampingForce/motionRatio`，B1/B2 必须保留这两个字段，B2-1 的 `simStep` 也必须继续返回 evaluation。

## 2. 精确改动总表

| ID | 文件:行号 | 函数 | 当前实现 | 目标实现 |
| --- | --- | --- | --- | --- |
| B2-2a | `05:178-195` | `simApplyImpulse` | `offset` 车体系、`force` 路面系，字段名未标注坐标系 | 字段名不变，注释写明 `offset` 为相对参考点的车体系绝对点、`force` 为路面系；数值不变 |
| B2-2b | `05:375-383` | `simEvaluate` 脉冲块 | `simCross(impulse.offset, impulse.force)` | `leverRoad = simQuatRotate(q, offset - cgBody)`；`simCross(leverRoad, impulse.forceRoad)`；力直接加到路面系 `force` |
| B2-3a | `03:257-297` | `suspSolveCorner` | 返回 `contact`（车体系）、`wheelPos`（车体系） | 追加 `contactBody/wheelPosBody/contactRoad/wheelPosRoad`；`*Road = R(bodyQuat)·*Body + bodyPos` |
| B2-3b | `05:267-268` | `simEvaluate` 角点循环 | `contactX/Z = 参考点 + 横摆旋转的设计轮位` | `corner.contact = solved.contactRoad`；`corner.wheelPos = solved.wheelPosRoad` |
| B2-3c | `05:269-285` | 角点记录 | 只有 `cornerVelocityY` 标量 | 追加 `contactVelocity[3]`、`wheelPos[3]`、`normal`（=钳位后 `force`）、`friction[3]` |
| B2-3d | `05:351-356` | 滑动摩擦接地点速度 | 用 yaw-only `corner.contact` 重算 | 读 `corner.contactVelocity`（B2-3c 已算），力臂 `contact - cg` |
| B2-3e | `05:561-570` | `simBuildModel` | `contactPoints` 取 `corner.contact`；`wheelCenters = contact + (0,R,0)` | `contactPoints` 不变（来源已统一）；`wheelCenters` 取 `corner.wheelPos` |
| B2-3f | `05:586-604` | `simBuildModel` 的 `solved` | 二次 `applyQuaternion().add(bodyVec)` | 直接拷贝 `corner.contact`/`corner.wheelPos`；保留 `rockerAngle/coilLength/motionRatio/converged` 兼容字段 |
| B2-1a | `05:23-31` | 常量 | `SIM_REST_SPEED` 等 | 增 `SIM_ARREST_SPEED=2e-3`、`SIM_ARREST_RATE=2e-3`、`SIM_ARREST_DWELL=3`、`SIM_HOLD_HYSTERESIS=0.02` |
| B2-1b | `05:127-151`、`153-172` | `simCreate`/`simReset` | `flags{holding,sliding,...}`、`cornerSeed` | 增 `contact{...}` 初值 `mode='HOLD'` |
| B2-1c | `05:199` | `simEvaluate` 签名 | `(sim)` | `(sim, dt = SIM_DT)`；审计只传一参，靠默认值兼容 |
| B2-1d | `05:315-373` | 摩擦块 | `atRest/holding/sliding` 每步重算；动摩擦 `μN` 无上限 | 两态机 + 刹停冲量上限 `k`；输出 `contactNext` 与每角 `friction` |
| B2-1e | `05:407-512` | `simIntegrate` | 用 `evaluation.holding` 三处（426、439、471） | 用 `evaluation.contactNext.mode`；积分后算 `SLIP→HOLD` 与投影，写入 `contactNext` |
| B2-1f | `05:514-517` | `simStep` | 直接返回 `simIntegrate` | 返回前提交 `sim.contact = evaluation.contactNext`（契约：唯一提交者） |
| B2-1g | `05:507-508` | `simIntegrate` 尾部 | `flags.holding/sliding = evaluation.*` | 由 `contactNext.mode` 派生，保持与旧 flags 等价 |
| B2-1h | `05:172` 之后 | 新函数 | 无 | `simRetargetReference(sim, source)`：重算 `computeStatic`、校验 `geometryRevision`、清空 `cornerSeed`、保留 `state/contact/time/impulse` |
| B2-1i | `05:618-634` | `simInfo` | `holding/sliding/atRest/...` | 增 `mode/dwell/since/changes/lastChangeStep/reason/slipSpeed/usage` |
| B2-1j | `05:711-815` | `runDynamicSelfTests` | 8 项 | 增“低速驻车”“滑移不反向”，共 10 项 |
| B2-4a | 05 新增（`simEvaluate` 之前） | `simApplyForceAt` | 无 | `(sim, roadPoint, forceRoad, bucket)` 纯累加，力臂 `roadPoint - cgWorld` |
| B2-4b | `05:306-311`、`337-341`、`364-368`、`379-382` | 三处法向/摩擦/脉冲力矩 | 四处手写 `simCross` | 全部改为 `simApplyForceAt`（bucket 分别 normal/friction/impulse） |
| B2-4c | `05:385-403` | `simEvaluate` 返回 | 无 `momentParts` | 增 `momentParts{normal,friction,impulse}`，三项和等于 `moment`（≤1e-9） |
| B2-4d | `05:605-701` | `simBuildModel` | 无 `momentParts` | 透传 `momentParts` 与 `frictionUse` |

## 3. B2-2 脉冲作用点（0.5 人日，合入序 1）

**契约公式（`contracts.v1` §4.1，r1 已裁决）**：`P = refPos + R(q)·offset`，`r_CG = refPos + R(q)·cgBody`，`P - r_CG = R(q)·(offset - cgBody)`，`M = (R(q)·(offset-cgBody)) × forceRoad`。力只在路面系定义一次（`forceRoad`，不随姿态旋转）；车体系等价式 `R·(leverBody × (R⁻¹·forceRoad))` 只作核对，不设第二套定义。分册 02 §4.2 已按此回改，全文无 `forceBody`。

施工步骤：

1. `05:178-195` 保留 `offset` 数值 `[0,0,0]`、`[0,0,0.90]`、`[0.95,0,0]`，`forceRoad` 数值不变；只补注释“offset 相对参考点、forceRoad 路面系”。
2. `05:375-383` 改为：
   ```js
   const lever = [impulse.offset[0] - cgBody[0], impulse.offset[1] - cgBody[1], impulse.offset[2] - cgBody[2]];
   const leverRoad = simQuatRotate(q, lever);
   const localMoment = simCross(leverRoad, impulse.forceRoad);
   ```
   `cgBody` 在 05:206 就绪，`q` 在 05:204 就绪。B2-2 阶段先内联，B2-4 再改成 `simApplyForceAt(sim, P, impulse.forceRoad, 'impulse')`，两者数值必须逐位相同（`P - cgWorld = leverRoad`）。
3. 期望数值（`cgBody=(-0.15975,0.30,0)`）：俯仰 `leverRoad=(1.10975,-0.30,0)`，零姿态 `M=(0,0,-6880.45)`；侧倾 `M=(3780,0,-670.95)`；垂向 `M=(0,0,-1086.30)`。后两项随 R-01 一并变化，必须登记，不能只改俯仰。
4. 不改 `simActiveImpulse`（178-183）与 `until` 语义。
5. 提交同时登记：`README.md:79-81` 与 `DESIGN.md` 20.2/20.6 的“质心处/0.90 m/0.95 m”由 B5-1 改写；浏览器 26 项中侧倾/俯仰峰值与 `audit-rocker-reach` 的 4.1 阻尼峰值（旧 30.7/46.3 kN）在 B1 合入后重测，B2-2 不自行改阈值。

**验收**：`B4.4/body-moment`、`B4.4/road-magnitude`、`B4.4/yaw90-axis` 三条转绿（阈值见 §7）。

## 4. B2-3 接地点单一来源（1.0 人日，合入序 2）

1. `03:257-297` 在返回对象上追加四个字段（不改 B1-3 已有字段）：
   ```js
   const wheelPosBody = state.C.clone();                       // 车体系
   const contactBody = state.C.clone().addScaledVector(down, d.tireRadius);
   const wheelPosRoad = wheelPosBody.clone().applyQuaternion(bodyQuat).add(bodyPos);
   const contactRoad = contactBody.clone().applyQuaternion(bodyQuat).add(bodyPos);
   ```
   `bodyQuat` 与 `bodyPos` 是入参，已在 `suspSolveCorner` 签名中。保留顶层 `contact`、`wheelPos` 一版供旧调用方；契约规定 `contactBody` 只给机构与渲染。
2. `05:267-268` 删除，改 `const contact = solved.contactRoad`；同时把 `05:351-356` 的接地点速度上提到角点循环（`05:269-285`），写成
   `corner.contactVelocity = velocity + omegaRoad × (corner.contact - cg)`，力臂与 `05:306/337/364` 同源。
3. 回退分支（`geometry` 或 `design` 为空，05:263-266）：用完整四元数
   `p0 = R(q)·[wheel.x,0,wheel.z]`、`p1 = refPos + p0`、`contact = p1 - [0,p1.y,0]`。法向必须是路面系 `[0,1,0]`，不得用 `gravityLocal` 反方向（A-02）。10° 侧倾下与 yaw-only 公式差约 12.3 mm，满足审计的 >10 mm。
4. `05:561-570`：`contactPoints` 仍读 `corner.contact`（来源已统一），`wheelCenters` 改读 `corner.wheelPos`。
5. `05:588-604`：删掉 `applyQuaternion(bodyQuat).add(bodyVec)` 的二次变换，直接拷贝；`bodyVec`（586）随之只服务别处，若无引用一并删除。保留 `rockerAngle/coilLength/motionRatio/converged` 顶层兼容字段，`22-car-dynamics.js:958、1112` 与 `test-dynamics.mjs:134` 仍读它们。
6. 求解失败但 `frame.converged=false` 时，`contactRoad` 仍由最佳迭代给出；力分支只看 `frame.converged`（A-03），不看 `ok`。

**验收**：`B4.5/default-sample`、`B4.5/attitudes`、`B4.5/contact-plane`、`B4.5/fallback-full-quaternion` 四条转绿。

## 5. B2-1 HOLD/SLIP 与 simRetargetReference（1.5 人日，合入序 3）

**状态结构**（`contracts.v1` §2.3）：`sim.contact = {mode,dwell,since,changes,lastChangeStep,reason,slipSpeed,usage}`；`simEvaluate` 只返回 `contactNext`，`simStep` 提交，`simBuildModel` 只读。

1. 增常数与 `sim.contact` 初值（B2-1a/b）。
2. `simEvaluate(sim, dt)` 内：
   - 先在 05:315 前算出 `demand/capacity`、四角 `|contactVelocity|`、平面速度与 `|wy|`，据 `sim.contact.mode` 与速度条件决定当步模式；
   - HOLD 分支保留 05:331-344 的比例分配；SLIP 分支按 05:350-362 的每角方向取饱和库仑，再乘刹停系数 `k`；
   - `k` 的两个预算：平面 `p = m·v + F_ext,t·dt`、横摆 `h = Iyy·wy + L_nf·dt`。**`L_nf` 只能取非摩擦项（normal + impulse）**，摩擦项是被控量（见 §8.2）；
   - `k<1` 时在 05:443 与 05:460 之间投影 `vx=vz=0` 或 `wy=0`；
   - 每角写 `corner.normal = corner.force`、`corner.friction`，供 B2-4 的 `momentParts` 与遥测。
3. `simIntegrate`：三处 `evaluation.holding`（426、439、471）改读 `contactNext.mode`；积分后按 `SIM_ARREST_SPEED/RATE/DWELL` 更新 `dwell`，满足则 `mode='HOLD'`、清零速度、写 `since/lastChangeStep/changes`；`05:507-508` 的 flags 由 mode 派生。
4. `simStep` 提交（B2-1f）：先 `const evaluation = simIntegrate(...)`，再 `sim.contact = evaluation.contactNext`，仍返回 `evaluation`——`audit-seed-writeback.mjs:46/54` 与既有测试都读 `evaluation.corners[].dampingForce/motionRatio`。
5. `simRetargetReference(sim, source)`（B2-1h）：`computeStatic(source)` → 校验 `geometryRevision`（两侧均定义且不等才抛错）→ `sim.cornerSeed=[null×4]` → 保留 `state/contact/time/impulse`。调用点由 B3-2 把 `40-app.js:76` 的 `SIM.reference = computeStatic(state)` 换成它；B2-1 只提供函数与用例。
6. `simInfo` 增七个投影字段（B2-1i）；`solverOk` 沿用 B1-3 的 `corners.every(c=>c.ok)`（05:665），不另起名。
7. 自检 +2（B2-1j），页面 14+10=24，浏览器由 `>=8` 改 `>=10`（04 的文件）、弹窗 `>=24`。

**验收**：`B4.3/` 五条转绿；重新驻车用例必须走 `simRetargetReference`，审计的 `retargetMethod` 应从 `direct-reference` 变为 `simRetargetReference`。

## 6. B2-4 力装配统一（0.5 人日，合入序 4）

1. 新增 `simApplyForceAt(sim, roadPoint, forceRoad, bucket)`：累加 `force`，把 `(roadPoint-cgWorld)×forceRoad` 同时累加到 `moment` 与 `momentParts[bucket]`。签名四参，累加器机制见 §8.1。
2. 替换四处手写叉乘（05:306-311、337-341、364-368、379-382），bucket 分别 normal/friction/impulse；摩擦两个分支同桶。
3. `simEvaluate` 返回 `momentParts`；`simBuildModel` 透传。
4. `b2` 的等价性：以 B2-1 合入后的 HEAD 为基线，改造前后同组确定性用例完整 state 逐位相同。
5. 守卫：`awk '/^function simEvaluate/,/^}/' src/js/05-body-dynamics.js | grep -c 'simCross('` 为 0。

**验收**：`momentParts` 三项和 ≤1e-9、法向/摩擦力矩独立复算 ≤1e-6 N·m、`simApplyForceAt` 等价、grep 守卫为 0。

## 7. 审计 check id → test-dynamics [10][11][12]

审计脚本现状（`npm run audit:contact`，12 条中 11 条红、`B4.5/contact-plane` 绿；基线 `knownFailure:true`）。下表左列是验收脚本的 id 与阈值，右列是 [10][11][12] 中同名断言的落点；容差必须逐字一致。

| 审计 id | 阈值 | fbb401d 实测 | 落点 | 备注 |
| --- | --- | --- | --- | --- |
| `B4.3/low-speed-hold` | 1 步 `abs(vx)≤1e-12`；4 步 `mode=HOLD`；位移 `≤2e-6` m | vx=5e-4、mode=SLIP、位移 4e-6 | [10] | 另断言 `x≥0` |
| `B4.3/contact-state-field` | `sim.contact.mode ∈ {HOLD,SLIP}` | 无字段 | [10] | 直接断言类型 |
| `B4.3/step-no-reversal` | `0≤vx<1e-6`、`0≤x<1e-4` | vx=-0.0174586、x=-3.49e-5 | [10] | — |
| `B4.3/slope-perturbation` | HOLD、`abs(vx)≤1e-12`、位移 `<1e-4` | vx=-0.0105396、SLIP、位移 5.77e-5 | [10] | — |
| `B4.3/repark` | 0.1 s 内 HOLD；`vx=vz=wy=0`；1.1 s 位移 `<1e-9` | SLIP；4.63e-4/-6.65e-4/6.49e-5；位移 1.35e-2 | [10] | 另断言 retarget 不改 state/contact、seed 全 null |
| `B4.4/body-moment` | 24 偏航 `abs(ΔM_body-(0,0,-6880.45))≤1e-9` | 12770.45 | [11] | — |
| `B4.4/road-magnitude` | `abs(abs(M)-6880.45)≤1e-9` | 990.45 | [11] | — |
| `B4.4/yaw90-axis` | `abs(Mx)≤1e-9`、`abs(Mz+6880.45)≤1e-9` | (5890,0,-1.8e-12) | [11] | 另断言路面系 (-6880.45,0,0) |
| `B4.5/default-sample` | gap `≤1e-3` mm | 8.5349/5.4390 mm | [12] | — |
| `B4.5/attitudes` | gap `≤1e-3` mm（俯仰/侧倾 0/2/5/10 + 8/7 + 10/10） | 最大 178.8106 mm | [12] | 0° 即 7.2179/5.0220；侧倾 10° 28.8974 |
| `B4.5/contact-plane` | `abs(y)≤1e-6` m | 9.0e-11（已绿） | [12] | — |
| `B4.5/fallback-full-quaternion` | `abs(y)≤1e-6` 且距 yaw-only `>10` mm | y=0、差 0（与 solved 差 21.8–28.9） | [12] | 补 8°/7° 与 10°/10° |

审计未覆盖、只在 [10][11][12] 出现的断言：

| 段 | 断言 | 数值/容差 |
| --- | --- | --- |
| [10] | 容量边界不抖振 | demand/capacity=0.99 与 1.01 各 5 s，`changes` ≤0 与 ≤2 |
| [10] | 帧率一致 | 10/12/30/60/144 Hz 到同一 `sim.time` 与子步数，完整 state `===`；`lastChangeStep` 序列相同 |
| [10] | 遥测无副作用 | 连续 100 次 `simBuildModel`，`changes/dwell/since/lastChangeStep` 不变 |
| [10] | 横摆预算 | 8°/7° 与 10°/10° 各一次 SLIP→HOLD，预算与独立复算差 ≤1e-9 |
| [10] | 旧 flags 兼容 | `flags.holding === (mode==='HOLD')`、`flags.sliding === (mode==='SLIP')` |
| [11] | 复合姿态 | 侧倾 10°+俯仰 10°：`ΔM_road = R·(0,0,-6880.45)`，模 6880.45，≤1e-9 |
| [11] | 侧倾/垂向脉冲 | `(3780,0,-670.95)`、`(0,0,-1086.30)`，≤1e-6 |
| [11] | 差只含脉冲项 | `abs(ΔM - R·(lever×F))≤1e-9`，力差 `R·F` |
| [12] | 独立复算 | `suspSolveCorner` 复算的 `contactRoad` 与消费值差 ≤1e-9 |
| [12] | 力矩分解 | 三项和 ≤1e-9；法向/摩擦独立复算 ≤1e-6 N·m（水平、8°/7°、10° 俯仰、低附着） |
| [12] | 横摆对称 | 水平对称 `abs(momentParts.friction[1])≤1e-6` |
| [12] | `normalMomentX/Z` | 与 `contactPoints×loads` 重算差 ≤1e-6 |
| [12] | `simApplyForceAt` 等价 | 改造前后最终 state 逐位相同 |
| 守卫 | grep | `simEvaluate` 内 `simCross(` 计数 0 |

## 8. 开工前必须裁决的三项

8.1 `simApplyForceAt` 的累加器。契约冻结四参签名且“无返回值、纯累加”，但没有累加目标。建议：模块级 `let SIM_FORCE_ACCUM = null`，`simEvaluate` 开头设置、`finally` 还原；`simApplyForceAt` 在 `SIM_FORCE_ACCUM === null` 时抛错。这样不改签名、不写 `sim`、实测可重复。备选是 `sim._accum`，但会与“`simEvaluate` 无副作用”的表述冲突，需 lead 选定。

8.2 O-14 的横摆预算口径。若按字面把 `momentParts.friction[1]` 加进 `h`，控制量与被控量混在一起。反例：`L0=1`、饱和摩擦 `Lf=3`、无外部项，按字面 `h=1-3=-2`、`k=2/3`，本步后 `L=-1` 仍反向；按非摩擦口径 `h=1`、`k=1/3`，本步后 `L=0`。建议口径为“左侧 normal+impulse，右侧 friction”，并在分册 02 §4.1 第 8 条与 [10] 的断言同步改写；若坚持字面口径，则刹停系数必须解成不动点，工作量与风险都上升。

8.3 分册 02 §4.2 的 `forceBody` 与契约 §4.1 的 `forceRoad` 冲突。按契约执行，B2-2 提交同时回改 02 §4.2 第 1、2、3、6 条与 §5.3 的公式说明；[11] 的复合姿态断言按 `(R·lever)×forceRoad` 计算，不再用 `R·(lever×forceBody)`。

## 9. 风险

1. **低速状态机与旧 flags**：`test-dynamics.mjs:152/236/239/242`、`test-dynamics-browser.mjs:195/213`、`30-ui.js:588/656/782` 都直接读 `holding/sliding`。必须由 mode 派生且逐位等价；HOLD 的速度守卫（HOLD→SLIP 当平面速度或接地点滑移超 2e-3）不能省，否则“锁存 HOLD + 运动状态”会瞬移停车。
2. **脉冲基线重定**：6880.45 只覆盖俯仰；侧倾 (3780,0,-670.95) 与垂向 (0,0,-1086.30) 也变。4.1 工况的阻尼峰值（30.7/46.3 kN）与运动比（-4.20）在 B1+R-01 后必须重测并登记，旧值只作症状。
3. **接地点位移**：默认样本 8.53 mm、10° 俯仰 178.81 mm 是可视化位移；力臂变短/变长会让倾斜面静力对照变化（/tmp 副本实测 8°/7° 0.48 N、-10°/-10° 0.53 N，门限 1 N），B1 的机构解若改变接触点，须重测，不得沿用。
4. **法向力回退分支**：只能用 `frame.converged`；误用 `ok` 会让 4.1 工况四角全走回退，载荷与阻尼基线整体偏移。`B1-3` 若保留顶层 `converged` 且语义未改，B2 仍须显式读 `frame.converged`。
5. **审计基线翻转**：B2 完成后 `baseline/0.2.0.json` 中 `knownFailure:true` 的 11 条会变成 pass，`npm run audit:baseline` 将报 status-diff。必须由 05 在同一批次用 `npm run audit:update` 更新快照并在提交信息登记，否则 CI 红。

## 10. 顺序、并行与测试项数

- **合入**：B2-2 → B2-3 → B2-1 → B2-4（R-05）。B2-2 与 B2-3 改动集不相交（05:178-195/375-383 对 `03:257-297`+`05:267-268/351-356/561-604`），可并行开发；B2-1 依赖 B2-3 的 `contact/contactVelocity` 与 B1 的质心状态，必须在 B2-3 之后；B2-4 与 B2-1/B2-2 在 05:306-382 重叠，只能最后。
- **行号漂移**：B1 会改 `05:108-172/199-268/407-512/541-701` 与 `03:229-297`，B2 的每个提交按“函数名 + 目标代码块”重新定位，不按本文件行号硬改。
- **测试项数**：`npm test` 47+52 → 47+（52 + [10] 约 10 + [11] 6 + [12] 约 11）= 约 79，区间 77–81，最终以脚本打印为准；动态自检 8→10，页面 14+10=24；浏览器现有 26 项保留，B2 追加 1 条 mode 断言后为 27，自检数量断言改为 `>=10`/`>=24`（04 的文件）。
- **命令**：`npm run audit:contact`（B2 门禁，12 条全绿即通过）、`node tools/test-dynamics.mjs`、`npm test`、`npm run build:check`（构建后）；浏览器由 CI 空闲端口执行，本地不在 B2 运行。
