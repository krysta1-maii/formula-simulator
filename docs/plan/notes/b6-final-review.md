# B6 交付前独立复核（b6-final-review）

| 项目 | 内容 |
| --- | --- |
| 复核者 | reviewer（共享任务 task-6，独立于施工与文档定稿） |
| 工作目录 | `/home/andyk/projects/formula-simulator` |
| 分支 / HEAD | `feat/plan-execution` / `cbed2d6`（B6 中间 WIP；B6 收尾改动未提交） |
| 复核时间 | 2026-11-19 04:25–04:55（Asia/Hong_Kong） |
| 环境 | Node v24.22.1；Google Chrome 156.0.8078.47；linux/x64（WSL2） |
| 写入范围 | 仅本文件；除本文件外未修改仓库内任何文件 |
| 结论 | 功能、构建、回归、性能可通过独立复核；建议以“有条件通过”签署 M6，条件为修正下述两处文档覆盖声明（或补测试）。未发现阻塞代码/产物提交的问题。 |

## 0. 结论摘要

1. **改动集合与交付边界一致。** 复核开始时工作区为 13 个已跟踪修改 + 2 个未跟踪记录文件，本文件写入后为 3 个未跟踪记录；连同 `cbed2d6` 已包含的 6 个 B6 文件，B6 全量相对 `2999731` 为 19 个文件加 3 个新增记录（含本文件）。`.qoder/` 与 `.tmp-test/` 均被 `.gitignore` 忽略，不会进入提交。
2. **构建、版本、数字全部可追溯。** `node tools/check-build.mjs --strict` 通过：`1021578 B`、`sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`；页脚、`APP_VERSION`、`package.json` 均为 `0.3.0`。acceptance 的 50+80、27、78、12、45、26、19、51、bench 数据、字节数与哈希均可追溯到 `.tmp-test/node-regression-final.log`、`docs/plan/notes/b6-verification.md`、`docs/plan/notes/b6-ui-stability.md` 或本轮独立命令输出。
3. **UI 测试修复成立。** `test-ui-browser.mjs` 未提交 diff 只含 B5.4 材质/几何释放断言和 viewport 面板竞态修复；没有新增固定 sleep、没有放宽或删除既有断言。A 轮 run9、B 轮 run2 的失败证据与最终 10 连跑 10/10 日志均与未提交修复一致；本轮独立单跑亦为 `PASS 45 ui checks`。
4. **两处覆盖声明过强，需在签署“全部满足”前处理。**
   - 条件 2 的“动量与能量”在 `test-physics-invariants.mjs` 的 27 项中没有对应断言；独立测算显示非主轴能量漂移约 `1.88e-3`，低于计划阈值 `2e-3`，但该数值没有进入自动测试。
   - `DESIGN.md` 20.10 与 acceptance §2.1 第 13 行声称 teardown（`FSApp.dispose()`/`teardownScene`）由 Node `test-runtime` assets 组与 `audit-browser` B5.4 覆盖；实际两处只覆盖 `disposeGroupChildren` 与重建释放，没有任何测试调用 `FSApp.dispose()`。
5. **提交层面没有阻塞项。** 但 `cbed2d6` 是 WIP 提交，要做成 4 个干净提交必须先 `git reset --soft 2999731` 再接续；`index.html` 是构建产物，若只在 release 提交落库，perf/test(ui) 两个中间提交会 `build:check` 失败。建议按本文 §4 的分步重建法处理。
6. **最终意见：** 代码、构建、回归、性能维度可签 M6；若维持 acceptance 当前“六条准入条件全部满足”的措辞，建议改为“有条件通过”，条件为本文 §2.6 的 A1、A2 两项文档修正或补测。

## 1. 复核方法

本轮复核为只读复核，全部命令在工作区根目录执行；唯一写入是本文。方法分五类：

1. **状态与差异核对**：`git status --short`、`git status --short --ignored`、`git diff --stat`、`git diff 2999731 --stat`、`git show --stat cbed2d6`、`git diff --check`、`git diff --summary`、`git check-ignore -v .qoder .tmp-test`。
2. **构建与版本核对**：`node tools/check-build.mjs --strict`；直接读取 `index.html` 字节数、sha256、页脚版本；核对 `src/js/00-core.js` 的 `APP_VERSION` 与 `package.json` 的 `version`。
3. **回归独立复跑**：`npm test`、`node tools/test-physics-invariants.mjs`、`node tools/test-runtime.mjs`、`node tools/test-dev-server.mjs`、`node tools/bench.mjs`、`FS_REQUIRE_CHROME=1 node tools/test-dynamics-browser.mjs`、`FS_REQUIRE_CHROME=1 node tools/test-camera.mjs`、`FS_REQUIRE_CHROME=1 npm run audit`、`npm run audit:baseline`、`FS_REQUIRE_CHROME=1 node tools/test-ui-browser.mjs`。
4. **既有证据核验**：逐行检查 `.tmp-test/node-regression-final.log` 的 bench 段；核验 A/B 轮与最终轮 UI 日志、summary TSV、失败日志原文；核对历史基线 `git show ed8aa0a:tools/audit/baseline/0.2.0.json` 的 39 个 knownFailures 与当前 51/51 基线。
5. **针对性补充实验**：用 `git archive 2999731` 导出 B5 源码到 `/tmp`，与当前源码在同一进程加载，比较 `simBuildModel` 输出的 JSON 字符串；用临时脚本测算非主轴自由转动的能量与角动量平方漂移。两段脚本只存在于 `/tmp`，不入库。

