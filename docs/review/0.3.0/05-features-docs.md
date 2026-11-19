# 功能完整性与文档一致性对抗审阅（0.3.0）

> **历史评审｜基线：0.3.0 / `45983ca`。** 本文保留原始发现与结论，不代表当前状态。请先查阅 [总报告](00-summary.md) 和 [0.4.x 状态映射](status-mapping.md)；0.4.0 已关闭项只在映射中登记，其他发现以 0.4.1 最终验收为准。当前状态以根 README/DESIGN 及最新验收为准。

| 项目 | 内容 |
| --- | --- |
| 审阅任务 | task-5《功能完整性与文档一致性对抗审阅：参数链路、导出、持久化、自检》 |
| 审阅对象 | formula-simulator 0.3.0，HEAD 45983ca，审阅开始前工作区干净 |
| 审阅方式 | 只读源码审阅 + Node 物理/自检探针 + 无头 Chrome 156 真实页面实验；未修改任何被跟踪文件，未运行 npm run build |
| 环境 | Node v24.22.1；Google Chrome 156.0.8078.47；Linux x64；无头 Chrome 使用随机调试端口与临时 user-data-dir |
| 证据目录 | .tmp-review/integration/（脚本、JSON、日志、截图）；唯一报告文件为本文件 |

## 1. 审阅范围与方法

### 1.1 范围

- 文档：README.md、DESIGN.md（尤其第 20 节）、docs/plan/acceptance.md、docs/code-review.md、docs/code-review-k3.1-pro.md、docs/plan/notes/b6-final-review.md。
- 页面与实现：src/index.template.html 全部可交互控件，src/js/00-core.js、30-ui.js、40-app.js 的功能实现，src/js/05-body-dynamics.js 的动态试验、求解状态与自检，src/js/03-suspension.js 的转向标定。
- 重点：控件是否真正改变物理或视觉；动态试验是否与 README 数值一致；24 项自检是否真实、是否随参数变化、缓存是否正确失效、失败是否可见；复制 JSON、PNG 截图、localStorage、恢复默认；README/DESIGN/acceptance 的命令与数字；竖屏移动端功能等价性。
- 与 UI 审阅流的分工：不重复焦点、对比度、布局细节。求解失败 warning 文案矛盾与 solverFailed 锁存由对应审阅流负责；本报告只把它们作为 CG 高度恢复链的侧证。

### 1.2 方法

1. 源码对照：从模板控件清单追到 30-ui.js 绑定、40-app.js 编排、00-core.js/05-body-dynamics.js 模型，确认“界面—状态—物理/视觉”闭环。
2. Node 探针：用仓库自带 tools/audit/_harness.mjs 加载 00-core/03-suspension/05-body-dynamics，核对脉冲力矩、0.12 s 持续时间、稳态载荷、惯量、运动比、自检项与参数敏感性（probe-physics.mjs）。
3. 真实页面：用 tools/browser-runner.mjs 启动无头 Chrome（--remote-debugging-port=0、临时 profile），加载仓库根目录 index.html；用真实 DOM 事件触发滑块/复选/按钮，读取 window.FSApp.getSnapshot()、DOM 文本、#checkList、#selfTestList；在页面内注入 CanvasRenderingContext2D.fillText/HTMLCanvasElement.toDataURL 探针保存实际截图。
4. 环境说明：部分无头会话的 requestAnimationFrame 约 1 Hz，依赖 animate 的 DOM 标签/CSS 抽屉更新滞后；涉及此类现象时用 FSApp.advanceSimulation(0) 或 Page.captureScreenshot 强制帧后再测量。未强制帧的早期测量不计入结论。
5. 独立性：未把 0.2.0 已发现问题（摇臂收敛、质心积分、低速摩擦、脉冲坐标、接地点、帧时间、几何代际、自检 DOM、材质释放、UI U1–U4）当新发现；只检查这些修复是否完整、是否引入回归。完整套件以 Lead 基线（50/50+80/80、27/27、78/78、build:check 668c59ea…）为背景，本报告另做针对性质检。

### 1.3 证据脚本与产物

| 证据 | 脚本/产物 | 用途 |
| --- | --- | --- |
| 物理与自检 | .tmp-review/integration/probe-physics.mjs → probe-physics.json | 脉冲力矩、持续时间、峰值、惯量、运动比、404 组静态自检搜索、极端动态自检 |
| 控件链路 | .tmp-review/integration/features.mjs → features.json | 干净基线下逐控件 before/after、显示开关、单位、预设、低附着、脉冲按钮、阻尼/ARB 动态对比 |
| CG 高度缺陷 | .tmp-review/integration/cgheight-deterministic.mjs、recovery.mjs → 两个 JSON | 确定性复现、0.35–0.50 分级、重置姿态、恢复默认、截图 |
| 会话/持久化/键盘 | .tmp-review/integration/session.mjs → session.json | localStorage、损坏/越界/旧版数据、存储拒绝、恢复默认、全部快捷键 |
| 导出 | .tmp-review/integration/exports.mjs → exports.json | 复制 JSON（正常/降级/失败）、PNG 截图、双按钮、kg/暂停 |
| 自检与移动端 | .tmp-review/integration/selftest-mobile.mjs → selftest-mobile.json；mobile-drawer.mjs、mobile-portrait.mjs | 24 项、失败可见性、缓存、竖屏抽屉/触控/模态/截图 |
| 截图 | .tmp-review/integration/artifacts/ 下 screenshot-1440.png、screenshot-390-portrait.png、cgheight-bug-0.50-front.png、cgheight-bug-after-reset-front.png 等 | 正常构图、竖屏构图、CG 高度故障态与重置后故障态 |

## 2. 已核实无问题或修复有效的方面

### 2.1 交付物与版本

