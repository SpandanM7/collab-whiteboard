import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

// Load server/.env when present. Variables already set in the environment (e.g. on a host) win.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig(process.env);
const { httpServer, io } = createApp(config);

httpServer.listen(config.port, () => {
  console.log(
    `Whiteboard server listening on :${config.port} (allowing ${config.clientOrigins.join(', ')})`,
  );
});

const shutdown = () => {
  // Open sockets can stall a graceful close; the host kills the process soon after SIGTERM anyway.
  setTimeout(() => process.exit(1), 5_000).unref();
  void io.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
