# B4 施工勘察（b4-recon）

| 项目 | 内容 |
| --- | --- |
| 分支 | `feat/plan-execution` |
| HEAD | `3d3f408`（B0-0 契约提交；工作树另有未提交的 `package.json`、`src/js/00-core.js`、`03-suspension.js`、`05-body-dynamics.js`、`22-car-dynamics.js` 与未跟踪的 `tools/audit*`） |
| 源码基线 | fbb401d；B1 正在施工，勘察读取时 00/03/05/22 已改；这些文件行号以读取瞬间为准，合入后需重核 |
| 依据 | `docs/plan/contracts.v1.md`、分册 04 r2、分册 06 裁决、分册 01/02/03、B0 审计脚本 |
| 性质 | 只读勘察；本文件只登记改动点，不改 `src/`、`tools/` 或 `index.html` |
| 边界 | B1 正在施工、B4 尚未解冻；本册不提前实现 B1/B2/B3 的字段 |

## 1. 勘察结论

B4 的八个工作项在源码上都能落到具体行号，但直接按分册 04 的步骤施工会遇到五处需要先对齐的地方：B1-1 把 `sim.state` 改成质心后 `40-app.js:23-31` 的 `calibrateRack` 仍把 state 当参考点传给 `suspRackForSteer`；分册 04 计划把 `#solverBadge` 放进 `.topbar-center`，而 `styles.css:1004-1008` 在 1180 px 以下把整个 center 隐藏；计划称画布“不进入聚焦序列”，实际 `10-scene.js:1577` 已给 canvas 设 `tabindex="0"`；B3-1/B3-3 会改 `30-ui.js` 的 `simDetail`、检查表行骨架与 `openModelModal`；B1-4 已改 `22-car-dynamics.js` 的渲染写入点（当前 963 行按 `rocker.feasible` 写失败标志）。上述五处不影响 B4 的设计，但决定插入位置与合入顺序。

勘察读取期间 B1 已开始改 `src/js/00-core.js`、`src/js/03-suspension.js`、`src/js/05-body-dynamics.js` 与 `src/js/22-car-dynamics.js`（git status M），这些文件行号随后仍在变化；本文件对物理文件只引函数名与契约字段，UI 文件按当前行号。当前环境可直接做只读复核：Node 24.22.1（全局 `WebSocket` 可用）、`/usr/bin/google-chrome` 存在、9300/9400/9600/8731 无监听；`npm test` 仍为静力 47 项、动力学 52 项全绿，动态自检仍是 8 项（R-06 目标 10 项由 B1/B2 增加）。`index.html` 已被 git 跟踪，当前与源码逐字节一致：960717 B、SHA-256 `ada2ca87…fa36`。`package.json` 当前已有 B0 的 `audit*` 脚本，但尚无 `build:check`、`test:ui`、`test:dev-server`、`pretest:*`。

## 2. 现状证据

| 编号 | 现状 | 位置 | 复核值 |
| --- | --- | --- | --- |
| E1 | `#app` 用 `100dvh` 同时设 `min-height: 520px`，`body` 隐藏溢出 | `styles.css:29-46` | 844×390 下 `#app` 高 520；底栏高 42、`bottom:10`，顶边 468；面板 `top:76/bottom:72`，底边 448 |
| E2 | 全局 keydown 只排除输入控件与模态框，空格无条件 `preventDefault` | `30-ui.js:1015-1041` | 焦点在 `#btnHelp` 时按空格切换仿真，不打开帮助 |
| E3 | 关闭面板只设透明度和 `pointer-events` | `styles.css:344-346`、`30-ui.js:340-350` | 无 `inert`、无 `aria-hidden`、无 `visibility`；全仓 grep 无 `inert` |
| E4 | 暂停文本分两处更新 | `30-ui.js:206-211`、`781-786`、`651-674` | 暂停后 `animate()` 不再调 `refreshTelemetry`（`40-app.js:427-435`），`#simDetail` 停在“运行” |
| E5 | 徽标位置会自我隐藏 | `styles.css:1004-1008`、模板 37-42 | `.topbar-center` 在 1180 px 以下 `display:none`；面板关闭提示若放此处，横屏/窄屏不可见 |
| E6 | 检查表当前 8 行且每次清空重建 | `30-ui.js:563-649` | 首行 `sim.finite && !sim.recovered`；`container.textContent=''` 后新建 8 个节点 |
| E7 | 求解状态被渲染层抹平 | `05-body-dynamics.js` 的 `solverOk`（B1 施工中，`simBuildModel` 当前 741 行仍取 `converged`）、`22-car-dynamics.js` 的 `updateSuspension`（当前 944-963） | `solverOk` 只看轮架 `converged`；角度有限即清 `rockerSolveFailed` |
| E8 | 轮载箭头为仿射映射 | `10-scene.js:1029-1056`、模板 161 | `0.26 + 0.56·load/avg`，夹 `[0.2,0.88]`；零载 0.26 m |
| E9 | dev-server 以字符串前缀判界 | `tools/dev-server.mjs:13-15` | `normalize(join(root,url))` 后 `startsWith(root)`；同前缀兄弟目录可通过 |
| E10 | 浏览器测试 spawn 后、连接前不在 try 内 | `test-dynamics-browser.mjs:64-87`、128、258-263 | 启动/WS 失败绕过 `finally`；`/tmp/fs-camera-*` 泄漏；SKIP 文案在 29 行误写 camera test |
| E11 | 无 Chrome 时成功退出、Node 18 无全局 WebSocket | `test-dynamics-browser.mjs:28-31`、`test-camera.mjs:29-32`、`capture-docs.mjs:23-26` | `process.exit(0)`；三个工具都用 `new WebSocket`（Node 21 起才有） |
| E12 | 画布已可聚焦 | `10-scene.js:1577` | `canvas.setAttribute('tabindex','0')`；分册 04 B4-2 “画布不进入聚焦序列”需改写 |