未重复执行完整 10 次 UI 连跑：该证据由 `docs/plan/notes/b6-ui-stability.md` 与 `.tmp-test/ui-stability-final-run1..10.log` 提供，本轮以独立单跑和日志逐行核对代替；这是本复核的已知限制，不影响对修复机制的判断。

## 2. 逐项结果

### 2.1 工作区改动集合：通过

`git status --short` 复核开始时的实际输出（13 个修改 + 2 个未跟踪；本文件写入后新增第 3 个未跟踪项）：

```text
 M .gitignore
 M DESIGN.md
 M README.md
 M docs/audit-baseline-0.2.0.md
 M docs/plan/acceptance.md
 M docs/plan/contracts.v1.md
 M docs/plan/handoff.md
 M docs/plan/notes/b6-recon.md
 M docs/plan/parts/05-regression.md
 M "docs/施工计划.md"
 M index.html
 M src/js/00-core.js
 M tools/test-ui-browser.mjs
?? docs/plan/notes/b6-ui-stability.md
?? docs/plan/notes/b6-verification.md
```

与任务给定的本轮工作区清单逐项一致。`git diff --stat` 为 13 files changed、272 insertions(+)、132 deletions(-)；`git diff --check` 无空白错误；`git diff --summary` 无模式变更。

需要说明交付边界：另有 6 个 B6 文件已在 `cbed2d6` 中提交，而不在工作区 status 中——`package.json`、`src/index.template.html`、`src/js/05-body-dynamics.js`、`src/styles.css`、`tools/audit/_harness.mjs`、`tools/bench.mjs`。因此 `git diff 2999731 --stat` 显示 19 files changed、1241 insertions(+)、154 deletions(-)；再加 3 个新增记录（`b6-verification.md`、`b6-ui-stability.md`、本文件），B6 全量为 22 个文件。提交拆分必须以这个全量为准，不能只看工作区。

`.qoder/` 与 `.tmp-test/` 均被忽略：

```text
.gitignore:47:.qoder/    .qoder
.gitignore:43:.tmp-test/ .tmp-test
```

`git status --short --ignored` 中二者为 `!!` 项，普通 status 不出现，符合要求。

### 2.2 构建与版本：通过

`node tools/check-build.mjs --strict` 退出 0，输出：

```text
index.html 与源码一致  1021578 B  sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246  (/home/andyk/projects/formula-simulator/index.html)
```

独立核对：

| 项 | 实际值 | 结果 |
| --- | --- | --- |
| `index.html` 字节数 | 1,021,578 B | 一致 |
| `index.html` sha256 | `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246` | 一致 |
| 页脚 | 唯一一处 `v0.3.0`，无 `v0.2.0` | 通过 |
| `src/js/00-core.js:10` | `const APP_VERSION = '0.3.0';` | 通过 |
| `package.json` version | `0.3.0` | 通过 |
| 运行时依赖 | `dependencies`/`devDependencies` 均为空 | 通过 |

### 2.3 数字一致性：通过

acceptance 引用的全部数字均可在指定证据中找到原值；本轮又独立复跑了对应命令。

| acceptance 数字 | 证据来源 | 本轮核对结果 |
| --- | --- | --- |
| `npm test` 50/50 + 80/80 | `.tmp-test/node-regression-final.log` 第 76、187 行 | 独立复跑 `PASS 50/50 checks`、`PASS 80/80 checks`，退出 0 |
| `test:invariants` 27/27 | 同上第 189 行 | 独立复跑 `PASS 27/27 checks`，退出 0 |
| `test:runtime` 78/78 | 同上第 278 行 | 独立复跑 `PASS 78/78 checks`，退出 0 |
| `test:dev-server` 12/12 | 同上第 293 行 | 独立复跑 `PASS 12 dev-server checks`，退出 0 |
| `test:ui` 45 项 | b6-ui-stability.md；最终轮 10 个日志 | 独立单跑 `PASS 45 ui checks`；10 个最终日志均为同一 PASS 行 |
| `test:browser` 26 项 | b6-verification.md 第 36 行 | 独立复跑 `PASS dynamic browser checks`，退出 0，19.0 s |
| `test:camera` 19 项 | b6-verification.md 第 37、113 行 | 独立复跑 `PASS camera checks`，退出 0，25.6 s；静态计数与 4 预设循环展开后确为 19 |
| `audit` 51 checks | b6-verification.md 第 38、73–100 行 | 独立复跑 `[audit] PASS 51 checks`，10 个脚本、0 failed，退出 0 |
| `audit:baseline` match | b6-verification.md 第 39、104 行 | 独立复跑 `PASS 51 checks`、`baseline: match`，退出 0 |
| bench 单步 0.0180/0.0170/0.0257 ms | `.tmp-test/node-regression-final.log` 第 300 行 | 原值逐字一致；独立复跑中位 0.0212 ms，受当前宿主负载影响，仍远低于 0.05 ms 预算 |
| bench suspEval 4.0650/4.08 | 同上第 301 行 | 原值逐字一致；独立复跑同为 4.065/4.08 |
| bench simBuildModel hot 0.0264/0.0233/0.0402、coldStable 0.0249、coldStart 0.8622 | 同上第 302、307 行 | 原值逐字一致；独立复跑 hotStable 0.0351 ms，仍在 0.05 ms 预算内 |
| bench computeStatic 0.0803/0.0592/0.2012 | 同上第 303 行 | 原值逐字一致；独立复跑中位 0.0855 ms |
| bench simCreate 12.0674/11.7041/14.3035 | 同上第 304 行 | 原值逐字一致；独立复跑中位 15.8213 ms |
| 静态自检 4.9706 ms、动态自检 214.9483 ms | 同上第 308–309 行 | 原值逐字一致；独立复跑 5.2872 ms、303.0007 ms（负载差异，按需执行，不影响预算判定） |
| 1,021,578 B / sha256 668c59ea… | index.html 与 check-build 输出 | 逐字节与哈希一致 |
| UI 最终 10 连跑 10/10、605,559 ms | b6-ui-stability.md 第 127–147 行、最终轮 summary TSV | 10 个日志逐行核对一致；10 次耗时求和 605,559 ms |

