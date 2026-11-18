# 分册 05：回归测试矩阵与基线审计工具

| 项目 | 内容 |
| --- | --- |
| 适用版本 | 0.2.0（提交 fbb401d） |
| 修订 | r2（2026-11-19），按分册 06 的 P0/P1 裁决回改 |
| 所属批次 | B0 全部；B1-B4 的测试交付 |
| 上游依据 | 主册第 4、5、7 节；A/B 报告；复核事实 1-12；分册 01、02 的接口与验收 |
| 交付文件 | docs/plan/parts/05-regression.md |
| 约束 | 单文件离线、零运行时依赖、Node >= 18、不改 src/ 与 index.html |

## 1. 范围说明

### 1.1 目标

本分册解决三个问题：把 12 项已确认缺陷固化成可复现、可判定的审计脚本；为每条缺陷建立"修复前红、修复后绿"的回归断言；规定 Node、构建、浏览器三层测试的执行边界，使后续物理重构不再以"现有测试全绿"作为正确性证据。

### 1.2 与其他分册的边界

分册 01 负责质心积分、求解器协议与种子所有权；02 负责 HOLD/SLIP、脉冲坐标与接地点；03 负责帧时间、几何代际与资源生命周期；04 负责界面与工具链。本分册只定义验证方法、观测指标、脚本骨架和验收阈值，不实现修复。审计脚本与业务修复必须分开提交，保证修复前的失败基线可追溯。分册 01、02 已经给出各自工作项的验收条目，本分册负责把它们落成统一入口、结构化输出和 CI 编排；两处阈值如有冲突，以分册 01、02 的物理判据为准，本分册只补充脚本实现细节。

### 1.3 不在本分册范围

不迁移测试框架，不引入 Playwright、Jest、Vitest 等依赖；本轮不把全局脚本改成 ES Modules；不做像素级截图比对；不以浏览器性能数据作为物理正确性的判据。单文件离线交付、零运行时依赖、Node >= 18 的约束不变。

### 1.4 判定原则

1. 每条断言必须有独立判据：解析解、几何可达性、坐标变换或守恒量，不能把当前实现的输出当作标准答案。
2. 每条缺陷至少一个断言在 fbb401d 上失败；修复后同一断言通过。只在修复后新增的"验证性断言"不计入回归。
3. 阈值带单位、可复算，集中在文件顶部的常量区；断言内不写魔法数字。
4. 测试只读源码；需要新增探针时，探针与修复同批提交，并在本分册登记。
5. 失败信息包含实测值、阈值和单位，便于从 CI 日志直接定位。

## 2. 现有测试覆盖映射

### 2.1 三层现状

| 层 | 命令 | 数量 | 当前结果 | 说明 |
| --- | --- | ---: | --- | --- |
| 静力 Node | npm run test:core | 47 | 全绿 | computeStatic 的平衡、包线、告警 |
| 动力学 Node | npm run test:dynamics | 52 | 全绿 | 六自由度、机构、脉冲、滑移、帧率 |
| 浏览器动力学 | npm run test:browser | 26 | 全绿（需 Chrome） | 真实页面、DOM、场景探针 |
| 浏览器相机 | npm run test:camera | 20 | 全绿（需 Chrome） | 轨道、缩放、正交预设 |

### 2.2 静力 47 项的映射

| 小节 | 数量 | 现有断言 | 邻近缺陷 | 覆盖判定 |
| --- | ---: | --- | --- | --- |
| [1] 内置自检 | 2 | 14 项自检数量与通过率 | — | 仅健康检查 |
| [2] 水平参考 | 6 | 总法向、前轴比、姿态、力矩、ARB、残差 | — | 只验证静力模型 |
| [3] 坡道/侧倾 | 20 | 4 组工况 × 5 项平衡与告警 | B4.3 | 不含低速与状态转换 |
| [4][5] 载荷转移与质量缩放 | 4 | 上坡向后、右倾向右；双倍质量载荷与轴荷比 | — | 方向性与线性检查 |
| [6] ARB 再分配 | 4 | 前/后杆横向转移与滚转刚度 | — | 静力等效杆 |
| [7] 告警可达性 | 6 | 低附着摩擦告警、离地原始负载 | B4.3 | 只验证告警，不验证停止 |
| [8] 随机包线 | 3 | 3000 组有限、平衡、接地 | B4.1 | 静力随机，不触达动态求解 |
| [9] 确定性 | 2 | 同输入载荷与姿态逐位一致 | — | 静力确定性 |

### 2.3 动力学 52 项的映射

| 小节 | 数量 | 现有断言 | 邻近缺陷 | 覆盖判定 |
| --- | ---: | --- | --- | --- |
| [1] 派生参数 | 5 | 惯量、频率、阻尼、设计运动比、弹簧刚度 | B4.1 | 只验证设计点 |
| [1b] 机构运动学 | 8 | ±25 mm 闭合、接地点共面、压缩/伸张、运动比为正、齿条、遥测、轮位 | B4.1、B4.5 | 准静态采样，不覆盖动态不可达 |
| [2] 水平动态平衡 | 6 | 载荷、姿态、静摩擦保持、接地 | B4.2 | 从平衡姿态启动，掩盖漂移 |
| [3] 倾斜面收敛 | 16 | 4 组工况 × 载荷/总法向/非负/接地 | B4.3 | 无低速、无状态转换 |
| [4] 防倾杆动态 | 2 | 垂向无 ARB 力；硬杆抑制侧倾 | B4.4 | 只有侧倾脉冲，无横摆 |
| [5] 脉冲与阻尼 | 3 | 垂向响应、阻尼衰减、有限性 | B4.2 | 只有垂向，无自由旋转 |
| [6] 确定性与定步长 | 4 | 60/144 Hz 同时间、同状态、累积不超一步 | B5.1 | 未测 10/5 Hz 与丢时 |
| [7] 驻车与滑移 | 4 | 8° 保持、低附着滑移、高附着保持 | B4.3 | 无 0.5 mm/s 与单步过零 |
| [8] 随机包线 | 2 | 120 组有限、非负载荷 | B4.1 | 只检查有限性，不检查残差 |
| [9] 动态自检 | 2 | 10 项（B2-1 后）、全部通过 | B5.3 | 自检本身未纳入回归判据 |

