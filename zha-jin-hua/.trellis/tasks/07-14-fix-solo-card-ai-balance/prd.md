# 修复移动端手牌展示与单机 AI 盲加注漏洞

## Goal

修复单机对战中玩家看牌后手牌严重重叠，以及本地兜底 AI 可被持续盲加注稳定压制的问题。

## Requirements

- 玩家看牌后，自己的三张牌在手机竖屏上必须完整可辨；未看牌和对手暗牌继续保持紧凑叠放。
- 加注只能逐档提升，避免从基础注直接跳到最高档。
- 本地兜底 AI 必须按完整牌力和底池赔率决策，强牌在无法继续加注时不能默认弃牌。
- 本地兜底 AI 应能利用最近公开行动，对连续加注保留合理的跟注或比牌反制。
- 保持现有动作合法性、AI 风格差异、模型决策接口和多人游戏规则兼容。

## Acceptance Criteria

- [x] 手机视口下，玩家看牌后三张牌之间无重叠，牌面点数和花色均可见。
- [x] 基础注为 10 时只允许加注到 20，后续按 20、50、100、200 逐档提升。
- [x] 已看牌强牌面对最高注时选择跟注或比牌，不因没有更高加注档位而弃牌。
- [x] 固定种子的盲加注模拟不再让真人获得显著高于四人局合理范围的胜率。
- [x] 相关单测、类型检查、构建和移动端浏览器验证通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
