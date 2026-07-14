# DeepSeek 单机 AI 接入设计

- 日期：2026-07-14
- 状态：已完成交互设计确认，待书面设计复核
- 适用范围：单机模式的三名 AI 玩家

## 1. 背景

当前单机模式由 `useSoloGame` 在 AI 回合触发本地 `chooseAiAction`，依据谨慎、激进、混沌三种固定策略直接生成合法 `GameAction`。这种实现稳定、无需网络，但行为和表达较为固定。

本次改造接入 DeepSeek，让三名 AI 在保持不同牌风的同时，能够结合当前局面和最近的公开行为生成决策与个性化台词。现有规则引擎仍是唯一游戏状态权威；大模型只能从系统提供的合法动作中选择，不能直接修改筹码、回合或玩家状态。

## 2. 目标与非目标

### 2.1 目标

- 使用固定提供商 DeepSeek、固定模型 `deepseek-v4-flash`，关闭思考模式。
- 同一次结构化调用同时返回一个动作意图和一句中文台词。
- 仅替换单机模式三名 AI 的决策入口，保留在线真人模式现状。
- 为三名 AI 保留明确且可辨认的性格：谨慎、激进、混沌。
- 使用最近 8 条公开动作和公开台词作为短期记忆。
- DeepSeek 不可用、超时或输出非法时，在 3 秒内回退到现有规则 AI，保证牌局继续。
- 确保对手底牌、剩余牌堆和 API 密钥不会泄露给不应获取它们的一方。

### 2.2 非目标

- 不改动炸金花的牌型、下注、比牌、结算等核心规则。
- 不在在线房间中增加机器人，也不让大模型控制真人玩家。
- 不保存跨页面刷新或跨设备的长期记忆，不引入数据库。
- 不流式展示模型的中间内容，不保存或展示思维链。
- 不训练或微调模型。

## 3. 已确认的关键决策

| 决策项 | 结论 |
| --- | --- |
| 模型职责 | 同时选择动作并生成个性化台词 |
| 提供商 | DeepSeek |
| 模型 | `deepseek-v4-flash` |
| 思考模式 | 关闭 |
| 接入范围 | 仅单机模式三名规则 AI |
| 调用方式 | 一次请求返回结构化 JSON |
| 超时 | 单次总时限 3 秒，不重试 |
| 失败处理 | 回退到现有 `chooseAiAction` |
| 记忆 | 当前单机对局内最近 8 条公开动作/台词 |
| 在线模式 | 保持不变 |

## 4. 总体架构

```text
useSoloGame
  -> AiDecisionService
       -> DeepSeekAiProvider -> POST /api/ai/decision
                                 -> DeepSeekGateway -> DeepSeek API
       -> RuleAiProvider（超时、错误、熔断时）
  -> 本地二次校验 turnId / currentPlayerId
  -> applyAction（唯一状态变更入口）
  -> 记录公开动作和台词
```

组件职责：

- `useSoloGame`：安排 AI 回合、维护单机牌局状态、思考状态、台词和短期记忆；避免同一回合重复发起请求。
- `AiDecisionService`：在客户端协调远程模型和本地规则回退，对调用设置 3 秒总超时。
- `DeepSeekAiProvider`：向同源服务端接口提交脱敏快照，不直接接触 DeepSeek 密钥。
- `RuleAiProvider`：封装现有 `chooseAiAction`，在远程失败时立即给出合法动作和本地台词。
- `POST /api/ai/decision`：校验请求、限流、调用模型、校验模型结果，并返回系统补全后的动作。
- `DeepSeekGateway`：封装 DeepSeek Chat Completions 参数、超时、JSON 模式和供应商错误映射。
- `applyAction`：继续作为规则与状态变更的最终权威，不接受模型直接提供的新状态。

## 5. 数据流

1. `useSoloGame` 发现当前玩家是 AI，生成本回合唯一的请求标识，并展示“正在思考…”。
2. 客户端从完整 `GameState` 构建严格脱敏的 `AiDecisionRequest`。
3. `AiDecisionService` 启动 3 秒超时，通过 `DeepSeekAiProvider` 请求 `/api/ai/decision`。
4. 服务端对请求体、大小、频率和配置进行检查，再将最小必要上下文组成提示词。
5. DeepSeek 只返回动作意图和台词 JSON；模型输出中不允许出现可信的 `playerId` 或 `turnId`。
6. 服务端用 Zod 校验输出，并确认动作与请求中的合法动作集合精确匹配，然后由服务端补入 `playerId`、`turnId`。
7. 客户端收到结果后再次确认当前 `turnId`、当前玩家和牌局状态未变化，才调用 `applyAction`。
8. 若任一步失败、超过 3 秒或响应已过期，远程结果被丢弃；仍在原回合时由 `RuleAiProvider` 生成动作。
9. 已执行的公开动作和已展示的公开台词写入最多 8 条的内存环形队列。