### 2.4 浏览器 26 项与相机 20 项的映射

| 组 | 数量 | 现有断言 | 邻近缺陷 | 覆盖判定 |
| --- | ---: | --- | --- | --- |
| 启动与实时状态 | 6 | FSApp、500 Hz、水平载荷、四轮接地、位移、遥测条 | — | 冒烟 |
| 暂停/继续 | 3 | 时钟停止、按钮文案、恢复推进 | U4 | 不检查 simDetail 文案 |
| 脉冲与场景 | 6 | 垂向位移、线圈长度、机构闭合、轮心高度、衰减、侧倾 | B4.1、B4.4 | 只有垂向/侧倾，无横摆 90° |
| 低附着滑移 | 2 | 平面状态释放、载荷有限 | B4.3 | 不覆盖低速死区 |
| 复位与参数 | 3 | 回到水平设计状态；阻尼更新、状态有限 | — | — |
| 动态自检 | 2 | 10 项（B2-1 后）自检可运行且通过 | B5.3 | 不检查周期自检开销 |
| 按钮 | 1 | 六个动态按钮存在 | U2 | 不测键盘激活 |
| 几何重建 | 1 | 轴距 3.70 m 后接地 | B5.2 | 未测 rebuild=false 与代际混用 |
| 弹窗与页面错误 | 2 | 自检条目 ≥ 24；无异常与控制台错误 | B5.3 | 不测周期 DOM 重建 |
| 相机 | 20 | 预设、拖拽、滚轮、正交切换 | — | 与 12 项缺陷无交集 |

### 2.5 缺口结论

现有 99 项 Node、26 项浏览器、20 项相机检查全部通过，但对 12 项缺陷没有一条直接命中断言。原因有三类：测试从 computeStatic 的平衡姿态启动，掩盖了自由旋转与求解失败；测试只覆盖静态采样点或高帧率，未覆盖动态不可达、低速阈值与 10/5 Hz；Node 测试不装载渲染层，看不到每帧回写摇臂角种子。因此 B0 必须先建立独立的审计层，回归断言再按批次并入测试套件。自检数量按 R-06 冻结为静力 14 项加动力学 10 项共 24 项，浏览器动态断言 >=10、弹窗 >=24；README 第 19 行的 Node 动力学 45 项应改 52 项。

## 3. B0 工具规格

### 3.1 目录与共享模块

~~~
tools/
  test-harness.mjs
  audit/
    _harness.mjs, run-all.mjs
    audit-free-body.mjs, audit-rocker-reach.mjs, audit-friction-low-speed.mjs
    audit-impulse-frame.mjs, audit-contact-gap.mjs, audit-frame-time.mjs
    audit-seed-writeback.mjs, audit-shadowing.mjs          # audit-seed-writeback=O1；audit-shadowing=A2
    audit-browser-contract.mjs, audit-ui.mjs               # B5.2/5.3/5.4/O1；U1-U4/U6
    baseline/0.2.0.json
~~~

tools/test-harness.mjs 导出 loadThree()、loadPhysics(extraExports)、makeSetup(patch)、createChecker(title)、mulberry32(seed)。loadPhysics 内部维护与 build.mjs 相同的文件顺序（00-core、03-suspension、05-body-dynamics），只返回显式列出的 API，测试不直接依赖全局变量。若将来迁移到显式模块，只替换 loadPhysics 的实现，测试文件不改。

tools/audit/_harness.mjs 导出 createAudit(meta)，其 check(id, ok, metrics, threshold, detail) 记录结构化结果；finish() 向 stdout 输出单个 JSON 对象，向 stderr 输出人类可读行，退出码 0 表示全部通过、1 表示断言失败、2 表示环境或装载错误。JSON 结构固定为：

~~~json
{
  "schema": 1,
  "audit": "B4.1",
  "appVersion": "0.2.0",
  "checks": [
    {
      "id": "B4.1/rocker-residual",
      "ok": false,
      "metrics": { "maxResidualMm": 4.52, "peakDampingKN": 30.74 },
      "threshold": "maxResidualMm <= 0.1 and peakDampingKN <= 15",
      "detail": "converged with 4.52 mm closure error"
    }
  ]
}
~~~

B0 脚本定位的源码锚点：05-body-dynamics.js:206-208、415-464（质心与积分）、03-suspension.js:229-247、264（摇臂求解与种子）、22-car-dynamics.js:959-961（渲染回写）、05-body-dynamics.js:665（solverOk）、40-app.js:418（应用层帧截断）、20-car.js:175-187（几何释放）、30-ui.js:1015-1041（全局快捷键）。脚本用这些位置解释现象，不在断言里绑定行号。

### 3.2 Node 审计脚本

