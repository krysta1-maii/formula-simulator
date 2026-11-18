# B6 UI 浏览器测试 10 连跑稳定性验证（b6-ui-stability）

| 项目 | 内容 |
| --- | --- |
| 执行者 | ui-stability（历史轮次 A/B）；最终轮由 lead 持有并执行 |
| 工作目录 | /home/andyk/projects/formula-simulator |
| 分支 / HEAD | `feat/plan-execution` / `cbed2d663f1e7536f1d026466f24fefe7f68f8e4` |
| 历史轮次窗口 | 2026-11-19 03:52:09–03:59:44（A 轮）、04:02:08–04:10:07（B 轮），Asia/Hong_Kong |
| 被测产物 | 每次由 `tools/build.mjs` 重建的临时 artifact；1,021,578 B，sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`（APP_VERSION 0.3.0） |
| 测试脚本 | `tools/test-ui-browser.mjs`；历史轮为修复前版本 sha256 `10cee0328615441dcc7d506141193cc3e0577a7f5804a7ebcb4988aa91026b74`，修复后 `0e92f20b6ab978698799008cb65aae859f8a12d851526fc03c89d110d09a8ee1`（27,979 B，mtime 2026-11-19 04:08:44） |
| 历史结论 | A 轮 9/10、B 轮 9/10；两次失败均为同一既有 viewport 面板竞态（`844x390 panel stays inside the viewport`，`open=false`）。task-2 新增的 B5.4 材质/几何释放断言在 A、B 两轮共 20 次运行中 20/20 通过，计数稳定为 materialDisposed=7、geometryDisposed=387 |
| 最终轮状态 | 修复版脚本最终 10 连跑由 lead 执行，10/10 通过（退出码全 0，每次 PASS 45 ui checks，artifact 始终为 668c59ea…f246）；运行窗口 2026-11-19 04:10–04:21 HKT，总耗时 605,559 ms，详见第 7 节 |

## 1. 环境

| 项目 | 值 |
| --- | --- |
| Node | v24.22.1（Linux x64） |
| Chrome | Google Chrome 156.0.8078.47（/usr/bin/google-chrome，headless=new + SwiftShader） |
| 操作系统 | Linux 6.18.58.1-microsoft-standard-WSL2 x86_64 |
| 主机名 | DESKTOP-A2R3K6E |
| CPU | 12 核 |
| 执行方式 | 串行、单进程：每轮执行一次 `node tools/test-ui-browser.mjs`；每次由 build 步骤重新构建临时 artifact，Chrome 使用独立临时 profile |
| 日志目录 | `.tmp-test/`（已被 .gitignore 忽略）：A 轮 `roundA-runN.log`、`roundA-summary.tsv`；B 轮 `roundB-runN.log`、`roundB-summary.tsv` |
| 计时方式 | shell 中 `date +%s%N` 前后差值，包含 Node 与 Chrome 启动时间 |

历史两轮运行的被测 artifact 与 index.html 均为 1,021,578 B、sha256 `668c59ea…f246`，即 APP_VERSION 0.3.0 的最终产物；PASS/FAIL 行中的 artifact sha256 与之一致。

## 2. 历史轮次总览

| 轮次 | 时间窗口 | 测试脚本版本 | 结果 | 总耗时 | 失败断言 |
| --- | --- | --- | ---: | ---: | --- |
| A | 03:52:09–03:59:44 | 修复前 `10cee032` | 9 通过 / 1 失败 | 455,119 ms（455.1 s） | run9：`844x390 panel stays inside the viewport`（open=false） |
| B | 04:02:08–04:10:07 | run1–run9 为修复前；run10 已加载修复后版本 | 9 通过 / 1 失败 | 478,569 ms（478.6 s） | run2：同一断言（open=false） |

B 轮不是同一脚本版本的完整轮次：修复在 04:08:44 落地，run9 启动时加载的仍是旧脚本，run10 启动时加载的是修复版脚本并通过。因此 B 轮 run10 只能作为修复的冒烟证据，不能作为最终轮结果；最终轮已按修复版脚本完整重跑 10 次并通过，见第 7 节。

## 3. 第 A 轮逐次结果（修复前）

| # | 退出码 | 结果行 | 耗时（ms） | artifact sha256 前缀 |
| ---: | ---: | --- | ---: | --- |
| 1 | 0 | PASS 45 ui checks | 43,725 | 668c59ea |
| 2 | 0 | PASS 45 ui checks | 46,549 | 668c59ea |
| 3 | 0 | PASS 45 ui checks | 48,328 | 668c59ea |
| 4 | 0 | PASS 45 ui checks | 49,295 | 668c59ea |
| 5 | 0 | PASS 45 ui checks | 45,080 | 668c59ea |
| 6 | 0 | PASS 45 ui checks | 48,475 | 668c59ea |
| 7 | 0 | PASS 45 ui checks | 44,440 | 668c59ea |
| 8 | 0 | PASS 45 ui checks | 38,530 | 668c59ea |
| 9 | 1 | FAIL 1 / 45 ui check(s) failed | 47,194 | 668c59ea |
| 10 | 0 | PASS 45 ui checks | 43,268 | 668c59ea |

合计 455,119 ms，平均 45.5 s，最快 38.5 s，最慢 49.3 s。运行开始时 loadavg 为 2.99 / 5.78 / 8.06，结束时为 10.63 / 9.53 / 9.02（1 分钟均值；SwiftShader 软件渲染本身会明显抬升 CPU 负载）。

run9 的失败输出原文：

```text
[viewport]
...
ok   844x390 leaves at least 55% for the scene  288.0 / 390
FAIL 844x390 panel stays inside the viewport  {"open":false,"top":62,"bottom":332,"screenshotTop":288,"screenshotBottom":321,"viewport":390}
ok   844x390 screenshot button is visible  288.0..321.0
...
FAIL  1 / 45 ui check(s) failed  [artifact 1021578 B  sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246]
```

该次运行其余 44 项全部通过；B5.4 断言输出为 `ok   B5.4 rebuild releases materials and geometry  materialDisposed=7 geometryDisposed=387`。

## 4. 第 B 轮重跑（修复前）

| # | 退出码 | 结果行 | 耗时（ms） | 运行前 loadavg（1/5/15 分钟） | 运行后 loadavg |
| ---: | ---: | --- | ---: | --- | --- |
| 1 | 0 | PASS 45 ui checks | 44,201 | 2.77 / 6.57 / 7.97 | 5.57 / 6.78 / 7.98 |
| 2 | 1 | FAIL 1 / 45 ui check(s) failed | 47,604 | 5.57 / 6.78 / 7.98 | 8.62 / 7.42 / 8.14 |
| 3 | 0 | PASS 45 ui checks | 46,737 | 8.62 / 7.42 / 8.14 | 9.17 / 7.76 / 8.22 |
| 4 | 0 | PASS 45 ui checks | 49,629 | 9.17 / 7.76 / 8.22 | 10.64 / 8.39 / 8.41 |
| 5 | 0 | PASS 45 ui checks | 43,264 | 10.64 / 8.39 / 8.41 | 11.05 / 8.79 / 8.54 |
| 6 | 0 | PASS 45 ui checks | 44,935 | 11.05 / 8.79 / 8.54 | 11.92 / 9.37 / 8.75 |
| 7 | 0 | PASS 45 ui checks | 44,321 | 11.92 / 9.37 / 8.75 | 11.05 / 9.52 / 8.84 |
| 8 | 0 | PASS 45 ui checks | 46,252 | 11.05 / 9.52 / 8.84 | 10.34 / 9.52 / 8.87 |
| 9 | 0 | PASS 45 ui checks | 44,106 | 10.34 / 9.52 / 8.87 | 9.94 / 9.56 / 8.91 |
| 10 | 0 | PASS 45 ui checks | 67,071 | 9.94 / 9.56 / 8.91 | 16.18 / 11.42 / 9.60 |

合计 478,569 ms，平均 47.9 s。run2 失败详情与 A 轮 run9 完全同类：

```text
FAIL 844x390 panel stays inside the viewport  {"open":false,"top":62,"bottom":332,"screenshotTop":288,"screenshotBottom":321,"viewport":390}
FAIL  1 / 45 ui check(s) failed  [artifact 1021578 B  sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246]
```

B 轮 B5.4 断言的 10 次输出同样全部为 `materialDisposed=7 geometryDisposed=387`。run10 耗时 67.1 s、结束 loadavg 升至 16.18，但仍是 `PASS 45 ui checks`，说明新断言与既有断言的超时条件在该负载下仍有余量。

## 5. 失败根因

失败断言是既有 viewport 组中的 `844x390 panel stays inside the viewport`，判定条件为 `panel.open && panel.bottom <= viewport + 1 && panel.top >= -1`。两次失败的实际 detail 中 `top=62`、`bottom=332`、`screenshotTop=288`、`screenshotBottom=321`、`viewport=390` 均与通过时完全一致，只有 `open` 为 false，说明面板布局没有溢出视口，而是在被检查前被异步关闭了。

时序如下：

1. 测试在 viewport 组首先把视口从初始 1280x900 切到 844x390（`Emulation.setDeviceMetricsOverride`）。
2. 旧版 `waitForViewport` 只等待 `innerWidth === 844` 与高度一致，再 `sleep(80)`；此时页面内 `matchMedia('(max-width: 980px)')` 已变为 matches=true，但 change 事件可能尚未派发。
3. 测试调用 `closePanels` 后立即 `ensurePanelOpen` 打开 `panelControls`。
4. 延迟到达的 change 事件触发 `onCompactChange`，对两个面板执行 `setPanel(..., false)`，移除 `is-open`。
5. 随后的 `panel` 读取得到 `open=false`，断言失败。

对应源码为 `src/js/30-ui.js:1342-1351`：`matchMedia('(max-width: 980px)')` 的 change 回调在 `event.matches` 为真时调用 `setPanel('panelControls', false)` 与 `setPanel('panelTelemetry', false)`；`setPanel` 在 `src/js/30-ui.js:439-458` 通过 `classList.toggle('is-open', open)` 改变状态。980px 阈值只有从初始 1280 切到 844 时才发生 false→true 的跳变，因此只有 844x390 这一档会触发关闭；后续 667 仍为 compact（无跳变），1024/1280 为非 compact（回调只刷新 UI，不关闭面板）。focus 组稍后再次从 1280 切到 844，同样存在第二次 false→true 跳变，因此修复需要同时覆盖 viewport 组与 focus 组。

判定为竞态而非一般负载抖动的依据：

- 两次失败（A 轮 run9、B 轮 run2）来自同一条断言，20 次运行中其余断言零失败；两次 detail 的布局数值与通过时逐字段相同。
- 失败并不随负载单调出现：B 轮 run2 开始负载 5.57 时失败，而 B 轮 run10 结束负载 16.18 时通过；A 轮 run9 的全局结束负载 10.63。
- `matchMedia` change 事件的派发时机相对于 CDP 操作序列是异步的，CPU 调度只会扩大竞态窗口，不是根因。
- 该断言在 task-2 补丁路径之外（assets 组位于 solver 组之后），与 B5.4 断言无关；B5.4 在 A、B 两轮共 20 次运行中 20/20 通过。

## 6. 修复 diff 摘要

修复只改 `tools/test-ui-browser.mjs`，`git diff --stat` 为 `+35 / -3`；其中 B5.4 assets 组来自 task-2（+15 行），本次面板竞态修复为 +20 / -3。修复后脚本 sha256 为 `0e92f20b…d09a8ee1`，27,979 B，mtime 2026-11-19 04:08:44。

| 修改点 | 位置 | 内容 |
| --- | --- | --- |
| 视口等待 | `waitForViewport`，当前第 84–89 行 | 在等待 `innerWidth`/`innerHeight` 之后，增加等待 `matchMedia('(max-width: 980px)').matches` 与预期一致（宽度 ≤ 980 为 true），再等待两个 `requestAnimationFrame`，让 change 事件队列清空；原有 `sleep(80)` 保留，未新增用于等待的固定 sleep |
| 面板稳定化辅助 | 新增 `openPanelStable`，当前第 114–127 行 | 最多 3 次尝试：`ensurePanelOpen` → `waitFor` is-open → 等待两帧后确认仍为 is-open；若被异步关闭则 `closePanel` 后重试；3 次仍失败返回 false |
| 844x390 分支 | 当前第 180 行、183 行 | 用 `openPanelStable(client, 'panelControls')` 替换直接 `ensurePanelOpen`；check 条件在原有 `panel.open` 与位置断言之前增加 `panelStable` 前置条件。check 文案 `844x390 panel stays inside the viewport` 与位置阈值均未改变，属于更严格的判定 |
| exclusive 面板分支 | 当前第 293–295 行，focus 组切到 844x390 后 | `ensurePanelOpen` 改为 `openPanelStable`，覆盖第二次 1280→844 的 compact 跳变，避免 telemetry 打开后被延迟的 change 事件关闭 |

断言强度没有放宽：check 总数为 45；`844x390 panel stays inside the viewport` 仍要求面板打开且上下边界在视口内，只增加了“打开状态稳定”的前置条件；没有删除断言、没有降低阈值、没有用固定 sleep 掩盖时序。本次修复不涉及 `src/` 与 `index.html`，被测 artifact 仍为 1,021,578 B、sha256 `668c59ea…f246`。

## 7. 最终轮（修复版，10/10）

最终轮由 lead 以修复版 `tools/test-ui-browser.mjs` 串行执行 10 次，运行窗口 2026-11-19 04:10–04:21 HKT。10 次全部退出 0，每次均为 `PASS  45 ui checks`，artifact 始终为 1,021,578 B、sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`。

