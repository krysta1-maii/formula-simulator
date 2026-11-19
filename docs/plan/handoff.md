# 施工交接文档（Handoff）

> **历史记录｜基线：0.3.0 B6 交接快照。** 本文保留暂停时的版本、工作区、测试和待办状态，尤其第 2–4 节不是当前导航。当前状态以根目录 [README](../../README.md)、[DESIGN](../../DESIGN.md) 及 [最新验收](acceptance.md) 为准。

> 状态更新（2026-11-19，B6 收尾会话）：第 4.1 节的阻塞项已全部闭合——`index.html` 已按 0.3.0 源码重建并通过严格门禁（1,021,578 B、sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246、页脚 v0.3.0）；`APP_VERSION` 已同步为 0.3.0；浏览器回归、UI 稳定性连跑与审计基线均已复跑。M6 结论与证据见 `docs/plan/acceptance.md`、`docs/plan/notes/b6-verification.md`、`docs/plan/notes/b6-ui-stability.md`；独立复核见 `docs/plan/notes/b6-final-review.md`。本文第 4 节保留为施工记录；文中 44 项 UI、20 项 camera 等旧计数以 `docs/plan/acceptance.md` 的最终口径为准（UI 45 项、camera 19 项）。

| 项目 | 内容 |
| --- | --- |
| 项目 | Formula Simulator 阶段二缺陷修复（施工计划 B0–B6） |
| 分支 | `feat/plan-execution`（未推送） |
| 已提交 HEAD | `2999731`（B5 文档同步） |
| 工作区状态 | B6 收尾改动已保存为 WIP 提交，见第 3 节 |
| 暂停时间 | 2026-11-19 03:40（Asia/Hong_Kong） |
| 施工依据 | `docs/施工计划.md`、`docs/plan/contracts.v1.md`、分册 01–06 |
| 当前版本 | 工作区 0.3.0；`index.html` 仍为 0.2.0 时构建的旧产物 |
| 团队状态 | 任务板 13 项全部 completed；所有 subagent 已停止 |

## 1. 总体进度

B0-0 至 B5 已完成并提交，B6 收尾进行到“代码、测试、审计、性能全部就绪，差最终构建、浏览器全量复跑与 M6 签收”。

| 批次 | 状态 | 提交 | 主要结果 |
| --- | --- | --- | --- |
| B0-0 契约冻结 | 完成 | `3d3f408` | `contracts.v1.md` 冻结状态/角点/力/遥测/命令契约 |
| B0 审计层 | 完成 | `ed8aa0a` | 8 个 Node + 2 个浏览器审计脚本，0.2.0 基线 39 条 knownFailure |
| B1 物理 | 完成 | `75205d8`、`cb9a9d8` | 质心积分、闭式摇臂解、种子所有权、解析运动比；physics 审计 23/23 |
| B2 接触 | 完成 | `d361d27`、`df17140` | HOLD/SLIP、6880.45 N·m 脉冲、contactRoad 唯一、simApplyForceAt；contact 审计 12/12 |
| B3 运行时 | 完成 | `919f2c8`、`65eef75` | 0.5 s/128 步/积压排空、几何代际、自检缓存、资源释放；runtime 审计 11/11 |
| B4 界面/工具链 | 完成 | `328b640`、`919f2c8` | 键盘/焦点、10 行检查表、构建门禁、44 项 UI 测试；ui 审计 5/5 |
| B5 文档 | 完成 | `2999731` | README 11 处、DESIGN 7 处、template 3 处；audit 51/51、baseline match |
| B6 准入 | 进行中 | 未提交 | bench 已落地、性能达标、验收报告骨架已写，差构建与浏览器全量复跑 |

