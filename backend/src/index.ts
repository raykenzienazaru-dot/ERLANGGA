import { createGatewayServer } from './server.ts';

const { server, config } = createGatewayServer();

server.listen(config.port, () => {
  console.log(`[Agrapatha BMKG Gateway] Server running on port ${config.port}`);
  console.log(`[Agrapatha BMKG Gateway] Allowed Origins: ${Array.from(config.allowedOrigins).join(', ')}`);
});

// Graceful shutdown handling
function shutdown(signal: string) {
  console.log(`[Agrapatha BMKG Gateway] Received ${signal}. Shutting down cleanly...`);
  server.close(() => {
    console.log('[Agrapatha BMKG Gateway] Closed all active connections.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