| 文件 | 缺陷 | 工况与输入 | 关键指标 | 修复前基线 | 通过判据 |
| --- | --- | --- | --- | --- | --- |
| audit-free-body.mjs | B4.2 / E1 | 关闭重力、角点载荷、弹簧/阻尼、ARB 与机构；初始角速度 (1,0,0) rad/s；积分 1 s | 质心最大漂移、参考点位移、角速度误差、四元数范数误差 | 质心漂移 287.66 mm；参考点位移 0 | 质心漂移 ≤ 0.01 mm；参考点位移 287.66 ± 0.5 mm；角速度误差 ≤ 1e-9 |
| audit-rocker-reach.mjs | B4.1 / E2-E4 | 600 kg、前后 50 N/mm、阻尼比 0.05、ARB 0；1.5 s 稳定后俯仰脉冲；积分 2 s | 闭合残差、可达区间下界、运动比极值、阻尼峰值、converged 与残差组合 | 残差 4.02 mm、运动比 -4.20、阻尼 30.7 kN、可达下界 709.40 mm > 目标 707.83 mm；R-01 重定后重测 | frame.converged 时残差 ≤ 0.1 mm；不可达但 ok 的样本数为 0；阻尼峰值 ≤ 15 kN；运动比在 [0.2,0.8] 且逐步变化 ≤ 0.02 |
| audit-friction-low-speed.mjs | B4.3 / C-1-C-4 | 水平路 vx=0.0005 单步；vx=0.01 单步；8° 坡小扰动；10°/10° 滑移后切水平；容量边界 | 末速度、mode/HOLD-SLIP、位移、changes | 0.0005 时四轮摩擦为零且滑移；0.01 单步后 -0.017459 m/s；切水平后 5 s 仍 8.1e-4 m/s | 1 子步 abs(vx)<1e-12；4 子步 mode==='HOLD'；单步 0≤vx<1e-6；0.1 s 内重新驻车；changes 不超 2 |
| audit-impulse-frame.mjs | B4.4 / C-5 | 横摆 0/15/.../345° 共 24 姿态；俯仰、侧倾、复合姿态；对比有/无脉冲的力矩差 | 车体系与路面系 ΔM、模长、零力臂工况 | 横摆 90° 时当前实现把力矩放到错误轴（ΔMz≈0）；正确车体系 ΔM=(0,0,-6880.45) | 车体系 ΔM=(0,0,-6880.45)，abs(ΔMx)<1e-9、abs(ΔMz+6880.45)<1e-9；24 姿态全过；R-01 重定后全量重测 |
| audit-contact-gap.mjs | B4.5 / C-6-C-7 | 俯仰/侧倾 0/2/5/10°；默认俯仰脉冲（总时长 0.12 s，开始后 60 ms 采样）；8°/7° 倾斜与 10° 侧倾回退分支 | 两套接地点间距、contact.y、力矩分解复算 | 0° 即差 7.22 mm；10° 俯仰 178.81 mm；开始后 60 ms 差 8.53 mm | 间距 ≤ 1e-6 m；contact.y 绝对值 ≤ 1e-6 m；力矩分量差 ≤ 1e-6 N·m |
| audit-frame-time.mjs | B5.1 | 60/30/10/5 Hz 各 1 s 墙钟；另一组按应用层 50 ms 截断 | 推进时间、droppedTime、子步数 | 60/10/5 Hz 推进 1.0/0.8/0.4 s；截断后 5 Hz 为 0.25 s | 推进 + dropped 与墙钟差 ≤ 0.02 s；推进不足时 dropped > 0；60 Hz 推进 ≥ 0.98 s |
| audit-seed-writeback.mjs | O1 / E5 | 同一 B4.1 工况，60 Hz、每帧 8 子步、共 90 帧；A 组不回写，B 组每帧写 corner.angle，C 组把角种子毒化为 ±1.2 rad | 三组阻尼峰值、最终状态、运动比漂移 | A=33.38 kN，B=46.42 kN（复核报告 46.3 kN，+39%），C 与 A 明显不同；R-01 重定后重测 | B 与 A 最终状态逐位相同、峰值差 ≤ 1 N；C 与 A 差 ≤ 1e-6；A 峰值 ≤ 15 kN |
| audit-shadowing.mjs | A2 / E8 | 构造 friction=0.2 的模型，对比 reference.source 存在/缺失时的 capacity | capacity 比值、是否静默回退 | 缺失时 capacity 放大 7.0 倍 | reference.source 必须存在；缺失时抛出消息含 reference.source 的错误，不静默回退 |

### 3.3 浏览器审计脚本

| 文件 | 缺陷 | 方法 | 修复前基线 | 通过判据 |
| --- | --- | --- | --- | --- |
| audit-browser-contract.mjs | B5.2、B5.3、B5.4、O1 | CDP 启动页面；setState 尺寸；MutationObserver 观察自检列表；patch Material.prototype.dispose；对比一次推进与分块推进 | 3.90 m 轴距下场景轮位仍为 1.775 m（差 175 mm），旧硬点与新轮位杆长偏差约 104 mm；空闲 1 s 自检列表持续变更；一次重建 387 次几何释放、0 次材质释放；分块与一次推进阻尼峰值差 > 10% | 场景与快照轮位差 ≤ 1e-6 m；空闲 1 s 自检列表变更为 0；owned 材质释放 ≥ 3 且 shared 材质释放为 0；分块推进阻尼峰值差 ≤ 1% |
| audit-ui.mjs | U1-U4、U6 | 844×390 视口；焦点在 btnHelp 时按 Space；读取关闭面板 inert/aria-hidden；暂停后读 simDetail；CHROME_PATH=/bin/false 启动 | 底部工具栏超出视口；Space 切换仿真；关闭面板仍可 Tab；暂停后 simDetail 仍以"运行"开头 | 工具栏矩形在视口内；帮助打开且运行状态不变；关闭面板 inert=true 且 aria-hidden=true；simDetail 含"暂停"；失败启动退出码 2 且无残留 profile |

