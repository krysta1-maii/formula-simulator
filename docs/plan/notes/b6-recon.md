# B6 准入评审勘察（b6-recon）

| 项目 | 内容 |
| --- | --- |
| 分支 / HEAD | `feat/plan-execution` / `328b640`（B4 已提交） |
| 勘察时间 | 2026-11-19 02:45（Asia/Hong_Kong） |
| 性质 | 只读勘察；本文件只新增笔记，不改源码、测试、构建产物或其他文档 |
| 依据 | 主册 §6、§7.1、§9；分册 05 §4、§5、§8；`docs/plan/contracts.v1.md`；`tools/audit/baseline/0.2.0.json`；当前测试与审计实跑 |
| 环境 | Node v24.22.1；Google Chrome 156.0.8078.47；linux/x64 |
| 结论 | 回归与审计当前全绿，但 M6 不能直接关闭：预修复基线已被覆盖、B5 尚未提交、`tools/bench.mjs` 缺失且 `simBuildModel` 超预算、浏览器材质/teardown 断言缺失 |

**历史勘察说明：** 本文件是 2026-11-19 02:45 的历史勘察记录。正文中的 `test:ui` 44 项、`test:camera` 20 项、`tools/bench.mjs` 缺失、`tools/test-harness.mjs` 路径与“待清理”判断均为当时状态；最终口径与判定见 `docs/plan/acceptance.md`（UI 45 项、camera 19 项、bench 已落地、05 路径已对齐）。

## 1. 12 项缺陷映射

当前 HEAD 的回归项数为静力 50 + 动力学 80；`test:invariants` 27、`test:runtime` 78、`test:dev-server` 12、`test:ui` 44。下表“修复前红”取自历史基线 `git show ed8aa0a:tools/audit/baseline/0.2.0.json` 与同批生成的 `docs/audit-baseline-0.2.0.md`；“当前绿”取自当前 `npm run audit` 与对应测试。

| 缺陷 | 修复提交 | 回归用例（文件 / check 或分组） | 修复前红证据 | 当前绿证据 |
| --- | --- | --- | --- | --- |
| B4.1 摇臂不可达/运动比 | B1 `75205d8` | `audit-rocker-reach`（5 checks：unreachable-ok、ok-residual、motion-ratio-range、motion-ratio-continuity、damping-peak）；`test-physics-invariants --group rocker/ratio` | 5/5 fail；残差 18.66 mm、比值 -6.92..6.98、阻尼 33.38 kN | audit 5/5 pass；invariants 27/27 pass |
| B4.2 质心漂移/参考点路径 | B1 `75205d8` | `audit-free-body`（12 checks：cg-drift/ref-path/omega/quat-norm 各 x/y/z）；`test-physics-invariants --group cg` | 6/12 fail（cg/ref-path x/y/z；漂移 287.66 mm） | audit 12/12 pass；invariants 27/27 pass |
| B4.3 低速摩擦/单步反向/重新驻车 | B2 `d361d27` | `audit-friction-low-speed`（5 checks）；`test-dynamics [10] 接触状态机`（lowSpeedStop、repark、telemetryPurity、yawBudget） | 5/5 fail；0.0005 m/s 摩擦为零、0.01 m/s 单步 -0.017459 m/s | audit 5/5 pass；dynamics 80/80 pass |
| B4.4 脉冲坐标系 | B2 `d361d27` | `audit-impulse-frame`（3 checks）；`test-dynamics [11] 脉冲坐标系`（yaw 0/90、24 姿态、复合姿态） | 3/3 fail；横摆 90° 时力矩在错误轴 | audit 3/3 pass；dynamics 80/80 pass |
| B4.5 两套接地点/力矩分解 | B2 `d361d27` | `audit-contact-gap`（4 checks）；`test-dynamics [12] 接地点唯一性与力矩分解`（contactGap、momentParts、forceAssembly） | 3/4 fail；0°/10° 间距 7.22/178.81 mm | audit 4/4 pass；dynamics 80/80 pass |
| B5.1 低帧率丢时 | B3 `65eef75` | `audit-frame-time`（6 checks）；`test-runtime --group frame` | 4/6 fail；10/5 Hz 推进不足、dropped 字段缺失 | audit 6/6 pass；runtime 78/78 pass |
| B5.2 几何代际 | B3 `65eef75` | `audit-browser-contract` B5.2；`test-runtime --group geometry`；`test-dynamics-browser` geometry rebuild | 1/1 fail；3.90 m 轴距杆长偏差 104.10 mm | audit 5/5 pass；runtime 78/78 pass；browser PASS |
| B5.3 周期自检/DOM | B3 `65eef75` | `audit-browser-contract` B5.3；`test-ui-browser` telemetry / 10 行检查表 | 1/1 fail；空闲 1 s 自检列表持续重建 | audit 5/5 pass；ui 44/44 pass |
| B5.4 材质生命周期 | B3 `65eef75` | `audit-browser-contract` B5.4；`test-runtime --group assets` | 1/1 fail；一次重建 387 次几何释放、0 次材质释放 | audit 5/5 pass；runtime assets 组 pass；**test-ui-browser 无材质/teardown 断言** |
| O1 渲染回写种子 | B1 `75205d8` | `audit-seed-writeback`（5 checks）；`test-physics-invariants --group seed` | 5/5 fail；A=33.38 kN、B=46.42 kN、C 与 A 不同 | audit 5/5 pass；invariants 27/27 pass |
| A2 变量遮蔽 | B1 `75205d8` | `audit-shadowing`（2 checks）；`test-runtime sourceContract` / `invariants --group shadow` | 1/2 fail；缺失 source 时容量放大 7 倍 | audit 2/2 pass；runtime 78/78 pass |
| UI（U1–U4） | B4 `328b640` | `audit-ui`（U1/landscape、U2/space-key、U3/panel-focus、U4/pause-text）；`test-ui-browser` 44 项 | 4/4 fail；横屏裁切、空格切换仿真、关闭面板可 Tab、暂停文案不同步 | audit 5/5 pass；ui 44/44 pass |

