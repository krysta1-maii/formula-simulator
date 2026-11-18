# 分册 04：界面、可访问性与工具链

| 项目 | 内容 |
| --- | --- |
| 适用版本 | 0.2.0（提交 fbb401d） |
| 所属批次 | B4（界面与工具链） |
| 交付文件 | `docs/plan/parts/04-ui-tooling.md` |
| 负责范围 | B 报告第 6 节界面问题、A 报告第 4 节清理项、求解残差展示、浏览器测试与构建约束 |
| 依据 | A 报告 `docs/code-review.md`、B 报告 `docs/code-review-k3.1-pro.md`、主册 `docs/施工计划.md`、分册 01 `docs/plan/parts/01-physics-state.md` |
| 修订 | r2（2026-11-19）：按 `docs/plan/parts/06-review.md` 的 R-06、R-09、R-10、O-08、O-09、O-16、O-04 定点回改 |

## 1. 范围说明

本册处理三类问题：界面可用性与可访问性缺陷（小高度横屏裁切、空格键覆盖按钮语义、关闭面板仍可 Tab 聚焦、暂停文本不同步、轮载箭头映射与说明不一致）；求解残差与降级状态在遥测、自检和页面提示中的呈现，使界面不再以“数值有限”代替“求解正常”；工具链约束（测试前强制构建、`index.html` 哈希一致性、Chrome 严格模式与跳过语义、开发服务器目录边界、CI 分层）。

本册不修改物理内核。摇臂可行性、角点统一状态、运动比连续性由分册 01 的 B1-2、B1-3、B1-5 实现，本册只消费其冻结字段；接地点与摩擦状态归分册 02；帧时间、几何代际、自检缓存归分册 03。约束沿用主册：单文件离线交付、零运行时依赖、不引入前端框架、Node >= 18；新增纯函数留在全局脚本作用域，不改 ES 模块。模板改动限于 `src/index.template.html`，产物只由 `npm run build` 生成。新增文件仅 `tools/browser-runner.mjs`、`tools/test-ui-browser.mjs`、`tools/test-dev-server.mjs`、`tools/check-build.mjs` 与 `.github/workflows/ci.yml`。行号对应提交 fbb401d。

## 2. 现状与证据

下表由本册只读核对；界面尺寸为按样式表规则计算，未在浏览器中运行。

| 编号 | 现状 | 源码位置 | 观测值或计算值 | 影响 |
| --- | --- | --- | --- | --- |
| E1 | `#app` 同时用 `100dvh` 与 `min-height: 520px`，`body` 隐藏溢出 | `styles.css:29-46` | 844×390 下 `#app` 高 520；底栏顶边 468（高 42、`bottom:10`）；面板底边 448 | 底栏与面板底栏落在视口外；现有 `@media (max-height:700px)`（1070-1074）无法抵消 `min-height` |
| E2 | 全局 keydown 未排除按钮、`summary`、链接 | `30-ui.js:1015-1041` | `isTyping` 仅覆盖 input/textarea/select（1018）；空格分支无条件 `preventDefault()` 并调用 `simulationToggle()` | 焦点在帮助按钮上时空格切换仿真而非打开帮助 |
| E3 | 关闭面板仅设透明度与指针事件 | `styles.css:344-346`、`30-ui.js:340-350` | 无 `inert`、`aria-hidden`、`visibility`；全仓 grep 无 `inert` | 关闭面板内的控件仍可 Tab 到达并被读屏读出 |
| E4 | 暂停文本由两处分别更新 | `30-ui.js:206-211`、`781-786`、`651-674` | `#simDetail` 用上一帧 `model.sim.running` 拼接；暂停后 `animate()` 不再调用 `refreshTelemetry`（`40-app.js:427-435`） | `#telemetrySimState` 显示暂停，`#simDetail` 仍显示运行 |
| E5 | 轮载箭头为固定基底加饱和的仿射映射 | `10-scene.js:1029-1056`；模板 161 | `0.26 + 0.56·load/avg`，夹在 `[0.2, 0.88]`；零载 0.26 m，平均载 0.82 m | 长度不正比于载荷，与说明“长度正比于四轮法向力”不符 |
| E6 | 检查表以有限性作为通过条件 | `30-ui.js:590-595`、`571-580` | 首行为 `sim.finite && !sim.recovered`；`model.sim` 缺失时默认 `finite: true` | 4 mm 闭合残差、运动比 -4.20 时 UI 仍报通过 |
| E7 | 求解状态被二次抹平 | `05-body-dynamics.js:665`、`22-car-dynamics.js:959-961`、`30-ui.js:581-582` | `solverOk` 只看轮架 `converged`；渲染路径只要角度有限就清除失败标志 | 浏览器中的机构失败在 UI 不可见 |
| E8 | dev-server 用字符串前缀判断边界 | `tools/dev-server.mjs:13-15` | `normalize(join(root, url))` 后 `startsWith(root)`；`/../formula-simulator-secret/x` 可通过 | 同前缀兄弟目录可被读取；仅绑定 localhost |
| E9 | Chrome 启动后、连接前不在 `try` 内 | `test-dynamics-browser.mjs:64-87`、`128`、`258-263` | `spawn`（37-54）后先 `findTarget()`（86）再 `connect()`（87），`try` 从 128 行开始 | 启动或 WS 失败时 `finally` 不执行，进程与 `/tmp/fs-camera-*` 泄漏 |
| E10 | 无 Chrome 时以成功退出 | `test-dynamics-browser.mjs:28-31`、`test-camera.mjs:29-32`、`capture-docs.mjs:23-26` | `process.exit(0)`；动态测试文案误写为 “camera test” | CI 把未安装浏览器当作通过 |
| E11 | 浏览器测试依赖全局 `WebSocket` | `test-dynamics-browser.mjs:80`、`test-camera.mjs:85`、`capture-docs.mjs:67`、`package.json:17-19` | Node 24.22.1 下 `typeof WebSocket === 'function'`；该全局自 Node 21.0.0 提供，18/20 默认没有 | Node 18 运行 `test:browser` 报 `ReferenceError`，与浏览器缺失无关 |
| E12 | 构建确定性成立 | `tools/build.mjs:8-30`、`index.html` | 内存重算与磁盘逐字节相同：960717 B，SHA-256 `ada2ca87…fa36` | 哈希门禁可行，不需要时间戳或依赖 |
| E13 | 浏览器测试前不构建 | `package.json:7-16` | 无 `pretest:browser`/`pretest:camera`；测试以 `file://` 打开现成产物 | 源码未构建时验证的是旧页面 |
| E14 | 死代码与命名不一致 | `20-car.js:169-171`、`40-app.js:237`、`capture-docs.mjs:116-120` | 死函数仅定义无调用；截图名写死 `FS-01_static_`；死函数按 `FS-01_dynamic_` 匹配 | 命名与实际动态载荷不符，另有一处死代码 |
| E15 | 回退分支欧拉顺序与文档不一致 | `22-car-dynamics.js:1100-1105`、`DESIGN.md:553-558`、模板 504 | 回退为 `qYaw·qRoll·qPitch`（Ry·Rx·Rz），文档与 `simQuatFromEuler` 为 Ry·Rz·Rx；1124-1143 缩进异常 | 动态路径基本不可达，属一致性与可读性问题 |

