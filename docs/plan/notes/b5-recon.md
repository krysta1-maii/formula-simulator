# B5 施工勘察（b5-recon）

| 项目 | 内容 |
| --- | --- |
| 分支 | feat/plan-execution |
| HEAD | 65eef75（B3 已提交；B4 工作区有未提交改动） |
| 源码基线 | 0.2.0 / fbb401d；README.md、DESIGN.md 未改；src/index.template.html 已有 B4-2/B4-4 工作区改动 |
| 依据 | 主册第 10 节、分册 05、docs/plan/contracts.v1.md、README、DESIGN、src/index.template.html、tools/test-* |
| 性质 | 只读勘察；本文件只登记改点、目标文本与冲突，不改 README/DESIGN/源码 |
| 结论 | 22 个检查点：18 处必改（README 11、DESIGN 7）、4 处已同步（DESIGN 1、template 3） |

## 1. 勘察结论

主册第 10 节的位置在表中拆成 22 行：18 处必改、4 处已同步。DESIGN 20.2 的质心积分主体与 template 的三处文案已由 B1-6、B4-2、B4-5 落地，B5 不应重复改；README 14、README 32–50、README 245 是主册未列的补漏行，DESIGN 645 是 20.7 内的测试数量拆分。README/DESIGN 当前仍是 B0 之前的文案，与 B1–B4 实现存在数量、帧时间、质心、脉冲基线四类冲突。

本轮的“当前”必须区分三个口径：HEAD 的 npm test 是静力 47 + 动力学 78；工作区因 B4 未提交的 3 个 test-core 断言与 2 个 test-dynamics 断言，实际是 50 + 80；主册第 10 节、contracts 5.2、README 第 202 行仍写 52。B5 施工应在 B4 合入后按最终数复测一次，不能沿用 52。

docs/plan/parts/05-regression.md 当前没有 B5-1/B5-2 的实施步骤，只有 2.5 节一句自检数量同步；主册第 5 节已把 B5-1/B5-2 归到 05。这是本轮勘察发现的计划缺口，B5 开工前需先在 05 补节，或由 lead 明确以本笔记作为临时实施依据。

## 2. 当前实现核对

| 项目 | 实测/现状 | 证据 |
| --- | --- | --- |
| npm test | HEAD 47+78；工作区 50/50 + 80/80（B4 未提交新增 3+2） | 实跑 npm test；git diff -- tools/test-core.mjs tools/test-dynamics.mjs |
| test:invariants | 27/27 通过 | 实跑 npm run test:invariants |
| test:runtime | 78/78 通过 | 实跑 npm run test:runtime |
| 页面自检 | 静力 14 + 动力学 10 = 24；动态名称含“低速驻车”“滑移不反向” | runSelfTests / runDynamicSelfTests；test-runtime 的 dynamic self-tests return 10 checks |
| 帧时间 | SIM_MAX_SUBSTEPS=128、SIM_MAX_FRAME_DT=0.5、SIM_MAX_BACKLOG=0.5；2 Hz 推进约 0.512 s/s 且 droppedTime 约 0.244 s | src/js/05-body-dynamics.js:24-26、866-888；test-runtime frame 组 |
| 脉冲基线 | 俯仰脉冲零姿态绕质心力矩 −6880.45 N·m；横摆 90° 车体系仍为纯俯仰 | test-dynamics 的 pitch impulse moment at yaw 0 is -6880.45、yaw 90 keeps the body moment pure pitch |
| 质心积分 | sim.state.x/y/z 为质心；参考点由 simReferencePoint 派生；cg/x-ref-path 通过 | contracts 1.1；test-invariants cg 组 |
| 接地点唯一 | contactRoad 唯一来源；独立求解复算差 ≤1e-9；回退用完整四元数与路面法向 | test-dynamics 的 an independent solve reproduces the contact point、fallback contact uses the full quaternion and the plane normal |
| 材质释放 | Node 合成组 7 个实例材质释放 7、共享/缓存 0、非共享几何 8；lastBuild 创建/释放相等 | test-runtime assets 组；src/js/20-car.js:192-289 |
| 材质浏览器断言 | 当前 test-ui-browser.mjs 未发现 instanceMaterialCreated/Disposed、assets 或 dispose 断言 | 全仓 grep；03 B3-4 验收中“一次轴距重建 7/7”尚未自动化 |
| template | 轮载文案、空格文案已在工作区符合目标；行号因 B4 改动漂移 | src/index.template.html:162、448、540 |
| README/DESIGN | 未被 B1–B4 修改，仍是 22/8、40 子步、45/52 等旧值 | git status；README 19/100/164/172/202/212/245；DESIGN 544/578/640/645/648 |

## 3. 逐条改点

### 3.1 README.md（11 处）