补充：U5（轮载箭头）与 U6（Chrome 清理）是 B4 的附加项，不属于主册 12 项缺陷；当前 `test-ui-browser` 覆盖 U5/U6 相关行为，`audit-ui` 5 项含 U1–U4 加页面错误。

**基线证据的关键问题。** 当前 `tools/audit/baseline/0.2.0.json` 的 `knownFailures` 为 `[]`，51 个 checks 全部为 pass，`defectEvidence.*.failing` 全为空；而 `git show ed8aa0a:tools/audit/baseline/0.2.0.json` 的 `knownFailures` 为 39，`docs/audit-baseline-0.2.0.md` 仍记录 39 fail。当前 JSON 虽然 `commit` 字段仍写 `fbb401d`，但 `generatedAt` 已是 B4 后的 18:30:29；它是“修复后基线”，不是“修复前红基线”。M6 条件 1 的“修复前失败”只能由历史 Markdown/git 对象证明，不能由当前 JSON 证明；发布前必须把 `ed8aa0a` 基线另存为只读工件或打 tag。

## 2. 阶段三准入 6 条逐条核对

| # | 主册 §7.1 条件 | 可验证方法（命令/断言） | 当前证据 | 判定 |
| ---: | --- | --- | --- | --- |
| 1 | 12 项缺陷均有回归用例，修复前失败、修复后通过 | `npm run audit` + `npm run audit:baseline`；对每组查 `defectEvidence` 的 `failing` 与当前 `status`；历史基线用 `git show ed8aa0a:...` | 当前 51/51 pass、`baseline: match`；历史 39 fail；测试 50+80、27、78、44 全绿 | **部分**：当前绿充分，机器可读的修复前红已被覆盖，只有历史 Markdown/git 证据 |
| 2 | 自由刚体解析轨迹、动量与能量、接地点唯一性、运动比连续性通过 | `npm run test:invariants`（cg/rocker/corner/seed/ratio/shadow）；`npm run test:dynamics` [12] | 27/27、80/80 通过；contactGap/momentParts/forceAssembly 均在 [12] | **通过** |
| 3 | 状态、角点、ForceEvaluation、遥测快照字段与语义稳定；渲染层不写物理 | contracts.v1 逐项对照；`test:invariants`、`test:dynamics` [10–12]、`test:runtime`、`test:ui` | 字段已实现且有测试；`simEvaluate` 裸 `simCross` 守卫为 0；10 行 id 通过 | **部分**：`tools/bench.mjs` 缺失；浏览器材质/teardown 未覆盖；05 与契约路径有漂移 |
| 4 | 文档物理断言与测试编号一一对应 | 查 README/DESIGN 的 B5 改点；查每条断言旁的测试编号 | B5 工作区已改 README/DESIGN 的数量、帧时间、质心、脉冲、20.10，但未提交；未见“断言→测试编号”表 | **未满足**：B5 未提交，且只有数量同步，没有逐条测试编号 |
| 5 | 性能预算达标，优化前后确定性一致 | `tools/bench.mjs`（缺）；临时 Node 脚本；`npm test` 确定性用例 | 单步 0.021 ms、suspEval 4.24/8、computeStatic 0.45 ms、simCreate 36.6 ms、静态自检 6.1 ms、动态自检 306.8 ms；**simBuildModel 0.094 ms > 0.05 ms** | **未通过（条件性）**：bench 未落库，且 simBuildModel 超预算；需要官方口径复核 |
| 6 | 单文件构建通过，index.html 与源码哈希一致，无新增运行时依赖 | `npm run build:check`；`node -e` 检查 dependencies/devDependencies；`npm run test:ui` 离线组 | `index.html` 1,019,876 B，SHA-256 `d302c44d…b508`；无依赖；离线组通过 | **通过（版本/Node 覆盖待补）**：当前 Node 24/Chrome 156；未验证 Node 18/20 |

