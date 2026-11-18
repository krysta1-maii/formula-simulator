# B0 审计基线 0.2.0（fbb401d）

| 项目 | 值 |
| --- | --- |
| 应用版本 | 0.2.0 |
| 提交 | fbb401d |
| 生成时间 | 2026-11-18T17:04:37.944Z |
| 环境 | Node v24.22.1；linux/x64；Chrome auto |
| 检查总数 | 51 |
| 通过 | 12 |
| 已知失败 | 39 |
| 缺陷组 | 12 |

**历史快照说明：** 修复前基线（39 knownFailures）见提交 `ed8aa0a`；本文档是 B0 阶段在 `fbb401d` 上生成的修复前证据表，当前 `tools/audit/baseline/0.2.0.json` 已是修复后基线（51/51 pass、knownFailures 0）。两者分别作为“历史红”与“当前绿”的对照，不得混用。

本文件由 tools/audit/baseline/0.2.0.json 生成，用于记录 fbb401d 源码上的 B0 失败基线（历史）。修复批次每完成一项，应在同一提交中更新 JSON 中对应条目的 status/knownFailure。

## 12 项缺陷证据

| 缺陷 | 检查数 | 失败数 | 失败检查 |
| --- | ---: | ---: | --- |
| B4.1 | 5 | 5 | B4.1/unreachable-ok<br>B4.1/ok-residual<br>B4.1/motion-ratio-range<br>B4.1/motion-ratio-continuity<br>B4.1/damping-peak |
| B4.2 | 12 | 6 | B4.2/cg-drift-x<br>B4.2/ref-path-x<br>B4.2/cg-drift-y<br>B4.2/ref-path-y<br>B4.2/cg-drift-z<br>B4.2/ref-path-z |
| B4.3 | 5 | 5 | B4.3/low-speed-hold<br>B4.3/contact-state-field<br>B4.3/step-no-reversal<br>B4.3/slope-perturbation<br>B4.3/repark |
| B4.4 | 3 | 3 | B4.4/body-moment<br>B4.4/road-magnitude<br>B4.4/yaw90-axis |
| B4.5 | 4 | 3 | B4.5/default-sample<br>B4.5/attitudes<br>B4.5/fallback-full-quaternion |
| B5.1 | 6 | 4 | B5.1/10-time<br>B5.1/5-time<br>B5.1/5-clamp50-time<br>B5.1/dropped-field |
| B5.2 | 1 | 1 | B5.2/geometry-generation |
| B5.3 | 1 | 1 | B5.3/telemetry-dom |
| B5.4 | 1 | 1 | B5.4/material-release |
| O1 | 5 | 5 | O1/writeback-peak<br>O1/writeback-state<br>O1/seed-poison<br>O1/peak-bound<br>O1/chunked-vs-one-shot |
| A2 | 2 | 1 | A2/no-silent-fallback |
| UI | 4 | 4 | U1/landscape<br>U2/space-key<br>U3/panel-focus<br>U4/pause-text |

## 按审计脚本分组的检查

### free-body（12 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B4.2/cg-drift-x | fail | {"cgDriftMm":287.65523540431394,"time":1.0000000000000007} | cgDriftMm <= 0.01 |
| B4.2/ref-path-x | fail | {"refDispMm":0,"expectedRefMm":287.65532316252177} | abs(refDispMm - expectedRefMm) <= 0.5 |
| B4.2/omega-x | pass | {"omegaError":0} | omegaError <= 1e-9 |
| B4.2/quat-norm-x | pass | {"qnormError":1.1102230246251565e-16} | qnormError <= 1e-12 |
| B4.2/cg-drift-y | fail | {"cgDriftMm":153.17641285279714,"time":1.0000000000000007} | cgDriftMm <= 0.01 |
| B4.2/ref-path-y | fail | {"refDispMm":0,"expectedRefMm":153.1764595840428} | abs(refDispMm - expectedRefMm) <= 0.5 |
| B4.2/omega-y | pass | {"omegaError":0} | omegaError <= 1e-9 |
| B4.2/quat-norm-y | pass | {"qnormError":1.1102230246251565e-16} | qnormError <= 1e-12 |
| B4.2/cg-drift-z | fail | {"cgDriftMm":325.896529453693,"time":1.0000000000000007} | cgDriftMm <= 0.01 |
| B4.2/ref-path-z | fail | {"refDispMm":0,"expectedRefMm":325.89662887860123} | abs(refDispMm - expectedRefMm) <= 0.5 |
| B4.2/omega-z | pass | {"omegaError":0} | omegaError <= 1e-9 |
| B4.2/quat-norm-z | pass | {"qnormError":1.1102230246251565e-16} | qnormError <= 1e-12 |