### 3.4 npm scripts 与执行入口

在 package.json 中新增以下脚本，不新增依赖：

~~~json
{
  "scripts": {
    "test:invariants": "node tools/test-physics-invariants.mjs",
    "test:runtime": "node tools/test-runtime.mjs",
    "test:ui": "node tools/test-ui-browser.mjs",
    "audit": "node tools/audit/run-all.mjs --require-pass",
    "audit:baseline": "node tools/audit/run-all.mjs --expect-baseline",
    "audit:update": "node tools/audit/run-all.mjs --update-baseline",
    "audit:physics": "node tools/audit/run-all.mjs --group physics --require-pass",
    "audit:contact": "node tools/audit/run-all.mjs --group contact --require-pass",
    "audit:runtime": "node tools/audit/run-all.mjs --group runtime --require-pass",
    "audit:ui": "node tools/audit/run-all.mjs --group ui --require-pass",
    "ci:node": "npm run test && npm run test:invariants && npm run test:runtime && npm run test:dev-server",
    "test:dev-server": "node tools/test-dev-server.mjs",
    "build:check": "node tools/check-build.mjs",
    "ci:browser": "npm run test:browser && npm run test:camera && npm run test:ui"
  }
}
~~~

audit 默认严格模式，任何未通过即退出 1，因此 B0 阶段该命令按设计失败；audit:baseline 只校验当前状态与 0.2.0 快照一致，用于 B0 验收；每完成一个批次，在修复提交中把对应条目的 knownFailure 改为 false。audit:update 只允许人工执行，CI 不调用。审计分组：`audit:physics` 固定包含 `audit-free-body`、`audit-rocker-reach`、`audit-seed-writeback`、`audit-shadowing` 四个；shadow 不单列 npm script，归入 physics。

### 3.5 基线快照的存放与更新

机器快照存放在 tools/audit/baseline/0.2.0.json，字段包括 schema、appVersion、commit、environment、checks。每个 check 记录 id、group、knownFailure、observed、threshold、status；observed 保存本次实测指标，status 为 pass/fail。人类可读表由 run-all.mjs 生成到 docs/audit-baseline-0.2.0.md，文件头注明"由 audit:update 生成，勿手改"。

更新规则：B0 建立快照时全部 knownFailure=true；B1-B4 每修复一条，在同一提交中把该条改为 false 并更新 observed；快照 diff 只允许出现状态翻转和实测值变化，不允许删除条目。M6 时 knownFailure 全为 false，npm run audit 通过。归档版本保留在 git 历史中，不另建多份 JSON。

### 3.6 B0 工作项实施步骤

| 工作项 | 实施步骤 | 验收命令 | 依赖 | 风险与回滚 | 人日 |
| --- | --- | --- | --- | --- | ---: |
| B0-1 | 1. 新建 tools/test-harness.mjs，按 build.mjs:12-21 的文件顺序装载；2. 新建 tools/audit/_harness.mjs，实现 JSON 报告与 0/1/2 退出码；3. 逐个实现 8 个 Node 审计脚本，先跑通空场景再填断言；4. 每个脚本在 fbb401d 上记录红色输出 | node tools/audit/audit-free-body.mjs 等逐个执行 | — | 脚本依赖内部 API，源码重构会失效；以返回对象为边界，不读行号；回滚删除 tools/audit 与 test-harness | 0.6 |
| B0-1b | 1. 实现 audit-browser-contract.mjs 与 audit-ui.mjs；2. 复用 B0-1 的 CDP 连接、JSON 报告与退出码；3. 在 fbb401d 上记录浏览器失败基线 | node tools/audit/audit-browser-contract.mjs；node tools/audit/audit-ui.mjs | B0-1 | 浏览器审计受 SwiftShader 时序影响；只做状态轮询与几何探针；回滚删除两个脚本与 baseline 条目 | 0.3 |
| B0-2 | 1. 运行 run-all --update-baseline 生成 0.2.0.json；2. 生成 Markdown 表；3. 实现 --expect-baseline 的逐条比对与 diff；4. 在 PR 模板中加入基线 diff 检查 | node tools/audit/run-all.mjs --expect-baseline | B0-1 | 快照误更新；audit:update 人工执行，CI 只读；回滚恢复 JSON | 0.2 |
| B0-3 | 1. 增加 npm scripts；2. run-all 支持 --group、--require-pass、--expect-baseline；3. 接入 CI 分层与严格 Chrome；4. 文档记录过渡期门禁 | npm run audit:physics；npm run build:check | B0-1、B0-2 | 门禁过早阻断未修批次；用分组命令与 knownFailure 控制；回滚 scripts | 0.2 |

## 4. 逐缺陷回归用例

### 4.1 工况唯一定义