- git rev-parse HEAD = 45983ca62057060611f71150734e45caefac50a2；审阅开始前 git status --porcelain 为空（审阅期间仅新增 docs/review 未跟踪目录）。
- index.html 大小 1,021,578 B、sha256 668c59ea6f53369b673fc577c65bb9e7036eceab7e13080b3d562e203143f246，与 acceptance/build 基线一致；package.json version 0.3.0；src/js/00-core.js:10 的 APP_VERSION 为 0.3.0。
- README 列出的 test:core、test:dynamics、test:invariants、test:runtime、test:ui、test:dev-server、audit:baseline、test:browser、test:camera、docs:capture、dev 均存在于 package.json；docs/01…10*.png 均存在。
- 默认参数下派生量：Ixx/Iyy/Izz = 264.6434/1416.616/1250.340 kg·m²（文档约 265/1417/1250）；运动比 0.51596/0.32391（文档约 0.52/0.32）；轮心阻尼 3529.0/4482.9 N·s/m（文档约 3.5/4.5 kN·s/m）；连杆 30 根、端点 68 个；maxSuspLinkStretchMm 在 1e-12 mm 量级、tieRodStretchMm 在 1e-10 mm 量级。
- 24 项自检名称与 README 列表语义一一对应：14 项静力名称逐字一致；10 项动力学名称均在，但 README 排序与实现顺序不同（见 §3.5 第 8 条）。默认打开模型说明得到 24 条、14/14 与 10/10。
- acceptance 中“动量/能量未独立断言”“FSApp.dispose 未自动断言”已被 b6-final-review 标注，本报告不重复作为新发现；只记录 acceptance 的 HEAD 仍写 WIP 提交（§3.5）。

### 2.2 参数控件链路（干净基线，逐项实测）

以下每项都在 FSApp.reset() + resetDynamics({settle:1.5}) 的暂停平衡态下，通过真实 range/checkbox 事件改变，并在再次重置后读取快照；完整数值见 features.json。除 CG 高度外，所有控件都能在快照或 DOM 中找到对应变化。

| 控件 | before → after（代表性可观测量） | 结论 |
| --- | --- | --- |
| 纵坡 0→8° | β 0→8.000°；前轴比 0.4550→0.4431；四角载荷 1780.3/1780.3/2132.5/2132.5 → 1717.0/1717.0/2157.8/2157.8 N；heave 0.00004→0.164 mm | 有效 |
| 横坡 0→7° | β 7.000°；roll 0.0254°；左载比 0.5000→0.4771；ARB 扭转 0→0.1295° | 有效 |
| 附着系数 1.40→0.60 | frictionCapacity 1.40→0.60；静力载荷不变（差在 0.3 N 动力学收敛噪声内） | 有效（只改变容量分支） |
| 总质量 798→900 kg | totalWeight 7825.71→8825.99 N；四角载荷按比例增加；heave 频率 4.364→4.109 Hz；Ixx 264.64→298.47 | 有效 |
| 前轴静载比 45.5→52% | frontShare 0.4550→0.5200；cgX -0.15975→0.0710 m；前/后载荷互换 | 有效 |
| 质心高度 0.30→0.50 m | 缺陷：水平路面上 Node 静力应保持不变，但页面产生 200 mm 参考点下移、8–122 kN 载荷、rack -120 mm；见 §3.1 | P1 |
| 质心横向 0→0.08 m | leftShare 0.4984→0.4503、rightShare 0.5016→0.5497；cgProjectionZ 0→0.080 m | 有效 |
| 前轮心率 140→220 N/mm | 线圈刚度 525.9→826.4 N/mm；heave 频率 4.364→4.912 Hz；pitch 频率 6.176→7.091 Hz | 有效 |
| 后轮心率 160→80 N/mm | 线圈刚度 1525.0→762.5 N/mm；heave 频率 4.364→3.737 Hz | 有效 |
| 前阻尼比 0.35→0.90 ζ | 轮心阻尼 3529→9074.6 N·s/m；轴端阻尼 13256→34087 N·s/m；脉冲峰值 19.9→8.55 mm、尾值 3.03→2.1e-7 mm | 有效 |
| 后阻尼比 0.38→0.90 ζ | 后轮心阻尼 4482.9→10617.4 N·s/m；轴端 42728.5→101199.2 N·s/m | 有效 |
| 前防倾杆 60→100%（bank 7°） | arbRate.front 42000→70000 N/m；arbRollStiffness 245030→318514；roll 0.02539→0.02271° | 有效 |
| 后防倾杆 60→100%（bank 7°） | arbRate.rear 54000→90000 N/m；roll 0.02539→0.02220°；叶片角 39.23°→0° | 有效 |
| 前轮转角 0→12° | 齿条 -0.036→-19.10 mm；横拉杆残差仍 <1e-7 mm；四角载荷变化约 ±101/±116 N（见 §3.5“仅机构展示”措辞） | 有效，但 UI 措辞过度 |
| 轴距 3.55→3.70 m | 几何 revision 1→3、commit 0→1；前/后轮位 x 由 ±1.7750→±1.8500 m；cgX -0.15975→-0.16650 m | 有效（重建） |
| 前轮距 1.62→1.75 m | revision 1→5、commit 2→3；轮位 z 展宽；载荷分配更新 | 有效（重建） |
| 后轮距 1.58→1.45 m | revision 1→6、commit 4→5；轮位 z 收窄 | 有效（重建） |
| 轮胎半径 0.36→0.33 m | revision 1→7、commit 6→7；getSceneProbe().wheelPos.y 0.35993→0.32993 m | 有效（重建） |
| 显示复选：轮载/质心/标注/剖视/机构标注 | showLabels 关→4 个 load-label 隐藏；showLoads 关→4 个；showCG 关→CG 与 CG′ 隐藏；showParts 关→5 个 part-label 隐藏；xray 关/开→5/0 | 有效（需强制帧，见 §5） |
| N / kg 单位 | FL 1780 N→181.5 kg；ΣN 798.0 kg；massEqFL 显示约 1,780 N；快照仍为 N | 有效 |
| 5 个路面预设 | level/slope/bank/mixed/lowGrip 分别写入 (0,0)/(8,0)/(0,7)/(6,5)/(10,10,0.20)；chip 激活正确 | 有效 |
| 低附着滑移 | β 14.106°、μ_req 0.2513；2 s 滑移 0.98 m（Node 2.0 s 为 1.10 m）；warning 显示“切向摩擦不足”；20 s 后 z=2.600 m 边界、速度归零、boundary=true | 有效 |