## 2. 当前验收现状

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm test` | 通过 50/50 + 80/80 | 静力 50、动力学 80（B2 新增 [10][11][12]，B4 新增清理项） |
| `node tools/test-physics-invariants.mjs` | 通过 27/27 | cg/rocker/corner/seed/ratio/shadow |
| `node tools/test-runtime.mjs` | 通过 78/78 | frame/geometry/selftest/assets |
| `node tools/test-dev-server.mjs` | 通过 12/12 | 路径越界、405、symlink、no-store |
| `node tools/test-ui-browser.mjs` | 通过 44/44（单次） | a-ui 的等待策略改动后仅跑过 1 次，未完成 10 次稳定性验证 |
| `node tools/test-dynamics-browser.mjs` | 待复跑 | 最近一次通过 26 项在 B3/B4 代码之前，最新构建未验证 |
| `node tools/test-camera.mjs` | 待复跑 | 同上，20 项 |
| `npm run audit` | 通过 51/51 | B5 时全绿；B6 的 simBuildModel 优化后 a-runtime 复跑仍 51/51 |
| `npm run audit:baseline` | 退出 0、match | `knownFailures` 为空 |
| `node tools/bench.mjs` | 总体 PASS | 单步中位 0.0246 ms、suspEval 4.07、simBuildModel 热稳定 0.0433 ms、simCreate 18.96 ms、动态自检 329.5 ms（按需） |
| `node tools/check-build.mjs --strict` | **失败** | 预期 e6e4…、实际 b0dc…：`index.html` 是 0.2.0 页脚的旧产物，模板已 0.3.0 |

## 3. 工作区改动（已保存为 WIP 提交）

以下改动已随本 handoff 一起保存为 WIP 提交；恢复后按第 4.1 节拆成正式提交。

| 文件 | 改动 | 归属/状态 |
| --- | --- | --- |
| `README.md` | 版本 0.2.0 → 0.3.0（1 行） | B6 版本收口，可用 |
| `package.json` | `version` 0.3.0；新增 `"bench": "node tools/bench.mjs"` | B6，可用 |
| `src/index.template.html` | 页脚 v0.2.0 → v0.3.0 | B6，重建前不得提交产物 |
| `tools/audit/_harness.mjs` | `APP_VERSION` 0.2.0 → 0.3.0 | B6；baseline 文件仍为 `0.2.0.json`，属预期 |
| `src/js/05-body-dynamics.js` | `simBuildModel` 热路径优化（+146/−），输出四组工况逐字节相同 | B6 性能，已由 npm test/audit 验证 |
| `tools/test-ui-browser.mjs` | 等待策略重构（+101/−），固定 sleep 改轮询与状态确认 | B6 UI 稳定化；单次 44/44，未做 10 次 |
| `src/styles.css` | `.panel-close` 的 `transition: all` 改为具体属性 | 同上，配合焦点稳定化 |
| `tools/bench.mjs` | 新增性能基准脚本 | B6，已接入 npm bench |
| `docs/plan/acceptance.md` | 新增 M6 准入报告骨架；性能表已填正式 bench 数据 | 结论仍为“待定”，§0/§2 有过时表述 |
| `docs/plan/notes/b6-recon.md` | B6 勘察记录 | 可保留 |
| `docs/施工计划.md` | M0–M5 标记完成、§8 补 0.3.0、§9 改 50+80 | reviewer 已改，可用 |
| `docs/plan/parts/05-regression.md` | §3.1 harness/目录路径修正 | 可用 |
| `index.html` | **未修改**，仍是 B5 提交的 1,019,996 B / `b0dccc…` | 必须重建后再提交 |

未跟踪的 `.qoder/` 不属于本项目，提交时排除。

## 4. 未完成事项

### 4.1 阻塞 M6（按顺序）

1. **重建 `index.html`**：`node tools/build.mjs`，再跑 `node tools/check-build.mjs --strict`，确认页脚 v0.3.0、哈希与源码一致。构建产物需要提交。
2. **全量浏览器复跑**（有 Chrome，用严格模式）：
   - `FS_REQUIRE_CHROME=1 node tools/test-dynamics-browser.mjs`（26 项）
   - `FS_REQUIRE_CHROME=1 node tools/test-camera.mjs`（20 项）
   - `node tools/test-ui-browser.mjs`（44 项）
   - 复跑 `npm run audit`，确认 51/51；再跑 `npm run audit:baseline`。
3. **UI 稳定性**：连续 10 次 `node tools/test-ui-browser.mjs`，要求 10/10 全绿。若仍偶发，先定位具体用例（面板开合、焦点回退、模态框关闭时序），延续 a-ui 的轮询思路，不要加固定 sleep 或放宽断言。
4. **定稿 `docs/plan/acceptance.md`**：
   - §0 摘要：条件 5 改为通过（bench 数据见 §3），条件 6 待重建后判定；删除“bench 尚不存在”“性能待填”表述。
   - §2 条件 5/6 行、§4 缺口表（路径问题已修、bench 已落地）、§5 命令结果、§6 结论。
   - 给出 M6 最终意见（通过/有条件通过），并附完整命令输出摘要。
5. **提交 B6**（建议四个提交）：
   - `perf(runtime): 优化 simBuildModel 热路径并新增 bench`
   - `test(ui): 将固定等待改为状态轮询`（含 styles.css 的 transition 微调）
   - `chore(release): 版本升至 0.3.0`（package/README/template/_harness + 重建的 index.html）
   - `docs(plan): M6 准入报告与主册里程碑`（acceptance、施工计划、05 分册路径）

### 4.2 非阻塞但应在阶段三前处理

1. **B5.4 浏览器材质/teardown 断言**：当前只有 Node 侧 7/7 与浏览器 audit 的 B5.4/material-release；`test-ui-browser` 没有 teardown 用例。要么补一条 CDP 断言，要么在 acceptance 明确“由 audit 覆盖、UI 层不重复”的口径。
2. **Node 18/20 兼容性**：`package.json` 声明 `>=18`，但浏览器工具依赖 Node 21+ 的全局 `WebSocket`。CI 已按 Node 18/20（非浏览器）与 Node 22（浏览器）分层；在 README/CI 配置落地前不要宣称 Node 18 可跑浏览器测试。
3. **历史 39 fail 基线归档**：`tools/audit/baseline/0.2.0.json` 已被修复后状态覆盖为 51/51。修复前证据在 git `ed8aa0a` 与 `docs/audit-baseline-0.2.0.md`；acceptance 已引用，建议在 0.2.0 基线文档再加一行“历史快照见 ed8aa0a”。
4. **主册与分册口径复查**：主册 §9 已改 50+80，§10 仍保留 B5 计划时的“45→52”描述（历史计划语境，可保留）；contracts §5 已改 50+80。提交前 grep 一次旧值。
5. **`.qoder/`**：确认是否加入 `.gitignore` 或删除，当前未跟踪。

## 5. 恢复步骤

在新会话中从当前工作区继续：

```bash
git status
git log --oneline -8