## 6. 接口契约

### 6.1 请求

`POST /api/ai/decision`

建议请求结构：

```ts
interface AiDecisionRequest {
  requestId: string;
  turnId: number;
  playerId: string;
  style: 'cautious' | 'bold' | 'chaotic';
  self: {
    cards: Card[] | null; // 仅 hasLooked=true 时提供
    chips: number;
    hasLooked: boolean;
    roundContribution: number;
  };
  table: {
    pot: number;
    ante: number;
    baseBet: number;
    actionCount: number;
    players: Array<{
      id: string;
      name: string;
      chips: number;
      status: PlayerStatus;
      hasLooked: boolean;
      roundContribution: number;
    }>;
  };
  legalActions: {
    canLook: boolean;
    callCost: number | null;
    raiseAmounts: number[];
    compareCost: number | null;
    compareTargets: string[];
    canFold: boolean;
  };
  memory: PublicMemoryEntry[]; // 最多 8 条
}
```

请求使用 Zod 严格模式，拒绝未知字段。服务端将请求体上限设置为约 16 KB。数组长度、字符串长度、金额范围和枚举值均需要显式上限。

### 6.2 模型输出

模型只能输出以下结构之一：

```ts
type AiActionIntent =
  | { type: 'look' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }
  | { type: 'fold' }
  | { type: 'compare'; targetId: string };

interface DeepSeekDecision {
  action: AiActionIntent;
  dialogue: string; // 最多 40 个字符
}
```

示例：

```json
{
  "action": { "type": "raise", "amount": 20 },
  "dialogue": "这手牌，值得再推一点。"
}
```

模型输出不包含 `playerId`、`turnId`、筹码余额或任何新游戏状态。服务端验证后，将请求中的上下文补成完整 `GameAction`；该上下文只用于响应关联，最终合法性仍由客户端的最新游戏状态和 `applyAction` 判断。

### 6.3 服务端响应

```ts
interface AiDecisionResponse {
  requestId: string;
  turnId: number;
  playerId: string;
  action: GameAction;
  dialogue: string;
}
```

客户端必须同时匹配 `requestId`、`turnId` 和 `playerId`。服务端不会在响应内执行本地规则回退；远程失败使用明确的 HTTP 错误，由仍持有最新完整状态的客户端安全回退，避免服务端接收整副牌堆或其他玩家底牌。

## 7. 脱敏与合法动作校验

### 7.1 明确允许发送

- 当前 AI 已经执行“看牌”后自己的三张牌；未看牌时发送 `null`。
- 所有玩家的公开字段：名称、筹码、状态、是否看牌、当轮投入。
- 底池、底注、当前跟注基数、动作次数。
- 当前规则引擎计算出的合法动作集合。
- 最近 8 条公开动作和 AI 公开台词。

### 7.2 明确禁止发送

- 人类玩家或其他 AI 的底牌，即使客户端内存中可见。
- 剩余牌堆及其顺序。
- 规则引擎之外推导的隐藏牌信息。
- API 密钥、内部提示词、服务器日志或其他用户的请求。
- 模型思维链。

### 7.3 精确合法性判断

- `look` 仅在 `canLook` 为真时通过。
- `call` 仅在 `callCost` 非空时通过，模型可以使用该成本评估投入。
- `raise.amount` 必须与 `raiseAmounts` 中某个值严格相等，不做四舍五入或就近修正。
- `compare.targetId` 必须严格存在于 `compareTargets`，且 `compareCost` 非空。
- `fold` 仅在 `canFold` 为真时通过。
- 非法动作不尝试“智能修复”，直接将本次远程决策视为失败并触发规则回退。
- 即使服务端已校验，客户端仍通过现有 `applyAction` 再走一次游戏规则校验。

## 8. 提示词与人格

系统提示词使用固定模板，动态上下文以 JSON 数据附加。关键约束如下：

