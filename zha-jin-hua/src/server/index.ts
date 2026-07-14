import { createServer, type Server as HttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import express, { type Express, type Router } from 'express';
import { Server as SocketServer } from 'socket.io';

import { createAiDecisionRouter } from './ai/route';
import { RoomManager } from './rooms';
import { registerSocketHandlers } from './socket';

export interface GameServer {
  app: Express;
  httpServer: HttpServer;
  io: SocketServer;
  rooms: RoomManager;
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

export interface GameServerOptions {
  clientRoot?: string;
  aiRouter?: Router;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: true, credentials: true } });
  const rooms = new RoomManager();
  const clientRoot = options.clientRoot ?? resolve(process.cwd(), 'dist/client');

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/ai', options.aiRouter ?? createAiDecisionRouter());
  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  app.use(express.static(clientRoot));
  app.get('/{*splat}', async (_request, response) => {
    const html = await readFile(resolve(clientRoot, 'index.html'), 'utf8');
    response.type('html').send(html);
  });
  registerSocketHandlers(io, rooms);

  return {
    app,
    httpServer,
    io,
    rooms,
    start(port) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '0.0.0.0', () => {
          httpServer.off('error', reject);
          resolve();
        });
      });
    },
    stop() {
      rooms.dispose();
      if (!httpServer.listening) return Promise.resolve();
      return new Promise((resolve) => io.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const server = createGameServer();
  const port = Number(process.env.PORT ?? 3001);
  server.start(port).then(() => {
    console.log(`金局服务已启动：http://0.0.0.0:${port}`);
  });
}