| 项目 | 冻结值 |
| --- | --- |
| 参数 | 600 kg；前后轮心 50 N/mm；阻尼比 0.05；ARB 0 |
| 时间 | settle 1.5 s；SIM_DT 2 ms；脉冲总时长 0.12 s；开始后 60 ms 采样；统计窗口为脉冲后 2 s 峰值 |
| 主基线 | 首个不可达样本残差 4.02 mm、运动比 -4.20、阻尼 30.7 kN；回写 46.3 kN 作为敏感性样本单列 |
| 引用规则 | 01/02/04 只引用本表，不各自定义工况；验收命令一律为可执行的 node/npm 命令，不使用 heredoc 伪代码；R-01 重定后本表与全部脉冲基线按 6880.45 N·m 重测，原值仅作缺陷症状、不再作为基线 |
| 随机种子 | B1 不变量固定 `mulberry32(20261119)`；B5 矩阵用例固定 `mulberry32(20261031)`；其他测试文件可固定各自的常量，但必须写在用例旁；不接受运行时 seed。 |

### 4.2 测试文件归口与函数签名

| 文件 | 主要函数或分组 | 用途 |
| --- | --- | --- |
| tools/test-physics-invariants.mjs | --group cg、rocker、corner、seed、ratio、shadow；freeBodyDrift(api, opts)、rockerReach(api, setup)、seedIndependence(api, setup) | 自由刚体解析轨迹、摇臂可达、种子独立、运动比连续性、变量遮蔽 |
| tools/test-dynamics.mjs [10] 接触状态机 | lowSpeedStop(api, vx, steps)、repark(api, scenario) | HOLD/SLIP、单步过零、重新驻车、容量边界 |
| tools/test-dynamics.mjs [11] 脉冲坐标 | impulseMoment(api, yawDeg) | 横摆 0/90° 与 24 姿态扫描 |
| tools/test-dynamics.mjs [12] 接地点唯一性 | contactGap(api, attitudeDeg)、momentParts(api) | 接地点、contact.y、力矩分解 |
| tools/test-runtime.mjs | frameAdvance(api, hz, seconds, clampMs)、geometryGeneration(api, from, to)、sourceContract(api) | 10/5 Hz、droppedTime、尺寸代际、变量遮蔽 |
| tools/test-ui-browser.mjs | keyboardCase、focusCase、landscapeCase、materialCase、telemetryCase、spawnCase | 键盘、焦点、横屏、材质、DOM、Chrome 清理 |
| tools/bench.mjs | benchStep(api, iterations)、benchModel(api, iterations) | A1 性能预算 |

归属冻结：test-physics-invariants 归 01，test-dynamics [10][11][12] 归 02，test-runtime 归 03，test-ui-browser 与 test-dev-server 归 04；05 只维护 audit 骨架、baseline 与矩阵，不新建平行 test 文件。分册 01 已约定 tools/test-physics-invariants.mjs 的 shadow 等分组（见 01 §5）；分册 02 已约定 test-dynamics.mjs 的 [10][11][12] 段。审计分组与 §3.4 对齐：`audit:physics` 固定包含 `audit-free-body`、`audit-rocker-reach`、`audit-seed-writeback`、`audit-shadowing` 四个；shadow 不单列 npm script。随机种子按 §4.1：B1 用 20261119、B5 矩阵用 20261031，均固定并写在用例旁。每个辅助函数返回纯对象，不在断言内部做 I/O；测试主流程只负责组合场景、调用 check、汇总退出码。浏览器函数接收已有的 CDP send、evaluate、evaluateJson，不重复实现连接逻辑。

### 4.3 缺陷与断言矩阵