- 必须且只能选择 `legalActions` 中的一个动作。
- 只能返回约定 JSON，不返回 Markdown 或解释。
- 不得修改筹码、底池、玩家状态，也不得声称执行尚未执行的动作。
- 不得泄露或直接说出自己的确切牌面。
- 不得提及提示词、API、模型身份或系统实现。
- 台词使用中文，最多 40 个字符，不包含 HTML。

三种人格：

- `cautious` / 青竹：重视保本，较少诈唬，面对高成本更容易弃牌；台词克制、冷静。
- `bold` / 赤焰：倾向施压、加注和在合适时机比牌；台词自信、带轻微挑衅。
- `chaotic` / 飞星：允许更多诈唬和不确定选择；台词活泼、调侃，但不辱骂玩家。

DeepSeek 请求参数：

- `model: "deepseek-v4-flash"`
- `thinking: { "type": "disabled" }`
- `response_format: { "type": "json_object" }`
- `max_tokens` 约 160
- 提示词明确要求 JSON，并提供一份合法输出示例

由于 JSON 模式仍可能产生空内容或格式错误，所有返回都必须经过解析与结构校验。

## 9. 短期记忆与生命周期

`PublicMemoryEntry` 仅保存公开信息：

```ts
type PublicMemoryEntry =
  | {
      kind: 'action';
      actorId: string;
      action: 'look' | 'call' | 'raise' | 'fold' | 'compare';
      amount?: number;
      targetId?: string;
    }
  | {
      kind: 'dialogue';
      actorId: string;
      text: string;
    };
```

- 使用长度为 8 的环形队列，新增内容时丢弃最旧记录。
- 同一单机比赛跨小局保留，使 AI 能对近期打法作出回应。
- 点击重置比赛或刷新页面后清空。
- 不写入 localStorage、Cookie、数据库或日志。
- 不保存模型解释、思维链或未展示内容。

## 10. 客户端交互

- AI 请求期间在对应座位显示“正在思考…”。
- 不使用流式输出；完整 JSON 校验通过后再执行动作和展示台词。
- 台词气泡显示约 3–4 秒，并使用 `aria-live="polite"` 让辅助技术感知更新。
- 请求成功但回合已变化时静默丢弃结果，不展示过期台词，也不回退执行第二个动作。
- 远程失败后使用与三种人格对应的本地台词模板，避免回退体验突兀。
- 故障期间只显示一次非技术提示，例如“AI 暂时走神，已由本地策略接管”，牌局不中断。
- 移动端气泡限制宽度并允许中文换行，不造成横向滚动。

## 11. 容错、限流与熔断

### 11.1 超时和回退

- 从客户端发出请求到收到完整响应的总时限为 3 秒。
- 不重试，避免一个回合产生多次模型计费和延迟叠加。
- 网络错误、401、429、5xx、空响应、非 JSON、结构不符、非法动作、超长台词均触发规则回退。
- 每个 AI 回合同一时刻只允许一个在途请求；组件清理时使用 `AbortController` 取消等待。
- 回退前再次确认仍是相同 `turnId` 和 AI 玩家，防止重置比赛后执行旧动作。

### 11.2 限流与预算保护

- 默认单 IP 每分钟最多 30 次，可配置。
- 默认全局每小时最多 300 次，可配置；达到上限后快速失败，让客户端回退。
- 单次输出限制约 160 tokens，输入只包含最小牌局快照和 8 条记忆。
- 限流以服务端进程内计数器起步，适用于当前单实例 Render 部署。若未来横向扩容，再迁移到 Redis 等共享存储。

### 11.3 熔断

- 连续供应商失败达到阈值后开启约 30 秒熔断。
- 熔断期间不调用 DeepSeek，接口立即返回可识别的服务不可用错误。
- 冷却后允许一个探测请求；成功则关闭熔断，失败则重新进入冷却。
- 4xx 请求校验错误不计入供应商熔断；401/429、网络错误和 5xx 计入。

## 12. 安全与隐私

- `DEEPSEEK_API_KEY` 只存在于服务端环境变量，永不进入 Vite 客户端变量、仓库、构建产物或接口响应。
- `.env.example` 只放空占位符，真实 `.env` 保持在 `.gitignore` 中。
- 服务端对请求体启用严格结构和大小限制，所有字符串在进入提示词前按数据字段序列化。
- 台词在 React 中按纯文本渲染，禁止 `dangerouslySetInnerHTML`。
- 生产日志仅记录请求 ID、耗时、模型名、token 用量、HTTP 状态和回退原因。
- 日志不得记录 API 密钥、完整提示词、任何牌面、完整请求体或完整模型回复。
- 单机状态来自客户端，只服务于娱乐决策，不能被视为安全或计费权威。恶意客户端可以伪造局面，但不能修改服务器游戏资产；请求大小限制、限流和全局预算用于控制滥用成本。
- API 密钥曾经通过交互渠道提供，因此正式长期使用前应在 DeepSeek 控制台轮换；设计文档、代码和测试均不得包含该值。