`npm test` 当前为静力 47 项、动力学 52 项全绿（本册实跑 `PASS 52/52 checks`）；上述缺陷都不在断言覆盖内，因此每项先补断言再改实现。E12 哈希仅作施工前基线，施工后以实际构建输出为准，CI 只比较重建结果与磁盘文件是否相等。

## 3. 任务清单

| ID | 标题 | 主要文件 | 依赖 | 工作量（人日） |
| --- | --- | --- | --- | --- |
| B4-1 | 横屏布局与视口约束 | `styles.css` | B2；B4-8 先行 | 0.5 |
| B4-2 | 键盘作用域与按钮语义 | `30-ui.js`、模板 | B2（批次入口） | 0.5 |
| B4-3 | 面板与模态框焦点管理 | `30-ui.js`、`styles.css`、模板 | B4-2（合入顺序） | 0.5 |
| B4-4 | 遥测状态同步与残差展示 | `30-ui.js`、`40-app.js`、`styles.css`、模板 | B1-3、B1-5、B2 | 0.5 |
| B4-5 | 轮载箭头线性映射与文案 | `00-core.js`、`10-scene.js`、模板 | 无（可提前） | 0.3 |
| B4-6 | dev-server 边界与浏览器测试清理 | `dev-server.mjs`、新建 `browser-runner.mjs`、两个浏览器测试 | B0 | 0.5 |
| B4-7 | 清理项与命名统一 | `20-car.js`、`40-app.js`、`22-car-dynamics.js`、`capture-docs.mjs` | 无（可提前） | 0.3 |
| B4-8 | 构建一致性与 Chrome 严格模式 | `build.mjs`、新建 `check-build.mjs`、`package.json`、CI | B0 | 0.5 |

合计 3.6 人日，在主册 B4 的 3-4 人日预算内。依赖按 R-09 冻结：B4-5、B4-7 可提前；B4-6、B4-8←B0；B4-3←B4-2；B4-4←B1-3、B1-5、B2。B4-8 先于 B4-1 合入，B4-1 直接用其 `test:ui`，不使用临时探针。浏览器用例集中在新文件 `tools/test-ui-browser.mjs`，其编写工作量已分摊到各条；若单列交付，加 0.3 人日，合计 3.9。

## 4. 工作项

### B4-1 横屏布局与视口约束（0.5 人日）

**现状。** `#app` 用 `height: 100dvh` 同时设 `min-height: 520px`（`styles.css:46`），`body` 又设 `overflow: hidden`（32 行）。视口低于 520 px 时应用仍按 520 px 排版。底栏 `.bottom-bar`（804-821，模板 423-443）在 844×390 下受 `max-width:980px` 与 `max-height:700px` 两条规则叠加，高 42、`bottom:10`，顶边 468 px；面板受 `max-height:700px` 覆盖后 `top:76/bottom:72`，底边 448 px，`panel-foot` 被裁约 58 px。两条查询都只在 520 px 容器内定位，无法抵消 `min-height`。

**实施步骤。** 1. 把 `styles.css:46` 改为 `height: 100vh; height: 100dvh; min-height: 0;`，保留 `overflow: hidden`。2. 在 1074 行后新增低高度查询，按 390 px 视口取值：

```css
@media (max-height: 560px) {
  .topbar { height: 56px; }
  .panel { top: 62px; bottom: 58px; }
  .bottom-bar { height: 38px; bottom: 8px; }
  .tool-btn { height: 27px; font-size: 8.5px; }
  .tool-glyph, .viewport-hint, .topbar-center { display: none; }
  .toast { bottom: 52px; }
}
```

3. 在其后补 `@media (max-height: 560px) and (max-width: 980px)`，把底栏改为 `left: 10px; right: 10px; bottom: calc(8px + env(safe-area-inset-bottom, 0px));`，必须放在 1019、1044 两条规则之后。4. 删除 1070-1074 中重复的 `bottom-bar { bottom: 10px }`。5. 不改 meta 与 `index.html`；可选在 `capture-docs.mjs` 增加 `openPage(844, 390)` 生成横屏基线。

**验收。** 在 844×390、667×375、1024×400、1280×720 下断言：`document.documentElement.scrollWidth/scrollHeight` 不超出视口 0.5 px；`#app` 高等于 `innerHeight`；`.topbar`、`.bottom-bar` 矩形完全在视口内。844×390 打开参数面板后 `.panel` 底边不越界且 `#btnScreenshot` 可见；顶栏底边到底栏顶边净高 ≥ 0.55×`innerHeight`（新规则下约 74%）。以上断言由 `npm run test:ui` 视口组执行；`npm test` 与 `npm run build:check` 保持通过。

