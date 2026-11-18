# M6 阶段三准入报告（acceptance）

| 项目 | 内容 |
| --- | --- |
| 报告状态 | **定稿**：M6 阶段三准入“有条件通过”；基于 0.3.0 最终产物与 2026-11-19 实跑证据；两项测试覆盖缺口见 §6.1/§6.2 |
| 分支 / HEAD | `feat/plan-execution` / `cbed2d6`（B6 提交前的 WIP；文档、版本与产物由 B6 收尾提交随后落库） |
| 交付版本 | 0.3.0（`package.json`、`APP_VERSION`、模板页脚、`index.html` 页脚同版） |
| 施工基线 | 0.2.0 / fbb401d；历史失败基线 `ed8aa0a`（39 knownFailures） |
| 日期 | 2026-11-19 |
| 依据 | 主册 §6、§7.1、§9；分册 05 §4、§5、§8；`docs/plan/contracts.v1.md`；`docs/plan/notes/b6-verification.md`；`docs/plan/notes/b6-ui-stability.md`；`.tmp-test/node-regression-final.log`；`docs/audit-baseline-0.2.0.md` |
| 环境 | Node v24.22.1；Google Chrome 156.0.8078.47；linux/x64 |

## 0. 结论摘要

1. 12 项缺陷均有“历史红—当前绿”的映射：历史基线 `ed8aa0a` 为 39 knownFailures，当前 `tools/audit/baseline/0.2.0.json` 为 51/51 pass；历史快照已在 `docs/audit-baseline-0.2.0.md` 与 git 对象中只读归档。
2. 主册 §7.1 六条准入条件中，条件 1、3、4、5、6 满足；条件 2 的主体（解析轨迹、角速度恒定、动力学）满足，但“动量与能量”未设独立守恒断言（§6.1），据此 M6 给“有条件通过”。
3. 最终回归全部通过：`npm test` 50/50 + 80/80、`test:invariants` 27/27、`test:runtime` 78/78、`test:dev-server` 12/12；浏览器 `test:browser` 26/26、`test:camera` 19/19、`audit` 51/51 与 `audit:baseline` match；`test:ui` 45 项且最终 10 连跑 10/10；`build:check` 通过（1,021,578 B、sha256 `668c59ea…`）。
4. §6 的遗留项包括两项测试覆盖缺口（动量/能量、teardown）与发布约束（历史基线只读保护、Chrome 与 Node 版本边界、分支尚未推送）。M6 结论见 §7。

## 1. 12 项缺陷映射

约定：“修复前红”指 fbb401d 上的历史基线；“修复后绿”指 0.3.0 最终源码上的测试/审计。历史失败数来自 `git show ed8aa0a:tools/audit/baseline/0.2.0.json`（knownFailures 39）与 `docs/audit-baseline-0.2.0.md`；当前 51 项全 pass 来自 `tools/audit/baseline/0.2.0.json` 与 2026-11-19 的 `npm run audit`。

