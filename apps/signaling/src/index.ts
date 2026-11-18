import { SignalingServer } from './server.js';

const server = new SignalingServer();

server.start().catch((err) => {
  console.error('[signaling] falha ao iniciar', err);
  process.exit(1);
});

async function shutdown(): Promise<void> {
  console.log('[signaling] encerrando...');
  await server.stop();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
