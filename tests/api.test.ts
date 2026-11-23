import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApi } from '../src/server/index.ts';
import { Store } from '../src/server/store.ts';
import type { Workspace } from '../src/shared/types.ts';

test('API saves a plan and rejects invalid recasts without changing state', async () => {
  const store = new Store(':memory:');
  const server = createApi(store);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/`;
  try {
    const update = await fetch(url + 'plans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'revenue', departmentId: 'retail', amount: '123.45' }) });
    assert.equal(update.status, 200);
    assert.equal((await update.json() as Workspace).plans.revenue.retail, 12345);
    const invalid = await fetch(url + 'recast', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weights: [{ id: 'retail', weightBps: 5000 }, { id: 'enterprise', weightBps: 4000 }] }) });
    assert.equal(invalid.status, 400);
    const current = await (await fetch(url + 'workspace')).json() as Workspace;
    assert.equal(current.departments[0].weightBps, 6000);
    assert.equal(current.plans.revenue.retail, 12345);
    const unknown = await fetch(url + 'plans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'missing', departmentId: 'retail', amount: null }) });
    assert.equal(unknown.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});

test('API accepts the configured Codespaces origin but rejects other origins', async () => {
  const previousName = process.env.CODESPACE_NAME;
  const previousDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  process.env.CODESPACE_NAME = 'numeriq-test';
  process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = 'app.github.dev';
  const store = new Store(':memory:');
  const server = createApi(store);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/plans`;
  const body = JSON.stringify({ accountId: 'revenue', departmentId: 'retail', amount: '123.45' });
  try {
    const accepted = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://numeriq-test-5173.app.github.dev' }, body });
    assert.equal(accepted.status, 200);
    const rejected = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://other-5173.app.github.dev' }, body });
    assert.equal(rejected.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    if (previousName === undefined) delete process.env.CODESPACE_NAME;
    else process.env.CODESPACE_NAME = previousName;
    if (previousDomain === undefined) delete process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    else process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = previousDomain;
  }
});

test('catalog API publishes and retrieves a hierarchy and rejects cycles', async () => {
  const store = new Store(':memory:');
  const server = createApi(store);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/api/catalog`;
  const post = (path: string, body: object) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const created = await post('/hierarchies', { dimensionId: 'pilot-departments', name: 'Management' });
    assert.equal(created.status, 200);
    const hierarchy = store.catalog.catalog()[0].models[0].dimensions.find((dim) => dim.id === 'pilot-departments')!.hierarchies[0];
    const valid = [{ memberId: 'retail', parentId: null }, { memberId: 'enterprise', parentId: 'retail' }];
    assert.equal((await post('/versions', { hierarchyId: hierarchy.id, expectedVersion: 0, nodes: valid })).status, 200);
    const cyclic = [{ memberId: 'retail', parentId: 'enterprise' }, { memberId: 'enterprise', parentId: 'retail' }];
    const rejected = await post('/versions', { hierarchyId: hierarchy.id, expectedVersion: 1, nodes: cyclic });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json() as { error: string }).error, /cycle/);
    const catalog = await (await fetch(url)).json() as ReturnType<typeof store.catalog.catalog>;
    const versions = catalog[0].models[0].dimensions.find((dim) => dim.id === 'pilot-departments')!.hierarchies[0].versions;
    assert.equal(versions.length, 1);
    assert.equal(versions[0].nodes.find((node) => node.memberId === 'enterprise')?.parentId, 'retail');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
  }
});
