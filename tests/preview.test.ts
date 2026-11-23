import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, codespaceHost } from '../src/shared/preview.ts';

test('only the configured private Codespace origin and local preview are allowed', () => {
  const env = { CODESPACE_NAME: 'numeriq-test-abc', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };
  assert.equal(codespaceHost(env), 'numeriq-test-abc-5173.app.github.dev');
  assert.equal(allowedOrigin('https://numeriq-test-abc-5173.app.github.dev', env), true);
  assert.equal(allowedOrigin('http://127.0.0.1:5173', env), true);
  assert.equal(allowedOrigin('https://other-5173.app.github.dev', env), false);
  assert.equal(allowedOrigin('http://numeriq-test-abc-5173.app.github.dev', env), false);
  assert.equal(allowedOrigin('https://numeriq-test-abc-5173.app.github.dev', {}), false);
  assert.throws(() => codespaceHost({ ...env, CODESPACE_NAME: 'invalid/name' }));
});