## 3. B4-1 至 B4-8 精确改动

### B4-1 横屏布局与视口

根因是 `#app` 的 `min-height: 520px` 与 `body{overflow:hidden}` 组合：844×390 时布局容器仍为 520 px，绝对定位的底栏按 520 px 定在 `top:468`，面板按 `520-72` 定在 `bottom:448`，两者都落在 390 px 视口外；1019/1044/1073 的响应式规则只改尺寸，改不了容器高度。

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `styles.css:46` | `#app` | `height: 100vh; height: 100dvh; min-height: 0;`，保留 `overflow: hidden` |
| `styles.css:1074` 之后 | 新增 `@media (max-height: 560px)` | `.topbar{height:56px}`；`.panel{top:62px;bottom:58px}`；`.bottom-bar{height:38px;bottom:8px}`；`.tool-btn{height:27px;font-size:8.5px}`；隐藏 `.tool-glyph/.viewport-hint/.topbar-center`；`.toast{bottom:52px}` |
| 同上之后 | 新增 `@media (max-height:560px) and (max-width:980px)` | `.bottom-bar{left:10px;right:10px;bottom:calc(8px + env(safe-area-inset-bottom,0px))}` |
| `styles.css:1070-1074` | `max-height:700px` 块 | 删除其中重复的 `.bottom-bar{bottom:10px}`，只留面板内边距 |
| 模板 5 | viewport meta | 已有 `viewport-fit=cover`，不改；不新增 DOM |

验收：`Emulation.setDeviceMetricsOverride` 依次设 844×390、667×375、1024×400、1280×720；断言 `documentElement.scrollWidth/scrollHeight` 不溢出、`#app` 高度等于 `innerHeight`、`.topbar` 与 `.bottom-bar` 矩形完全在视口内；844×390 打开参数面板后 `.panel` 底边不越界、`#btnScreenshot` 可见；场景净高不小于 55%。本项只改 CSS，不与 B1/B2/B3 抢文件。

### B4-2 键盘作用域与按钮语义

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `30-ui.js:1015` 前 | 新增常量与函数 | `SHORTCUT_BLOCK_SELECTOR` 覆盖 `button, a[href], summary, label, input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="button"], [role="slider"], [role="switch"], [role="checkbox"]`；`shortcutTargetBlocked(target)` 返回 `Boolean(target.closest(SELECTOR))` |
| `30-ui.js:1022-1036` | `bindKeyboard` | Escape 与 modal 处理之后插入守卫：`event.defaultPrevented` 为真，或 `shortcutTargetBlocked(event.target)` 为真，则直接 return；保留 `isTyping` 兜底；修饰键判断保持 |
| `30-ui.js:1039` | 空格分支 | 条件改为 `event.key === ' '` 或 `event.code === 'Space'`（二者取或）；只有进入全局处理才 `preventDefault()` |
| 模板 445-447、538 | 提示文案 | 改为“空格暂停（焦点不在控件上时）”；按键列表同步 |
| `10-scene.js:1577` | canvas 聚焦 | 不改；canvas 有 `tabindex="0"`，聚焦 canvas 时快捷键仍应生效，测试需覆盖 |

