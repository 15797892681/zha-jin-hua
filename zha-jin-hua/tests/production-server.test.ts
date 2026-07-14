// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildAiDecisionRequest } from '../src/ai/context';
import { createAiDecisionRouter } from '../src/server/ai/route';
import { createGameServer, type GameServer } from '../src/server/index';
import { createGame } from '../src/shared/game';

function aiBody() {
  const state = createGame({
    players: [{ id: 'bot', name: '青竹' }, { id: 'you', name: '你' }],
    startingChips: 1000,
    ante: 10,
    random: () => 0,
  });
  return buildAiDecisionRequest(state, 'bot', 'cautious', [], 'req-production');
}

describe('production web server', () => {
  let server: GameServer | undefined;
  let clientRoot: string | undefined;

  afterEach(async () => {
    await server?.stop();
    if (clientRoot) await rm(clientRoot, { recursive: true, force: true });
  });

  it('serves health, built assets, and the SPA fallback from one process', async () => {
    clientRoot = await mkdtemp(join(tmpdir(), 'zjh-client-'));
    await mkdir(join(clientRoot, 'assets'));
    await writeFile(join(clientRoot, 'index.html'), '<main>金局生产页面</main>');
    await writeFile(join(clientRoot, 'assets', 'app.js'), 'window.__ZJH__ = true');

    server = createGameServer({ clientRoot, aiRouter: createAiDecisionRouter({ env: {} }) });
    await server.start(0);
    const address = server.httpServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await expect(fetch(`${baseUrl}/healthz`).then((response) => response.json()))
      .resolves.toEqual({ ok: true });
    await expect(fetch(`${baseUrl}/assets/app.js`).then((response) => response.text()))
      .resolves.toContain('__ZJH__');
    await expect(fetch(`${baseUrl}/room/A7K9Q2`).then((response) => response.text()))
      .resolves.toContain('金局生产页面');

    const aiResponse = await fetch(`${baseUrl}/api/ai/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(aiBody()),
    });
    expect(aiResponse.status).toBe(503);
    expect(aiResponse.headers.get('content-type')).toContain('application/json');
    await expect(aiResponse.json()).resolves.toEqual({ code: 'AI_DISABLED' });
  });
});