**依赖与风险。** 按主册顺序在 B2 后合并，避免与面板改动并发。风险是低于 360 px 时控件拥挤；补 360 px 断言，必要时在 README 声明最低窗口高度。回滚只需恢复 `min-height: 520px` 并删除新媒体查询，两步独立。B4-8 先于本项合入，`test:ui` 与共享运行器在此之前已存在，不采用临时探针方案。工作量 0.5 人日。

### B4-2 键盘作用域与按钮语义（0.5 人日）

**现状。** `bindKeyboard`（`30-ui.js:1015-1090`）在 `window` 上监听 `keydown`，只排除 input/textarea/select、模态框和 Ctrl/Meta/Alt；空格分支无条件 `preventDefault()` 并调用 `simulationToggle()`。焦点在按钮上时浏览器原生空格激活被拦截，帮助按钮变成切换仿真；焦点在面板 `summary` 上时空格无法展开。

**实施步骤。** 1. 在键盘段前新增选择器常量与 `shortcutTargetBlocked(target)`，选择器覆盖 `button, a[href], summary, label, input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [role="switch"], [role="checkbox"]`，实现为 `Boolean(target.closest(SELECTOR))`。2. 在 Escape 与模态框处理之后、其余快捷键之前插入 `if (event.defaultPrevented || shortcutTargetBlocked(event.target)) return;`；`isTyping` 保留兜底。3. 空格判断改为 `event.key === ' ' || event.code === 'Space'`，只在进入全局处理时 `preventDefault()`。4. 模板 445-447 与 538 行改为“空格暂停（焦点不在控件上时）”，README 同步归分册 05。5. 不新增 `tabindex`，不改变 Tab 顺序。

**验收。** 暂停后聚焦 `#btnHelp` 派发 Space：`#modelModal.hidden === false` 且 `getSnapshot().sim.running === false`。`document.activeElement.blur()` 后派发 Space：`sim.running` 取反，`#telemetrySimState` 与 `#simDetail` 同步。聚焦 `#slope` 按 `h` 不改坡度，按 ArrowRight 改一个步长。聚焦 `#btnToggleControls` 按 Space：面板只翻转一次且 `aria-expanded` 一致。打开模态框后按 `h`/Space/数字键：仿真、坡度、相机均不变。焦点在 `summary` 上按 Space：`details.open` 翻转。以上断言由 `npm run test:ui` 键盘组执行，用真实按键事件而非 `element.click()`，覆盖 WCAG 2.1.1 与 4.1.2。

**依赖与风险。** 与 B4-3 共用面板状态断言，先做本项可少改一次测试。风险是“焦点停在按钮上仍用空格暂停”的旧习惯失效；按钮语义优先，暂停按钮自身聚焦时空格仍触发暂停。回滚删除两行判定即可。工作量 0.5 人日。

### B4-3 面板与模态框焦点管理（0.5 人日）

**现状。** `.panel:not(.is-open)` 只设 `opacity:0` 与 `pointer-events:none`（`styles.css:344-346`），元素仍在可访问性树与 Tab 序列；`setPanel`（`30-ui.js:340-350`）只切 class，不设 `inert`/`aria-hidden`，也不处理焦点归属；`updatePanelUI`（321-338）只维护 `aria-pressed`。模态框有 `aria-modal`（模板 475），但 `openModelModal`（359-370）只聚焦关闭按钮，Tab 可移出，背景未隔离。

**实施步骤。** 1. 重写 `setPanel`：独占打开时对另一面板调用 `setPanelInert(other, true)`；关闭时若焦点在面板内，先 `toggle.focus({ preventScroll: true })`；然后切 class、`setPanelInert(panel, !open)`、`updatePanelUI()`。2. 新增 `setPanelInert(panel, inert)`：支持时设 `panel.inert` 并同步 `aria-hidden`；不支持时用 `Map` 保存可聚焦子元素原 `tabindex`，隐藏设 `-1`、恢复时还原。3. `updatePanelUI` 把 `aria-pressed` 改为 `aria-expanded`；模板 48-55 加 `aria-controls` 并把初值设为 `true`。4. 新增 `modalFocusables(modal)` 与 Tab 首尾循环，处理放在 `bindKeyboard` 的 Escape 之前；`openModelModal` 用 `Map` 记录并对 `#viewport, .topbar, .panel, .bottom-bar, .viewport-hint, #mobileScrim` 设 inert，`closeModelModal` 先恢复背景再恢复 `UI.modalReturnFocus`。5. 在 `styles.css:344-346` 增加 `visibility: hidden`，关闭时用 `transition: ... visibility 0s linear .3s` 延迟，避免截断滑出动画；打开时延迟为 0。6. Escape 与 scrim 关闭走同一 `setPanel`。

**验收。** 点关闭按钮后：`document.activeElement.id === 'btnToggleControls'`、`panel.inert === true`、`aria-hidden === 'true'`，350 ms 后 computed `visibility === 'hidden'`。连续 25 次 Tab 不进入关闭面板；打开后 Tab 能到达第一个 `input[type="range"]`，`inert === false` 且无 `aria-hidden`。844×390 初始关闭时前 20 次 Tab 不进入面板。模态框内 15 次 Tab 与 5 次 Shift+Tab 始终在 `#modelModal` 内，Escape 后焦点回 `#btnHelp` 且背景 inert 恢复原值。参数面板切遥测面板时前者立即 inert。以上断言由 `npm run test:ui` 焦点组执行；样式沿用 `styles.css:1080-1082` 的 `:focus-visible`，不引入新颜色。

**依赖与风险。** 依赖 B4-2 的按键顺序，否则 Escape 与 Tab 处理互相覆盖。风险是 `inert` 与 `visibility` 同时作用时打开首帧不可聚焦；先移除 class 再移除 inert，测试等待 350 ms。回滚可分两层：只回退 CSS 或只回退 `inert`，均保留焦点返回。工作量 0.5 人日。