补充核对：

- camera 从前文档中的“20 项”改为“19 项”是有依据的：`tools/test-camera.mjs` 共有 16 个 `check()` 调用点（不含函数定义），其中 1 个位于 side/front/rear/top 四预设循环内，展开为 15+4=19；`docs/plan/notes/b6-verification.md` 第 113 行已解释该口径，`docs/plan/contracts.v1.md`、`docs/施工计划.md` §9 与 acceptance 均已改为 19。
- acceptance 中不再有“待定/待填/未通过/FAIL/尚不存在/清理稿/APP_VERSION 0.2.0”等残留；`grep -nE` 对该文件返回无匹配（退出 1）。
- 数值对比中，独立复跑的绝对耗时与 b6-verification 的原始记录不同（当前宿主负载不同），但所有预算判定与项数一致；这不构成数字不一致，反而说明 bench 结论不依赖单次计时。

### 2.4 文档路径与旧口径：通过（有一处轻微历史标注不完整）

实现路径核对：

| 文档引用 | 实际存在 | 结果 |
| --- | --- | --- |
| `tools/audit/_harness.mjs` | 存在，209 行，导出 `loadPhysics`、`createAudit`、`runAudit` 等 | 一致 |
| `tools/audit-browser/` | 存在，含 `_cdp.mjs`、`audit-browser-contract.mjs`、`audit-ui.mjs` | 一致 |
| `tools/bench.mjs` | 存在，13,118 B，已接入 `npm run bench` | 一致 |

旧口径 grep 结果：

- `e6e4` / `b0dc` 只出现在 `docs/plan/handoff.md:45` 与 `:65`，属于 B6 暂停时的施工记录；handoff 顶部第 3 行已加“状态更新”说明，但该说明只明确“第 4 节保留为施工记录”，第 2、3 节中的旧 HEAD、旧产物与“44 项”叙述没有逐条标注为历史。属轻微文档一致性问题，见 §2.6 B3。
- `47+52` 只出现在历史勘察（`b1–b6-recon`）、历史计划分册（`02/03/04/06`）、`docs/plan/parts/05-regression.md` 的 B0 现状说明、`docs/施工计划.md` §10 与旧版 code-review；其中 05-regression、施工计划与 acceptance 均已有明确的历史口径说明。`docs/plan/notes/b6-recon.md:12` 还专门加了“历史勘察说明”。
- `44 项` 只出现在 `handoff.md`（历史状态）与带历史说明的 `b6-recon.md`；最终文档 README/DESIGN/施工计划/acceptance/contracts 均为 45。
- `tools/test-harness.mjs` 只出现在历史勘察、历史审核报告与 `05-regression.md:190` 的 B0-1 历史计划行（该行已注明“历史计划；实际落点为 `tools/audit/_harness.mjs`”）。同表 B0-1b 行仍写 `node tools/audit/audit-browser-contract.mjs`，未单独标注，但该表整体属于 B0 历史施工步骤，影响很低。

### 2.5 `test-ui-browser.mjs` diff 审计：通过（有一处非阻塞的测试强度备注）

`git diff cbed2d6 -- tools/test-ui-browser.mjs` 为 `+35/-3`，与 b6-ui-stability.md 第 116 行一致；当前文件 27,979 B、sha256 `0e92f20b6ab978698799008cb65aae859f8a12d851526fc03c89d110d09a8ee1`、mtime 04:08:44，与记录一致。

未提交 diff 只有四类改动：