### rocker-reach（5 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B4.1/unreachable-ok | fail | {"unreachableOk":333,"firstViolation":{"corner":0,"step":123,"time":1.7480000000000013,"targetMm":707.834385779026,"minReachMm":707.96006... | unreachableOk == 0 |
| B4.1/ok-residual | fail | {"okWithResidual":331,"maxResidualMm":18.65962844658686,"maxResidualInfo":{"corner":1,"step":170,"time":1.8420000000000014,"ok":true,"res... | okWithResidual == 0 and residual <= 0.1 mm when ok |
| B4.1/motion-ratio-range | fail | {"minRatio":-6.920767895481738,"maxRatio":6.97951129504959,"unavailableWhenOk":0} | 0.2 <= ratio <= 0.8 and available when ok |
| B4.1/motion-ratio-continuity | fail | {"maxJump":11.175300468627274} | maxJump <= 0.02 per 2 ms step |
| B4.1/damping-peak | fail | {"peakDampingKN":33.38071676162761,"peakInfo":{"corner":0,"step":357,"time":2.2159999999999775,"dampingN":33380.71676162761,"ratio":-6.92... | peakDampingKN <= 15 |

### seed-writeback（4 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| O1/writeback-peak | fail | {"plainPeakKN":33.38071676162761,"writebackPeakKN":46.42256602607738,"relativeDelta":0.39070009663309135,"writebackPeakInfo":{"frame":16,... | abs(writebackPeak - plainPeak) / plainPeak <= 0.01 |
| O1/writeback-state | fail | {"stateDelta":0.2767338307190885,"plainTime":2.939999999999898,"writebackTime":2.939999999999898} | state delta <= 1e-12 |
| O1/seed-poison | fail | {"poisonDelta":0.7583233499260326,"poisonPeakKN":1.2586334642812966} | state delta <= 1e-12 after poisoning corner.angle |
| O1/peak-bound | fail | {"plainPeakKN":33.38071676162761} | plainPeakKN <= 15 |

### shadowing（2 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| A2/source-contract | pass | {"sourcePresent":true,"sourceFriction":0.2,"capacityWithSource":1565.1413400000768} | reference.source exists and carries setup friction |
| A2/no-silent-fallback | fail | {"threw":false,"message":"","capacityWithSource":1565.1413400000768,"capacityWithoutSource":10955.989380000536,"ratio":6.999999999999999} | throw mentioning reference.source or keep capacity ratio 1 |

### friction-low-speed（5 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B4.3/low-speed-hold | fail | {"afterOne":{"vx":0.0005,"x":0.000001,"mode":"SLIP","hasContactState":false},"afterFour":{"vx":0.0005,"x":0.000004,"mode":"SLIP","displac... | vx <= 1e-12 after one step; HOLD after four; displacement <= 2e-6 m |
| B4.3/contact-state-field | fail | {"hasContactState":false,"mode":"SLIP"} | sim.contact.mode in HOLD/SLIP |
| B4.3/step-no-reversal | fail | {"vx":-0.017458620000001347,"x":-0.0000349172400000027,"mode":"SLIP"} | 0 <= vx < 1e-6 and 0 <= x < 1e-4 after one 2 ms step |
| B4.3/slope-perturbation | fail | {"vx":-0.010539618848534854,"displacement":0.00005765578240903479,"mode":"SLIP"} | HOLD, vx <= 1e-12, displacement < 1e-4 m |
| B4.3/repark | fail | {"before":{"time":1.0000000000000007,"vx":-0.3620201581621636,"vz":0.3566000804016967,"mode":"SLIP","displacement":0.249565444533955},"re... | HOLD within 0.1 s, velocities zero, drift < 1e-9 m |

### impulse-frame（3 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B4.4/body-moment | fail | {"maxBodyError":12770.45,"expected":[0,0,-6880.45],"yaw0Body":[0,0,-5890],"yaw90Body":[5889.999999999999,0,-1.8189894035458565e-12]} | maxBodyError <= 1e-9 N m over 24 yaw attitudes |
| B4.4/road-magnitude | fail | {"maxMagnitudeError":990.4499999999998,"expectedMagnitude":6880.45} | abs(\|M\| - 6880.45) <= 1e-9 |
| B4.4/yaw90-axis | fail | {"yaw90Body":[5889.999999999999,0,-1.8189894035458565e-12]} | yaw 90 body moment = (0, 0, -6880.45) |

### contact-gap（4 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B4.5/default-sample | fail | {"gapMm":8.534883084616181,"perCorner":[{"index":0,"gapMm":8.534883084616181},{"index":1,"gapMm":8.53488308461201},{"index":2,"gapMm":5.4... | gapMm <= 1e-3 |
| B4.5/attitudes | fail | {"maxAttitudeGapMm":178.81062465697664,"cases":[{"label":"pitch-0","pitchDeg":0,"rollDeg":0,"gapMm":7.21791807559047,"maxY":4.52815762579... | max gap <= 1e-3 mm for pitch/roll 0/2/5/10 and 8/7, 10/10 tilt |
| B4.5/contact-plane | pass | {"maxY":9.016483257717409e-11} | abs(contact.y) <= 1e-6 m |
| B4.5/fallback-full-quaternion | fail | {"rollDeg":10,"maxY":0,"maxVsYawOnlyMm":0,"perCorner":[{"index":0,"y":0,"vsYawOnlyMm":0,"vsSolvedMm":28.897353247887285},{"index":1,"y":0... | fallback y <= 1e-6 m and differs from yaw-only by > 10 mm |

### frame-time（6 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B5.1/60hz | pass | {"hz":60,"clampMs":null,"frames":60,"wallSeconds":1,"advanced":1.0000000000000007,"dropped":null,"total":1.0000000000000007,"maxSubsteps"... | advanced >= 0.98 s at 1 s wall |
| B5.1/30hz | pass | {"hz":30,"clampMs":null,"frames":30,"wallSeconds":1,"advanced":0.9980000000000007,"dropped":null,"total":0.9980000000000007,"maxSubsteps"... | advanced >= 0.98 s at 1 s wall |
| B5.1/10-time | fail | {"hz":10,"clampMs":null,"frames":10,"wallSeconds":1,"advanced":0.8000000000000005,"dropped":null,"total":0.8000000000000005,"maxSubsteps"... | advanced >= 0.98 or advanced+droppedTime >= 0.98 with droppedTime > 0 |
| B5.1/5-time | fail | {"hz":5,"clampMs":null,"frames":5,"wallSeconds":1,"advanced":0.4000000000000003,"dropped":null,"total":0.4000000000000003,"maxSubsteps":4... | advanced >= 0.98 or advanced+droppedTime >= 0.98 with droppedTime > 0 |
| B5.1/5-clamp50-time | fail | {"hz":5,"clampMs":50,"frames":5,"wallSeconds":1,"advanced":0.24800000000000016,"dropped":null,"total":0.24800000000000016,"maxSubsteps":2... | advanced >= 0.98 or advanced+droppedTime >= 0.98 with droppedTime > 0 |
| B5.1/dropped-field | fail | {"fields":[{"hz":60,"clampMs":null,"advanced":1.0000000000000007,"dropped":null,"hasDroppedField":false},{"hz":30,"clampMs":null,"advance... | all low-rate cases expose droppedTime or stay real time |

### browser-contract（5 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| B5.2/geometry-generation | fail | {"wheelGapMaxMm":0,"linkStretchMm":146.08615403471993,"diagStretchMm":104.09899342281447,"stretch":{"susp":104.09899342281447,"tie":146.0... | wheel gap <= 1e-6 m and link stretch <= 0.001 mm |
| B5.3/telemetry-dom | fail | {"listPresent":true,"mutationCount":9} | mutationCount === 0 over 1.2 s idle |
| B5.4/material-release | fail | {"materialDisposed":0,"geometryDisposed":387} | materialDisposed >= 3 and geometryDisposed > 0 |
| O1/chunked-vs-one-shot | fail | {"bodyPosDelta":0.0007146018970887111,"quatDelta":0,"dampingDelta":52.96367097604559,"travelDelta":1.0162608595275326} | body/quaternion delta <= 1e-9 and damping/travel delta <= 1e-6 |
| browser-contract/page-errors | pass | {"pageErrors":[]} | pageErrors.length === 0 |

### ui（5 项）

| 检查 | 状态 | 实测摘要 | 判据 |
| --- | --- | --- | --- |
| U1/landscape | fail | {"viewport":{"width":844,"height":390},"topbar":{"top":0,"bottom":70,"height":70,"width":844},"bottomBar":{"top":468,"bottom":510,"height... | topbar and bottom-bar inside 844x390 viewport |
| U2/space-key | fail | {"focused":"btnHelp","modalOpen":false,"beforeRunning":true,"afterRunning":false} | Space opens the help modal and does not toggle simulation |
| U3/panel-focus | fail | {"open":false,"inert":false,"ariaHidden":null,"focusable":38} | closed panel is inert and aria-hidden |
| U4/pause-text | fail | {"detail":"运行 · t 2.10 s · 500 Hz · 静摩擦保持","running":false} | simDetail contains pause and does not start with running |
| ui/page-errors | pass | {"pageErrors":[]} | pageErrors.length === 0 |

## 计数口径说明

本文档所记录的历史基线快照为 51 个唯一 check，其中 12 个通过、39 个已知失败。lead 验证消息记录为 50 checks / 39 knownFailures；差异来自 browser-contract 与 ui 的 page-errors 检查曾共用同一 id，唯一化后多出 1 个通过项，失败项数不变。以本 JSON 为准，未回改基线文件。

已知失败项清单见 JSON 的 knownFailures 数组；审计脚本退出码约定为 0 通过、1 断言失败、2 环境或装载错误。
