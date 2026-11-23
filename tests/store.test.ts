import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.ts';
import { allocate, parseMoney } from '../src/shared/calculations.ts';

test('recast reconciles each penny and rejects invalid weights', () => {
  const departments = [{ id: 'a', name: 'A', weightBps: 6000 }, { id: 'b', name: 'B', weightBps: 4000 }];
  assert.deepEqual(allocate(101, departments), { a: 61, b: 40 });
  assert.throws(() => allocate(100, [{ id: 'a', name: 'A', weightBps: 9999 }]));
  assert.throws(() => parseMoney('1.234'));
});

test('plan, metadata, actual and recast changes persist across reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'numeriq-test-'));
  try {
    const path = join(directory, 'workspace.sqlite');
    let store = new Store(path);
    store.setPlan('revenue', 'retail', '123.45');
    store.setActual('revenue', '1000.01');
    store.rename('departments', 'retail', 'Retail North');
    store.setRecast([{ id: 'retail', weightBps: 5500 }, { id: 'enterprise', weightBps: 4500 }]);
    assert.throws(() => store.setRecast([{ id: 'retail', weightBps: 5000 }, { id: 'enterprise', weightBps: 4000 }]));
    store.close();
    store = new Store(path);
    const workspace = store.workspace();
    assert.equal(workspace.plans.revenue.retail, 12345);
    assert.equal(workspace.actuals.revenue, 100001);
    assert.equal(workspace.departments[0].name, 'Retail North');
    assert.equal(workspace.departments[0].weightBps, 5500);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('missing plan remains distinct from explicit zero', () => {
  const store = new Store(':memory:');
  try {
    store.setPlan('revenue', 'retail', null);
    store.setPlan('revenue', 'enterprise', '0');
    assert.equal(store.workspace().plans.revenue.retail, undefined);
    assert.equal(store.workspace().plans.revenue.enterprise, 0);
  } finally { store.close(); }
});