### 2.3 按钮、快捷键与相机

- 动态试验 6 按钮均能真实工作：暂停/继续（500 ms 内 sim.time 冻结，按钮文本“继续/暂停”、simDetail 与遥测状态同步）；重置姿态（time=0、速度=0、姿态回平衡）；垂向/侧倾/俯仰脉冲（峰值见 §2.4）；回到平衡（time≈2.0 s、残余 heave 3.7e-5 mm）。
- 复制参数：正常剪贴板路径得到 27 个 setup 键、16 个 summary 键、version 0.3.0；setup 与 FSApp.getState() 一致，summary 的 loads/ΣN/β/μreq/姿态/heave/travel/sim/inertia/frequencies 与快照一致；剪贴板拒绝时 execCommand('copy') 降级成功；两者都失败时 toast 为“浏览器未允许剪贴板访问，可改用截图”。
- 截图：顶部与底部按钮都调用同一导出；1440×900 视口得到 1440×813 PNG，竖屏 390×844 得到 390×844 PNG；画布叠加标题、日期、四角载荷、ΣN、β/μreq、h/θ/φ、RUN/PAUSE，不含网页 UI；kg 状态下卡片数值切换到 kg；文件名形如 FS-01_paused_20261119-045622_1.png。截图见 §2.6 与 §3.1。
- 相机：5 个预设的 preset/projection 与 README 一致（side/front/rear/top 正交，threeQuarter 透视）；O 键与按钮切换正交/透视；X 键/按钮与复选同步；AutoRotate 开启后 theta 0.62→0.822；重置视角回到 threeQuarter；M/按钮完整循环转向→传动→前防倾杆→后防倾杆并自动开启 xray、关闭两侧面板；面板开关与关闭按钮、帮助弹窗、Esc 关闭均有效。
- 快捷键：Space 暂停/继续、I 垂向脉冲、1–5 相机、O 正交、H 水平、X/F/G 显示开关、M 剖视、R 重置视角、? 打开模型说明、Esc 关闭均实测有效；焦点在按钮上时 Space 不触发仿真（只触发按钮原生行为），符合模板“焦点不在控件上时”的说明。

### 2.4 动态试验数值（Node 与浏览器一致）

| 项目 | 实测 | README/DESIGN 宣称 | 结论 |
| --- | --- | --- | --- |
| 脉冲持续时间 | 60 个 2 ms 子步 = 0.12 s；3 种脉冲均如此 | 0.12 s | 一致 |
| 垂向脉冲力 | -6800 N；峰值 heave 14.20 mm、pitch 0.0934° | 6800 N，激励升沉和俯仰 | 力量级一致；作用点描述有误，见 §3.3 |
| 侧倾脉冲力 | -4200 N，作用在 z=+0.90 m；峰值 roll 0.4071° | 4200 N，右侧 0.90 m | 量级/位置一致（参考点定义见 §3.3） |
| 俯仰脉冲力 | -6200 N，x=+0.95 m；峰值 pitch 0.2733° | 6200 N、前方 0.95 m | 一致 |
| 零姿态俯仰力矩 | 0/0/-6880.45 N·m（Node 与 test [11] 一致） | -6880.45 N·m | 一致 |
| 垂向脉冲绕 z 力矩 | 0/0/-1086.30 N·m | README 未提，且称“在质心处” | 文档错误，见 §3.3 |
| 侧倾脉冲力矩 | 3780/0/-670.95 N·m | README 未提 | 与参考点定义一致 |
| 低附着 β | 14.106°，tanβ=0.2513 | 约 0.251 | 一致 |
| 默认 Ixx/Iyy/Izz | 264.64/1416.62/1250.34 | 约 265/1417/1250 | 一致 |
| 线圈刚度 | 525.9/1525.0 N/mm | 约 517/1525 | 前轴不一致，见 §3.5 |

### 2.5 自检的真实性与失败可见性

- 默认：静力 14/14、动态 10/10；第一次打开“？”得到 24 条；第二次打开不增加运行次数（selfTestRuns 仍为 static 1/dynamic 1）。
- 构造合法滑块组合 mass=600、wheelRateF/R=320、dampingF/R=1.2：动态自检 9/10，“垂向脉冲衰减 4.84 → 0.00 mm”失败（峰值小于 5 mm 判据）；页面摘要“23 / 24 项通过”、列表出现 is-fail 项、#selfTestStatus 显示“动态 9 / 10”、#checkList 的 dynamicTests 行 is-warn。说明自检不是恒真，失败也能显示。
- 参数变化后静态自检会按 SETUP_KEYS 失效并重算（static runs 1→2、2→3），但动态自检只在打开模型说明且缓存失效时重算（见 §3.2）。
- 在 §3.1 的故障态（CG 0.50 + 求解失败）中，动态自检仍 10/10、静态 14/14，页面可显示 24/24；这是自检与“活状态”脱节的直接证据，见 §3.2。

### 2.6 导出/持久化/移动端（已核实部分）

