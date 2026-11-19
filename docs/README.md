# Formula Simulator 文档索引

本索引按文档时效和用途分类。当前交付版本、功能、操作与验证口径以根目录文档为准；历史报告中的版本号、提交哈希、行号、测试计数和“完成/通过”结论只适用于各自基线。

## 当前交付说明

| 文档 | 用途 |
| --- | --- |
| [根 README](../README.md) | 当前版本、运行方式、功能、操作、限制与验证入口；由 lead 统一维护 |
| [DESIGN](../DESIGN.md) | 当前设计、物理模型、坐标约定、架构和模型边界；由 lead 统一维护 |
| [悬挂重构说明](suspension-refactor.md) | 0.4.0 悬挂布置、共享几何与力链路、转向和车体包络验证专题；与最新根文档不一致时，以根文档为准 |

## 0.4.1 收口验收

- [0.4.1 当前验收记录](plan/acceptance.md)：记录最终产物、缺陷映射、实测结果和验证边界；0.3.0 M6 材料已单独归档。
- [0.3.0 发现到 0.4.x 的状态映射](review/0.3.0/status-mapping.md)：分别登记 0.4.0 已关闭项、0.4.1 本轮关闭项及未覆盖范围。
- 收口过程中的施工记录、交接快照和路线建议不能替代最终验收。最终测试数量和性能数据只在验收记录中维护，避免多处漂移。

## 历史施工计划与验收材料

这些材料记录 0.2.0 缺陷修复到 0.3.0 M6 收口的施工过程，不是当前施工入口。

| 类别 | 文档 |
| --- | --- |
| 0.2.0 审查基线 | [代码审查 A](code-review.md)、[代码审查 B](code-review-k3.1-pro.md) |
| 施工主册与交接 | [修复施工计划](施工计划.md)、[B6 交接快照](plan/handoff.md) |
| 契约与分册 | [施工契约 v1](plan/contracts.v1.md)、[01 物理状态](plan/parts/01-physics-state.md)、[02 接触与力](plan/parts/02-contact-force.md)、[03 运行时](plan/parts/03-runtime.md)、[04 UI 与工具链](plan/parts/04-ui-tooling.md)、[05 回归](plan/parts/05-regression.md)、[06 计划复核](plan/parts/06-review.md) |
| 0.2.0 失败基线 | [B0 审计基线](audit-baseline-0.2.0.md) |
| 0.3.0 M6 验收证据 | [0.3.0 验收归档](plan/acceptance-0.3.0.md)、[浏览器复跑](plan/notes/b6-verification.md)、[UI 稳定性](plan/notes/b6-ui-stability.md)、[独立最终复核](plan/notes/b6-final-review.md) |

其余 `plan/notes/` 文件是各批次勘察和施工记录。契约、计划及验收材料中的接口口径如果与当前根 README/DESIGN 或最新验收冲突，不直接用于判断当前状态。

## 0.3.0 对抗评审

- [总报告](review/0.3.0/00-summary.md)：统一的问题编号、严重度和当时交付判定。
- 分报告：[01 物理](review/0.3.0/01-physics.md)、[02 视觉](review/0.3.0/02-visual.md)、[03 UI](review/0.3.0/03-ui.md)、[04 运行时](review/0.3.0/04-runtime.md)、[05 功能与文档](review/0.3.0/05-features-docs.md)、[06 机构与车体包络](review/0.3.0/06-body-mechanism-fit.md)。
- [跨版本状态映射](review/0.3.0/status-mapping.md)：阅读原报告前先核对哪些发现有 0.4.0/0.4.1 关闭依据，以及哪些验证限制仍然有效。
- `review/0.3.0/evidence/` 保存可随文档归档的图片。报告提及的 `.tmp-review/` 是审阅时的本地临时证据目录，不属于稳定的仓库文档入口。

## 未来路线草案

- [下一阶段演进意见与第三阶段详细规划建议](formula_simulator_next_stage_roadmap.md)：**未批准草案，后续架构另行讨论**。它保留基于 0.4.0 的建议原文，不是当前施工契约、验收依据或已经批准的阶段三架构。