# 1. 重建产物并验证
node tools/build.mjs
node tools/check-build.mjs --strict

# 2. Node 回归
npm test
node tools/test-physics-invariants.mjs
node tools/test-runtime.mjs
node tools/test-dev-server.mjs

# 3. 浏览器回归（Chrome 可用）
node tools/test-ui-browser.mjs
FS_REQUIRE_CHROME=1 node tools/test-dynamics-browser.mjs
FS_REQUIRE_CHROME=1 node tools/test-camera.mjs

# 4. 审计与性能
npm run audit
npm run audit:baseline
node tools/bench.mjs

# 5. 定稿 acceptance 后按第 4.1 节拆提交
```

## 6. 关键约定与风险

1. **契约唯一来源**：`docs/plan/contracts.v1.md`。实现与契约冲突时先改契约，再改代码；分册只引用不重定义。
2. **baseline 的版本语义**：`tools/audit/baseline/0.2.0.json` 是修复前（fbb401d，0.2.0）的失败快照，修复后逐条转为 pass；文件名保留 0.2.0 是历史标识。`audit:baseline` 只比较 check 状态，不比较 `appVersion`，因此 `APP_VERSION=0.3.0` 不会导致 mismatch。
3. **审计探针的更新边界**：B1/B2/B3 期间只允许改探针取法与观察方式，不改 check id、阈值与断言结构；continuity 阈值重定与 5-clamp50 语义变更均有文档依据。后续不要再放宽阈值来“转绿”。
4. **`index.html` 是构建产物**：必须与 `src/` 同版提交。当前工作区源码为 0.3.0，产物仍是 0.2.0，这是 `build:check` 唯一的失败原因。
5. **UI 测试时序**：面板与模态框有 CSS 过渡，固定 sleep 在高负载下会偶发失败；a-ui 已改为 `waitFor` 轮询与状态确认。若继续修改，保持“先等状态、再断言”的写法。
6. **未推送**：分支 `feat/plan-execution` 只在本地；提交前确认远程策略。
7. **测试数量口径**：当前 `npm test` 50+80，不是 47+52；自检 14+10=24；UI 44 项；审计 51 项。文档中出现旧数量时按此口径修正。

## 7. 文件索引

| 文件 | 作用 |
| --- | --- |
| `docs/施工计划.md` | 主册：批次、依赖、裁决、验收命令、里程碑 |
| `docs/plan/contracts.v1.md` | 施工契约：状态/角点/力/遥测/命令 |
| `docs/plan/acceptance.md` | M6 准入报告（待定稿） |
| `docs/plan/parts/01–06` | 分册与审核裁决 |
| `docs/plan/notes/b1–b6-recon.md` | 各批次施工勘察与裁决记录 |
| `tools/audit/`、`tools/audit-browser/` | 审计脚本、基线、CDP 设施 |
| `tools/bench.mjs` | 性能基准 |
| `tools/test-*.mjs` | 回归与浏览器测试 |
| `src/js/00/03/05/22/10/20/30/40` | 物理、几何、渲染、应用与 UI |