- 复制 JSON：正常、降级、失败三条路径均正确；内容完整，未混入 DOM/闭包状态；exportedAt 为 ISO 字符串。
- 截图：见 §2.3；1440×813 图见 artifacts/screenshot-1440.png，390×844 竖屏见 artifacts/screenshot-390-portrait.png；构图正常、卡片不出界、姿态/载荷数字与快照一致（竖屏截图相机 preset 为 portrait）。
- localStorage 键为 fs01.dynamic.setup.v1：修改后的 26 个参数与刷新后一致；损坏 JSON、越界/错误类型、旧版多余键、Storage.setItem 抛错都能安全恢复/继续运行，无页面异常；越界值被 clamp、未知键被丢弃、缺失键用默认值补齐。
- 恢复默认：一轮修改后点击“恢复默认”，state 与 DEFAULTS 逐键相等，localStorage 写回默认 JSON，单位回到 N、xray/标注复位、相机回 threeQuarter、autoRotate 关闭、sim 重新运行；这是正常路径下的完整复位（异常后的复位见 §3.4）。
- 竖屏：390×844 重新加载后相机 preset=portrait；参数抽屉打开后（等待过渡完成）rect 为 left=10/right=380，遮罩显示；抽屉可滚动到 1072 px，底部截图/复制按钮可达；质量滑块 798→820 kg 生效；遥测抽屉与参数抽屉互斥（参数面板 inert）；单位 kg 显示“820.0 kg / 186.5”；单指拖动改变 theta（0.3659→0.260）；帮助模态 rect 366×769 完整落在视口内、24 项列表、背景 inert；全流程 pageErrors 为空。
- 参数/相机刷新行为：参数全部恢复，但相机回到 threeQuarter 透视。README 只声明“参数保存在 localStorage”，未声明相机持久化，因此这是声明范围外的限制，不是缺陷（§4.3）。

## 3. 发现（按严重度）

### 3.1 P1：改变质心高度会瞬移车身参考点、污染转向齿条标定，并使“重置姿态”失去静力平衡

严重级别：P1（高）。置信度：高（本报告与 Lead 两个独立会话复现，数值一致）。

#### 3.1.1 复现（最小步骤）

1. 打开 index.html（Chrome 156），等待 ready；暂停，点击“重置姿态”或让 resetDynamics({settle:1.5}) 结束，确认 cgHeight=0.30、四角载荷 1780/1780/2132/2132 N、heave≈0、rack≈0。
2. 保持暂停，把“质心高度”滑块从 0.30 拖到 0.35 / 0.40 / 0.45 / 0.50（真实 input 事件）。
3. 读取 FSApp.getSnapshot()；随后点击“重置姿态”，再读快照；可再改质量 850 kg 触发一次重新标定，观察恢复。

自动化脚本：.tmp-review/integration/recovery.mjs、cgheight-deterministic.mjs；原始结果 recovery.json、cgheight-deterministic.json。

#### 3.1.2 实际 vs 期望

| 操作 | 期望（README 承诺/物理） | 实际 |
| --- | --- | --- |
| 0.30→0.35（暂停平衡态） | 车身参考点不动；仅 CG 高度/视觉 CG 标注变化；水平载荷不变 | 参考点下移 50 mm，四角行程 50/50/50/50 mm，载荷 8.16/8.16/15.82/15.82 kN；solverOk=true，warning 仍隐藏 |
| 0.30→0.40 | 同上 | 下移 100 mm，载荷 14.70/14.70/42.18/42.18 kN；solverOk=true，warning 仍隐藏 |
| 0.30→0.45 | 同上 | 下移 150 mm，载荷 20.17/20.17/82.29/82.29 kN；solverOk=true，warning 仍隐藏 |
| 0.30→0.50 | 同上 | 下移 200 mm；载荷 29.78/18.73/122.21/122.21 kN；rack=-120.0 mm、tieRodStretch=53.808 mm、solverState=failed、badge 才显示 |
| 0.50 后点“重置姿态” | 回到当前参数的静力平衡，载荷 1780/1780/2132/2132，rack≈0，tieRod≈0 | 四角载荷 1780/4654/2132/2132 N；rack 仍 -120.0 mm、tie 52.092 mm、solverState=failed；推进 1 s 后 779/2715/3125/1207 N、heave 6.30 mm、pitch 0.206°、roll -0.244°，仍非静力平衡 |
| 0.50 后改为 mass=850 kg 再重置 | — | rack 回到 0.42 mm、tie≈0、solverState=ok、载荷约 1899/1894/2269/2274 N（明显恢复） |

另外，Lead 在另一会话用同一真实 UI 路径独立复现：0.35 为 8.16/15.82 kN（50 mm 行程）、0.40 为 14.70/42.18 kN（100 mm）、0.45 为 20.17/82.29 kN（150 mm）、0.50 为 29.78/18.73/122.21/122.21 kN（200 mm）；并且运行中 0.30→0.50 后 1 s 内出现 heave +453 mm、pitch 4.40°、四轮载荷 0，3 s 仍 +538 mm/9.45°。本报告暂停态数值与之一致；运行态数值由 Lead 提供，未在本报告脚本中重复。

#### 3.1.3 根因链（file:line）

1. src/js/40-app.js:115-120（refreshAll 的 stalePhysics 分支）在物理参数变化时调用 simRetargetReference(SIM, state)，随后用 simReferencePoint(sim) 计算齿条；但 simRetargetReference（src/js/05-body-dynamics.js:263-277）只替换 sim.reference，保留 sim.state。cgHeight 进入 cgBody.y（00-core.js:191-201/601），而 state 是质心坐标；旧 state 在新 cgBody 下对应 p = r_CG - R c 的参考点瞬间下移 ΔcgHeight（最多 0.3 m，见 0.30→0.50 的 -200 mm）。
2. 同一路径 src/js/40-app.js:119 立即调用 calibrateRack(SIM, state.steer)；calibrateRack（40-app.js:39-51）用 simReferencePoint(sim) 的异常姿态调用 suspRackForSteer；后者在 src/js/03-suspension.js:559-587 把齿条限制在 ±0.12 m。参考点下移 0.2 m 时，求解器找不到使前轮平均转角为 0 的齿条位置，直接饱和到 -0.12 m。
3. simReset（src/js/05-body-dynamics.js:225-256）和 UI 的 simulationReset（src/js/30-ui.js:225-239）只重置车身状态/参考模型，不重新计算 rackShift；因此“重置姿态”后车身虽然回到平衡，转向齿条仍停在 -120 mm，横拉杆被拉开 52 mm，四角力不再对称。
4. FSApp.resetDynamics（src/js/40-app.js:444-459）同样只 simReset，不重标定齿条；processPendingRebuild（src/js/40-app.js:71-105，77 行 simReset settle 0.5、80 行 calibrateRack）在重建时先以旧 rack 做 settle，再标定新 rack；标定后没有第二次 reset，导致“恢复默认”后仍可能保留失败锁存/非对称载荷（见 §3.4）。
5. 诊断缺口：solverOk 由 solved.ok 组成（05-body-dynamics.js:1111），但 refreshChecks 的 steerOk 只看 tieRodStretchMm<5（30-ui.js:770-772），warning 详情只统计 rockerFeasible/残差（30-ui.js:1030-1033），所以 0.50 故障态显示“求解失败：0 个角点不可达 / 最大残差 0.000 mm / 运动比不可用 0 角”，与“横拉杆 53.808 mm”同时出现，用户无法从 warning 得知真实原因。0.35–0.45 的 8–82 kN 载荷也没有任何“载荷超范围”警告，直到 0.50 求解失败才出现 badge。