| # | 退出码 | 耗时（ms） | 运行前 loadavg（1/5/15 分钟） | PASS 行 | artifact sha256 |
| ---: | ---: | ---: | --- | --- | --- |
| 1 | 0 | 69,009 | 15.12 / 11.28 / 9.56 | PASS 45 ui checks | `668c59ea…f246` |
| 2 | 0 | 57,635 | 12.12 / 11.07 / 9.60 | PASS 45 ui checks | `668c59ea…f246` |
| 3 | 0 | 61,156 | 12.12 / 11.15 / 9.71 | PASS 45 ui checks | `668c59ea…f246` |
| 4 | 0 | 55,138 | 10.76 / 10.95 / 9.74 | PASS 45 ui checks | `668c59ea…f246` |
| 5 | 0 | 61,395 | 10.62 / 10.86 / 9.77 | PASS 45 ui checks | `668c59ea…f246` |
| 6 | 0 | 65,544 | 11.33 / 10.83 / 9.83 | PASS 45 ui checks | `668c59ea…f246` |
| 7 | 0 | 54,218 | 10.87 / 10.89 / 9.92 | PASS 45 ui checks | `668c59ea…f246` |
| 8 | 0 | 60,183 | 12.17 / 11.29 / 10.12 | PASS 45 ui checks | `668c59ea…f246` |
| 9 | 0 | 57,827 | 12.46 / 11.48 / 10.25 | PASS 45 ui checks | `668c59ea…f246` |
| 10 | 0 | 63,454 | 11.16 / 11.23 / 10.23 | PASS 45 ui checks | `668c59ea…f246` |

