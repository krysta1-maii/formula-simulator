# B6 浏览器回归验证记录

- 执行者：browser-verify（共享任务 task-1）
- 工作目录：/home/andyk/projects/formula-simulator
- 分支：feat/plan-execution；HEAD：cbed2d663f1e7536f1d026466f24fefe7f68f8e4（wip: B6 收尾中间状态与交接文档）
- 本轮执行窗口：2026-11-19 04:20:27 至 04:22:46 HKT（UTC+08:00），四条命令合计 123884 ms（约 123.9 s）
- 结论：最终源码（APP_VERSION 0.3.0）重建产物上，四条命令全部退出 0；dynamics 26/26、camera 19/19、audit 51/51 checks 全部通过；audit:baseline 结论为 match；无失败、无重试、无 SKIP。

## 0. 复跑背景与产物变更

本条记录是 APP_VERSION 0.3.0 最终源码收口后的**复跑**，取代 03:44–03:47 的上一轮记录。两轮的差别只在被测产物：

- 上一轮针对旧 index.html（sha256 505ee68c…，APP_VERSION 仍为 0.2.0）。
- 本轮之前，`src/js/00-core.js` 的 `APP_VERSION` 已由 0.2.0 改为 0.3.0；index.html 已重建为最终交付物：1,021,578 B，sha256 `668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246`，mtime 2026-11-19 03:50:46，页脚为 v0.3.0（全文不含 v0.2.0 字样）。据 lead 交接，`node tools/check-build.mjs --strict` 已通过；该门禁不在本轮四项命令内，本轮未重复执行，但独立核对了产物大小、sha256、页脚版本与源码常量 `APP_VERSION = '0.3.0'`。
- dynamics、camera 与 audit（含 browser-contract、ui 两组）读取的都是这份新产物；复跑前后其 mtime 与 sha256 未变。
- 本轮未运行 `tools/test-ui-browser.mjs`；UI 稳定性由 lead 与另一位同事负责。

## 1. 环境

| 项目 | 值 |
| --- | --- |
| Node | v24.22.1（Linux x64） |
| npm | 12.2.3 |
| Chrome | Google Chrome 156.0.8078.47（/usr/bin/google-chrome） |
| 操作系统 | Linux 6.18.58.1-microsoft-standard-WSL2 x86_64 |
| 主机名 | DESKTOP-A2R3K6E |
| 被测产物 | index.html，1,021,578 B，sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246，mtime 2026-11-19 03:50:46，页脚 v0.3.0 |
| 源码版本常量 | src/js/00-core.js 第 10 行 `const APP_VERSION = '0.3.0';`（mtime 03:50:46） |
| 审计基线文件 | tools/audit/baseline/0.2.0.json，sha256 101e7dd1ac9ddd4aa77fef7c4128ee153442f7775d394d90619fa680f1090ee6，mtime 02:30:29 |
| 测试脚本 | tools/test-dynamics-browser.mjs（mtime 01:40:06）、tools/test-camera.mjs（mtime 01:40:22）、tools/audit/run-all.mjs（mtime 01:02:56），复跑期间均未变 |

## 2. 命令结果（本轮复跑）

| # | 命令 | 退出码 | 项数 | 耗时 | 最终 PASS 行（原样） |
| --- | --- | --- | --- | --- | --- |
| 1 | `FS_REQUIRE_CHROME=1 node tools/test-dynamics-browser.mjs` | 0 | 26 项，26 ok，0 FAIL | 18780 ms（18.8 s） | `PASS  dynamic browser checks` |
| 2 | `FS_REQUIRE_CHROME=1 node tools/test-camera.mjs` | 0 | 19 项，19 ok，0 FAIL | 27641 ms（27.6 s） | `PASS  camera checks` |
| 3 | `FS_REQUIRE_CHROME=1 npm run audit` | 0 | 10 个审计脚本，51 checks，0 failed | 35973 ms（36.0 s） | `[audit] PASS  51 checks` |
| 4 | `npm run audit:baseline` | 0 | 51 checks，baseline: match | 41490 ms（41.5 s） | `[audit] PASS  51 checks`，`baseline: match` |

命令按任务给定顺序串行执行，每条均为一次通过，相邻命令首尾相接（04:20:30 起跑，04:22:46 收尾）。耗时由 shell 中的 `date +%s%N` 前后差值测得，包含 Node/npm 启动与 Chrome 启动时间；合计 18780+27641+35973+41490 = 123884 ms。

### 2.1 关键断言摘录（原样）

dynamics：

```text
ok   six-DOF simulation is live  1.80 s
ok   rendered coil stroke equals the telemetry compression  8.641 / 8.641 / 3.810 / 3.810 mm · Δ 1.1e-13
ok   mechanism closes in the rendered scene  susp 0.0000 · tie 0.0000 · arb 0.0000 mm
ok   low grip releases the six-DOF planar state  1.25 m
ok   all dynamic self-tests pass
ok   model modal lists static and dynamic tests  24
ok   no page errors
```

camera：

```text
ok   side is an exact orthographic elevation  {"theta":1.5707963267948966,"phi":1.5707963267948966,"zoom":6,"radius":12,"projection":"orthographic","preset":"side","target":[0,0.55,0],"transition":false}
ok   top is an exact orthographic elevation  {"theta":1.5707963267948966,"phi":0.002,"zoom":6,"radius":12,"projection":"orthographic","preset":"top","target":[0,0.55,0],"transition":false}
ok   drag right increases azimuth (scene follows pointer)  0.620 -> 1.402
ok   wheel zooms in  5.790 -> 4.266
ok   wheel moves the orbit target toward the cursor  target moved 0.553 m
ok   no page errors
```