1. `waitForViewport` 在等待 `innerWidth/innerHeight` 后，增加等待 `matchMedia('(max-width: 980px)').matches` 与宽度的预期关系，再等待两个 `requestAnimationFrame`，让 980px 断点的 change 事件队列清空；原有 `sleep(80)` 保留，未新增等待用固定 sleep。
2. 新增 `openPanelStable`：最多 3 次尝试，`ensurePanelOpen` + `waitFor` is-open + 双 rAF 后再次确认 is-open；若被异步关闭，则 `closePanel` 后重试；3 次失败返回 false。
3. viewport 组 844x390 分支用 `openPanelStable` 替换直接 `ensurePanelOpen`，并在既有 `panel.open` 与位置断言前增加 `panelStable` 前置条件；断言文案与阈值未变。
4. focus 组切到 844x390 后的 exclusive 分支用 `openPanelStable` 替换 `ensurePanelOpen`；B5.4 的 assets 组在 solver 之后、display 之前新增，挂接 `THREE.Material.prototype.dispose`/`BufferGeometry.prototype.dispose` 计数，等待 `__uiMatDispose >= 3 && __uiGeomDispose > 0`（4 s 超时），再恢复 `wheelbase: 3.55`、等待重建并 `resetDynamics({ settle: 1 })`。

核验结论：

- 没有新增固定 sleep（diff 中无新增 `sleep(` 行）；没有放宽或删除既有断言；viewport 组和 exclusive 组仍是原来的断言条件。
- B5.4 断言的等待使用 `waitFor` 轮询，不是固定 sleep；实测计数稳定为 `materialDisposed=7 geometryDisposed=387`。
- A 轮 run9、B 轮 run2 的失败原文均为同一条既有断言：

```text
FAIL 844x390 panel stays inside the viewport  {"open":false,"top":62,"bottom":332,"screenshotTop":288,"screenshotBottom":321,"viewport":390}
```

  两次失败时布局数值与通过时逐字段相同，只有 `open=false`；20 次 A/B 运行中 B5.4 断言 20/20 通过。归因于 `src/js/30-ui.js:1342-1351` 的 matchMedia change 回调异步关闭面板，证据链成立。
- 最终轮 10 个日志均为 `PASS 45 ui checks`、artifact 1,021,578 B / `668c59ea…`，10 次耗时合计 605,559 ms；B5.4 行 10/10 为 `materialDisposed=7 geometryDisposed=387`。本轮独立单跑亦为 `PASS 45 ui checks`（49,957 ms，同一 artifact 哈希）。
- 非阻塞备注：exclusive 分支忽略了 `openPanelStable` 的返回值。若面板打开前置条件失败，`exclusive` 断言仍可能因 `leftOpen=false && leftInert=true && rightOpen=true` 而通过，理论上存在“前置失败但断言通过”的窗口；这不是本次修改引入的放宽（原代码同样忽略 `ensurePanelOpen` 返回值），但后续可把返回值纳入 check 前置条件。

### 2.6 acceptance §2.1 与 §7 抽查：发现两处覆盖声明过强

§2.1 的 16 行逐行抽查：测试文件名、分组名与 check id 均在仓库中存在，抽查覆盖：

- 第 1 行 `B4.2/cg-drift-*`、`ref-path-*`：`tools/audit/audit-free-body.mjs:91-98` 存在，历史基线 6/12 fail。
- 第 3 行 `B4.1/unreachable-ok`、`ok-residual`、`motion-ratio-range`、`motion-ratio-continuity`、`damping-peak`：`audit-rocker-reach.mjs` 存在，5/5 fail → 5/5 pass。
- 第 5 行 `B4.3/low-speed-hold` 等 5 个、`B4.5/default-sample` 等 4 个：`audit-friction-low-speed.mjs`、`audit-contact-gap.mjs` 存在。
- 第 6 行 `B4.4/body-moment`、`road-magnitude`、`yaw90-axis`：`audit-impulse-frame.mjs` 存在。
- 第 7 行 `B5.1/60hz`、`30hz`、`10-time`、`5-time`、`5-clamp50-time`、`dropped-field`：`audit-frame-time.mjs` 的动态 id 构造存在。
- 第 9、10、11、13 行 `B5.3/telemetry-dom`、`O1/chunked-vs-one-shot`、`B5.2/geometry-generation`、`B5.4/material-release`：`audit-browser-contract.mjs` 存在。
- 第 12 行 `audit-ui` U1–U4：`audit-ui.mjs` 存在。
- 第 16 行的 50/80/27/78/45/26/19 七组计数：与脚本实际 check 数一致（本文件 §2.3 已核对）。

发现两处问题：

**A1（重要，文档/测试覆盖缺口）：条件 2 的“动量与能量”没有自动断言。**

