// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createGameServer, type GameServer } from '../src/server/index';

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

    server = createGameServer({ clientRoot });
    await server.start(0);
    const address = server.httpServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await expect(fetch(`${baseUrl}/healthz`).then((response) => response.json()))
      .resolves.toEqual({ ok: true });
    await expect(fetch(`${baseUrl}/assets/app.js`).then((response) => response.text()))
      .resolves.toContain('__ZJH__');
    await expect(fetch(`${baseUrl}/room/A7K9Q2`).then((response) => response.text()))
      .resolves.toContain('金局生产页面');
  });
});