## 3. 性能预算实测方案

`tools/bench.mjs` 当前不存在（`ls tools/bench.mjs` 失败），分册 05 的 A1 仍把它列为测试文件。以下用临时 Node 脚本实测，未写仓库；Node 24.22.1，linux/x64。方法：同一进程预热后取中位数；`simStep` 1000 步；`simBuildModel` 在预先 `simCreate(...,{settle:0})` 的 sim 上 200 次；`computeStatic` 20 次；`simCreate({settle:1.5})` 5 次；`runSelfTests` 10 次；`runDynamicSelfTests` 3 次。

| 指标 | 主册目标 | 本次实测（中位数） | 判定 |
| --- | ---: | ---: | --- |
| 单子步物理 | ≤0.05 ms | 0.0213 ms（min 0.0107） | 通过 |
| 单子步 suspEval | ≤30 次 | 平均 4.24、最大 8 | 通过 |
| `simBuildModel` | ≤0.05 ms | **0.0945 ms**（min 0.0332、max 3.28，GC 长尾） | **未通过** |
| `computeStatic` | ≤8 ms | 0.453 ms | 通过 |
| `simCreate`（settle 1.5 s） | ≤60 ms | 36.6 ms | 通过 |
| 静态自检 | 参数不变不重算；当前 22 ms 级 | 6.1 ms/次（14 项） | 通过（缓存另由 test-runtime selftest 覆盖） |
| 动态自检 | 移出周期路径、按需执行 | 306.8 ms/次（10 项） | 通过“不进入周期路径”语义；需 bench 固化 |

临时脚本方案（`/tmp/b6-bench.mjs`，不写入仓库）：

```js
import { loadPhysics } from '/home/andyk/projects/formula-simulator/tools/audit/_harness.mjs';
const api = loadPhysics(['suspEvalReset', 'suspEvalCount']);
const t = () => Number(process.hrtime.bigint()) / 1e6;
const sim = api.simCreate(api.DEFAULTS, { settle: 0 });
for (let i = 0; i < 5; i += 1) api.simBuildModel(sim);
const times = [];
for (let i = 0; i < 200; i += 1) { const s = t(); api.simBuildModel(sim); times.push(t() - s); }
times.sort((a, b) => a - b);
console.log('simBuildModel median', times[100], 'ms');
```