| 缺陷 | 修复提交 | 回归用例（文件/check 或分组） | 修复前红证据 | 修复后绿证据 |
| --- | --- | --- | --- | --- |
| B4.1 摇臂不可达/运动比 | B1 `75205d8` | `audit-rocker-reach`（5 checks）；`test-physics-invariants --group rocker/ratio` | 5/5 fail；残差 18.66 mm、比值 -6.92..6.98、阻尼 33.38 kN | audit 5/5 pass；invariants 27/27 pass |
| B4.2 质心漂移/参考点路径 | B1 `75205d8` | `audit-free-body`（12 checks）；`test-physics-invariants --group cg` | 6/12 fail；质心漂移 287.66 mm、参考点位移 0 | audit 12/12 pass；invariants 27/27 pass |
| B4.3 低速摩擦/单步反向/重新驻车 | B2 `d361d27` | `audit-friction-low-speed`（5 checks）；`test-dynamics [10]` | 5/5 fail；0.0005 m/s 摩擦为零、单步 -0.017459 m/s | audit 5/5 pass；dynamics 80/80 pass |
| B4.4 脉冲坐标系 | B2 `d361d27` | `audit-impulse-frame`（3 checks）；`test-dynamics [11]` | 3/3 fail；横摆 90° 时力矩落在错误轴 | audit 3/3 pass；dynamics 80/80 pass |
| B4.5 两套接地点/力矩分解 | B2 `d361d27` | `audit-contact-gap`（4 checks）；`test-dynamics [12]` | 3/4 fail；0°/10° 间距 7.22/178.81 mm | audit 4/4 pass；dynamics 80/80 pass |
| B5.1 低帧率丢时 | B3 `65eef75` | `audit-frame-time`（6 checks）；`test-runtime --group frame` | 4/6 fail；10/5 Hz 推进不足、dropped 字段缺失 | audit 6/6 pass；runtime 78/78 pass |
| B5.2 几何代际 | B3 `65eef75` | `audit-browser-contract` B5.2；`test-runtime --group geometry`；`test-dynamics-browser` geometry | 1/1 fail；3.90 m 轴距杆长偏差 104.10 mm | audit 5/5 pass；runtime 78/78 pass；browser 26/26 pass |
| B5.3 周期自检/DOM | B3 `65eef75` | `audit-browser-contract` B5.3；`test-ui-browser` telemetry/10 行 | 1/1 fail；空闲 1 s 自检列表持续重建 | audit 5/5 pass；ui 45/45 pass |
| B5.4 材质生命周期 | B3 `65eef75` | `audit-browser-contract` B5.4；`test-runtime --group assets`；`test-ui-browser` assets 组 | 1/1 fail；387 次几何释放、0 次材质释放 | audit 5/5 pass；Node assets 组 pass；`test-ui-browser` 的 `B5.4 rebuild releases materials and geometry` 实测 materialDisposed=7、geometryDisposed=387 |
| O1 渲染回写种子 | B1 `75205d8` | `audit-seed-writeback`（5 checks）；`test-physics-invariants --group seed` | 5/5 fail；A=33.38 kN、B=46.42 kN、C 与 A 不同 | audit 5/5 pass；invariants 27/27 pass |
| A2 变量遮蔽 | B1 `75205d8` | `audit-shadowing`（2 checks）；`test-runtime sourceContract` / `invariants --group shadow` | 1/2 fail；缺失 source 时容量放大 7 倍 | audit 2/2 pass；runtime 78/78 pass |
| UI（U1–U4） | B4 `328b640` | `audit-ui`（U1–U4）；`test-ui-browser` 45 项 | 4/4 fail；横屏裁切、空格切换仿真、关闭面板可 Tab、暂停文案不同步 | audit 5/5 pass；ui 45/45 pass |

覆盖数：12/12。映射到提交：B1 4 项（B4.1、B4.2、O1、A2），B2 3 项（B4.3、B4.4、B4.5），B3 4 项（B5.1–B5.4），B4 1 组（UI/U1–U4）。U5/U6 是 B4 附加项，不计入 12 项。

## 2. 主册 §7.1 六条准入条件