原生按钮的 Space 激活发生在 keyup；测试必须派发 keyDown 与 keyUp，不能只发 keyDown，也不能用 `element.click()` 代替。B4-2 与 B4-3 都改 `bindKeyboard`：B4-2 先插入守卫，B4-3 再在其前面加 Tab 陷阱，避免同一段两处重写。

### B4-3 面板与模态框焦点

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `30-ui.js:321-338` | `updatePanelUI` | 把 `aria-pressed` 改为 `aria-expanded`；保留 `aria-controls` |
| `30-ui.js:340-357` | `setPanel` / `togglePanel` | 独占打开时对另一面板 `setPanelInert(other,true)`；关闭时若焦点在面板内，先聚焦对应 toggle，再切 class、`setPanelInert(panel,!open)`、`updatePanelUI()` |
| `30-ui.js:359-380` | `openModelModal` / `closeModelModal` | 新增 `modalFocusables(modal)`；对 `#viewport,.topbar,.panel,.bottom-bar,.viewport-hint,#mobileScrim` 用 `Map` 记录并设 inert；关闭先恢复背景再恢复 `UI.modalReturnFocus` |
| `30-ui.js:1015-1030` | `bindKeyboard` | 在 Escape 之前处理 Tab 首尾循环；只在 modal 打开时接管 |
| 模板 48-55 | 面板 toggle | 加 `aria-controls="panelControls/panelTelemetry"`、`aria-expanded="true"`，去掉 `aria-pressed` |
| `styles.css:340、344-346` | `.panel` / `:not(.is-open)` | 关闭态加 `visibility:hidden`；用 `transition: ... visibility 0s linear .3s` 延迟，打开态延迟 0 |
| 模板 475 | 模态框 | 已有 `role="dialog" aria-modal="true"`，不改；焦点陷阱在 JS |

`inert` 不支持时用 `Map` 保存面板内可聚焦元素的原 `tabindex`，关闭设 -1、打开还原；不要用 CSS `display:none`，否则滑出动画消失。关闭动作必须在点击回调同步设置 `inert` 与 `aria-hidden`，`tools/audit-browser/audit-ui.mjs:72-81` 在 200 ms 后就读取这两个属性。

### B4-4 遥测状态同步与残差展示

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `30-ui.js:563-649` | `refreshChecks` | 10 行固定 id：`sim, contact, links, steer, arb, friction, rockerResidual, motionRatio, staticTests, dynamicTests`；`sim` 判据 `sim.finite && !sim.recovered && solverOk`；新增 `rockerResidual`（四角 feasible 且 max 残差 <0.1 mm）与 `motionRatio`（按 `motionRatioState` 统计） |
| `30-ui.js:651-674` | `syncSimControls` | 末尾调用 `renderSimStatus()`，由它唯一写 `#simDetail` |
| `30-ui.js:781-786` | `refreshTelemetry` | 删除这段 `simDetail` 拼接，避免暂停后旧 model 覆盖 |
| `30-ui.js:813-832` | `solverWarning` | 求解分支置顶，优先级 failed > 卸载 > 边界 > 滑移；文案含最大残差与不可达角数；恢复时移除 `is-error` |
| `30-ui.js:382-421` | `refreshSelfTests` | 计数改为 14 静力 + 10 动态 = 24；全绿但 `solverOk=false` 时 summary 用 `var(--warn)` 并追加“求解降级” |
| `40-app.js:260-335` | `getSnapshot` | 透传 `solverOk`、`solverState`、`rockerResidualMm`、`rockerFeasible`、`motionRatioState`、`solved[i].rocker` |
| `40-app.js:390-405` | `getSceneProbe` | 追加 `solverOk`、四角 `rockerResidual`，供浏览器断言 |
| 模板 44-55 | `.topbar-actions` | 放 `<span id="solverBadge" role="status" aria-live="polite" hidden>`；不要放 37-42 的 `.topbar-center`（E5） |
| 模板 393 后 | data-list | 加 `<div><dt>角点求解残差</dt><dd class="mono" id="cornerSolveStatus">—</dd></div>` |
| 模板 385 | `#checkList` | `aria-label` 由“静态校核”改为“模型校核”，避免 10 行含动态项时语义不符 |

`solverState` 不在 `simBuildModel` 的字段表里，由 B4-4 在 UI 侧派生并放入快照：`failed` 标志优先，其次 `degraded`，最后 `solverOk === true` 为 `ok`；`solverOk === false` 且两个标志都为 false 属契约 §3.4 的非法组合，UI 必须降级显示“求解失败”而不是隐藏徽标。建议只写一份 `solverStateOf(model)`（放在 `30-ui.js` 的 `refreshChecks` 附近），`refreshChecks` 与 `40-app.getSnapshot` 都调用它，避免两套派生。