### B4-4 遥测状态同步与残差展示（0.5 人日）

**现状。** 暂停时 `#simDetail` 停在“运行”：该字段只在 `refreshTelemetry`（`30-ui.js:781-786`）写入，暂停后 `animate()` 不再调用它（`40-app.js:427-435`），而 `syncSimControls`（651-674）只维护 `#telemetrySimState`、按钮和时间。求解方面，检查表首行只看 `sim.finite && !sim.recovered`（590-595），`model.sim` 缺失时默认 `finite: true`（571-580）；`solverOk`（`05-body-dynamics.js:665`）只含轮架收敛，渲染路径又在 `22-car-dynamics.js:959-961` 清掉失败标志，4 mm 残差在 UI 上仍全绿。

**接口契约。** 只消费分册 01 的冻结字段，不另起名字：

| 字段 | 类型与语义 |
| --- | --- |
| `model.solverOk` | boolean，四角 `ok` 全真；`ok = frame.converged && rocker.feasible && motionRatioState === 'ok'` |
| `model.solverState` | `'ok'` / `'degraded'` / `'failed'`，`#solverBadge` 的唯一驱动源 |
| `model.rockerResidualMm` | number[4]，`rocker.residual * 1000`（`rocker.residual` 单位为 m） |
| `model.rockerFeasible` | boolean[4]，推杆—摇臂可达性 |
| `model.motionRatioState` | string[4]，`'ok'` 或 `'unavailable'` |
| `model.solved[i].rocker` | `{ angle, residual, feasible, branch }`，`residual` 单位 m |
| `model.sim.solverDegraded/solverFailed` | boolean，用于派生 `solverState`，UI 不直接判定 |
| `getSnapshot()` 透传 | 上述字段与 `solved[i].rocker`，供浏览器断言 |

检查表行 id 与顺序冻结为 `sim, contact, links, steer, arb, friction, rockerResidual, motionRatio, staticTests, dynamicTests`；本册只改 `sim` 判据并新增 `rockerResidual`、`motionRatio` 两行，其余行由分册 03 的 B3-3 维护。`solverOk` 不包含残差阈值，残差 <0.1 mm 只作为 `rockerResidual` 行的通过判据；字段缺失时显示 `—` 并判为不通过，不回退为绿色。

**实施步骤。** 1. 新增 `renderSimStatus(model = UI.lastModel)`，集中写 `#simDetail`（运行/暂停、`SIM.time`、步频、滑移/静摩擦/瞬态），`syncSimControls` 末尾调用，删除 781-786 的重复写入。2. `refreshChecks` 按冻结顺序输出 10 行，先取 `const solverOk = model.solverOk === true`；`sim` 行判据严格为 `sim.finite && !sim.recovered && solverOk`，不得并入残差阈值。3. `rockerResidual` 行独立计算 `residualMaxMm` 与 `residualMaxMm < 0.1`，值如 `max 0.004 / 0.100 mm · 失败 0 角`；`motionRatio` 行按 `motionRatioState` 统计不可用角数（`不可用 n 角 · 短时降级/持续失败`）；持续失败加 `is-error`，样式在 `styles.css:769-774` 后补 `.check-item.is-error` 两条规则，使用 `--danger`。4. `solverWarning`（`30-ui.js:813-832`）置顶求解分支，优先级“求解失败 > 卸载 > 边界 > 滑移”，文案含 `最大残差 xx mm（判据 0.100 mm）` 与不可达角数；非降级时移除 `is-error`。5. 模板 `topbar-center`（37-42）加 `<span class="solver-badge" id="solverBadge" role="status" aria-live="polite" hidden>求解降级</span>`；`#solverBadge` 只由 `model.solverState` 驱动：`'degraded'` 显示“求解降级”、`'failed'` 显示“求解失败”、`'ok'` 隐藏；仅在状态翻转时更新 `textContent` 与 `hidden`，并触发一次 `aria-live` 播报，不得每帧写入。6. 模板 data-list 的“仿真状态”后加 `<div><dt>角点求解残差</dt><dd class="mono" id="cornerSolveStatus">—</dd></div>`；`refreshSelfTests`（382-421）按 14 项静力 + 10 项动力学 = 24 项展示；测试全绿但 `solverOk === false` 时把 `#selfTestSummary` 置 `var(--warn)` 并追加“· 求解降级”，`#selfTestStatus`（803-806）追加“· 求解 正常/降级”；README 19/172/245 与 DESIGN 544/640 的 8/22 改为 10/24，由分册 05 的 B5-1 同步；分册 03 的 B3-3 同步为 10 项。7. `getSceneProbe`（390-405）追加 `solverOk` 与四角残差，供浏览器断言；字段透传由 B1-3 实施。

**验收。** 默认参数：`#solverBadge.hidden === true`，`#cornerSolveStatus` 匹配 `/max [0-9.]+ \/ 0\.100 mm/`，`sim` 与 `rockerResidual` 两行为 `is-ok`。设 `mass:600, wheelRateF/R:50, dampingF/R:0.05, arbFront/Rear:0`，俯仰脉冲后 `advanceSimulation(0.2)`：`getSnapshot().solverOk === false`、`getSnapshot().solverState` 为 `'degraded'` 或 `'failed'`、徽标文本匹配 `/(求解降级|求解失败)/`、`rockerResidual` 行为 `is-error`、`solverWarning` 含“残差”与“不可达”。该参数只作求解降级激励，本册不校验脉冲力矩数值（R-01 的 6880.45 由分册 02/05 处理）。恢复默认并 `resetDynamics({ settle: 1 })` 后全部恢复正常。关闭遥测面板重复工况，徽标仍可见（`offsetParent !== null`）。自检：`window.FSApp.runDynamicSelfTests().length >= 10`，打开模态框后 `document.querySelectorAll('#selfTestList li').length >= 24`，并按名称断言新增两项。状态同步：暂停 200 ms 后 `#simDetail` 以“暂停”开头，`#telemetrySimState === '暂停'`，`#btnSimToggle.textContent === '继续'`，1 s 后不变；继续或重置后四者立即为“运行/继续”。以上断言由 `npm run test:ui` 状态组与求解组执行；`grep -n "ok: sim.finite && !sim.recovered," src/js/30-ui.js` 无输出，且 `grep -c "solverOk" src/js/30-ui.js` 不少于 2（首行与徽标）。