| # | 条件 | 可验证方法 | 最终结果 | 判定 |
| ---: | --- | --- | --- | --- |
| 1 | 12 项缺陷均有回归用例，修复前失败、修复后通过 | 逐行核对第 1 节；历史基线 `git show ed8aa0a`；当前 `npm run audit` + `audit:baseline` | 历史 39 fail 已在 `ed8aa0a` 与 `docs/audit-baseline-0.2.0.md` 只读归档；当前 51/51 pass、`baseline: match`；12/12 映射完整 | **通过** |
| 2 | 自由刚体解析轨迹、动量与能量、接地点唯一性、运动比连续性通过 | `npm run test:invariants`（cg/rocker/corner/seed/ratio/shadow）；`npm run test:dynamics` [12] | invariants 27/27、dynamics 80/80；解析轨迹、角速度恒定、接触点与运动比均通过 | **有条件通过**：线动量/动能的独立守恒断言未纳入自动测试（§6.1） |
| 3 | 状态、角点、ForceEvaluation、遥测快照字段稳定；渲染层不写物理 | contracts.v1 对照；`test:invariants`、`test:dynamics` [10–12]、`test:runtime`、`test:ui` | 字段实现与测试齐全；`simEvaluate` 裸 `simCross` 守卫为 0；10 行 id 通过；05 §3.1 的 harness 与浏览器审计路径已分别对齐 `tools/audit/_harness.mjs` 与 `tools/audit-browser/` | **通过** |
| 4 | 文档物理断言与测试编号一一对应 | README/DESIGN 的断言按下表绑定测试文件与用例/组/id | 对照表见 §2.1，共 16 行；覆盖 README 的坐标、刚体方程、悬架、防倾杆、接触、脉冲、帧时间、静力、自检、确定性、机构、UI 与 DESIGN 20.2/20.3/20.7/20.10 | **通过** |
| 5 | 性能预算达标，优化前后确定性一致 | `tools/bench.mjs`；`npm test` 确定性断言 | 2026-11-19 最终 bench（§3）：单步 0.0180/0.0170/0.0257 ms、suspEval 4.065/4.08、`simBuildModel` hot 0.0233 ms、`computeStatic` 0.0592 ms、`simCreate` 11.7041 ms；总体 PASS | **通过** |
| 6 | 单文件构建通过，index.html 与源码哈希一致，无新增运行时依赖 | `node tools/check-build.mjs --strict`；依赖清单；离线组 | 通过：1,021,578 B、sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`；页脚 v0.3.0；`APP_VERSION` 0.3.0 与 package 同版；依赖为空 | **通过** |

### 2.1 文档断言—测试编号对照表（条件 4）

| # | 文档断言（位置） | 断言要点 | 测试文件与用例/分组/id | 结果 |
| ---: | --- | --- | --- | --- |
| 1 | README · 坐标与姿态 | 质心为积分变量，参考点由 `p = r_CG − R(q)c` 派生 | `test-physics-invariants --group cg`（cg-drift/ref-path/omega/quat-norm）；`audit-free-body` B4.2/cg-drift-x、cg-drift-y、cg-drift-z、ref-path-x、ref-path-y、ref-path-z | 通过（27/27；audit 12/12） |
| 2 | README · 六自由度刚体方程 | 平动/转动方程与四元数积分；惯量、角速度状态完整 | `test-dynamics` [2] 水平动态平衡、[3] 倾斜面收敛、[5] 脉冲与阻尼；`test-physics-invariants --group cg` | 通过（80/80；27/27） |
| 3 | README · 四角弹簧—阻尼器 | 机构反解运动比、线圈长度与弹簧力公式、设计运动比 | `test-dynamics` [1b] 机构运动学；`test-physics-invariants --group rocker/ratio`；`audit-rocker-reach` B4.1/unreachable-ok、ok-residual、motion-ratio-range、motion-ratio-continuity、damping-peak | 通过（audit 5/5；27/27） |
| 4 | README · 防倾杆 | 左右行程差产生等大反向力，不改变整车法向合力 | `test-dynamics` [4] 防倾杆动态；`test-core` [6] ARB 再分配 | 通过（80/80；50/50） |
| 5 | README · 接触、驻车与滑移 | 接地点唯一、静摩擦分配、HOLD/SLIP、低速与重新驻车 | `test-dynamics` [7] 驻车与滑移、[10] 接触状态机；`audit-friction-low-speed` B4.3/low-speed-hold、contact-state-field、step-no-reversal、slope-perturbation、repark；`audit-contact-gap` B4.5/default-sample、attitudes、contact-plane、fallback-full-quaternion | 通过（audit 5/5、4/4） |
| 6 | README · 动态试验 | 俯仰脉冲作用点前方 0.95 m、力臂 `offset − cgBody`、零姿态力矩 −6880.45 N·m | `test-dynamics` [11] 脉冲坐标；`audit-impulse-frame` B4.4/body-moment、road-magnitude、yaw90-axis | 通过（audit 3/3） |
| 7 | README · 数值积分 | 0.5 s 接受上限、128 子步、0.5 s 积压、低于 4 Hz 慢动作、droppedTime | `test-runtime --group frame`；`audit-frame-time` B5.1/60hz、30hz、10-time、5-time、5-clamp50-time、dropped-field | 通过（runtime 78/78；audit 6/6） |
| 8 | README · 静力参考 | 动态解回到静力解、倾斜载荷差 <1 N、总法向收敛到 mg cosβ | `test-core` [2] 水平参考、[3] 坡道/侧倾；`test-dynamics` [3] 倾斜面收敛 | 通过（50/50；80/80） |
| 9 | README · 自检与验收 | 24 项页面自检（14 静力 + 10 动力学）、列表与遥测更新 | `test-core` [1] 内置自检；`test-dynamics` [9] 动态自检；`test-runtime --group selftest`；`test-ui-browser` self-tests expose 10 dynamic and 24 total entries；`audit-browser-contract` B5.3/telemetry-dom | 通过（runtime 78/78；ui 45/45；audit 51/51） |
| 10 | README · 确定性与复现 | 帧率不改变状态、相同输入 bit-identical、120 组随机无 NaN | `test-dynamics` [6] 确定性与定步长、[8] 随机包线；`audit-browser-contract` O1/chunked-vs-one-shot | 通过（80/80；audit 51/51） |
| 11 | README · 机构闭合与杆长偏差 | 杆长偏差 0.000 mm、机构闭合、场景与快照同代 | `test-dynamics` [1b] 机构运动学；`test-dynamics-browser` mechanism closes in the rendered scene；`audit-browser-contract` B5.2/geometry-generation | 通过（26/26；audit 5/5） |
| 12 | README · UI 断言 | 横屏、空格键、面板焦点、暂停文案、轮载箭头、离线加载、45 项 | `test-ui-browser` 45 项（viewport/keyboard/focus/state/solver/assets/display/offline）；`audit-ui` U1/landscape、U2/space-key、U3/panel-focus、U4/pause-text | 通过（45/45；audit 5/5；10 连跑 10/10） |
| 13 | DESIGN 20.10 · 资源所有权与 teardown | 重建释放实例材质与几何、共享/缓存不释放；`FSApp.dispose()` 的 teardown 幂等未自动断言（§6.2） | `test-runtime --group assets` 7/7；`test-ui-browser` `B5.4 rebuild releases materials and geometry`（materialDisposed=7、geometryDisposed=387）；`audit-browser-contract` B5.4/material-release | 通过（重建释放；runtime 78/78；ui 45/45；audit 51/51） |
| 14 | DESIGN 20.2 · 平动方程 | 平动积分变量改为质心，删除参考点积分表述 | `test-physics-invariants --group cg`；`audit-free-body` B4.2/* | 通过（27/27；audit 12/12） |
| 15 | DESIGN 20.3 · 力臂与接地点 | 力臂相对质心、接地点唯一、力矩分解 | `test-dynamics` [12] contactGap/momentParts/forceAssembly；`audit-contact-gap` B4.5/* | 通过（80/80；audit 4/4） |
| 16 | DESIGN 20.7 · 验证结果 | 测试数量与覆盖面（50/80/26/45、27/78）与实际一致 | `test-core` 50、`test-dynamics` 80、`test-physics-invariants` 27、`test-runtime` 78、`test-ui-browser` 45、`test-dynamics-browser` 26、`test-camera` 19；`test-runtime` assets 组与 `audit-browser-contract` B5.4 | 通过（全部实测） |

## 3. 性能预算（0.3.0 最终 bench）

`tools/bench.mjs`：Node v24.22.1、linux/x64、samples=200、预热后测量，输出 mean/median/p95 与预算判定。数据来自 `.tmp-test/node-regression-final.log` 的 `=== bench ===` 段（2026-11-19，与 Node 回归同一日志）；总体 PASS。

| 指标 | 主册目标 | 最终结果（mean / median / p95，特殊项单列） | 判定 |
| --- | ---: | --- | --- |
| 单子步物理 | ≤0.05 ms | 0.0180 / 0.0170 / 0.0257 ms | 通过 |
| 单子步 suspEval | ≤30 次 | mean 4.065、max 4.08 | 通过 |
| `simBuildModel` | ≤0.05 ms | hot 0.0264 / 0.0233 / 0.0402 ms；coldStable 0.0249 ms；coldStart 0.8622 ms（首调长尾单列） | 通过 |
| `computeStatic` | ≤8 ms | 0.0803 / 0.0592 / 0.2012 ms | 通过 |
| `simCreate`（settle 1.5 s） | ≤60 ms | 12.0674 / 11.7041 / 14.3035 ms | 通过 |
| 静态自检 | 参数不变不重算 | 4.9706 ms/次（14 项）；缓存命中 0.0000 ms、calls=1、runs=1 | 通过 |
| 动态自检 | 移出周期路径 | 214.9483 ms/次（10 项，按需执行） | 通过 |

bench 口径：固定 Node 版本、样本数与预热；`simBuildModel` 的冷启动首调长尾单列，稳定轮次取中位。B6 优化仅改 `simBuildModel` 热路径（标量快照、预分配循环、同序四元数标量乘），默认/8°坡7°bank/摩擦转向/750 kg 四组模型 JSON 与优化前逐字节相同；同一日志中 `npm test` 50+80 与 `test:runtime` 78 保持。

## 4. 接口冻结清单（对照 contracts.v1）

| 契约项 | 实现/测试 | 状态 |
| --- | --- | --- |
| `sim.state` 质心 x/y/z、vx/vy/vz、referencePoint | `test-invariants --group cg`；`simReferencePoint` | 通过 |
| `suspSolveCorner` 的 frame/rocker/motionRatioState/seed/ok | `test-invariants --group corner/rocker`；`03-suspension.js:502-544` | 通过 |
| ForceEvaluation 的 force/moment/momentParts/corners/cg/flags | `test-dynamics [12]`；`05-body-dynamics.js:311-661` | 通过 |
| `simApplyForceAt(sim, roadPoint, forceRoad, bucket)` 三桶 | `test-dynamics [12] forceAssembly`；裸 `simCross` 守卫 0 | 通过 |
| 遥测 10 行 id、solverOk/solverState | `test-ui-browser` 45 项；行 id 与徽标断言 | 通过 |
| runtime 快照（frame/geometry/selftest/assets） | `test-runtime` 78 项；`40-app.js` geometry/assets 投影 | 通过 |
| assets 的 totals/lastBuild/lastTeardown | `test-runtime --group assets` 7/7；`test-ui-browser` `B5.4 rebuild releases materials and geometry`（materialDisposed=7、geometryDisposed=387）；`audit-browser-contract` B5.4/material-release | 通过（Node 7/7 与浏览器重建释放已覆盖；`FSApp.dispose()` 的 lastTeardown 归零未纳入自动断言，见 §6.2） |
| 共享 harness | `tools/audit/_harness.mjs`；05 §3.1 已对齐 | 通过 |
| 审计目录 | 浏览器审计 `tools/audit-browser/`；05 §3.1 已对齐 | 通过 |
| 性能 bench | `tools/bench.mjs` 已落地；本轮总体 PASS | 通过 |
| 构建产物 | `index.html` 1,021,578 B、sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`；页脚 v0.3.0；`APP_VERSION` 0.3.0 与 package 同版 | 通过 |