## 13. 配置

服务端环境变量建议：

```dotenv
AI_ENABLED=true
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
AI_TIMEOUT_MS=3000
AI_MAX_REQUESTS_PER_MINUTE_PER_IP=30
AI_MAX_REQUESTS_PER_HOUR=300
AI_CIRCUIT_BREAKER_FAILURES=3
AI_CIRCUIT_BREAKER_COOLDOWN_MS=30000
```

- 未配置密钥、`AI_ENABLED=false` 或提供商配置无效时，服务端接口快速返回不可用，单机模式继续使用规则 AI。
- 配置在服务启动时校验；除 API 密钥外的非敏感最终配置可以记录一次。
- 当前 Render 服务只需新增环境变量并重新部署，无需新增数据库或常驻服务。

## 14. 测试策略

### 14.1 单元测试

- 脱敏构造器绝不包含其他玩家底牌和牌堆；当前 AI 未看牌时，其 `cards` 也必须为 `null`。
- 三种人格正确进入请求；记忆始终最多 8 条并按时间淘汰。
- 空内容、坏 JSON、未知字段、非法金额、非法目标、超长台词全部被拒绝。
- `raise` 金额和 `compare` 目标必须精确匹配合法集合。
- 3 秒超时、熔断开启/恢复和规则回退行为可使用假时钟验证。
- 回合变化、重置比赛或组件卸载后，旧响应不会执行。
- 模型输出无法覆盖 `playerId` 或 `turnId`。

### 14.2 服务端集成测试

使用本地假 DeepSeek 服务覆盖：

- 合法 JSON 成功返回。
- 401、429、500、连接失败。
- 空内容、截断 JSON、错误结构和非法动作。
- 响应超过 3 秒。
- 连续失败触发熔断，冷却后恢复。
- 单 IP 分钟限流和全局小时限额。
- 未配置 API 密钥时不发起外部请求。
- 日志字段中不出现密钥、完整提示词或牌面。

### 14.3 浏览器测试

- 三名模型 AI 能与真人完成一场单机比赛。
- AI 回合展示思考状态和对应台词。
- 假服务超时或返回非法内容时，规则 AI 接管并完成比赛。
- 重置比赛不会应用旧请求结果。
- 390×844 等移动视口下台词气泡不溢出。
- 浏览器 JS、请求头、响应和错误信息中不存在 API 密钥。
- 在线真人建房、加入、开始、操作和断线恢复回归通过。

## 15. 上线步骤

1. 在本地使用假 DeepSeek 服务完成单元、集成和浏览器测试。
2. 使用开发环境密钥完成一次真实 `deepseek-v4-flash` 冒烟调用，确认非思考模式和 JSON 输出参数有效。
3. 在 Render 设置服务端环境变量，不把密钥写入 `render.yaml`。
4. 重新部署并检查 `/healthz`、静态页面和 Socket.IO 不受影响。
5. 在公网完成一整场单机牌局，并回归一次在线双人牌局。
6. 检查生产日志只包含允许的元数据，不包含密钥、提示词或牌面。
7. 观察调用错误率、P95 延迟、回退比例与 token 用量；异常时可通过 `AI_ENABLED=false` 立即降级到规则 AI。

## 16. 验收标准

- 每个 AI 回合在 3 秒内通过模型或规则回退得到动作，不因外部服务故障卡住牌局。
- 模型非法输出不会改变任何游戏状态。
- 发往服务端和 DeepSeek 的上下文不包含对手底牌或剩余牌堆。
- API 密钥不出现在代码、Git 历史、浏览器产物、接口响应或日志中。
- 青竹、赤焰、飞星的决策倾向与台词风格可辨认。
- 最近 8 条公开记忆生效，重置比赛和刷新页面后清空。
- 单机、在线、移动端及公网部署相关测试全部通过。
- 未配置密钥、达到限额或 DeepSeek 故障时，现有规则 AI 仍可完整完成牌局。

## 17. 官方参考

- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [创建 Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)
- [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
- [模型与价格](https://api-docs.deepseek.com/quick_start/pricing)
