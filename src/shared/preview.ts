export function codespaceHost(env: NodeJS.ProcessEnv): string | undefined {
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || !domain) return undefined;
  if (!/^[a-z0-9-]+$/i.test(name) || !/^[a-z0-9.-]+$/i.test(domain)) {
    throw new Error('Invalid Codespaces preview configuration');
  }
  return `${name}-5173.${domain}`;
}

export function allowedOrigin(origin: string, env: NodeJS.ProcessEnv): boolean {
  const host = codespaceHost(env);
  return origin === 'http://127.0.0.1:5173' || (host !== undefined && origin === `https://${host}`);
}