- 合计耗时 605,559 ms（10 分 5.6 秒），均值约 60.6 s/次，最快 54,218 ms，最慢 69,009 ms。
- 运行期间宿主 loadavg 处于 10.6–15.1 的高负载区间，10 次仍全部通过；相对历史 A/B 轮（均值 45.5 s / 47.9 s），单次耗时增加约 13–15 s，但所有 check 均未触发超时，说明修复后的等待逻辑与既有超时余量在高负载下仍充足。
- 每次 PASS 的 45 项中包含 task-2 新增的 B5.4 材质/几何释放断言；历史两轮实测该断言计数稳定为 materialDisposed=7、geometryDisposed=387。
- 本轮无失败，无失败日志；原始输出见 `.tmp-test/ui-stability-final-run1.log` … `ui-stability-final-run10.log` 与 `ui-stability-final-summary.tsv`。

### 7.1 结论

修复后最终轮 10/10 全部通过：退出码均为 0，每次 `PASS  45 ui checks`，artifact 恒为 1,021,578 B / sha256 `668c59ea…f246`。历史 A 轮 run9 与 B 轮 run2 的失败均为 `844x390 panel stays inside the viewport` 的 `open=false`，归因于 `src/js/30-ui.js:1342-1351` 的 `matchMedia('(max-width: 980px)')` change 事件在 1280→844 视口切换后异步执行 `setPanel(false)` 关闭面板的竞态，不是 B5.4 断言或 0.3.0 产物的问题。修复只增加视口/媒体查询等待与面板打开稳定化逻辑，不改变断言强度：check 总数仍为 45，面板 check 的文案与位置阈值未变，只新增了更严格的 `panelStable` 前置条件；未加入用于等待的固定 sleep，未放宽任何阈值。最终轮在高负载（loadavg 10.6–15.1）下 10/10，可作为 B6 UI 稳定性结论。