| 缺陷 | 回归断言 | 阈值 | 放置文件与用例 | 批次/依赖 |
| --- | --- | --- | --- | --- |
| B4.1 摇臂不可达 | 动态扫掠中不存在 frame.converged=true 且推杆闭合残差超限、却仍报 ok=true 的样本；分别记录 frame.converged 与综合 ok | 残差 ≤ 0.1 mm；不可达但 ok 的样本数 = 0 | test-physics-invariants / rocker | B1-2、B1-3 |
| B4.1 运动比异常 | 运动比始终为正且在合理区间，逐步变化连续 | 0.2 ≤ i ≤ 0.8；每一步 abs(Δi) ≤ 0.02 | test-physics-invariants / ratio | B1-5 |
| B4.1 阻尼峰值 | 同一工况阻尼峰值不超过物理包线 | ≤ 15 kN（基线 30.7 kN） | audit-rocker-reach；invariants / rocker | B1-3 |
| B4.2 质心漂移 | 无外力自由旋转 1 s 后质心位移可忽略，参考点按解析轨迹运动 | 质心 ≤ 0.01 mm；参考点 287.66 ± 0.5 mm | test-physics-invariants / cg | B1-1 |
| B4.2 角速度守恒 | 无外力时角速度与四元数范数守恒 | 误差 ≤ 1e-9 / 1e-12 | test-physics-invariants / cg | B1-1 |
| B4.3 低速死区 | vx=0.0005 m/s、settle=0，1 子步后速度归零，4 子步后 HOLD | abs(vx) ≤ 1e-12；mode='HOLD'；位移 0-2e-6 m | test-dynamics [10] / lowSpeedStop | B2-1 |
| B4.3 单步反向 | vx=0.01 m/s 单步不反向且落在 0 至 1e-6 | 0 ≤ vx < 1e-6；位移 0-1e-4 m | test-dynamics [10] / lowSpeedStop | B2-1 |
| B4.3 重新驻车 | 用 simRetargetReference 切水平，0.1 s 内 HOLD；10/12/30/60/144 Hz 同步长末态逐位一致、模式切换子步序号（lastChangeStep）一致 | mode='HOLD'；vx=vz=wy=0；位移 <1e-9 m；末态差 ≤1e-12 | test-dynamics [10] / repark | B2-1（含 simRetargetReference） |
| O-13 遥测纯度 | simEvaluate 只返回 contactNext，不提交状态；连续 100 次 simBuildModel 不改变 sim.contact.changes/dwell | changes/dwell 逐位相同；100 次后仍相同 | test-dynamics [10] / telemetryPurity | B2-1 |
| O-14 横摆预算 | L_ext 含法向、摩擦、脉冲力矩的 y 分量；8°/7° 与 10°/10° 各一条 wy 预算 | abs(L_ext_y) ≤ μ·ΣN·(track/2)（track 取对应轴轮距）；wy 单步预算 | test-dynamics [10] / yawBudget | B2-1 |
| B4.4 脉冲坐标系 | 横摆 0/90° 与 24 姿态下，脉冲力矩差旋转到车体系为 (0,0,-6880.45) | 逐分量 ≤ 1e-9 N·m | test-dynamics [11] / impulseMoment；audit-impulse-frame | B2-2 |
| B4.5 接地点唯一 | 0/2/5/10° 俯仰与侧倾、8°/7° 倾斜下两套接地点重合，且 contact.y=0 | 间距 ≤ 1e-6 m；abs(contact.y) ≤ 1e-6 m | test-dynamics [12] / contactGap；audit-contact-gap | B2-3 |
| B4.5 力矩分解 | 法向/摩擦/脉冲力矩独立复算与总和一致 | 分解和差 ≤ 1e-9；分量差 ≤ 1e-6 N·m | test-dynamics [12] / momentParts | B2-4 |
| R-07 力装配守卫 | simEvaluate 内不得出现裸 simCross(arm, force)；法向/摩擦/脉冲统一经 simApplyForceAt(sim, roadPoint, forceRoad, bucket)；momentParts 之和等于 moment | grep -n 'simCross' src/js/05-body-dynamics.js 在 simEvaluate 段命中 0；分解和差 ≤1e-9 N·m | test-dynamics [12] / forceAssembly；momentParts | B2-4 |
| R-10 求解状态/UI 契约 | solverOk=corners.every(ok)；solverState ∈ {ok,degraded,failed}；rockerResidualMm=rocker.residual*1000；motionRatioState；检查表固定 10 行 id：sim/contact/links/steer/arb/friction/rockerResidual/motionRatio/staticTests/dynamicTests | 字段集合与行 id 集合完全相等；残差单位 mm | test-runtime / solverContract；test-ui-browser / checkRows | B1-3、B3-3、B4-4 |
| B5.1 低帧率丢时 | 10/5 Hz 及 50 ms 截断下，推进时间与 droppedTime 之和守恒 | 与墙钟差 ≤ 0.02 s；推进不足时 dropped > 0 | test-runtime / frameAdvance | B3-1 |
| B5.1 高帧率基线 | 60 Hz 正常推进，不受新策略影响 | 推进 ≥ 0.98 s/s | test-runtime / frameAdvance | B3-1 |
| B5.2 尺寸代际 | 尺寸变化强制重建；场景轮位与快照同代 | 轮位差 ≤ 1e-6 m；杆长偏差 ≤ 1e-6 m；geometryRevision 一致 | test-runtime / geometryGeneration；test-ui-browser | B3-2 |
| B5.3 周期性自检 | 空闲时自检列表不重建，参数变化时才刷新 | 1 s 内列表变更 0 次 | test-ui-browser / telemetryCase | B3-3 |
| B5.4 材质释放 | 重建释放 owned 材质，不释放 shared 材质 | owned 释放 ≥ 3；shared 释放 0 | test-ui-browser / materialCase | B3-4 |
| O1 渲染回写种子 | 同参数建两个 sim：A 每步把 corner.angle 写为 baseAngle，B 写为 baseAngle+1.2；完整 state、time、flags 逐位相同；浏览器只比对 scene rockerAngles 与 solved rocker.angle | 差 ≤ 1e-12；峰值差 ≤ 1 N | test-physics-invariants / seed；audit-seed-writeback；test-dynamics-browser | B1-4 |
| A2 变量遮蔽 | reference.source 缺失时必须抛出消息含 reference.source 的错误，不静默回退 | 抛错且消息含字段名 | test-runtime / sourceContract；audit-shadowing | B1-6 |
| A1 性能预算 | 每子步 suspEval 次数与单步耗时在预算内 | ≤ 30 次/子步；≤ 0.05 ms/子步；模型 ≤ 0.05 ms | tools/bench.mjs | B1-5、B6 |
| U1 横屏视口 | 844×390 下顶栏与底部工具栏都在视口内 | rect.top ≥ 0 且 rect.bottom ≤ innerHeight + 1 | test-ui-browser / landscapeCase | B4-1 |
| U2 空格键 | 焦点在按钮上按 Space 执行按钮动作，不切换仿真 | 帮助打开；运行状态不变 | test-ui-browser / keyboardCase | B4-2 |
| U3 面板焦点 | 关闭面板 inert 且 aria-hidden，Tab 不进入 | inert=true；aria-hidden=true | test-ui-browser / focusCase | B4-3 |
| U4 暂停文案 | 暂停后 simDetail 与 telemetry 同步 | 含"暂停"且不以"运行"开头 | test-ui-browser | B4-4 |
| U5 轮载箭头 | 箭头长度与文档声明的载荷映射一致 | Node 线性断言 1e-12；浏览器只验证 height/load 比例与零载；非线性声明按公式复算 | test-ui-browser（B4-5 启用） | B4-5 |
| U6 Chrome 清理 | 启动失败不残留 Chrome 与 profile | test 失败退出 1；audit 环境错误退出 2；缺 Chrome 默认 SKIP，严格变量下失败；无 fs-* 临时目录 | test-ui-browser / spawnCase | B4-6 |
| A3 dev-server | 编码遍历与同前缀兄弟目录不可读 | 状态码 403/404 | test-dev-server / resolvePath | B4-6 |
| A4 清理项 | 死代码、截图命名、四元数顺序与缩进符合约定 | createDefaultBodyMaterialSet 未定义；截图名匹配 FS-01_dynamic_*；回退四元数顺序为 Ry·Rz·Rx | test-core.mjs [10] 死代码/命名；test-dynamics.mjs [13] 渲染回退四元数 | B4-7 |