- `docs/plan/acceptance.md:46` 把条件 2 写成“自由刚体解析轨迹、动量与能量、接地点唯一性、运动比连续性通过”，证据只列 `test:invariants` 27/27 与 `test:dynamics` 80/80。
- 实际 `tools/test-physics-invariants.mjs` 的 cg 组只有 `cg/*-drift`、`cg/*-ref-path`、`cg/*-omega`、`cg/*-qnorm` 四类（第 86–90 行，3 轴共 12 项）；其余组为 rocker/corner/seed/ratio/shadow。全文件没有 energy、momentum、能量、动量 相关断言；80 项 dynamics 中也没有。
- 计划本身要求过该项：`docs/plan/parts/01-physics-state.md:227` 写明“主轴工况相对漂移 < 1e-12；非主轴工况 < 2e-3”，且说明这是“回归监控”，但该测试未落地。
- 本轮独立测算（临时脚本，B5 源码同源装载；初始 `wx=wy=wz=1`、零外力、1 s）：能量相对漂移 `0.0018783490650824018`，角动量平方相对漂移 `0.001893234728993006`，四元数范数 `0.9999999999999999`；数值低于 `2e-3` 监控阈值，说明当前实现大概率能通过该断言，但“27/27 通过”不能证明“动量与能量”已被测试覆盖。
- 影响：acceptance 第 46 行与第 157 行“六条准入条件全部满足”在条件 2 上属于过度声明。建议二选一：(a) 在 cg 组补一条能量/角动量断言并重跑（计数会从 27 变为 28，需同步 README/DESIGN/acceptance/施工计划的 27）；(b) 把 acceptance 条件 2 改为“自由刚体轨迹、角速度/姿态规范性与运动比连续性通过；非主轴能量漂移以 1.88e-3 实测作为回归监控，未纳入自动断言”，并在 §7 保留该项为已知监控项。

**A2（重要，文档/测试覆盖缺口）：DESIGN 20.10 与 §2.1 第 13 行的 teardown 覆盖声明不成立。**

- `DESIGN.md:696` 写“teardown 归零由 Node `test-runtime` assets 组与 `audit-browser` B5.4 覆盖”。
- `docs/plan/acceptance.md:68`（§2.1 第 13 行）把“teardown 幂等”映射到 `test-runtime --group assets` 7/7、`test-ui-browser` B5.4、`audit-browser-contract` B5.4。
- 实际 `tools/test-runtime.mjs:201-226` 的 assets 组测试的是 `disposeGroupChildren` 的材质/几何释放、共享/缓存跳过、组清空与二次调用无副作用；`tools/test-ui-browser.mjs:377-390` 与 `tools/audit-browser/audit-browser-contract.mjs:97-111` 测试的是重建（rebuild）释放计数。两者都没有调用 `FSApp.dispose()` 或 `teardownScene`；`src/js/40-app.js:506` 导出的 `dispose: teardownScene` 与 `src/js/10-scene.js:1652` 的 teardown 全流程没有任何测试入口。
- 影响：这是“文档断言—测试编号一一对应”条件 4 的一处实质缺口，不只是措辞问题。代码本身有 `S.teardownDone` 幂等保护，但未被测试验证。建议把 DESIGN 20.10 改为“组级释放由 Node assets 组覆盖；完整 `FSApp.dispose()` 的浏览器 teardown 未单独断言，作为阶段三前补测项”，并同步 acceptance 第 68 行；或补一条调用 `window.FSApp.dispose()` 后读取 `getAssetStats().lastTeardown` 的浏览器断言（需重跑 10 连跑）。

**B1（轻微，文档一致性）：`docs/plan/handoff.md` 的旧状态未完全加注。** 第 9 行仍写“已提交 HEAD 2999731”、第 13 行写“index.html 仍为 0.2.0 旧产物”、第 45 行写“build:check 失败”、第 65 行写“index.html 未修改”，但第 3 行状态更新已说明这些阻塞项闭合。建议把第 3 行的“本文第 4 节保留为施工记录”改为“第 2–4 节均为 B6 暂停时的施工记录”，或给上述行加“历史状态”标记。属于交接文档的可读性问题，不影响交付。

**B2（轻微，文档范围）：§2.1 是章节级映射，不是逐句一一对应。** 16 行覆盖了任务列出的主要章节，但 README 的垂向脉冲参数（0.12 s / 6800 N）、默认 30 根连杆/68 端点、DESIGN 20.4/20.5/20.6 等断言没有单独行。测试侧大多有对应覆盖（如 `test-dynamics [5]` 的 heave impulse、`test-dynamics [1b]` 的机构），但“一一对应”的字面声明比表格实际覆盖更强。建议把 §2.1 的措辞改为“按章节抽取 16 组关键断言”，或在条件 4 的结论中注明“章节级对应，非逐句穷举”。

**B3（轻微，证据可复现性）：bench 数据只在被忽略的本地日志中。** `.tmp-test/node-regression-final.log` 被 `.gitignore` 忽略；acceptance §3 与 §7 将其作为正式性能证据。当前机器上该日志存在、数值逐字一致，但仓库的后续读者无法从 git 获得。建议把该日志的 `=== bench ===` 段作为附录粘进一份受版本控制的记录（例如 `b6-verification.md` 或 acceptance 附录），或把 `node tools/bench.mjs --json` 的输出提交到 `docs/plan/notes/`。

### 2.7 补充实验：优化前后输出与能量漂移

**优化前后 `simBuildModel` JSON 对照。** 将 `2999731` 导出到 `/tmp/oldrepo`，用当前与旧版 `tools/audit/_harness.mjs` 在同一进程分别加载，选择四组代表性工况：

