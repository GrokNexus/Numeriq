import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/store.ts';

test('alternate hierarchy versions preserve names and structures across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'numeriq-catalog-'));
  try {
    const path = join(directory, 'workspace.sqlite');
    let store = new Store(path);
    store.catalog.addApplication('Workforce');
    const app = store.catalog.catalog().find((item) => item.name === 'Workforce')!;
    store.catalog.addModel(app.id, 'Positions');
    const model = store.catalog.catalog().find((item) => item.id === app.id)!.models[0];
    store.catalog.addDimension(model.id, 'Location');
    let dim = store.catalog.catalog().find((item) => item.id === app.id)!.models[0].dimensions[0];
    store.catalog.addMember(dim.id, 'Europe');
    store.catalog.addMember(dim.id, 'UK');
    dim = store.catalog.catalog().find((item) => item.id === app.id)!.models[0].dimensions[0];
    const europe = dim.members.find((member) => member.name === 'Europe')!;
    const uk = dim.members.find((member) => member.name === 'UK')!;
    store.catalog.addHierarchy(dim.id, 'Management');
    store.catalog.addHierarchy(dim.id, 'Legal');
    let hierarchies = store.catalog.catalog().find((item) => item.id === app.id)!.models[0].dimensions[0].hierarchies;
    const management = hierarchies.find((hierarchy) => hierarchy.name === 'Management')!;
    const legal = hierarchies.find((hierarchy) => hierarchy.name === 'Legal')!;
    store.catalog.publish(management.id, 0, [{ memberId: europe.id, parentId: null }, { memberId: uk.id, parentId: europe.id }]);
    store.catalog.publish(legal.id, 0, [{ memberId: europe.id, parentId: uk.id }, { memberId: uk.id, parentId: null }]);
    assert.throws(() => store.catalog.publish(management.id, 1, [{ memberId: europe.id, parentId: uk.id }, { memberId: uk.id, parentId: europe.id }]), /cycle/);
    assert.throws(() => store.catalog.publish(management.id, 0, [{ memberId: europe.id, parentId: null }, { memberId: uk.id, parentId: null }]), /changed/);
    assert.throws(() => store.catalog.publish(management.id, 1, [{ memberId: europe.id, parentId: null }]), /each current member/);
    store.catalog.renameMember(dim.id, uk.id, 'Britain');
    store.catalog.publish(management.id, 1, [{ memberId: europe.id, parentId: null }, { memberId: uk.id, parentId: null }]);
    assert.throws(() => store.db.prepare('UPDATE catalog_nodes SET name=? WHERE hierarchy_id=?').run('changed', management.id), /immutable/);
    store.close();
    store = new Store(path);
    hierarchies = store.catalog.catalog().find((item) => item.id === app.id)!.models[0].dimensions[0].hierarchies;
    const versions = hierarchies.find((hierarchy) => hierarchy.id === management.id)!.versions;
    assert.deepEqual(versions.map((version) => version.version), [2, 1]);
    assert.equal(versions[1].nodes.find((node) => node.memberId === uk.id)?.name, 'UK');
    assert.equal(versions[1].nodes.find((node) => node.memberId === uk.id)?.parentId, europe.id);
    assert.equal(versions[0].nodes.find((node) => node.memberId === uk.id)?.name, 'Britain');
    assert.equal(versions[0].nodes.find((node) => node.memberId === uk.id)?.parentId, null);
    assert.equal(hierarchies.find((hierarchy) => hierarchy.id === legal.id)!.versions[0].nodes.find((node) => node.memberId === europe.id)?.parentId, uk.id);
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('planning members and catalog stay linked without rewriting hierarchy history', () => {
  const store = new Store(':memory:');
  try {
    store.addDepartment('UK North');
    let department = store.catalog.catalog()[0].models[0].dimensions.find((dim) => dim.binding === 'departments')!;
    const north = department.members.find((member) => member.name === 'UK North')!;
    store.catalog.addHierarchy(department.id, 'Management');
    const hierarchy = store.catalog.catalog()[0].models[0].dimensions.find((dim) => dim.id === department.id)!.hierarchies[0];
    store.catalog.publish(hierarchy.id, 0, department.members.map((member) => ({ memberId: member.id, parentId: null })));
    store.rename('departments', north.id, 'Northern UK');
    department = store.catalog.catalog()[0].models[0].dimensions.find((dim) => dim.binding === 'departments')!;
    assert.equal(department.members.find((member) => member.id === north.id)?.name, 'Northern UK');
    assert.equal(department.hierarchies[0].versions[0].nodes.find((node) => node.memberId === north.id)?.name, 'UK North');
    assert.throws(() => store.catalog.renameMember(department.id, north.id, 'Invalid'), /planning model editor/);
  } finally { store.close(); }
});