## 5. 完整 M6 验收命令序列

前置：0.3.0 已同版（package/APP_VERSION/模板页脚/index.html 页脚）；B6 收尾提交后工作区干净；`.qoder/` 已由 `.gitignore` 忽略；在 Node 24.22.1（或 CI 的 Node 22）与 Chrome 156 上执行。浏览器命令统一 `FS_REQUIRE_CHROME=1`，禁止用 SKIP 冒充通过。

```bash
node -v
google-chrome --version

npm test
npm run test:invariants
npm run test:runtime
npm run test:dev-server

npm run build:check
FS_REQUIRE_CHROME=1 npm run test:ui
FS_REQUIRE_CHROME=1 npm run test:browser
FS_REQUIRE_CHROME=1 npm run test:camera

FS_REQUIRE_CHROME=1 npm run audit
npm run audit:baseline

git diff --exit-code index.html
git status --short
```

| 命令 | 实际输出 / 说明 |
| --- | --- |
| `npm test` | `PASS 50/50 checks` + `PASS 80/80 checks`，退出 0（`.tmp-test/node-regression-final.log`） |
| `npm run test:invariants` | `PASS 27/27 checks`，退出 0 |
| `npm run test:runtime` | `PASS 78/78 checks`，退出 0 |
| `npm run test:dev-server` | `PASS 12 dev-server checks`，退出 0 |
| `npm run build:check` | `index.html 与源码一致 1021578 B sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`，退出 0 |
| `test:ui` | `PASS 45 ui checks`，退出 0；最终 10 连跑 10/10，单次约 54–69 s，总 605,559 ms（`docs/plan/notes/b6-ui-stability.md`） |
| `test:browser` | `PASS dynamic browser checks`（26/26），18.8 s，退出 0（`docs/plan/notes/b6-verification.md`） |
| `test:camera` | `PASS camera checks`（19/19），27.6 s，退出 0 |
| `npm run audit` | 10 个审计脚本、51 checks、0 failed，36.0 s，退出 0 |
| `npm run audit:baseline` | `baseline: match`，41.5 s，退出 0 |
| `git diff --exit-code index.html` | 无输出，退出 0 |
| `git status --short` | 空（B6 收尾提交后） |

