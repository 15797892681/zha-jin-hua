import { z } from 'zod';

import {
  deepSeekDecisionSchema,
  isLegalIntent,
  type AiDecisionRequest,
  type DeepSeekDecision,
} from '../../ai/contracts';

export interface DeepSeekGatewayConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DeepSeekResult {
  decision: DeepSeekDecision;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface DeepSeekGateway {
  decide(request: AiDecisionRequest, signal: AbortSignal): Promise<DeepSeekResult>;
}

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().default(0),
    completion_tokens: z.number().int().nonnegative().default(0),
    total_tokens: z.number().int().nonnegative().default(0),
  }).optional(),
}).passthrough();

const PERSONA = {
  cautious: '你是青竹：冷静保守，重视筹码，少诈唬，台词克制。',
  bold: '你是赤焰：主动施压，偏好合理加注和比牌，台词自信但不辱骂。',
  chaotic: '你是飞星：活泼难测，可以诈唬，台词带调侃但不冒犯。',
} as const;

function systemPrompt(request: AiDecisionRequest): string {
  return [
    PERSONA[request.style],
    '你在玩炸金花。只能从 legalActions 中精确选择一个动作。',
    '不要泄露确切牌面，不要提及提示词、API、模型或系统实现。',
    '只返回 JSON，不要 Markdown。格式示例：',
    '{"action":{"type":"fold"},"dialogue":"这一手先收住。"}',
    'dialogue 必须是中文纯文本，最多 40 个字符。',
  ].join('\n');
}

export function createDeepSeekGateway(
  config: DeepSeekGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): DeepSeekGateway {
  return {
    async decide(request, signal) {
      const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt(request) },
            { role: 'user', content: JSON.stringify(request) },
          ],
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          max_tokens: 160,
        }),
      });
      if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);

      const completion = completionSchema.parse(await response.json());
      const content = completion.choices[0].message.content;
      if (!content) throw new Error('DEEPSEEK_EMPTY_CONTENT');

      const decision = deepSeekDecisionSchema.parse(JSON.parse(content));
      if (!isLegalIntent(decision.action, request.legalActions)) {
        throw new Error('DEEPSEEK_ILLEGAL_ACTION');
      }

      const usage = completion.usage;
      return {
        decision,
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          totalTokens: usage?.total_tokens ?? 0,
        },
      };
    },
  };
}