| 工况 | 旧版 JSON 长度 | 新版 JSON 长度 | 结果 |
| --- | ---: | ---: | --- |
| 默认 | 18,624 | 18,624 | 逐字节相同 |
| `slope:8, bank:7` | 19,782 | 19,782 | 逐字节相同 |
| `friction:0.35, steer:0.12` | 18,628 | 18,628 | 逐字节相同 |
| `mass:750` | 18,731 | 18,731 | 逐字节相同 |

另外对默认与 8°/7° 工况各推进 200 个物理步后再比较，JSON 仍逐字节相同。故 acceptance §3“四组模型 JSON 与优化前逐字节相同”的确定性声明在本轮独立实验中得到支持；但该实验是本次复核临时执行的，仓库内仍没有对应的可复现脚本，建议与 B3 一并归档。

**非主轴能量/角动量。** 零外力、`wx=wy=wz=1`、1 s、500 步：能量相对漂移 `1.878e-3`，角动量平方相对漂移 `1.893e-3`，四元数范数 1.0。数值低于计划阈值 2e-3，但未进入自动测试（见 A1）。

### 2.8 历史基线与只读保护：通过

- 当前 `tools/audit/baseline/0.2.0.json`：51 个 check，51 pass、0 fail、`knownFailures: []`。
- `git show ed8aa0a:tools/audit/baseline/0.2.0.json`：51 个 check，12 pass、39 fail、`knownFailures` 39，与 `docs/audit-baseline-0.2.0.md` 的 12/39 完全一致。
- 历史基线文档已加“历史快照说明”，当前 JSON 与历史文档不再混用；acceptance §6.1 的只读保护要求明确。该项通过。

## 3. 证据命令与输出摘要

以下为本轮实际执行的命令与关键输出（节选，均为原样摘要）：

```text
$ git status --short
 M .gitignore
 M DESIGN.md
 M README.md
 M docs/audit-baseline-0.2.0.md
 M docs/plan/acceptance.md
 M docs/plan/contracts.v1.md
 M docs/plan/handoff.md
 M docs/plan/notes/b6-recon.md
 M docs/plan/parts/05-regression.md
 M "docs/施工计划.md"
 M index.html
 M src/js/00-core.js
 M tools/test-ui-browser.mjs
?? docs/plan/notes/b6-ui-stability.md
?? docs/plan/notes/b6-verification.md

$ git diff --stat
 13 files changed, 272 insertions(+), 132 deletions(-)

$ git diff 2999731 --stat
 19 files changed, 1241 insertions(+), 154 deletions(-)

$ git check-ignore -v .qoder .tmp-test
.gitignore:47:.qoder/    .qoder
.gitignore:43:.tmp-test/ .tmp-test

$ node tools/check-build.mjs --strict
index.html 与源码一致  1021578 B  sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246

$ npm test
PASS  50/50 checks
PASS  80/80 checks

$ node tools/test-physics-invariants.mjs
PASS  27/27 checks

$ node tools/test-runtime.mjs
PASS  78/78 checks

$ node tools/test-dev-server.mjs
PASS  12 dev-server checks

$ node tools/bench.mjs
单子步                 0.0216 / 0.0212 / 0.0280 ms  PASS
每子步 suspEval        4.0650 / 4.0800 / 4.0800    PASS
实时模型构建（热稳定）     0.0376 / 0.0351 / 0.0614 ms  PASS
computeStatic          0.1063 / 0.0855 / 0.2169 ms  PASS
simCreate              15.9703 / 15.8213 / 21.8575 ms PASS
总体: PASS

$ FS_REQUIRE_CHROME=1 node tools/test-dynamics-browser.mjs
PASS  dynamic browser checks   （19,038 ms，退出 0）

$ FS_REQUIRE_CHROME=1 node tools/test-camera.mjs
PASS  camera checks            （25,567 ms，退出 0）

$ FS_REQUIRE_CHROME=1 npm run audit
[audit] PASS  51 checks        （10 个脚本、0 failed，33,012 ms）

$ npm run audit:baseline
[audit] PASS  51 checks
  baseline: match              （33,602 ms）

$ FS_REQUIRE_CHROME=1 node tools/test-ui-browser.mjs
PASS  45 ui checks  [artifact 1021578 B  sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246]
                               （49,957 ms，退出 0）
```

最终 UI 10 连跑日志（`.tmp-test/ui-stability-final-run*.log`）逐行摘要：

```text
run1  PASS  45 ui checks  [artifact 1021578 B  sha256 668c59ea…f246]
...
run10 PASS  45 ui checks  [artifact 1021578 B  sha256 668c59ea…f246]
B5.4 行（10/10）：ok B5.4 rebuild releases materials and geometry  materialDisposed=7 geometryDisposed=387
合计：605,559 ms
```

A/B 轮失败证据（原样）：