`#solverBadge` 的 `aria-live` 不切换属性值；只在 `solverState` 翻转时写一次 `textContent` 与 `hidden`，让 live region 播报一次。默认 hidden，`ok` 时保持 hidden；`degraded` 文本“求解降级”，`failed` 文本“求解失败”。

### B4-5 轮载箭头线性映射

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `00-core.js:86` 之后 | `clamp` 后新增 | `LOAD_ARROW_REF_HEIGHT=0.30`、`LOAD_ARROW_MAX_HEIGHT=1.35`；`loadArrowHeight(loadN, referenceN)` 返回 `clamp(load/ref*0.30, 0, 1.35)`，`referenceN` 非正时取 1 |
| `10-scene.js:1032、1049` | `updateOverlays` | `avgCorner = model.totalWeight / 4` 保留；`arrowHeight = loadArrowHeight(load, Math.max(avgCorner,1))`；1051-1057 的 shaft/head/隐藏阈值不变 |
| 模板 161 | 显示说明 | 改为“箭头长度与法向力成正比（平均轮载 0.30 m，4.5 倍封顶）” |
| `40-app.js:390-405` | `getSceneProbe` | 增加 `loadArrowHeights`（`shaft.scale.y + head`），仅测试用 |
| `tools/test-core.mjs:13-14` | factory 返回列 | 加 `loadArrowHeight`，Node 断言线性、零点、封顶、负值 |

注意 `10-scene.js` 的箭头几何：`makeArrow`（945-955）的 shaft 是单位高、`head=0.115`；`arrowHeight` 是含箭头的总高，`shaftLength=Math.max(0.02, arrowHeight-head)` 会保留 0.02 m 视觉最小杆长，0.5 N 以下整体隐藏。

### B4-6 dev-server 与浏览器 runner

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| 新建 `tools/browser-runner.mjs` | 导出 | `findChrome`、`browserGate(label,{required})`、`withChrome(label,fn,options)`、`createCdpClient(socket)`；`withChrome` 顺序固定 spawn → try → findTarget → connect → fn → finally；90 s 看门狗、SIGINT/SIGTERM、stderr 尾部 |
| `tools/test-dynamics-browser.mjs:16-127` | 启动与 CDP 段 | 删除重复 `CANDIDATES/findTarget/connect/send`，改用 runner；28-31 的 SKIP 改为 `browserGate` 并修正 29 行文案 |
| `tools/test-camera.mjs:17-100、161-249` | 同上 | 移植到 runner；保留 15 条顶层 check 与循环内 3 条 |
| `tools/capture-docs.mjs:14-114` | `openPage/closePage` | 迁移到 runner；23-26 的 SKIP 用 `browserGate('capture',{required:false})`；116-120 `latestDownload` 删除 |
| `tools/dev-server.mjs:1-23` | 重写 | 导出 `resolveRequestPath(root,url)` 与 `createDevServer({root,port})`；`relative` 判界，解码失败 400、NUL 400、越界 403、目录/不存在 404、非 GET/HEAD 405、`Cache-Control:no-store`；`realpath` 复核符号链接 |
| 新建 `tools/test-dev-server.mjs` | 测试 | 纯函数 6 组 + 集成 6 组：`/../fs-secret/x`→403、`/..%2fREADME.md`→403、`/%00`→400、`/src/../index.html`→200、`GET /` 200、`GET /../README.md` 403、`GET /src` 404、`POST /` 405、`HEAD /` 200、缓存头 |
| `package.json:7-24` | scripts | 加 `test:dev-server`；`test:ui` 与 `pretest:ui` 归 B4-8；不要重复 B0-3 的 `test:invariants/test:runtime` |

`tools/audit-browser/_cdp.mjs` 已有一套 CDP 启动与清理逻辑，但它归分册 05；B4-6 不 import 它，也不改它，避免审计与测试互相牵制。两套 runner 的重复是已知成本，若后续评审要求合并，应单独升级契约，不在 B4-6 内隐式改 05 的文件。

`browserGate` 的退出语义按契约 §5.3：无 Chrome 默认 SKIP 退出 0；`FS_REQUIRE_CHROME=1` 失败退出 1；`FS_SKIP_BROWSER=1` 显式跳过退出 0；两变量同设冲突退出 1；启动/协议/端口错误退出 2；测试断言失败退出 1。`capture-docs` 不参与门禁。

