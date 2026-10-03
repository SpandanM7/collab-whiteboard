import { parseOrigins } from './origins.ts';

export type Config = {
  port: number;
  /**
   * Browser origins allowed to connect, without trailing slashes. Entries may use `*` inside the
   * hostname (see `origins.ts`).
   */
  clientOrigins: string[];
};

/** Reads and validates configuration from an environment map. Throws a readable error. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];

  const port = Number(env.PORT);
  if (!env.PORT || !Number.isInteger(port) || port < 0 || port > 65535) {
    problems.push('PORT must be an integer between 0 and 65535');
  }

  // A comma-separated list lets one server accept the production site, a custom domain and
  // preview deployments. Each entry is reduced to its origin, so a typed trailing slash is fine.
  const { origins: clientOrigins, invalid } = parseOrigins(env.CLIENT_URL);
  if (clientOrigins.length === 0 || invalid.length > 0) {
    const detail = invalid.length > 0 ? ` (cannot use: ${invalid.join(', ')})` : '';
    problems.push(
      'CLIENT_URL must be one or more full URLs separated by commas, ' +
        `such as http://localhost:5173${detail}`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid server configuration:\n- ${problems.join('\n- ')}\n` +
        'Copy server/.env.example to server/.env, or set these variables in the environment.',
    );
  }
  return { port, clientOrigins };
}