**依赖与风险。** 依赖 B1-3、B1-5 与 B2（滑移文本）。字段改名时由 01 在 `simBuildModel` 出口适配，UI 不写兼容分支。风险是 `aria-live` 在拖动参数时频繁播报；只在布尔翻转时更新。B1-3 延期时先合并暂停同步与“待求解”占位，占位不得显示通过。回滚删除新增两行与徽标，保留 `renderSimStatus`。工作量 0.5 人日。

### B4-5 轮载箭头线性映射与文案（0.3 人日）

**现状。** `updateOverlays`（`10-scene.js:1029-1056`）用 `clamp(0.26 + 0.56 * load / avgCorner, 0.2, 0.88)`，`avgCorner = totalWeight / 4`（1032）。零载仍有 0.26 m，平均载 0.82 m 后封顶，与模板 161 行“长度正比于四轮法向力”不符。

**实施步骤。** 1. 在 `00-core.js` 的 `clamp` 后新增 `LOAD_ARROW_REF_HEIGHT = 0.30`、`LOAD_ARROW_MAX_HEIGHT = 1.35` 与纯函数：

```js
function loadArrowHeight(loadN, referenceN) {
  const ref = Number.isFinite(referenceN) && referenceN > 1 ? referenceN : 1;
  return clamp((loadN / ref) * LOAD_ARROW_REF_HEIGHT, 0, LOAD_ARROW_MAX_HEIGHT);
}
```

2. `10-scene.js:1049` 改为 `loadArrowHeight(load, Math.max(avgCorner, 1))`；`shaftLength` 保留 0.02 m 最小杆长，`head` 固定 0.115 m，几何写法（1054-1056）不变。3. 0.5 N 以下隐藏（1057）保留；颜色、接触环透明度与引线仍按 `load/maxLoad` 映射，不参与长度比例。4. 模板 161 行改为“箭头长度与法向力成正比（平均轮载 0.30 m，4.5 倍封顶）”，README/DESIGN 由分册 05 同步。5. `getSceneProbe` 增加 `loadArrowHeights`（读 `shaft.scale.y + head`），仅测试用。

**验收。** `tools/test-core.mjs` 的 factory 返回列加 `loadArrowHeight`，断言 `f(0)=0`、`f(0.5x)=0.5f(x)`、`f(2x)=2f(x)`、`f(10x)=1.35`、`f(-5)=0`、`f(1,0)` 有限且封顶，误差 1e-12。浏览器在水平与坡度 8° 下断言四角 `height[i]/load[i]` 相对差 < 1e-6（Node 断言 1e-12，浏览器只验证比例与零载），卸载角为零长；`grep -n "0.26\|0.88" src/js/10-scene.js` 无匹配。`npm test` 全绿。

**依赖与风险。** 可与 B2 并行。低载箭头会明显变短；若不接受，可把参考高度提到 0.36 m 但保持比例。回滚恢复旧公式并在模板中明确标注“非线性显示”，二选一。工作量 0.3 人日。

### B4-6 dev-server 边界与浏览器测试清理（0.5 人日）

**现状。** `dev-server.mjs:13-15` 用 `normalize(join(root, url))` 后 `startsWith(root)`，同前缀兄弟目录可通过；`decodeURIComponent` 在 try 内，非法编码返回 404；无方法限制与符号链接复核。浏览器测试在 `spawn` 后先 `findTarget()` 再 `connect()`，两者都在 `try` 之外（`test-dynamics-browser.mjs:86-87` 对 128 行），启动失败会绕过 `finally`，泄漏进程与 `/tmp/fs-camera-*`；`test-camera.mjs` 与 `capture-docs.mjs` 同构。`test-dynamics-browser.mjs:29` 文案误写为 camera test；三个工具都依赖 Node 21 才有的全局 `WebSocket`。

**实施步骤。** 1. 新建 `tools/browser-runner.mjs`（零依赖），导出 `findChrome`、`browserGate(label, { required })`、`withChrome(label, fn, options)`、`createCdpClient(socket)`。2. `withChrome` 顺序固定为 spawn → 立即 try → findTarget → connect → fn → finally；finally 关闭 socket、`chrome.kill('SIGKILL')`、删除 profile（前缀统一为 `fs-browser-`）；同时挂 `SIGINT/SIGTERM` 与 90 s 看门狗，`chrome` 的 `error/exit` 在 findTarget 期间 reject 并带 stderr 尾部 20 行。3. 端口改为 `--remote-debugging-port=0`，从 stderr 解析 `DevTools listening on ws://127.0.0.1:<port>/` 后请求 `/json/list`；解析失败回退 `getFreePort()`（`net` 监听 0 取端口）并重试一次，消除 9400-9800 冲突。4. 两个测试与 `capture-docs.mjs` 改用共享运行器，删除重复的 `CANDIDATES/findTarget/connect/send` 与各自清理代码；原 `check` 调用逐条保留。5. `browserGate` 语义：`FS_SKIP_BROWSER=1` 显式跳过（退出 0，与严格变量同设则冲突退出 1）；无 Chrome 默认 `SKIP` 退出 0，严格模式 `FAIL` 退出 1；无全局 `WebSocket` 默认跳过并提示需要 Node >= 21，严格模式失败。退出码统一：test 脚本断言失败为 1，runner 或 audit 环境错误（无法启动 Chrome、协议或端口错误）为 2，缺 Chrome 默认 SKIP 为 0。6. `dev-server` 导出 `resolveRequestPath(root, requestUrl)` 与 `createDevServer({ root, port })`：解码失败 400、含 NUL 400、`relative` 以 `..` 或绝对路径开头 403、`/` 映射 `index.html`；请求阶段 `realpath` 复核根外符号链接，`ENOENT/EISDIR` 404，仅 `GET/HEAD` 200、其余 405，响应加 `Cache-Control: no-store`。7. 新建 `tools/test-dev-server.mjs`，纯函数 6 组（含 `'/../fs-secret/x'`→403、`'/..%2fREADME.md'`→403、`'/%00'`→400、`'/src/../index.html'`→200）与集成 6 组（`GET /` 200、`GET /../README.md` 403、`GET /src` 404、`POST /` 405、`HEAD /` 200 无正文、缓存头），注册 `test:dev-server`。8. 修正 `test-dynamics-browser.mjs:29` 文案，截图工具用 `browserGate('capture', { required: false })`；`capture-docs` 不参与 CI 门禁，只在 `docs:capture` 中运行。