### B4-7 清理项与命名

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `20-car.js:169-171` | `createDefaultBodyMaterialSet` | 删除；`grep -rn createDefaultBodyMaterialSet src tools` 无输出 |
| `40-app.js:237` | `link.download` | `'FS-01_' + mode + '_' + formatStamp() + '_' + screenshotCount + '.png'`，`mode` 取 dynamic/paused/static |
| `capture-docs.mjs:116-120` | `latestDownload` | 删除（死代码，且按 `FS-01_dynamic_` 匹配旧命名） |
| `22-car-dynamics.js:13-18` | `_qPitch/_qRoll/_axisX/_axisZ` | 删除；`_qYaw` 与 `_axisY` 保留 |
| `22-car-dynamics.js:1106-1108`（B1 施工中） | `updateCar` 回退分支 | 改为 `const quat = simQuatFromEuler(yaw, model.pitch, model.roll)`，再 `S.bodyPivot.quaternion.set(quat[1],quat[2],quat[3],quat[0])`；B1 合入后再按函数名核对行号 |
| `22-car-dynamics.js:1128-1147`（B1 施工中） | `updateCar` 车轮回退 | 纯缩进，不改表达式；B1 合入后再核对 |
| `tools/test-dynamics.mjs` | 新增断言 | `simQuatFromEuler(0.7,0.3,-0.4)` 与显式 `Ry·Rz·Rx` 比对 <1e-12；`(0,0.3,0.4)` 与旧顺序 `Ry·Rx·Rz` 差 >1e-6 |

### B4-8 构建一致性与 UI 浏览器测试

| 文件:行号 | 函数/选择器 | 目标实现 |
| --- | --- | --- |
| `tools/build.mjs:1-31` | 重构 | 导出 `renderIndexHtml({root})` 与 `build({root,write})`；CLI 用 `import.meta.url === pathToFileURL(process.argv[1]).href`；保留 17-25 的占位符检查；不写时间戳 |
| 新建 `tools/check-build.mjs` | `verifyIndexHtml` | 重算字符串与磁盘逐字节比较，返回 `{ok,actualHash,expectedHash,actualBytes,expectedBytes}`；CLI 0/1，不写盘 |
| `package.json:7-24` | scripts | 加 `build:check`、`pretest:browser/camera/ui`、`test:ui`；`test:dev-server` 归 B4-6；`test:invariants/test:runtime` 归 01/03 |
| 新建 `tools/test-ui-browser.mjs` | CDP 测试 | 只放 UI 组：视口、键盘、焦点、状态、求解展示、显示、离线；用 `withChrome`，端口由内核分配；不碰材质与 spawn |
| 新建 `.github/workflows/ci.yml` | CI | node job 18/20/22：`npm test && npm run test:invariants && npm run test:runtime && npm run test:dev-server && npm run build:check`；browser job Node 22，`FS_REQUIRE_CHROME=1` 跑三个 `npm run` 脚本；`capture-docs` 不参与 |
| `index.html` | 产物 | 模板/样式/JS 改完后由 `npm run build` 重建并随源码提交；`build:check` 只校验，不修复 |

`tools/test-ui-browser.mjs` 的 CDP 断言组如下；它复用 `withChrome`，用 `Emulation.setDeviceMetricsOverride` 改视口、`Input.dispatchKeyEvent` 派发真实按键、`Runtime.evaluate` 读 DOM 与 `getSnapshot/getSceneProbe`，不碰材质释放与 Chrome 启动清理（后者归 03/05）。