#### 3.1.4 影响

- 参数链路：质心高度是 README/DESIGN 明确列出的可调参数；在正常暂停态改变它会导致车身瞬间下沉 50–200 mm、载荷放大 4.6–68 倍（82 kN），运行态可导致车辆“飞起”（Lead 复现 heave +453…538 mm、pitch 4.4–9.45°、四轮卸载），且 3 s 内不恢复。
- “重置姿态”承诺失效：README 第 94 行“放回当前路面和参数下的静力平衡姿态”在 0.50 后不成立；载荷 1780/4654/2132/2132 N，继续演化到 779/2715/3125/1207 N，转向齿条 -120 mm、横拉杆 52 mm。
- 结果可信度：截图/复制 JSON 会记录这些异常载荷和姿态；页面自检仍可 24/24（见 §3.2），用户没有明显阻断信号。
- 视觉：artifacts/cgheight-bug-0.50-front.png 显示故障态车身沉入台面、四角载荷 29,780/18,733/122,207/122,207 N、h -200 mm；cgheight-bug-after-reset-front.png 显示重置后前右 4,654 N、ΣN 10,699 N 的卡片（均为 1440×813 实际导出）。

#### 3.1.5 建议修复方向

1. 保留参考点而不是保留质心：在 refreshAll 的物理参数分支中，若 cgBody 改变（cgHeight/cgLateral/frontWeightPct），先把 sim.state 平移 R(q)·(c_new - c_old)，使 simReferencePoint(sim) 不变；再 simRetargetReference，最后重标定齿条。这样 CG 高度只改变质心位置/惯量语义，不会瞬移车身。
2. 在正确的姿态标定齿条：calibrateRack 不应使用当前瞬态 simReferencePoint，而应以新参考的静力平衡姿态（simEquilibriumState/reference）为输入；或至少在 simReset/resetDynamics/processPendingRebuild 的 settle 完成后重新标定并再次 reset。
3. 重标定后清理求解锁存：sim.solverFailed/solverDegraded/solverFailureSteps 在成功评估时应允许清除，或在重标定/重置时强制清除；否则“恢复默认”后 badge 仍显示失败（§3.4）。
4. 诊断可见：求解失败/降级时把 tieRodStretchMm、rackTravelMm 和 solverOk 原因写入 warning；对 max(loads) > 2× 静态或 |travel| > 25 mm 增加“载荷超范围”提示；不要等求解失败才提示。
5. 回归用例：暂停/运行两种状态下 cgHeight 0.30→0.35→0.40→0.45→0.50，断言参考点位移 <1 mm、四角载荷 <2× 静态、|rack|<5 mm、tieRod<1 mm；再点“重置姿态”断言四角与 levelLoads 差 <1 N、solverState=ok；再点“恢复默认”断言 badge 隐藏、warning 隐藏、solverFailed=false。建议加在 tools/test-dynamics-browser.mjs（目前没有 cgHeight UI 测试，见 §4.1）。

### 3.2 P2：自检语义与文档承诺不一致，且活状态故障可被 24/24 掩盖

严重级别：P2（中）。置信度：高。

#### 3.2.1 文档承诺 vs 实际

- README.md:188：“打开‘？’模型说明时重新运行动力学自检；参数变化后遥测中的‘动态自检’显示最近一次结果。”DESIGN.md:640 同样写“打开模型说明时重新运行动力学自检”。
- 实际 ensureDynamicSelfTests（src/js/30-ui.js:508-534）在缓存 revision 未变时直接返回缓存；openModelModal（30-ui.js:467-480）调用 refreshSelfTests()（默认 force=false）。实测：首次打开 modal dynamic runs 1，关闭后再打开仍为 1；参数不变时不会“重新运行”。
- 参数变化后 ensureStaticSelfTests 会清空 selfTestCache.dynamicTests（30-ui.js:493-506），但保留 UI.dynamicTests 旧数组；refreshChecks 用 cached || UI.dynamicTests（30-ui.js:762）继续显示旧动态结果。实测把动态结果从 10/10 变成 9/10 的极端组合后，改 mass 700，遥测 #selfTestStatus 仍是“动态 9 / 10”、摘要仍是“23 / 24”，而 selfTestRuns.dynamic 未变；直到再次打开 modal 才重算（dynamic 2→3）。这与“显示最近一次结果”字面一致，但 UI 没有“来自旧 revision”的标记，容易被读成当前参数通过。
- 更关键的是活状态盲区：在 §3.1 的 0.50 + 重置姿态故障态（badge=“求解失败”、rack -120 mm、tie 52 mm）中，runDynamicSelfTests() 仍返回 10/10、runSelfTests() 仍返回 14/14，页面可显示 24/24。原因是自检在 05-body-dynamics.js:1162-1294 使用 simCreate(source, ...) 新建独立 sim（rackShift=0），并大量覆盖 slope/bank/arb 等固定探针；它们验证的是模型/求解器不变量，不是当前 live sim 的齿条/接地点/求解状态。这解释了为什么 P1 的严重故障没有被自检捕获。
- 自检并非恒真：合法组合 mass=600、wheelRateF/R=320、dampingF/R=1.2 使“垂向脉冲衰减”以 4.84 mm < 5 mm 判据失败，页面显示 23/24、列表 is-fail、行 is-warn；在 Node 中 404 组 UI 可达静态组合全部 14/14（静态检查是固定探针），而动态对若干极端组合会出现 1–2 项失败。失败路径本身是通的，问题是它不覆盖活状态且判据存在边界脆弱性。

