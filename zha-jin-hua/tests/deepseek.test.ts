// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildAiDecisionRequest } from '../src/ai/context';
import { createDeepSeekGateway } from '../src/server/ai/deepseek';
import { createGame } from '../src/shared/game';

function request() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
  return buildAiDecisionRequest(state, 'bot', 'cautious', [], 'req-deepseek');
}

describe('DeepSeek gateway', () => {
  it('uses V4 Flash with thinking disabled and JSON mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"action":{"type":"fold"},"dialogue":"先收一手。"}' } }],
      usage: { prompt_tokens: 90, completion_tokens: 18, total_tokens: 108 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);

    await expect(gateway.decide(request(), new AbortController().signal)).resolves.toEqual({
      decision: { action: { type: 'fold' }, dialogue: '先收一手。' },
      usage: { promptTokens: 90, completionTokens: 18, totalTokens: 108 },
    });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      max_tokens: 160,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(String(init.body)).not.toContain('deck');
  });

  it('tells the model that tactics already constrained the legal actions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"action":{"type":"fold"},"dialogue":"这手不跟。"}' } }],
    }), { status: 200 }));
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);

    await gateway.decide(request(), new AbortController().signal, {
      pressure: 'high',
      aggressorId: 'you',
      strength: 'competitive',
    });

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    const system = String(body.messages[0].content);
    expect(system).toContain('legalActions 已由战术引擎筛选');
    expect(system).toContain('当前压力：high');
    expect(system).toContain('主要施压者：you');
    expect(system).toContain('策略牌力分层：competitive');
  });

  it.each([
    '',
    'not-json',
    '{"action":{"type":"raise","amount":11},"dialogue":"加一点。"}',
    '{"action":{"type":"fold"},"dialogue":"超长'.concat('长'.repeat(41), '"}'),
  ])('rejects empty, malformed, illegal, or oversized output', async (content) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), { status: 200 }));
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);

    await expect(gateway.decide(request(), new AbortController().signal)).rejects.toThrow();
  });

  it('maps non-success provider responses to a sanitized error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('account detail', { status: 401 }),
    );
    const gateway = createDeepSeekGateway({
      apiKey: 'test-key', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash',
    }, fetchImpl);

    await expect(gateway.decide(request(), new AbortController().signal))
      .rejects.toThrow('DEEPSEEK_HTTP_401');
  });
});