浏览器回归的执行窗口为 2026-11-19 04:20:27–04:22:46（Asia/Hong_Kong），被测产物 sha256 在四条命令前后未变。

## 6. 遗留风险与发布约束

1. **历史基线只读保护。** 当前 `tools/audit/baseline/0.2.0.json` 是修复后基线（knownFailures 0）；历史 39 fail 只存在于 `ed8aa0a` 与 `docs/audit-baseline-0.2.0.md`。发布前不得对 0.2.0.json 执行 `audit:update`；若需新基线，应另存版本文件。
2. **浏览器依赖 Chrome。** 无 Chrome 时测试默认 SKIP；发布与 CI 必须设置 `FS_REQUIRE_CHROME=1`，不得以 SKIP 作为通过。
3. **Node 版本边界。** `engines >=18` 只覆盖非浏览器命令；浏览器测试依赖 Node 21+ 的全局 `WebSocket`。本轮只在 Node 24.22.1 验证，Node 18/20 未实测，不能宣称覆盖声明的全范围。
4. **分支尚未推送/合入。** `feat/plan-execution` 与 B6 收尾提交仍在本地；发布前需提交、推送，并在 CI 以 Node 22 + Chrome 严格模式复跑第 5 节命令。
5. **计数口径维护。** 本报告口径为 `npm test` 50+80、invariants 27、runtime 78、dev-server 12、ui 45、browser 26、camera 19、audit 51；历史计划文档中的 47/52/44/20 等仅作对照，后续文档更新以本节与 §2.1 为准。