| 组 | CDP 操作 | 关键断言 |
| --- | --- | --- |
| 视口 | 设备指标覆盖 844×390、667×375、1024×400、1280×720 | 页面无滚动溢出；`#app` 高等于 `innerHeight`；顶栏/底栏矩形在视口内；打开参数面板后底边不越界、`#btnScreenshot` 可见 |
| 键盘 | 聚焦 `#btnHelp`、`#slope`、`#btnToggleControls`、`summary`、canvas，分别派发 Space/字母键的 keyDown+keyUp | 帮助按钮聚焦时 Space 打开弹窗且 `sim.running` 不变；空白处 Space 翻转 running；输入框内 `h` 不改坡度、ArrowRight 改步长；面板按钮 Space 只翻转一次；modal 内 `h`/Space/数字键失效 |
| 焦点 | 关闭面板后读 activeElement/inert/aria-hidden；连续 Tab；打开后 Tab；模态框内 Tab/Shift+Tab；Escape | 关闭后焦点回 toggle，`inert===true`、`aria-hidden==='true'`、350 ms 后 `visibility:hidden`；25 次 Tab 不进入关闭面板；模态框内 15/5 次循环不逃逸；Escape 回 `#btnHelp` |
| 状态 | 暂停/继续/暂停中重置；键盘触发暂停 | `#simDetail`、`#telemetrySimState`、`#simStatus`、`#btnSimToggle` 四者一致，1 s 后不漂移 |
| 求解 | 默认；600 kg/50 N/mm/ζ0.05/ARB0 + 俯仰脉冲；恢复默认；关闭遥测面板重复 | `#solverBadge` 由 `solverState` 驱动“求解降级/求解失败”；`#cornerSolveStatus` 残差；`rockerResidual` 行 `is-error`；`#solverWarning` 含残差/不可达；`runDynamicSelfTests().length>=10`、弹窗 `#selfTestList li>=24` |
| 显示 | 水平与坡度 8° 读 `getSceneProbe().loadArrowHeights` | 四角 `height/load` 比例一致；零载为零；平均载 0.30 m |
| 离线 | `Network.enable` + `Page.reload` | 仅 `file:`/`data:` 请求，无 `http(s)` |

## 4. 关键口径

1. **10 行检查表**：id 与顺序固定为 `sim, contact, links, steer, arb, friction, rockerResidual, motionRatio, staticTests, dynamicTests`；`sim` 判据是 `sim.finite && !sim.recovered && solverOk`；残差 0.1 mm 只属于 `rockerResidual`；`motionRatio` 只按 `motionRatioState` 统计。B3-3 先建 10 行骨架，B4-4 只填 `sim` 判据与两行值，避免两处重写 `refreshChecks`。
2. **solverState 与徽标**：`failed > degraded > ok`；`solverOk=false` 且两标志皆 false 时按 failed 兜底并记录控制台告警；徽标只由 `solverState` 驱动，`aria-live` 不切换，只在翻转时写一次文本与 `hidden`。
3. **徽标位置**：放 `.topbar-actions`（模板 44-55），不要放 `.topbar-center`；后者在 `styles.css:1004-1008` 于 1180 px 以下隐藏，会导致“关闭面板仍可见”失效。
4. **残差行**：`rockerResidual` 判据“四角 `rockerFeasible` 且 `Math.max(...rockerResidualMm) < 0.1`”；值文本 `max 0.004 / 0.100 mm · 失败 0 角`；字段缺失显示 `—` 且 `ok:false`，不得绿色。
5. **轮载箭头**：线性函数放 `00-core.js`，零载为 0，平均轮载 0.30 m，4.5 倍封顶；颜色/引线仍按载荷比映射，不改几何结构。
6. **空格作用域**：只有焦点在非交互元素（含 canvas）或 `body` 时才接管；焦点在 `button/a/summary/label/input/select/textarea/[contenteditable]/role 控件` 时放行原生行为；`event.defaultPrevented` 早退；空格用 `key === ' '` 与 `code === 'Space'` 双条件。
7. **面板焦点**：关闭时先把焦点移到对应 toggle，再设 `inert` 与 `aria-hidden`；打开时先移除 class 再移除 inert；`inert` 不支持时用 `tabindex` Map 回退；CSS `visibility` 只作兜底，延迟 0.3 s。
8. **844×390 根因**：`#app` 的 `min-height:520px` 使容器高于视口；底栏与面板按 520 px 定位，分别落在 468/448 px。修法是 `min-height:0` + `100dvh` + 低高度媒体查询，不是继续调 `top/bottom`。

## 5. 与 B1/B2/B3 的接口

只消费 `contracts.v1.md` 已冻结字段，不新增、不改名、不改单位。