阈值来源：B4.1-B4.5 的基线值来自 2026-11-19 的复核实验与分册 01、02 的现状表；B5.1-B5.4 的基线来自 B 报告与主册第 5.2 节。修复后的判据取物理可接受值与基线之间的保守值。例如阻尼峰值基线 30.7 kN、目标 15 kN，留出一倍裕度，避免把"修好一半"判为通过。同一工况在不同统计窗口下的残差与运动比会在 4.02-4.52 mm、-4.20 至 -6.73 之间变化，审计以首次不可达样本和峰值阻尼为判据，不以单点数值作为通过条件。B4.3 的 mode 字段由 B2-1 引入，B0 审计在修复前用 flags.holding/sliding 作为等价观测。

## 5. CI 分层与执行顺序

### 5.1 三层职责

| 层 | 内容 | 目标时长 | 是否阻断合并 | 说明 |
| --- | --- | ---: | --- | --- |
| 快速 Node | npm test + test:invariants + test:runtime + test:dev-server | ≤ 15 s | 是 | 无 Chrome、无构建、确定性 |
| 构建一致性 | build:check + 源文件清单 + 单文件约束 + 依赖清单 | ≤ 5 s | 是 | 确保 index.html 与源码一致 |
| 浏览器 | 先 build，再 test:browser + test:camera + test:ui | ≤ 5 min | 是（CI 有 Chrome 时） | FS_REQUIRE_CHROME=1，跳过视为失败 |
| 审计（夜间） | npm run audit:baseline + 浏览器审计 + bench | ≤ 5 min | 否（M6 前） | 记录失败清单，修复后逐条转绿 |

### 5.2 执行顺序

执行顺序固定为：先 npm run ci:node（既有 99 项加新不变量/运行时测试，失败即停）；再 npm run build:check（校验字符串哈希、src/js 清单、依赖与单文件约束）；然后 FS_REQUIRE_CHROME=1 npm run ci:browser（必须先构建，浏览器脚本在 spawn 后进入 try/finally）；夜间 npm run audit:baseline 与 bench；发布前 npm run audit 严格模式。

### 5.3 过渡期门禁

B0-B4 修复合入时，完整 audit 仍会因未修条目失败，因此 PR 门禁用分组命令：B1 合并时跑 npm run audit:physics，B2 跑 npm run audit:contact，B3 跑 npm run audit:runtime，B4 跑 npm run audit:ui。分组命令要求该组全部通过；其他组失败不阻断，但 audit:baseline 必须证明状态未漂移。M6 后统一改为 npm run audit。

## 6. 测试代码风格约束

### 6.1 Node 测试的装载方式

本轮保留 new Function 装载全局脚本，不迁移 ES Modules。这与分册 01 的约束一致，理由有三点：审计脚本必须能在 fbb401d 的未修复代码上运行；物理修复要逐行对照，模块化会把 diff 淹没在移动与导出语句里；现有 99 项测试已验证该装载方式，迁移的收益与本轮目标无关。

为避免装载方式固化，新增 tools/test-harness.mjs，所有新测试和审计脚本只通过 loadPhysics() 拿 API。分册 01 若在 B1 抽出显式模块，只需把 loadPhysics() 内部改为 import()，并保持返回字段不变；测试文件不改。构建一致性层校验 loadPhysics 的文件清单与 src/js 实际文件一致，防止漏装。

### 6.2 Node 断言风格

使用 ESM .mjs、node: 内置模块、零第三方依赖。每个文件开头定义 LIMITS 常量区，阈值带单位；断言统一调用 check(name, condition, detail)，detail 输出实测值与阈值。测试用例之间不共享可变全局状态，每个场景重新 simCreate；随机测试按文件固定种子：本册矩阵用例使用 mulberry32(20261031)，B1 不变量使用 mulberry32(20261119)，各自固定并写在用例旁，不得跨文件共用状态；静力 3000 组、动力学 120 组、机构姿态 1000 组，样本数写入 LIMITS；断言不使用 Date.now() 或墙钟时间。失败时设 process.exitCode = 1，不抛异常中断后续用例；装载失败才允许抛错。

### 6.3 浏览器测试风格

先构建再运行；Chrome 缺失时本地默认 SKIP（退出 0），CI 设置 FS_REQUIRE_CHROME=1 后缺失即失败。每个脚本一个 Chrome 进程，spawn 后立即进入最外层 try/finally；就绪状态用轮询而不是固定 sleep；只断言公开 API、DOM 状态和几何探针，不做像素比对；页面异常、控制台 error、未处理 rejection 都计入失败。需要新增探针时，探针必须只读、无副作用，并在同批提交中登记到本分册。

### 6.4 审计脚本风格

stdout 只输出 JSON，stderr 输出人读日志；JSON 字段名带单位后缀（如 _mm、_kN、_ms）；每个 check 的 id 稳定为"缺陷编号/指标"格式，不随文件名变化；脚本不写仓库文件，不修改源码，不依赖当前工作目录；退出码严格区分 1 与 2。审计脚本不得读取基线来决定自己的断言，基线只用于比较与报告。