```text
.tmp-test/roundA-run9.log:FAIL 844x390 panel stays inside the viewport  {"open":false,"top":62,"bottom":332,"screenshotTop":288,"screenshotBottom":321,"viewport":390}
.tmp-test/roundB-run2.log:FAIL 844x390 panel stays inside the viewport  {"open":false,"top":62,"bottom":332,"screenshotTop":288,"screenshotBottom":321,"viewport":390}
```

历史基线核对：

```text
当前 baseline: 51 checks, 51 pass, 0 fail, knownFailures 0
ed8aa0a:       51 checks, 12 pass, 39 fail, knownFailures 39
```

## 4. 提交拆分建议

### 4.1 前置：先解除 WIP 提交

`cbed2d6` 已包含 13 个文件、1035 insertions/88 deletions 的 B6 中间改动，其中 6 个文件（`package.json`、`src/index.template.html`、`src/js/05-body-dynamics.js`、`src/styles.css`、`tools/audit/_harness.mjs`、`tools/bench.mjs`）不在当前工作区 status 中。若直接在 `cbed2d6` 上继续提交，WIP 提交会永久留在历史里，4 个正式提交无法覆盖它。

建议：

```bash
git branch backup/b6-wip cbed2d6      # 可选，保底
git reset --soft 2999731              # HEAD 回到 B5，工作区与索引保留
git restore --staged .                # 清空索引，工作区不变
git status --short                    # 应为 15 个已跟踪修改 + 7 个未跟踪（4 个相对 B5 新增的 B6 文件 + 3 个记录文件）
```

若 `git restore --staged .` 之后发现文件数不对，先停止并检查，不要用 `git checkout -- .` 覆盖工作区。

### 4.2 四个提交与逐提交文件清单

| # | 提交消息（建议） | 文件清单 | 说明 |
| ---: | --- | --- | --- |
| 1 | `perf(runtime): 优化 simBuildModel 热路径并新增 bench` | `src/js/05-body-dynamics.js`、`tools/bench.mjs`、`package.json`（仅 bench hunk）、`index.html`（按提交 1 源码重建，0.2.0 页脚） | 单独 hunk 暂存 `package.json` 的 `"bench"` 行；此提交不应包含 version 0.3.0 |
| 2 | `test(ui): 补 B5.4 释放断言并稳定面板竞态` | `tools/test-ui-browser.mjs`、`src/styles.css`、`index.html`（按提交 2 源码重建，0.2.0 页脚） | styles.css 影响产物，必须同提交重建；test-ui 自身不影响 index.html |
| 3 | `chore(release): 版本升至 0.3.0 并重建产物` | `package.json`（仅 version hunk）、`README.md`、`DESIGN.md`、`src/index.template.html`、`src/js/00-core.js`、`tools/audit/_harness.mjs`、`.gitignore`、`index.html`（最终 0.3.0） | README/DESIGN 含 45 项与 Node 版本说明，随版本收口；`.qoder/` 已忽略 |
| 4 | `docs(plan): M6 准入报告、验证记录与主册收口` | `docs/plan/acceptance.md`、`docs/plan/handoff.md`、`docs/plan/contracts.v1.md`、`docs/plan/parts/05-regression.md`、`docs/施工计划.md`、`docs/plan/notes/b6-recon.md`、`docs/plan/notes/b6-verification.md`、`docs/plan/notes/b6-ui-stability.md`、`docs/plan/notes/b6-final-review.md`、`docs/audit-baseline-0.2.0.md` | 三个新增 notes 必须 `git add`；本复核文件也在其中 |

说明：

- 用户在任务中建议 `index.html` 只放在 `chore(release)`。若严格照此执行，提交 1 和提交 2 的源码已分别改变 `05-body-dynamics.js` 与 `styles.css`，但 `index.html` 仍是旧产物，两个中间提交都会 `node tools/check-build.mjs --strict` 失败。两个选择：
  1. **推荐：每个影响产物的提交都重建并提交 `index.html`**（上表做法），使每个提交自洽；代价是 `index.html` 在三个提交中各出现一次，最终提交仍是 0.3.0 版本。
  2. 接受中间提交 `build:check` 失败，只在最终提交通过；这违反“index.html 必须与源码同版提交”的交付约定，不推荐，除非团队明确允许。
- 提交 1 与提交 2 的中间 `index.html` 重建方法（避免污染工作区）：

```bash
# 假设已提交 commit 1（不含 index.html）
git archive HEAD | tar -x -C /tmp/b6-build-c1
(cd /tmp/b6-build-c1 && node tools/build.mjs)
cp /tmp/b6-build-c1/index.html index.html
git add index.html
git commit --amend --no-edit
node tools/check-build.mjs --strict
```

提交 2 同理。最终提交 3 在工作区直接 `node tools/build.mjs`，再 `node tools/check-build.mjs --strict`。

### 4.3 `package.json` 的 hunk 拆分风险

`git diff 2999731 -- package.json` 有两个独立 hunk：第 4 行 `version: 0.2.0 → 0.3.0`，第 16 行附近新增 `"bench": "node tools/bench.mjs"`。风险与操作：

1. 若在提交 1 直接 `git add package.json`，version 0.3.0 会混入 perf 提交，release 提交再无可提交的 version 变更；提交 1 的 `package.json` 也会提前宣称 0.3.0。
2. 推荐 `git add -p package.json`，只选择 bench 那个 hunk；暂存后立即核对：