| 来源 | 消费字段 | B4 用途 |
| --- | --- | --- |
| B1-1 | `bodyPos`、`heave`、`cgWorld`、`bodyVelocity` | 遥测与截图，均为参考点/质心语义，不直接读 `state` |
| B1-3 | `solverOk`、`rockerResidualMm`、`rockerFeasible`、`motionRatioState`、`solved[i].rocker` | 首行、残差行、运动比行、徽标 |
| B1-5 | `sim.solverDegraded`、`sim.solverFailed` | 派生 `solverState` |
| B2-1 | `sim.mode`、`sim.usage`、`sim.slipSpeed`（替代旧 `sim.sliding/holding`） | 状态文本与警告；旧字段在 B2-1 合入前只作兼容 |
| B2-3 | `contactRoad`、`wheelPosRoad` | 载荷箭头锚点经 `model.contactPoints` 消费，UI 不自行变换 |
| B3-1 | `timeScale`、`droppedTime`、`backlog`、`lastAdvance` | `#simDetail` 与 `sim` 行文本；B3-1 先合入 |
| B3-2 | `geometry.{sceneRevision,physicsRevision,pending,mismatch}` | 不在 B4 验收里重定义；B4 只读 `pendingRebuild` 现状字段 |
| B3-3 | `setupRevision`、`selfTestRuns`、10 行骨架、`#checkList` 增量协议 | B4-4 只填值，不负责缓存 |
| B3-4 | `assets.{lastBuild,totals}` | 不在 test-ui-browser 断言；归 03/05 |

**需要 B4 开工前对齐的五处。**

1. `40-app.js:23-31` `calibrateRack` 把 `sim.state` 当参考点传给 `suspRackForSteer`。B1-1 已新增 `simReferencePoint(sim)`，但该调用点尚未迁移；B1-1 后 `state` 是质心，必须改为 `simReferencePoint(sim)` 或等价的 `{x,y,z}`。这是 B1-1 的调用点，不是 B4 的新接口；B4 只负责在 `30-ui/40-app` 中消费派生量，若 B1 未改，B4 不可开工。
2. `30-ui.js:656、782` 与 `refreshChecks:588` 使用 `SIM.flags.sliding`、`sim.sliding/holding`。B2-1 的契约字段是 `sim.mode`；B4-4 应优先读 `mode === 'SLIP'`，在 B2-1 未合入时保留旧字段回退，合入后删掉回退。
3. `40-app.js` 的 `getSnapshot` 同时被 B3-2/B3-3/B3-4/B4-4 追加字段。B4-4 只追加 `solver*` 与 `rocker*`，不要重排既有字段；B3-2 先合入，B4-4 在其后 rebase。
4. `30-ui.js` 的 `refreshChecks`、`refreshSelfTests`、`openModelModal` 同时被 B3-1/B3-3/B4-3/B4-4 修改。建议顺序：B3-1（帧字段）→ B3-3（缓存/10 行骨架/分片）→ B4-2（键盘）→ B4-3（焦点）→ B4-4（判据与值）。B4-2 的守卫必须在 B4-3 的 Tab 陷阱之前；B4-4 必须在 B3-3 的骨架之后。
5. `22-car-dynamics.js` 同时被 B1-4（当前 `updateSuspension` 944-963、`rockerSolveOk` 1088）、B4-7（当前回退分支 1106-1108、缩进段 1128-1147）和 B3-4（buildCar）修改。B1-4 先合入，B4-7 只改回退分支与缩进，B3-4 只改释放路径；三者行号不重叠，但 B4-7 的 `git diff -w` 验收必须在 B1-4 之后跑。

## 6. 合入顺序建议

| 顺序 | 工作项 | 理由 |
| --- | --- | --- |
| 1 | B0-3（scripts） | `test:invariants/test:runtime/build:check` 的脚本名先定，B4 再加 `test:ui` 等不冲突 |
| 2 | B4-6 + B4-8 | 只依赖 B0；先有 `browser-runner`、`check-build`、`test:ui` 与 CI，B4-1 才有可执行验收；B3-2 追加浏览器用例时可直接用 runner |
| 3 | B1-1…B1-6 | 物理字段先冻结；B1-4 改 22-car 后，B4-7 的回退分支才有稳定基线 |
| 4 | B2-1…B2-4 | 接触状态与 `mode` 冻结；B4-4 的滑移文本才有单一来源 |
| 5 | B3-1 → B3-2 → B3-3 → B3-4 | 先帧字段，再几何，再自检缓存/10 行骨架，最后资源释放；B3-3 是 B4-4 的前置 |
| 6 | B4-5 | 只改 00-core/10-scene/模板，可在 B3-4 前或后；B3-4 改 10-scene teardown，若先做 B4-5 需 rebase 1049 附近 |
| 7 | B4-7 | 依赖 B1-4 与 B3-2 的 exportScreenshot 稳定；B3-4 后 20-car 行号可能移动，删除 169-171 前重新核对 |
| 8 | B4-1 | 纯 CSS，不抢文件；在 B4-8 的 `test:ui` 就绪后做 |
| 9 | B4-2 → B4-3 | 同一 `bindKeyboard`；先守卫后 Tab 陷阱 |
| 10 | B4-4 | 最后；需要 B1-3/B1-5、B2-1、B3-1/B3-3 全部就绪 |