正式 M6 前应由 B0-1/B1-5 补 `tools/bench.mjs`（`benchStep`、`benchModel`），固定 Node 版本、预热次数、样本数和 GC 处理；临时结果只能作为“疑似未达标”的证据，不能替代正式 bench。

## 4. 接口冻结清单与缺口

以当前 `docs/plan/contracts.v1.md` 和实现核对：

| 契约 | 实现/测试证据 | 状态与缺口 |
| --- | --- | --- |
| `sim.state` 质心 x/y/z、vx/vy/vz、参考点派生 | `test-invariants --group cg`；`simReferencePoint` | 通过 |
| `suspSolveCorner` 的 frame/rocker/motionRatioState/seed/ok | `test-invariants --group corner/rocker`；`03-suspension.js:502-544` | 通过 |
| ForceEvaluation 的 force/moment/momentParts/corners/cg/flags | `test-dynamics [12]`；`05-body-dynamics.js:311-661` | 通过 |
| `simApplyForceAt(sim, roadPoint, forceRoad, bucket)` 三桶 | `test-dynamics [12] forceAssembly`；裸 `simCross` 守卫 0 | 通过 |
| 遥测 10 行 id 与 solverState | `test-ui-browser` 44 项；行 id 与徽标断言 | 通过 |
| runtime 快照（frame/geometry/selftest/assets） | `test-runtime` 78 项；`40-app.js` geometry/assets 投影 | 通过 |
| assets 的 totals/lastBuild/lastTeardown | `test-runtime assets` 组；Node 7/7、共享/缓存跳过 | Node 通过；**浏览器材质/teardown 未覆盖** |
| 共享 harness | 实际为 `tools/audit/_harness.mjs`；contracts 工作区已改；05 §3.1 仍写 `tools/test-harness.mjs` | **文档路径漂移** |
| 审计脚本目录 | 浏览器审计实际在 `tools/audit-browser/`；05 §3.1 写在 `tools/audit/` | **文档路径漂移** |
| 性能 bench | `tools/bench.mjs` 不存在；05 A1 仍引用 | **缺失** |
| B5 契约变更 | contracts/05/README/DESIGN 在 B5 工作区修改，未提交 | **M5 未闭合** |

## 5. 遗留风险与不能在 M6 关闭的事项

1. **预修复基线不可复现。** 当前 `0.2.0.json` 是修复后基线（knownFailures 0），不是 M0 的 39 fail 基线；只有历史 Markdown 与 `ed8aa0a` 对象。M6 条件 1 的证据链不完整，发布前需把历史基线固定为只读工件或 tag，否则 `audit:baseline` 只能证明“当前与修复后基线一致”。
2. **B5 未提交。** 工作区仍有 README.md、DESIGN.md、contracts.v1.md、05-regression.md、test-dynamics.mjs 修改；05 §9 已在工作区补 B5-1/B5-2 实施步骤，但尚未提交；主册 §9 仍写 47+52，而当前实测为 50+80，B5 工作区的 README/DESIGN 已改到 50/80。M5、M6 条件 4 和版本/变更记录不能关闭。
3. **版本与变更记录。** `package.json` 与 `APP_VERSION` 仍为 0.2.0，主册 §8.3 要求 B1 后 0.3.0；无 CHANGELOG。DESIGN 标 v0.3 但应用版本未变，属于文档/版本漂移。
4. **性能预算。** `tools/bench.mjs` 缺失；临时实测 `simBuildModel` 0.094 ms 超过 0.05 ms，且没有“优化前后 bit-identical”对照记录。M6 条件 5 不能按当前证据判通过。
5. **浏览器材质/teardown 证据。** 03 B3-4 要求浏览器一次重建 7/7、共享/缓存 0、teardown 归零；`test-ui-browser.mjs` 没有 materialCase/assets/dispose 断言；只有 `audit-browser-contract` 的 B5.4 和 Node `test-runtime` assets 组。B5.4 的浏览器回归缺口需补测试或由 lead 明确降级为 Node 口径。
6. **浏览器依赖 Chrome。** 当前 Chrome 156 可用，`test:ui`/`test:browser`/`test:camera` 和 `audit` 的 browser 组通过；无 Chrome 时默认 SKIP，CI 必须设 `FS_REQUIRE_CHROME=1`，否则“全绿”可能只是跳过。
7. **Node 版本下限。** 当前只在 Node 24.22.1 验证；`engines >=18`，但浏览器测试依赖全局 `WebSocket`（Node 21+）。未在 Node 18/20 跑 `npm test`/`test:invariants`/`test:runtime`，不能证明声明的下限。
8. **构建产物与版本。** `build:check` 通过，`index.html` 1,019,876 B、SHA-256 `d302c44d…b508`；B5 只改文档时无需重建，但若 B5 继续改模板或源码，必须重新 build 并复核哈希。`.qoder/` 仍是未跟踪目录，发布前应清理或忽略。
9. **05/契约/实际路径漂移。** 05 §3.1 仍写 `tools/test-harness.mjs` 与 `tools/audit/audit-browser-contract.mjs`，实际为 `tools/audit/_harness.mjs` 与 `tools/audit-browser/*`；contracts 工作区已部分修正，但 B5 提交前仍不闭合。
10. **M0 验收文字过期。** 05 §8 仍写“B0 12 项检查均为 fail，退出 0”；当前基线已 0 fail、`audit:baseline` 为 match。历史 B0 证据在 `ed8aa0a`，当前表格需改为“历史基线 vs 当前基线”两列，否则 M6 评审会误判。