## 3. audit 的 51 checks 汇总

`npm run audit` 的人类可读摘要（stderr）：

```text
[audit] PASS  51 checks
  ok   free-body  12 checks, 0 failed
  ok   rocker-reach  5 checks, 0 failed
  ok   seed-writeback  4 checks, 0 failed
  ok   shadowing  2 checks, 0 failed
  ok   friction-low-speed  5 checks, 0 failed
  ok   impulse-frame  3 checks, 0 failed
  ok   contact-gap  4 checks, 0 failed
  ok   frame-time  6 checks, 0 failed
  ok   browser-contract  5 checks, 0 failed
  ok   ui  5 checks, 0 failed
```

| 分组 | 审计脚本 | checks | failed |
| --- | --- | --- | --- |
| physics | free-body | 12 | 0 |
| physics | rocker-reach | 5 | 0 |
| physics | seed-writeback | 4 | 0 |
| physics | shadowing | 2 | 0 |
| contact | friction-low-speed | 5 | 0 |
| contact | impulse-frame | 3 | 0 |
| contact | contact-gap | 4 | 0 |
| runtime | frame-time | 6 | 0 |
| runtime/browser | browser-contract | 5 | 0 |
| ui/browser | ui | 5 | 0 |
| 合计 | 10 个脚本 | 51 | 0 |

本轮的 JSON 报告为 63764 字节（schema 1，appVersion 0.3.0，generatedAt 2026-11-18T20:22:00.663Z）：`pass=true`、`checks=51`、`failed=0`、`errors=[]`，51 个 check ID 无重复；10 个审计报告的 `skipped` 均为空数组、`error` 均为 null、`pass` 均为 true。逐脚本求和 12+5+4+2+5+3+4+6+5+5 = 51，与 `[audit] PASS  51 checks` 一致。

## 4. audit:baseline 的 match 结论

`npm run audit:baseline` 退出 0，stderr 末行为 `  baseline: match`；JSON 中 `baseline = {"pass":true,"mismatches":[]}`，51 个 checks 的 ID 与 pass/fail 状态和基线 `tools/audit/baseline/0.2.0.json` 全部一致，无 status-diff、missing-in-baseline、missing-in-report。

基线文件自身含 51 个 checks，全部为 `pass`，`knownFailures` 为空数组，故本次是“全绿基线全绿”的严格匹配。元数据口径需要说明：审计报告中的 `commit=fbb401d` 来自 `tools/audit/_harness.mjs` 的常量 `COMMIT`，并非运行时 HEAD（cbed2d6）；`appVersion=0.3.0` 现在与交付源码一致，而基线文件因历史原因仍标记 appVersion 0.2.0，比对依据是 check ID 与状态，不比对版本或 commit 字段。

## 5. 严格模式与 SKIP 核验

- 第 1、2、3 条命令均带 `FS_REQUIRE_CHROME=1`。据 `tools/browser-runner.mjs`，缺少 Chrome 时该开关会把“跳过”变为硬失败（退出码 2），因此本次不是无浏览器环境下的空跑；实际 Chrome 156 已启动并输出 26 项与 19 项页面断言。
- 四条命令输出中均无 `SKIP` 行；dynamics 与 camera 的日志统计为 ok=26/FAIL=0/SKIP=0、ok=19/FAIL=0/SKIP=0。
- 审计 harness（`tools/audit/_harness.mjs`）中，单个报告 `pass` 的条件是“无 error、skips 为空、checks 非空且全部 ok”。本轮 JSON 已逐项确认 10 个报告的 `skipped` 为空、checks 全 ok，等价于 0 个 skip。
- camera 计数口径保持不变：`tools/test-camera.mjs` 共 16 处 `check(...)` 调用，其中一处位于 side/front/rear/top 四预设循环内，展开后为 4 项，合计 15+4=19；本轮输出包含脚本定义的全部 19 项（从 app boots 到 no page errors），没有任何一项被条件跳过。任务或文档若写“20 项”，属于计数笔误，不影响通过结论。

## 6. 失败详情

无。本轮四条命令均一次执行成功，没有失败断言，也没有触发重试，因此不存在需要留存的 /tmp 失败日志。

## 7. 执行附注

- 复跑期间工作区还有其他人对文档（DESIGN.md、README.md、docs/plan/*）与 `tools/test-ui-browser.mjs` 的改动；它们不是本轮四条命令的输入（audit 的浏览器组使用 `tools/audit-browser/*`，不读取 `tools/test-ui-browser.mjs`）。被测产物 index.html、审计脚本、基线文件与两份浏览器测试脚本在复跑前后均未变化。
- `tools/audit/run-all.mjs` 把人类可读摘要写入 stderr，stdout 保留完整 JSON；npm 12 在 stderr 前两行输出 `npm notice run ...`，其后才是 `[audit]` 摘要。
- 全部命令在 Node v24.22.1 + Chrome 156.0.8078.47 的同一会话内完成，未安装依赖、未改源码、未清理缓存；除本文件外未修改任何文件。
