import { createServer, type Server as HttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import express, { type Express } from 'express';
import { Server as SocketServer } from 'socket.io';

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

export function createGameServer(): GameServer {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: true, credentials: true } });
  const rooms = new RoomManager();

  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  registerSocketHandlers(io, rooms);

  return {
    app,
    httpServer,
    io,
    rooms,
    start(port) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, '127.0.0.1', () => {
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
    console.log(`金局服务已启动：http://127.0.0.1:${port}`);
  });
}