## 6. 建议的 M6 验收命令序列

前置：B5 提交完成、工作区干净、版本策略确定；在 Node 24.22.1（或 CI 的 Node 22）与 Chrome 156 上执行。浏览器命令统一带 `FS_REQUIRE_CHROME=1`，禁止 SKIP 冒充通过。

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

预期输出（当前实测）：

| 命令 | 预期 |
| --- | --- |
| `npm test` | `PASS 50/50 checks` + `PASS 80/80 checks`，退出 0 |
| `npm run test:invariants` | `PASS 27/27 checks`，退出 0 |
| `npm run test:runtime` | `PASS 78/78 checks`，退出 0 |
| `npm run test:dev-server` | `PASS 12 dev-server checks`，退出 0 |
| `npm run build:check` | `index.html 与源码一致 1019876 B sha256 d302c44d…b508`，退出 0 |
| `test:ui` | `PASS 44 ui checks`，退出 0 |
| `test:browser` | `PASS dynamic browser checks`（26 项矩阵），退出 0 |
| `test:camera` | `PASS camera checks`（20 项矩阵），退出 0（历史勘察值；最终口径 19 项，见 acceptance） |
| `npm run audit` | 10 个审计脚本、51 checks、0 failed；退出 0 |
| `npm run audit:baseline` | `baseline: match`；退出 0 |
| `git diff --exit-code index.html` | 无输出、退出 0 |
| `git status --short` | 空（清理 `.qoder/` 后）；否则列明剩余未提交项 |

若要把 `simBuildModel` 作为硬门禁，需先补 `tools/bench.mjs` 并明确采样口径；在 0.094 ms 的实测下，按主册 ≤0.05 ms 不能宣判通过。

## 7. 结论与建议

B1–B4 的代码、测试与审计当前是绿的，12 项缺陷的“当前绿”证据充分；M6 的真正阻塞不在功能回归，而在证据链和收口条件：历史红基线被覆盖、B5 未提交、bench 缺失且一项性能超预算、浏览器材质/teardown 缺口、Node 18/20 未验证、版本未升。

建议 lead 在 M6 评审前完成四件事：一是把 `ed8aa0a` 的 39 fail 基线固化为只读工件并与当前 51 pass 并列；二是 B5 提交并把文档断言逐条绑定测试编号；三是补 `tools/bench.mjs` 并复核 `simBuildModel`，决定是优化还是正式调整预算；四是补 B5.4 浏览器材质/teardown 断言，或在准入报告中明确标注“Node 口径通过、浏览器口径未覆盖”。完成这四项后，再按第 6 节命令序列跑一遍，才具备 M6 关闭条件。