```bash
git diff --cached -- package.json       # 应只有 bench 行
git show :package.json | grep '"version"'   # 应为 0.2.0
```

3. 若环境不支持交互式 `add -p`，先备份最终 `package.json` 到 `/tmp`，把工作区 `version` 临时改回 0.2.0，`git add package.json` 提交 perf，再把备份复制回来提交 release。不要在未备份时直接改工作区文件。
4. 提交 3 之后核对：

```bash
git show HEAD:package.json | grep '"version"'   # 0.3.0
git show HEAD^:package.json | grep '"version"'  # 0.2.0
```

### 4.4 `index.html` 的验证方法

`index.html` 是 `build.mjs` 从 `src/index.template.html`、`src/styles.css`、`src/js/*.js`、`vendor/three.min.js` 生成的产物，不能脱离源码单独判断。建议每个提交后执行：

```bash
node tools/check-build.mjs --strict
# 期望：index.html 与源码一致  <bytes> B  sha256 <hash>

git status --short
# 期望：空（提交后）

git diff --exit-code index.html
# 期望：无输出、退出 0

git show HEAD:index.html | sha256sum
# 与上一条 check-build 输出的 hash 比较
```

最终提交还应在干净检出/临时归档中复跑一次，避免工作区未跟踪文件影响构建：

```bash
git archive HEAD | tar -x -C /tmp/b6-final-check
(cd /tmp/b6-final-check && node tools/check-build.mjs --strict)
```

当前最终产物已验证为 1,021,578 B / `668c59ea…f246`；提交 1/2 的中间产物哈希会不同，但每个都应满足“源码重算 === 磁盘文件”。

## 5. 残余风险

1. **Node 18/20 未实测。** `package.json` 的 `engines >=18` 只覆盖非浏览器命令；浏览器测试依赖 Node 21+ 的全局 `WebSocket`。README 与 acceptance §6.3 已明确说明，本轮也只在 Node 24.22.1 验证。建议在 CI 补 Node 18/20 的非浏览器矩阵，或在 release note 中保留“Node 18/20 未实测”的限制。
2. **Chrome 是浏览器测试硬依赖。** 无 Chrome 时测试默认 SKIP，必须 `FS_REQUIRE_CHROME=1`；本轮所有浏览器命令均带该开关。CI 需保证 Chrome 可用，否则无法证明 26/19/45/51 的结果。
3. **bench 证据是本地忽略日志。** 见 §2.6 B3；不影响当前结论，但影响后续复现。
4. **最终 10 连跑由 lead 执行。** A/B 轮由 ui-stability 执行，最终轮由 lead 执行并记录；本轮独立单跑 45/45 与日志一致，但未独立重跑 10 次。若要求“独立第三方复跑”，需要再安排约 10 分钟浏览器时间。
5. **分支未推送、CI 未跑。** acceptance §6.4 已列为发布约束；提交后仍需推送并在 Node 22 + Chrome 环境复跑 §5 命令。
6. **历史基线只读保护依赖流程纪律。** 当前 `0.2.0.json` 是修复后基线，`audit:update` 可覆盖；验收文档已警告，但代码层面没有阻止误更新。
7. **WIP 提交与拆分风险。** 见 §4；在完成拆分前，历史里仍有一个 `wip:` 提交，不应直接推送。

## 6. 结论

**是否可签 M6：可以，建议签署“有条件通过”。**

支持“通过”的部分：代码、构建、版本、Node/浏览器回归、审计、baseline、bench、性能优化确定性、UI 稳定性均有本轮独立复跑或逐行证据；未发现功能回归、产物不一致或测试假绿。

条件：

1. **修正条件 2 的能量/动量覆盖声明**：或在 `test-physics-invariants.mjs` 补断言，或在 `docs/plan/acceptance.md:46`、`:157` 明确“能量/角动量漂移作为回归监控（本轮实测 1.88e-3 < 2e-3），未纳入自动断言”。
2. **修正 teardown 覆盖声明**：`DESIGN.md:696` 与 `docs/plan/acceptance.md:68` 不应声称 `audit-browser` B5.4 覆盖 `FSApp.dispose()`；应改为“组级释放由 Node assets 组覆盖，完整浏览器 teardown 未单独断言”，或补测试后重跑 UI 10 连跑。
3. **（建议）** 修正 `docs/plan/handoff.md` 第 9、13、45、65 行的历史状态标注，避免与顶部状态更新冲突；并在 docs 提交中归档 bench 段。

**是否存在阻塞提交的问题：** 未发现阻塞代码/产物提交的问题。两处必须处理的是文档/覆盖声明（A1、A2），不是代码缺陷；若团队接受“有条件通过”，可在 docs(plan) 提交中一并修正文案，提交本身不受影响。若拒绝修正而坚持以“六条准入条件全部满足”签署“通过”，则 A1、A2 构成签署阻塞。

---

复核者：reviewer；日期：2026-11-19；本文件为 task-6 唯一写入产物。