**验收。** `node tools/test-dev-server.mjs` 全绿，`grep -n "startsWith(root)" tools/dev-server.mjs` 无输出。`CHROME_PATH=/nonexistent npm run test:browser` 退出 0 并输出 SKIP；加 `FS_REQUIRE_CHROME=1` 退出 1 并输出 FAIL；加 `FS_SKIP_BROWSER=1` 即使有 Chrome 也退出 0。启动失败与清理用例归分册 05 的 browser audit，本册不新增 spawn 回归用例；手工冒烟一次确认 `/tmp/fs-browser-*` 无残留、`pgrep -f remote-debugging-port` 无匹配。迁移后两个测试的 `ok` 行与迁移前逐条一致；`test:browser` 与 `test:camera` 可并行通过。

**依赖与风险。** 无前置，但应与 B4-8 的构建检查一起合并，避免测试基线与构建状态混淆。风险是 stderr 文案随 Chrome 版本变化；保留回退端口与看门狗，失败输出 stderr 尾部。回滚可按文件还原两个测试，`resolveRequestPath` 可独立回滚。工作量 0.5 人日。

### B4-7 清理项与命名统一（0.3 人日）

**现状。** `createDefaultBodyMaterialSet`（`20-car.js:169-171`）只有定义无调用；截图文件名写死 `FS-01_static_`（`40-app.js:237`），而叠加的是动态载荷；`capture-docs.mjs:116-120` 的 `latestDownload()` 从未调用且按 `FS-01_dynamic_` 匹配。`updateCar` 回退分支用 `qYaw·qRoll·qPitch`（`22-car-dynamics.js:1104`），与 `DESIGN.md:553-558` 的 Ry·Rz·Rx 相反；1124-1143 缩进异常。

**实施步骤。** 1. 删除 `20-car.js:169-171`，确认 `grep -rn createDefaultBodyMaterialSet src tools` 无输出。2. `40-app.js:237` 改为 `'FS-01_' + (model.sim ? (model.sim.running ? 'dynamic' : 'paused') : 'static') + '_' + formatStamp() + '_' + screenshotCount + '.png'`；`model` 已在 121 行取得。3. 删除 `capture-docs.mjs` 的 `latestDownload()`；以后若需要按下载目录取文件，用新前缀重写，保留单一命名。4. 回退分支改为 `const quat = simQuatFromEuler(yaw, model.pitch, model.roll); S.bodyPivot.quaternion.set(quat[1], quat[2], quat[3], quat[0]);`，删除 `_qPitch`、`_qRoll` 与仅它们使用的 `_axisX`、`_axisZ`（13-18 行），`_qYaw` 保留。5. 重排 1124-1143 缩进，不改表达式。6. `test-dynamics.mjs` 增加欧拉顺序断言：用 `simQuatRotate` 施加 `simQuatFromEuler(0.7, 0.3, -0.4)`，与显式 `Ry·Rz·Rx` 矩阵作用比较（< 1e-12）；再断言 `(0, 0.3, 0.4)` 下与旧顺序 `Ry·Rx·Rz` 结果不同（> 1e-6）。

**验收。** `grep -rn "createDefaultBodyMaterialSet\|FS-01_static\|latestDownload" src tools` 无输出，重建后 `index.html` 同样无这三个标识符。默认截图下载名匹配 `/^FS-01_dynamic_\d{8}-\d{6}_\d+\.png$/`，暂停后匹配 `/^FS-01_paused_/`。`npm run test:dynamics` 通过新增两组断言；`git diff -w` 对 `22-car-dynamics.js` 为空；`npm test` 与 `npm run build:check` 全绿。

**依赖与风险。** 无前置。截图改名在仓库内无引用；`simQuatFromEuler` 在 05 中定义、22 加载在后，运行时可调用，顺序正确性由 Node 断言守护。回滚按文件或单行还原。工作量 0.3 人日。

### B4-8 构建一致性与 Chrome 严格模式（0.5 人日）

**现状。** `index.html` 由 `tools/build.mjs` 拼接，无时间戳、文件按名称排序，输出确定；本册重算与磁盘逐字节相同（960717 B，SHA-256 `ada2ca87…fa36`）。但 `package.json` 无 `pretest:browser`/`pretest:camera`，测试直接以 `file://` 打开产物；Chrome 缺失时脚本 `exit(0)`，CI 会当作成功；三个浏览器工具依赖 Node 21 的全局 `WebSocket`，与 `engines: >=18` 不一致。

**实施步骤。** 1. 重构 `build.mjs`：导出 `renderIndexHtml({ root })`（只返回字符串）与 `build({ root, write })`（返回 `{ html, files, bytes, sha256 }`），CLI 用 `import.meta.url === pathToFileURL(process.argv[1]).href` 判断；保留 17-25 行占位符替换与 `</script>` 检查，不注入时间或版本。2. 新建 `check-build.mjs`，导出 `verifyIndexHtml({ root })` 返回 `{ ok, actualHash, expectedHash, actualBytes, expectedBytes }`；CLI 成功打印“index.html 与源码一致 sha256 … (… B)”，失败打印两侧哈希并以 1 退出。3. `package.json` 增加：