## 8. 证据与日志

- A 轮原始日志：`.tmp-test/roundA-run1.log` … `.tmp-test/roundA-run10.log`，汇总 `.tmp-test/roundA-summary.tsv`；失败日志 `.tmp-test/roundA-run9.log` 已完整保留。
- B 轮原始日志：`.tmp-test/roundB-run1.log` … `.tmp-test/roundB-run10.log`，汇总 `.tmp-test/roundB-summary.tsv`（含每次运行前后 loadavg）；失败日志 `.tmp-test/roundB-run2.log` 已完整保留。
- 最终轮原始日志：`.tmp-test/ui-stability-final-run1.log` … `.tmp-test/ui-stability-final-run10.log`，汇总 `.tmp-test/ui-stability-final-summary.tsv`；10 行均为 `PASS  45 ui checks`，artifact sha256 一致（lead 执行）。
- 运行命令：`node tools/test-ui-browser.mjs`（每轮独立进程，串行执行）；耗时由 `date +%s%N` 计算；A 轮未逐次采样负载，B 轮在每次运行前后采样 `/proc/loadavg`，最终轮记录运行前 loadavg。
- `.tmp-test/` 为本地验证目录，已在 `.gitignore` 中忽略；本文件只记录结果，不修改测试脚本、源码或构建产物。
- ui-stability 在 lead 接管最终轮后未再启动任何浏览器测试，避免与最终轮并发。