## 7. 风险

1. **UI 测试需要 Chrome**：本机 `/usr/bin/google-chrome` 存在，但默认 `test:ui` 在无 Chrome 时按契约 SKIP 退出 0；合并门禁必须带 `FS_REQUIRE_CHROME=1`，否则“未运行”会被当成通过。浏览器测试还依赖 Node 21+ 的全局 `WebSocket`，CI 的 browser job 固定 Node 22；本地 Node 24.22.1 可用。三个浏览器脚本并行时统一用 `--remote-debugging-port=0`，避免 9400-9800 随机端口冲突。
2. **构建产物 index.html 未提交**：当前 `index.html` 已被跟踪且与源码逐字节一致，但 B4 改模板/样式/30-ui/40-app 后，`pretest:*` 会重写它；若提交只含源码不含产物，CI 的 `build:check` 必红，其他人本地 `file://` 打开的也是旧页面。B4-8 必须把“改完 `npm run build`、把 `index.html` 一并提交”写入交付清单；并行 agent 不应同时跑 `pretest:*`，写入不是原子操作。
3. **快捷键与原生按钮冲突**：Space 的按钮激活在 keyup 触发，若 keydown 里 `preventDefault()` 就永远不会 click；B4-2 必须在 keydown 早退而不是在 click 里补救。测试要派发 keyDown+keyUp，并同时断言“帮助弹窗打开”和“仿真 running 未翻转”；只测其中一个都会漏掉反向回归。canvas 已有 `tabindex="0"`，聚焦画布时快捷键仍应生效，测试不要假设焦点只在 body。
4. **B1-1 的状态语义未同步到 40-app**：`calibrateRack` 若继续传 `sim.state`，转向标定会偏 0.30 m，且 4.1 工况的 rack 基线不可信。此项应在 B1-1 合入前由 01/主册确认 owner；B4 不应静默改物理调用点。
5. **徽标被 CSS 隐藏**：按分册原文放 `.topbar-center`，在 844×390 与所有 ≤1180 宽度下不可见，正好违背“关闭面板仍能看到降级”。落地改 `.topbar-actions`，并在 390 px 宽度下补可见性断言。
6. **inert 与焦点时序**：audit-ui 在点击关闭后 200 ms 读取 `inert/aria-hidden`；这两个属性必须在 click 回调同步设置，不能等 CSS 过渡或 rAF。`inert` 不支持的浏览器用 `tabindex` 回退；测试不要只测 Chromium 的 `inert`。
7. **两套 CDP 实现**：05 的 `tools/audit-browser/_cdp.mjs` 与 04 的 `browser-runner.mjs` 都会启动 Chrome。R-04 已把 audit 归 05，B4-6 不 import 它；重复代码是已知成本，若合并需另立契约。test-ui-browser 与 audit-ui 的 U1-U4 会覆盖同一行为，前者是修复后绿回归，后者是修复前红基线，二者都要保留但断言 id 不要复用。
8. **B3-3 的分片与 B4-3 的焦点**：B3-3 会把 `openModelModal` 改成异步/分片；B4-3 在其内部加焦点陷阱与背景 inert，若不按顺序会互相覆盖。建议 B3-3 合入后 B4-3 只补焦点逻辑，不改自检调度。
9. **B4-4 字段未就绪**：B1-3 的 `rockerResidualMm` 与 B1-5 的 flags 未落地前，`solverState` 只能占位；错误地显示绿色会重现“有限即通过”。B4-4 必须在 B1-3/B1-5 之后合入，缺失字段显示 `—` 并判失败。
10. **测试数量口径**：R-06 把动态自检从 8 提到 10、总数 22 提到 24；当前源码与 `test-dynamics-browser.mjs:225/251` 仍是 8/22。B4-4 与 B3-3 都会改这些断言，必须按测试名称断言新增两项，不能只改数字下限。

## 8. 复跑命令（B4 解冻后）

```bash
npm test
npm run build:check
npm run test:dev-server
npm run test:ui
FS_REQUIRE_CHROME=1 npm run test:browser
FS_REQUIRE_CHROME=1 npm run test:camera
npm run build && git diff --exit-code index.html
```

本册勘察期间只执行了只读的 `npm test` 与内存构建比对，未运行任何浏览器测试，未写 `src/` 与 `tools/`。行号以当前工作树为准；B1 已改 `00/03/05/22`，读取后仍在变化；`30-ui/40-app/`模板与样式当前未改，但 B3 合入后需按本文件重新核对一遍。
