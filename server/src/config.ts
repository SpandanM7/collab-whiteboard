export type Config = {
  port: number;
  /** Allowed browser origin, without a trailing slash. */
  clientUrl: string;
};

/** Reads and validates configuration from an environment map. Throws a readable error. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const problems: string[] = [];

  const port = Number(env.PORT);
  if (!env.PORT || !Number.isInteger(port) || port < 0 || port > 65535) {
    problems.push('PORT must be an integer between 0 and 65535');
  }

  let clientUrl = '';
  try {
    // An origin has no path, so normalise away any trailing slash a user may have typed.
    clientUrl = new URL(env.CLIENT_URL ?? '').origin;
  } catch {
    problems.push('CLIENT_URL must be a full URL such as http://localhost:5173');
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid server configuration:\n- ${problems.join('\n- ')}\n` +
        'Copy server/.env.example to server/.env, or set these variables in the environment.',
    );
  }
  return { port, clientUrl };
}