```text
"build:check": "node tools/check-build.mjs",
"pretest:browser": "node tools/build.mjs",
"pretest:camera": "node tools/build.mjs",
"pretest:ui": "node tools/build.mjs",
"test:ui": "node tools/test-ui-browser.mjs",
"test:dev-server": "node tools/test-dev-server.mjs"
```

`pretest:*` 在 npm 中先于同名脚本执行（本册在本机 npm 12.2.3 用临时目录验证了 `pretest:ui` → `test:ui`；Node 18 的 npm 9 同规则）。4. 三个浏览器测试在选择 Chrome 前调用 `verifyIndexHtml()`，失败输出 `FAIL stale index.html; run npm run build` 并以 1 退出；严格模式复用 B4-6 的 `browserGate`。5. 新增 `.github/workflows/ci.yml`：`node` job 用 Node 18/20/22 依次执行 `npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server && npm run build:check`，并检查无运行时依赖；`browser` job 固定 Node 22，用 `npm run` 触发 `pretest` 构建，设 `FS_REQUIRE_CHROME=1` 与 `CHROME_PATH=/usr/bin/google-chrome`，依次跑 `test:browser`、`test:camera`、`test:ui`。`build:check` 是唯一产物门禁，`capture-docs` 不参与。6. 离线守护放进 `test:ui`：`Network.enable` 后 `Page.reload`，断言 `Network.requestWillBeSent` 只出现 `file:`/`data:`；CI 另加 `node -e` 检查 `index.html` 中不存在 `<script|link … src|href>` 外链。7. 浏览器 job 固定 Node 22；README 的 Node 说明由分册 05 同步。

**验收。** 干净工作区 `npm run build:check` 退出 0；改 `30-ui.js` 一个空格后退出 1 且输出两侧哈希；`npm run build` 后重新通过且 `git diff --exit-code index.html` 为空。删除 `index.html` 后 `npm run test:browser` 会先重建（`pretest:browser` 生效）；直接跑测试且产物过期时输出 stale 并以 1 退出。`CHROME_PATH=/nonexistent FS_REQUIRE_CHROME=1 npm run test:browser` 退出 1，不设严格变量时退出 0 并 SKIP；两个变量同设时冲突退出 1。CI 两 job 全绿：`node` job 五条命令按序执行，18/20 不跑浏览器测试；`browser` job 由 `npm run` 触发构建。总时长目标 < 10 min。

**依赖与风险。** 依赖 B0 的脚本命名与 CI 分层，新增脚本不得与 `npm run audit` 重名。风险是 CI 镜像 Chrome 路径变化；回滚从 `browser` job 移除严格变量并记录门禁降级原因。`pretest:*` 会重写 `index.html`，本地用 `git status` 查看，CI 用 `build:check` 暴露差异。工作量 0.5 人日。

## 5. 自动化测试建议

### 5.1 Node 侧

| 文件 | 新增内容 | 命令 |
| --- | --- | --- |
| `tools/test-core.mjs` | factory 加 `loadArrowHeight`；线性、零点、封顶、负值五组 | `npm run test:core` |
| `tools/test-dynamics.mjs` | 欧拉顺序两种样本；`simBuildModel` 求解字段形状检查 | `npm run test:dynamics` |
| `tools/test-dev-server.mjs` | 路径纯函数 6 组与集成 6 组 | `npm run test:dev-server` |
| `tools/check-build.mjs` | 产物一致性，CI 与本地共用 | `npm run build:check` |

`test:invariants`（分册 01）与 `test:runtime`（分册 03）由对应分册维护，本册不新建同名脚本，CI 在 `node` job 统一调用。

DOM、焦点与按键默认行为无法用 `jsdom` 等价替代，且项目不引入依赖，因此这三类只放在浏览器测试。

### 5.2 浏览器侧

新建 `tools/test-ui-browser.mjs`，复用 `withChrome`，用 `Emulation.setDeviceMetricsOverride` 改视口、`Input.dispatchKeyEvent` 派发真实按键、`Runtime.evaluate` 读 `document.activeElement` 与计算样式。

| 组 | 用例 | 关键断言 |
| --- | --- | --- |
| 视口 | 844×390、667×375、1024×400、1280×720 | 无滚动溢出；`#app` 高等于视口；顶栏与底栏完全可见；面板打开后底边不越界、截图按钮可见；场景净高 ≥ 55% |
| 键盘 | 按钮空格、空白处空格、输入框字母、面板按钮空格、模态框快捷键、`summary` 空格 | 按钮原生激活且仿真不切换；空白处切换；输入原生行为保留；`details` 正常展开 |
| 焦点 | 关闭面板焦点返回、25 次 Tab、打开可进入、窄屏初始态、模态框循环、Escape 恢复、独占面板 | `activeElement` 归属、`inert`/`aria-hidden` 一致、350 ms 后 `visibility: hidden` |
| 状态 | 暂停、继续、暂停中重置、空格暂停 | 四个状态字段一致且 1 s 不漂移 |
| 求解 | 默认、4.1 参数、恢复默认、关闭面板后的徽标 | 徽标由 `solverState` 驱动的“求解降级/求解失败”文本、残差行数值、10 行检查表 class、警告文案；`window.FSApp.runDynamicSelfTests().length >= 10`、弹窗 `#selfTestList li` >= 24 |
| 显示 | 水平/8° 箭头比例、卸载零长 | 四角 `height/load` 一致；零载为零；平均载 0.30 m |
| 离线 | 重载后的网络请求 | 仅 `file:`/`data:` |

用例 35-45 条，单次目标 < 60 s；失败时输出实际值。本文件只包含 UI 组；材质与资源释放归分册 03 的 `test-runtime`，Chrome 启动/清理与资源审计归分册 05 的 browser audit，均不在本册重复。

### 5.3 运行与端口