#### 3.2.2 影响

- 文档把“打开说明=重新运行”写成事实，用户/验收者会误以为每次打开都在验证当前参数。
- 24/24 与“求解失败”badge 可同时出现，削弱自检作为验收信号的信任度；P1 这类故障会被自检“放行”。
- 极端但合法的滑块组合会让页面显示 23/24，文档未说明这是允许的参数边界现象还是缺陷。

#### 3.2.3 建议修复方向

1. 二选一：把文档改为“首次打开/参数 revision 变化后按需运行，参数未变时复用缓存”，或在 openModelModal 中以 force:true 运行（动态自检约 215 ms/10 项，已有 bench 证据，需接受打开延迟）。
2. 在遥测摘要/行中显示 dynamicRevision 与 setupRevision 的比较（“当前参数未验证”/“结果来自上一 revision”），或参数变化时清空 UI.dynamicTests 并显示“待重新运行”。
3. 在 24 项之外增加 live 检查（不替代模型自检）：solverState、rackTravelMm、tieRodStretchMm、最大载荷/行程，纳入摘要或在 #checkList 已有行（sim/steer）中明确失败原因；至少不要让 24/24 与 failed badge 同时无解释地出现。
4. 复核动态检查阈值/收敛时间：4.84 mm vs 5 mm、2.5 s/4 s settle 在低刚度/高阻尼边界会误报；建议改为相对阈值或延长 settle，并在文档说明合法边界下的预期结果。
5. 为“打开说明不再重跑”“参数变化后结果陈旧”及“故障态 24/24”各补一条浏览器回归。

### 3.3 P2：README 将垂向脉冲描述为“在质心处”，与实现/DESIGN/测试矛盾

严重级别：P2（中，文档物理断言错误）。置信度：高。

- README.md:95：“垂向脉冲 | 在质心处施加 0.12 s 的向下 6800 N 力，激励升沉和俯仰”。
- 实现 src/js/05-body-dynamics.js:283-302 的 offset 定义为“相对车身参考点”的车体系偏移：heave offset=[0,0,0]，进入 simEvaluate 后力臂为 offset - cgBody（05:491-499）。默认 cgBody=(-0.15975,0.30,0)，因此 heave 力实际作用在车身参考点，绕质心产生 (0,0,-1086.30) N·m 的俯仰力矩；Node 探针与 tools/test-dynamics.mjs [11] 都断言 -1086.30。若真在质心施加纯垂向力，该力矩应为 0，也不会有 README 同句所说的“激励俯仰”。
- DESIGN.md:632 已写清楚“作用点按相对车身参考点的车体系偏移定义，绕质心力臂为 offset - cgBody”，与 README 冲突。
- 影响：用户按 README 预期做“纯垂向”验证会得到额外俯仰；-6880.45 的俯仰脉冲力矩则正确（offset 0.95 m、F 6200 N、lever x=1.10975 m）。
- 修复：把 README 改成“在车身参考点处施加……（绕质心产生 -1086.30 N·m 俯仰力矩）”并明确 heave 不是纯垂向；若希望纯垂向，改为 offset=cgBody（并同步更新 test [11] 的 heave 力矩断言/文档）。侧倾脉冲同样应说明“相对车身参考点向右 0.90 m”，其力矩为 3780/0/-670.95 N·m。

### 3.4 P2：异常后“恢复默认”不能完全清除失败状态（与 §3.1 同源）

严重级别：P2（中）。置信度：高。

- 复现：先按 §3.1 制造 cgHeight=0.50 故障态；点击“恢复默认”（30-ui.js:256-270 → 40-app.js 重建）。
- 实际：state 已逐键等于 DEFAULTS（好）；但 sim.solverFailed=true、badge 仍显示“求解失败”、warning 仍可见；时间 0.756/1.524/2.036 s 时四角载荷约 1783.0/1777.7/2129.5/2135.5 N（前轴左右差约 5.3 N、后轴约 6 N），而不是默认 1780.3/1780.3/2132.5/2132.5。再点一次“重置姿态”后 solverFailed=false、badge 隐藏、载荷约 1785.4/1775.4/2132.5/2132.5（仍有约 10 N 的前轴差，rack 0.418 mm；属于 mm 级转向残差，但比正常默认大）。只有再改参数或再 reset 才恢复。
- 根因：processPendingRebuild（40-app.js:71-105）先 simReset(SIM,state,{settle:0.5})（77 行）再 calibrateRack（80 行）；settle 时仍使用旧 rack（-120 mm），会进入 degraded 并锁存 solverFailed；随后标定修正 rack，但没有第二次 reset，也没有清除 solverFailed（05-body-dynamics.js:805-812 只在后续连续健康时清 solverDegraded，不清 failed）。simReset 清锁存发生在错误 rack 下的 settle 之前。
- 影响：“恢复默认”是文档承诺的复位入口；在故障后它留下“求解失败”标签和非对称载荷，用户需要第二次操作才真正恢复。与另一条“solverFailed 锁存/文案矛盾”条目重叠，本报告只从“恢复默认是否彻底”角度记录。
- 修复：重建顺序改为“先标定（用新几何/平衡姿态）→ simReset → settle”；或在 settle 后再次 reset；重标定成功后显式清 solverFailed/solverFailureSteps；为“故障→恢复默认→无 badge/无 warning/载荷对称”加回归。

### 3.5 P3 清单（低严重度/文档与体验）