| # | 当前行 | 当前原文（截取） | 目标文本 | 依据 | 状态 |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 14 | 渲染帧率只决定每帧执行多少个子步 | 固定 2 ms 步长不变；帧率只决定每帧执行子步数；低帧率按 0.5 s 积压跨帧排空，4 Hz 以下慢动作，丢弃量计入 droppedTime | contracts 3.2；test-runtime 的 2 Hz timeScale 断言 | 必改（补漏） |
| 2 | 19 | 22 项页面自检（14+8）…动力学 45 项 | 24 项自检（14+10）；Node 静力 47、动力学 78（B4 后按 50/80 复测） | R-06；npm test；test-runtime selftest 组 | 必改 |
| 3 | 32–50 | 快速开始只列 test:core/dynamics/browser/camera | 补 test:invariants、test:runtime、test:ui、test:dev-server、build:check、audit:baseline；注明 npm test 仍是 47+78 | package.json scripts；contracts 5.2 | 必改（补漏） |
| 4 | 81 | 在车头方向 0.95 m 处 | 在车身参考点前方 0.95 m；绕质心力臂为 offset−cgBody；零姿态俯仰力矩 −6880.45 N·m | contracts 4.1；test-dynamics [11] 6880.45 | 必改 |
| 5 | 100 | 平动参考点仍是设计台面中心 | 平动以质心 r_CG 为积分变量；参考点由 p=r_CG−R(q)c 派生，偏移自动计入力矩 | contracts 1.1；test-invariants 的 cg/x-ref-path | 必改 |
| 6 | 164 | 单帧最多 40 个子步；掉帧后结果一致 | 单帧接受 ≤0.5 s、执行 ≤128 个 2 ms 子步、积压 ≤0.5 s 跨帧排空；超出丢弃并计 droppedTime；低于 4 Hz 慢动作（2 Hz 约 0.512×） | contracts 3.2；test-runtime frame 组 | 必改 |
| 7 | 172 | 页面内置 22 项自检 | 页面内置 24 项：14 项静力/边界 + 10 项动力学 | test-runtime selftest；contracts 3.3 第 9/10 行 | 必改 |
| 8 | 191–200 | 动力学检查列到 8 项 | 保留 1–8，追加“9. 低速驻车”“10. 滑移不反向” | runDynamicSelfTests 名称；test-runtime | 必改 |
| 9 | 202 | 动力学核心 52 项 | 动力学核心 78 项（B4 后 80）；浏览器 26 项可保留，另列 test:ui | npm test；test-dynamics；test-ui-browser | 必改 |
| 10 | 212 | 60/144 Hz 帧率测试结果一致 | 物理时间语义：固定 2 ms；0.5 s/128 步/0.5 s 积压/droppedTime；4 Hz 以下慢动作；60/144 Hz 固定步长一致性仍保留 | test-runtime frame；contracts 3.2 | 必改 |
| 11 | 245 | 14 项静力 + 8 项动力学 | 14 项静力 + 10 项动力学 | test-runtime selftest | 必改（补漏） |

### 3.2 DESIGN.md（7 处必改，1 处已同步）

| # | 当前行/节 | 当前原文（截取） | 目标文本 | 依据 | 状态 |
| ---: | --- | --- | --- | --- | --- |
| 12 | 20.2，551/565 | 车体状态由质心位置… | 保持；核对 p=r_CG−R(q)c、c=(-0.15975,0.30,0) 与 cgBody 一致 | contracts 1.1；B1-6 已改 | 已同步 |
| 13 | 20.2，578 | 单帧最多 40 个子步 | 单帧接受 ≤0.5 s、执行 ≤128 个 2 ms 子步、积压 ≤0.5 s 跨帧排空；超出丢弃并计 droppedTime；低于 4 Hz 慢动作 | contracts 3.2；test-runtime frame | 必改 |
| 14 | 20.3，599 | 对质心的力矩使用该接地点… | 明确每个角唯一 contactRoad；contactBody 只给机构/渲染；回退用 [0,1,0] 投影；力臂为 contactRoad−r_CG | contracts 1.2；test-dynamics [12] | 必改 |
| 15 | 20.7，544 | 8 项动力学自检 | 10 项动力学自检 | test-runtime selftest；R-06 | 必改 |
| 16 | 20.7，640 | 页面自检共 22 项 | 24 项：14 静力 + 10 动力学；列 10 项名称 | test-runtime；runDynamicSelfTests | 必改 |
| 17 | 20.7，645 | 52 项动力学检查 | 78 项（B4 后 80）；补 test-dynamics 的 HOLD/SLIP、脉冲 6880.45、contactRoad/力矩分解；test-ui-browser 另列 | npm test；test-dynamics；B4 diff | 必改 |
| 18 | 20.7，648 | 60 Hz 和 144 Hz 帧率… | 保留固定步长一致；补 test-physics-invariants 27 项（cg/rocker/seed/ratio/shadow）、test-runtime 78 项；2 Hz 0.512× 与 droppedTime | test-invariants；test-runtime | 必改 |
| 19 | 20.9，665–685 | 新增或修改的文件… | 20.9 补 test-physics-invariants、test-runtime、test-ui-browser、browser-runner、check-build、audit*；在 20.9 后新增 20.10 资源所有权与 teardown | contracts 3.2；test-runtime assets；03 B3-4 | 必改 |

### 3.3 src/index.template.html（3 处已同步）