## 7. 工作量、依赖与风险

### 7.1 工作量

| 编号 | 工作项 | 归属工作项（测试人日已含） | 人日 |
| --- | --- | --- | ---: |
| B0-1 | 共享 harness、8 个 Node 审计脚本 | — | 0.6 |
| B0-1b | 2 个浏览器审计脚本（合同、UI） | B0-1 | 0.3 |
| B0-2 | 基线快照、Markdown 生成、比较器 | B0-1 | 0.2 |
| B0-3 | npm scripts、run-all 分组与门禁 | B0-1、B0-2 | 0.2 |
| R1 | 物理不变量测试（约 12 项） | B1-1（2.0）、B1-3（1.0）、B1-5（1.0） | 0.8 |
| R2 | 接触与坐标测试（test-dynamics [10][11][12]） | B2-1（1.5）、B2-3（1.0）、B2-4（0.5） | 0.8 |
| R3 | 运行时测试（约 8 项） | B3-1（1.0）、B3-2（1.5）、B3-3（1.0）、B3-4（1.0） | 0.6 |
| R4 | UI 与可访问性测试（约 10 项） | B4-1～B4-6（2.8） | 0.6 |
| R5 | 构建一致性与 Chrome 严格模式 | B4-8（0.5） | 0.3 |
| 05 口径合计 | | | 4.4 |

B0 合计 1.3 人日（0.6+0.3+0.2+0.2），与主册 r2 一致；B0-1b 已单列，不再并入 B4-8。R1-R5 的 3.1 人日已包含在上表对应工作项的估算内：R1→B1-1/B1-3/B1-5，R2→B2-1/B2-3/B2-4，R3→B3-1/B3-2/B3-3/B3-4，R4→B4-1…B4-6，R5→B4-8；全项目工期为 B0 1.3 + B1 6.3 + B2 3.5 + B3 4.5 + B4 3.6 + B5 1.5 + B6 1.0 = 21.7，不另加 3.1。

### 7.2 依赖关系

B0-1 无前置；B0-2、B0-3 依赖 B0-1。R1 依赖 B1 的求解器结果字段（rockerResidualMm、rockerFeasible、motionRatioState、ok），在 B1-3 接口冻结后启用；R2 依赖 B1 完成后的质心状态，因为低速与脉冲都读 state；R3 依赖 B2 完成；R4 依赖 B2；R5 依赖 B0 与 B4-8。审计脚本本身不等待修复，B0 即可全部落地并保持红色。

### 7.3 风险与回滚

| 风险 | 表现 | 应对 |
| --- | --- | --- |
| 审计判据或阈值错误 | 审计仍绿但物理仍错，或合法参数被误报 | 独立判据（解析轨迹、几何距离、旋转矩阵叉乘）；基线值与目标值留一倍裕度；Node 18/24 各跑一次；阈值集中在 LIMITS |
| 浏览器审计不稳定或装载漂移 | SwiftShader 时序抖动；测试漏装模块 | 只做状态轮询与几何探针；严格模式只在 CI 开启；构建一致性层校验 src/js 清单与顺序 |
| 快照误更新或套件变慢 | 失败清单失去证据；Node 层 >15 s | audit:update 人工执行并校验 diff；审计放夜间，新测试按批次增量，bench 不进快速层 |

回滚策略：审计与测试文件都是新增文件，回滚只需删除对应文件、npm script 和 baseline 条目，不触碰 src。若某个新测试被证明判据错误，先回滚该测试与 baseline 条目，再单独提交修正，不在修复提交里注释掉断言。

## 8. 验收清单

| 阶段 | 命令 | 通过判据 |
| --- | --- | --- |
| B0 | node tools/audit/run-all.mjs --expect-baseline | 12 项缺陷对应的检查均为 fail，退出 0 |
| B0 | npm run audit | 按设计退出 1，失败清单与快照一致 |
| B1 | npm run test:invariants && npm run audit:physics | 不变量测试全绿；物理组审计全绿 |
| B2 | npm test && npm run audit:contact | [10][11][12] 全绿；接触组审计全绿 |
| B3 | npm run test:runtime && npm run audit:runtime | 运行时组测试与审计全绿 |
| B4 | FS_REQUIRE_CHROME=1 npm run test:ui && npm run audit:ui | UI 测试与审计全绿 |
| M6 | npm run ci:node && npm run build:check && FS_REQUIRE_CHROME=1 npm run ci:browser && npm run audit | 四层全部通过，knownFailure 全为 false |

所有新增测试必须在 fbb401d 上留下红色记录，PR 描述附命令与关键输出；只提交"修复后通过"的测试不算完成回归。

## 9. B5-1/B5-2 文档同步

B5-1：按主册第 10 节更新 README 19/81/100/164/170-215/212 与 DESIGN 20.2/20.3/20.7/20.9/20.10/544/640/578/648；数字以 B4 后实测 50+80、test:invariants 27、test:runtime 78、test:ui 44、自检 24 为准；删除 45/52/22/8/40/5890/50 ms/参考点积分旧表述。
B5-2：同步自检与遥测文案：14+10=24、10 行检查表、solverOk/solverState/rockerResidualMm/motionRatioState；template 162/448/540 已由 B4 同步，B5 只核对，不改逻辑。
验收：npm test 50+80、test:invariants 27、test:runtime 78、test:ui 44、audit 全绿、build:check strict；grep 旧值只允许出现在历史对照/审查报告。