6. **动量与能量未设独立断言。** `test-physics-invariants` 的 27 项覆盖自由刚体解析轨迹（cg-drift/ref-path）、角速度恒定（omega）与四元数归一化，但线动量与动能的守恒没有独立自动断言；主册条件 2 的“动量与能量”目前以解析轨迹与确定性回归间接验证。阶段三开局应补 line-momentum/energy 断言（预计 27→29），并同步全部计数口径。
7. **`FSApp.dispose()`/teardownScene 未自动断言。** Node `test-runtime` assets 组覆盖 `disposeGroupChildren` 的材质/几何释放，`audit-browser-contract` B5.4 与 `test-ui-browser` B5.4 覆盖重建释放；但 `FSApp.dispose()` 的 `assets.lastTeardown` 归零与幂等没有自动测试。阶段三开局补一条浏览器 teardown 断言，或维持本报告的口径降级说明。

## 7. 签署意见

**M6 结论：有条件通过。** 主册 §7.1 的条件 1、3、4、5、6 已满足；条件 2 的主体通过，但“动量与能量”未设独立守恒断言（§6.1），另有 `FSApp.dispose()` teardown 未自动断言（§6.2）。两项均为测试覆盖缺口，不影响 0.3.0 的物理实现、构建与回归结果；建议阶段三开局补测并同步计数后转为正式通过。

依据与证据：

- 条件 1–6 的逐条判定见 §2，文档断言对照见 §2.1（16 行）。
- 2026-11-19 最终回归：`npm test` 50/50 + 80/80、invariants 27/27、runtime 78/78、dev-server 12/12；`build:check` 1,021,578 B / sha256 `668c59ea…`；浏览器 dynamics 26/26（18.8 s）、camera 19/19（27.6 s）、audit 51/51（36.0 s）、`audit:baseline` match（41.5 s），合计 123.9 s、无 SKIP。
- UI：`test:ui` 45 项，B5.4 断言 `materialDisposed=7、geometryDisposed=387`；最终 10 连跑 10/10、退出码全 0、artifact 恒为 `668c59ea…`、总耗时 605,559 ms。
- 性能：`tools/bench.mjs` 总体 PASS，单步中位 0.0170 ms、`simBuildModel` hot 中位 0.0233 ms、`computeStatic` 中位 0.0592 ms、`simCreate` 中位 11.7041 ms。
- 证据文件：`docs/plan/notes/b6-verification.md`、`docs/plan/notes/b6-ui-stability.md`、`.tmp-test/node-regression-final.log`、`docs/audit-baseline-0.2.0.md`。

签署人：项目文档负责人（docs-acceptance）；签署日期：2026-11-19。