| # | 问题 | 位置 | 证据 | 影响/修复 |
| --- | --- | --- | --- | --- |
| 1 | README/DESIGN 称线圈刚度约 517/1525 N/mm，实际前 525.9 N/mm | README.md:147；DESIGN.md:597 | Node/snapshot springRateCoil[0]=525885.1 N/m；后轴 1525.0 一致 | 数值过时；改为 526/1525 或解释取整口径 |
| 2 | 截图右下角写“DESIGN.md v0.2”，与 0.3.0 不一致 | src/js/40-app.js:281 | exports.json 的 texts 含该字符串；screenshot-1440.png 可见 | 截图元数据过时；改为 v0.3 或移除版本号 |
| 3 | 前轮转角 UI 写“仅机构展示”，但实测通过前悬架运动学改变四角载荷约 ±101/±116 N | src/index.template.html:264；README.md:147 又承认运动比随转向变化 | features.json steer 记录：rack -0.036→-19.100 mm；载荷差 [-101.1,+102.1,+115.9,-116.9] N；pitch 0.0148°、roll -0.0298° | 措辞改为“只驱动机构，不产生轮胎侧向力；经运动比会影响前悬架载荷” |
| 4 | DESIGN 20.6 称参数面板新增“运动比”区，实际无运动比输入，只有遥测显示 | DESIGN.md:632 | 模板控件清单无 motionRatio；features.json 只有 dynRatio 遥测；README:147 说运动比不再是输入 | 删除“运动比”或改为“遥测显示” |
| 5 | 暂停/继续语义：暂停后点脉冲/重置会自动恢复运行 | src/js/05-body-dynamics.js:300（脉冲置 running=true）；src/js/30-ui.js:233（重置置 running=true） | features.json 三个脉冲 runningAfterClick=true；resetButton post.running=true | 文档未提；“暂停时仍可观察”与自动恢复有冲突；要么保持暂停，要么在按钮文案/README 说明 |
| 6 | “归零路面”/水平 preset 只清 slope/bank，不清 friction；lowGrip 后点水平仍 μ=0.20 | src/js/30-ui.js:144-152、166-176、1171-1172 | features.json lowGrip 后 state.friction=0.2；点击水平后 friction 仍 0.2，level chip 激活 | 预设名“路面”只含姿态，但 chip 激活只看角度，易误读；明确“水平只重置倾角”或同时重置 μ |
| 7 | getSnapshot().selfTests 只有 14 项静态；24 项需另开 modal/动态 API | src/js/40-app.js:312、376 | boot 快照 staticTests=14；runDynamicSelfTests() 另返回 10 | README:239 的“页面自检和动力学测试…读取”可被读成同一调用返回 24；补一句 API 说明 |
| 8 | README 的动力学自检顺序与实际实现顺序不同 | README.md:207-218；05-body-dynamics.js:1162-1294 | 实际顺序 level/tilt/heave/ARB/determinism/frame/slide/loads/hold/reverse；README 把 loads 列第 3、heave 第 4… | 逐项语义一致但“逐项”字面/阅读顺序不符；按实际顺序重排 |
| 9 | 验收报告“分支/HEAD”仍写 WIP 提交 cbed2d6，当前 HEAD 为 45983ca | docs/plan/acceptance.md:6 | git rev-parse HEAD=45983ca；文档称定稿 | 更新最终 HEAD，或明确该表为历史 WIP 快照 |
| 10 | README 文件结构漏列 src/js/03-suspension.js | README.md:267-302 | 实际文件存在且被 test-core/test-dynamics 加载；DESIGN 20.9 有列 | 补一行，避免读者漏掉机构求解器 |
| 11 | setText('bodyHeave',...) 目标 DOM 不存在 | src/js/30-ui.js:961；模板无 bodyHeave id | 模板 id 清单无 bodyHeave；无可见影响 | 删除死代码或补元素；清理项 |
| 12 | 加/减速/脉冲的载荷没有“载荷超范围”提示（0.35–0.45 的 8–82 kN 仍 hidden） | src/js/30-ui.js:1018-1049 | recovery.json 中 0.35–0.45 warningHidden=true | 与 P1 同源；建议加负载荷/行程包线警告 |
| 13 | 相机不持久化：刷新后从 top 回到 threeQuarter | README.md:238 只承诺参数持久化；session.json reload | 刷新后 camera preset=threeQuarter；参数一致 | 不是 README 过度声明；若产品期望“刷新后相机一致”，需补实现或声明 |
| 14 | 静态自检在 404 组 UI 可达组合中始终 14/14；固定探针不可被当前参数触发失败 | 00-core.js:647-749；probe-physics.json search | 404 组、含极端组合均无失败 | 不是缺陷（模型不变量），但说明它不能替代 live 校验；文档应说明“模型自检 vs 当前工况” |

## 4. 测试与文档缺口

### 4.1 自动化测试缺口（证据为仓库 grep）

- 没有针对复制参数、PNG 截图、localStorage、恢复默认、路面预设、单位切换、前轮转角、质心高度的断言：
  - grep -rn 'copyConfig|exportScreenshot|localStorage|btnResetAll|btnLevelSnapshot|data-road-preset|btnCopyConfig' tools tools/audit tools/audit-browser 仅命中 tools/capture-docs.mjs:155 调用 exportScreenshot()（无内容断言），其余无。
  - cgHeight 仅出现在 Node 随机包线/自检固定探针中（test-core.mjs:104/122、test-dynamics.mjs:266、test-runtime.mjs:173），没有任何浏览器 UI 路径测试——这正是 §3.1 未被发现的原因。