| # | 当前行 | 当前原文（截取） | 目标文本 | 依据 | 状态 |
| ---: | ---: | --- | --- | --- | --- |
| 20 | 162（主册 161） | 箭头长度与法向力成正比 | 保持现文案；仅确认行号 161→162；不重复改 | test-ui-browser 的 load-arrow copy states the linear contract；10-scene 的 loadArrowHeight | 已同步 |
| 21 | 448（主册 445） | 空格暂停（焦点不在控件上时） | 保持现文案；仅确认 445→448 | test-ui-browser 的 Space on a focused button… | 已同步 |
| 22 | 540（主册 538） | 空格 暂停/继续（焦点不在控件上时） | 保持现文案；仅确认 538→540 | test-ui-browser Space 组 | 已同步 |

## 4. 旧值处置

必须从 README/DESIGN 的“当前行为”段落删除或改写：

- 45（README 19）、52（README 202、DESIGN 645、主册第 10 节）、22（README 19/172、DESIGN 640）、8 项动态（README 19/172/245、DESIGN 544/640）。
- 40 个子步（README 164、DESIGN 578）、50 ms 截断（若文档出现即删）、掉帧后物理结果一致（README 164）、平动参考点仍是设计台面中心（README 100）。
- 5890：README/DESIGN 当前未出现；B5 不得新增。脉冲基线只写 −6880.45 N·m。

可以保留的旧值/稳定值：

- 版本 0.2.0、静力 47 项、浏览器 26 项、test:browser 的 26 项、60/144 Hz 固定步长确定性。
- 14 项静力 + 10 项动力学 = 24 项；Node 动力学 78（B4 后 80）。
- fbb401d 的 5890、40 子步、8 项动态只保留在审查报告、audit baseline 与历史记录中，不进入 README/DESIGN 当前行为描述。

## 5. 文档-实现冲突

1. **测试数量三套并存**：任务口径 47+78、工作区实测 50+80、主册/README 202/DESIGN 645 写 52；contracts 5.2 也写 52。B5 必须以 B4 合入后的实测为准，不能沿用 52。
2. **自检数量旧值**：README 19/172/245 与 DESIGN 544/640 仍写 22/8；实现是 24/10，test-runtime 有 dynamic self-tests return 10 checks。
3. **帧时间旧值**：README 164/DESIGN 578 写“40 个子步、掉帧后一致”，实现是 0.5 s/128 步/0.5 s backlog/droppedTime/4 Hz 以下慢动作。
4. **质心状态**：README 100 仍写“平动参考点仍是设计台面中心”；DESIGN 20.2 已由 B1-6 改为质心积分，主册仍把 20.2 列为待改，属于计划滞后而非文档缺失。
5. **脉冲基线**：README 81 只写“车头方向 0.95 m”，未说明参考点/质心与 6880.45；主册第 10 节的“45→52”同样滞后。
6. **测试编号重复**：test-dynamics.mjs 当前有两个 [10]：第 299 行“接触状态机”和第 731 行“render fallback quaternion”。B5 若引用 [10][11][12] 会歧义；需 B4 改为 [13] 或文档按名称引用。
7. **05 分册缺 B5-1/B5-2**：主册第 5 节把两项归 05，但 05 没有对应实施步骤；B5 开工前需补节或由 lead 明确本笔记为临时 spec。
8. **contracts 旧值/路径**：contracts 5.2 写 47+52；5.1 写 tools/test-harness.mjs，实际是 tools/audit/_harness.mjs。B5 若引用契约需先裁决。
9. **材质浏览器断言缺失**：03 B3-4 验收要求浏览器一次重建 7/7、共享/缓存 0；当前 test-ui-browser.mjs 未发现 assets/dispose 断言。Node 合成组 7/7 已过，但 DESIGN 20.10 若写“浏览器已验证”需补测试或改写口径。
10. **template 行号漂移**：主册写 161/445/538，当前是 162/448/540；内容已由 B4 改好，B5 不应按旧行号重复改。

## 6. 风险与最易漏的 3 处

**风险。**

- README 行号可能在 B4 收尾后继续漂移；改点表以“文件名 + 原文锚点”为准，行号只作当前定位。
- DESIGN 章节号与代码注释交叉引用多，20.7/20.10 新增后需检查 20.2/20.3 的“见 20.x”引用是否仍指向正确节。
- 47/78 与 50/80 未决时写死数字会再次制造 README 19 与 202 的内部矛盾；B5 应等 B4 合入后统一复测。
- template 已同步但 index.html 尚未重建；B5 只改文档，构建由 B4 收尾负责，不能用旧 index.html 反推文案。

**最易漏的 3 处。**

1. README 245 与 README 14：245 的“14+8”不在主册 170–215 的显式行号内，14 的“帧率只决定子步数”也不在主册第 10 节；两处都会留下旧语义。
2. README 202 与 DESIGN 645：主册只强调 README 19 的 45→52，容易漏掉测试清单里的 52；实际应写 78（B4 后 80）。
3. template 161/445/538：三处内容已由 B4 改好，行号却漂到 162/448/540；按主册旧行号改会改错行或重复劳动，B5 只核对不重写。