三个浏览器脚本各自启动 Chrome；B4-6 改为内核分配端口后可并行。本册编写期间不执行 `npm run test:browser`（当前端口占用），实施者合并前至少运行一次 `test:ui`、`test:browser` 与 `test:camera` 并保存输出作为迁移基线。浏览器测试不进入 `npm test`。

## 6. 风险与回滚

| 风险 | 触发 | 应对与回滚 |
| --- | --- | --- |
| 焦点管理导致面板不可操作 | B4-3 | 先 CSS 兜底再加 `inert`；覆盖打开/关闭/独占；回滚删 `setPanelInert` 调用 |
| `inert` 兼容性不足 | 旧版浏览器 | 特性检测与 `tabindex` 回退；或在 README 声明最低版本 |
| 去掉 `min-height` 后极短窗口拥挤 | B4-1 | 两档媒体查询与 360 px 断言；回滚恢复 `min-height: 520px` |
| 快捷键行为变化 | B4-2 | 空白处仍生效并同步文案；回滚删两行判定 |
| 求解字段改名 | B1-3 | 01 在 `simBuildModel` 出口适配；缺失显示“待求解” |
| 暂停同步重复写 DOM | B4-4 | 单一 `renderSimStatus`；徽标只在翻转时更新 |
| 箭头线性化后低载不醒目 | B4-5 | 参考高度可调；回滚并标注非线性 |
| 构建检查与本地流程冲突 | B4-8 | `pretest` 只做确定性构建，`git status` 可查 |
| Chrome 严格模式阻塞无浏览器机器 | CI | 仅环境变量开启；CI 路径可覆盖 |
| Node 18 无全局 `WebSocket` | 浏览器测试 | 浏览器 job 固定 Node 22；`browserGate` 明确提示 |

## 7. 工具链 CI 方案

**构建与产物。** `build:check` 是唯一产物门禁：重算模板替换并与 `index.html` 逐字节比较，不写盘，失败输出两侧 SHA-256 与字节数。`build` 仍是唯一写入路径；`pretest:browser/camera/ui` 在测试前构建，测试内部再次 `verifyIndexHtml()`。构建保持确定性，不写时间、主机名、随机数或版本号，`APP_VERSION` 仍手写在 `00-core.js:10`。

**Chrome 严格模式与跳过。** 默认无 Chrome 退出 0 并打印原因与恢复命令；`FS_REQUIRE_CHROME=1` 时失败退出 1；`FS_SKIP_BROWSER=1` 显式跳过；两者同设输出冲突并退出 1。无全局 `WebSocket` 时默认跳过并提示需要 Node >= 21，严格模式失败，不得让 `ReferenceError` 冒泡。退出码统一为：test 脚本断言失败 1，audit/runner 环境错误 2，缺 Chrome 默认 SKIP 0、严格变量下 1。`capture-docs.mjs` 默认允许跳过，不参与门禁。

**CI 分层。** `node` job 覆盖 Node 18/20/22 的 `npm test`、`test:invariants`、`test:runtime`、`test:dev-server`、`build:check` 与“无运行时依赖”检查；`browser` job 固定 Node 22，在严格模式下跑三个浏览器脚本。两层分开的原因是 Node 18 无全局 `WebSocket`，而物理与构建必须在声明的 Node 下限验证。CI 不安装 npm 依赖，仅用 Node 内置模块与预装 Chrome；工作流只引用 GitHub 官方 action（checkout、setup-node），不新增任何 npm 依赖。

**CI 工作流骨架。** 两个 job 都先 checkout 与 setup-node，浏览器 job 另跑 `google-chrome --version` 确认镜像：

```yaml
name: ci
on: [push, pull_request]
jobs:
  node:
    runs-on: ubuntu-latest
    strategy:
      matrix: { node: ['18', '20', '22'] }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}' }
      - run: npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server && npm run build:check
      - run: node -e "const p=require('./package.json'); if (p.dependencies||p.devDependencies) process.exit(1)"
  browser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: google-chrome --version
      - run: npm run build:check
      - run: npm run test:browser
        env: { FS_REQUIRE_CHROME: '1', CHROME_PATH: /usr/bin/google-chrome }
      - run: npm run test:camera
        env: { FS_REQUIRE_CHROME: '1', CHROME_PATH: /usr/bin/google-chrome }
      - run: npm run test:ui
        env: { FS_REQUIRE_CHROME: '1', CHROME_PATH: /usr/bin/google-chrome }
```

**本地命令。**

```bash
npm test                 # 静力 47 + 动力学 52
npm run build:check      # 产物与源码一致性
npm run build            # 唯一写入 index.html 的命令
npm run test:browser     # 动态冒烟；无 Chrome 默认跳过
npm run test:camera      # 相机冒烟；无 Chrome 默认跳过
npm run test:ui          # 键盘、焦点、视口、求解展示、离线
npm run test:dev-server  # 开发服务器边界
FS_REQUIRE_CHROME=1 npm run test:browser   # CI 严格模式（Windows 用 set / $env:）
```

## 8. 合并顺序与交付

1. B4-5、B4-7 先合并，不依赖物理批次，风险最低，为截图与测试提供稳定基线。
2. B4-6 与 B4-8 作为“工具链”提交序列：先共享运行器与 dev-server，再构建检查与 CI；两者共享 `browserGate`，不拆开合入。B4-8 的 `test:ui` 与 `browser-runner.mjs` 必须先于 B4-1 合入，B4-1 不使用临时探针。
3. B4-1、B4-2、B4-3 在 B2 后按“布局 → 键盘 → 焦点”每项一个提交；B4-4 在 B1-3 字段冻结后先合 `renderSimStatus` 与徽标骨架，再合残差行。
4. 提交使用 `fix(ui):`、`fix(tooling):` 前缀并列出编号与验收命令；全部合并后由分册 05 登记进回归矩阵，M4 以 `test:ui`、`build:check`、严格模式浏览器测试全绿判定。