- 动态 6 按钮中，浏览器测试只验证存在性：tools/test-dynamics-browser.mjs:136 的 buttons 数组仅做 getElementById 存在性检查；只有 btnSimToggle 被点击（:58/:63），btnSimReset 仅在 UI 测试 :317 点击一次，没有断言重置后的静力平衡/rack/时间；btnImpulseHeave/Roll/Pitch、btnSimSettle 的点击路径没有回归。
- 自检测试覆盖“能运行/能通过/列表 24 条”（test-ui-browser.mjs:352-364），但没有覆盖“第二次打开不重跑”的文档承诺、参数变化后的 stale row、或“故障 live 状态仍 24/24”；没有一条测试会让动态自检失败（我们构造的 9/10 组合未入库）。
- 没有测试导出图片的内容、PNG 尺寸/构图、kg/暂停状态、文件名；没有测试 localStorage 的损坏/越界/旧版/存储拒绝；没有测试“恢复默认是否逐键等于 DEFAULTS 且清除 badge”。
- 没有 cgHeight/极值载荷的浏览器断言；没有“运行中改 cgHeight 后 1/3 s 的 heave/pitch/载荷”回归（Lead 的复现说明这是可达路径）。
- 没有测试参数变化时避免参考点瞬移（§3.1 根因）；没有测试重标定后清 solverFailed。

### 4.2 文档与验收缺口

- README:188/DESIGN:640 的“打开模型说明重新运行动力学自检”与缓存实现不符；README:95 的“质心处”与 DESIGN:632/测试 [11] 不符；README:147/DESIGN:597 的 517 N/mm 与实测 525.9 不符。
- DESIGN:632 的“参数面板新增运动比”已过时；README 文件结构漏 03-suspension.js；acceptance:6 的 HEAD 为 WIP 提交；截图内部版本号为 v0.2。
- README 的 24 项列表名称逐项可对应，但动态顺序与实现顺序不同；若“逐项一致”按展示顺序理解则不成立，建议按实际顺序列出或注明“顺序不分先后”。
- acceptance 的 teardown/动量能量缺口已被 b6-final-review 记录，本报告不重复；但 acceptance 的“通过”行仍依赖这些未断言项，签署时应保持“有条件通过”的措辞（当前文档已如此）。
- 对“合法参数下动态自检失败（23/24）”没有文档解释，用户可能误认为产品缺陷；应说明自检的适用范围/阈值。

### 4.3 覆盖与统计备注

- 本报告未独立重跑完整 Node/浏览器套件；全量计数以 Lead 基线为准（50/50+80/80、27/27、78/78、45/45、26/26、19/19、51/51、build:check 668c59ea…）。本报告独立运行的是 Node 物理/自检探针（动态自检约 0.25–1.2 s/组）、无头 Chrome 页面实验（CG 高度、控件、导出、持久化、竖屏）。
- features.json 的 before/after 均在每次重置后读取；载荷的 ±0.3 N 差异来自动力学 settle 残差，不作为控件有效性的反例。
- 截图证据的尺寸/文本由页面内 fillText/toDataURL 探针和人工查看 PNG 双重确认；未使用 OCR。

## 5. 覆盖限制

1. 无头 Chrome 的 rAF 节流：部分会话 requestAnimationFrame 约 1 Hz，导致依赖 animate 的 DOM 标签、CSS 抽屉过渡在 400 ms 时仍处于起始状态（例如 390×844 首次测量 panel left=-400，强制 Page.captureScreenshot/advanceSimulation(0) 后为 left=10、right=380）。这不是移动端布局缺陷；所有涉及动画/标签的结论均已排除该伪影。
2. 未运行 build：遵守“不运行 npm run build/不重写 index.html”的约束；版本/产物一致性依赖 Lead 的 build:check 基线和本轮只读 hash 核对。未在干净检出中复跑全部命令。
3. 剪贴板/下载为桩：复制路径通过覆盖 navigator.clipboard.writeText/document.execCommand 捕获文本；截图通过覆盖 toDataURL/HTMLAnchorElement.click 捕获 PNG，未验证真实文件落盘/系统剪贴板权限，但验证了应用层 payload 与导出内容。
4. 触控只做单指轨道拖动：未验证双指缩放、长按、右键/中键平移、滚轮以光标为中心；这些属于相机/UI 审阅流，本报告只确认单指可用。
5. 移动端为 DevTools device emulation：390×844、DPR=1、重新加载以命中 portrait 相机；未在真实手机/安全区/软键盘下验证。
6. 自检失败/静态搜索为有限样本：静态 404 组随机+极端组合、动态 7 组极端组合；未做全参数笛卡尔穷举，也未证明“静态自检永远无法失败”，只证明在 UI 可达样本内未失败。
7. 与其它审阅流重叠：求解失败 badge 与 warning 文案矛盾、solverFailed 锁存由另一条负责；本报告在 §3.1/§3.2 只作为 CG 高度链与“恢复默认是否彻底”的侧证，建议合并时去重。
8. 时间/环境：Chrome 156、SwiftShader；Node v24.22.1；Node 18/20 与真实 GPU 未测（README/acceptance 已声明边界）。

## 6. 结论

- 0.3.0 在默认参数下的核心交互、动态试验数值、导出/持久化正常路径、竖屏基本功能和 24 项自检执行均成立；已声明修复（脉冲坐标、接地点、几何代际、自检缓存、UI 键盘/面板等）未见明显回归。
- 但存在一个 P1 参数链路缺陷：质心高度滑块会通过“保留质心、移动参考点”的 retarget 与“在异常姿态标定齿条”把车身瞬移 50–200 mm、放大载荷到 8–122 kN，并在“重置姿态”后留下 -120 mm 齿条和 52 mm 横拉杆残差；运行态可由 Lead 复现为车辆飞起且 3 s 不恢复。该缺陷未被现有自检/浏览器测试覆盖，且自检仍可显示 24/24。
- 另有 P2：自检“重新运行”文档承诺不实、参数变化后动态结果陈旧、活状态故障可被 24/24 掩盖；README 垂向脉冲“质心处”与实现/DESIGN/测试矛盾；恢复默认在异常后不能完全清除失败锁存。
- 建议先修 P1（参考点保持 + 齿条重标定 + 清锁存 + 载荷包线警告 + 回归用例），再修 P2 的文档/自检语义；P3 数值/文案/顺序问题可在同一 docs 提交中批量收敛。

---

审阅者：integration-reviewer（task-5）
日期：2026-11-19
证据根目录：.tmp-review/integration/
