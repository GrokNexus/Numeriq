import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { Application, Catalog, Dimension, Hierarchy, HierarchyNode, HierarchyVersion, Model } from '../shared/catalog.ts';

type Row = Record<string, SQLOutputValue>;
function text(value: SQLOutputValue | undefined): string {
  if (typeof value !== 'string') throw new Error('Invalid catalog data');
  return value;
}
function integer(value: SQLOutputValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid catalog data');
  return value;
}

export class CatalogStore {
  constructor(privateDb: DatabaseSync) {
    this.db = privateDb;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS catalog_applications (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS catalog_models (id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES catalog_applications(id), name TEXT NOT NULL, UNIQUE(application_id,name));
      CREATE TABLE IF NOT EXISTS catalog_dimensions (id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES catalog_models(id), name TEXT NOT NULL, binding TEXT UNIQUE CHECK(binding IS NULL OR binding IN ('accounts','departments')), UNIQUE(model_id,name));
      CREATE TABLE IF NOT EXISTS catalog_members (id TEXT NOT NULL, dimension_id TEXT NOT NULL REFERENCES catalog_dimensions(id), name TEXT NOT NULL, PRIMARY KEY(dimension_id,id), UNIQUE(dimension_id,name));
      CREATE TABLE IF NOT EXISTS catalog_hierarchies (id TEXT PRIMARY KEY, dimension_id TEXT NOT NULL REFERENCES catalog_dimensions(id), name TEXT NOT NULL, UNIQUE(dimension_id,name));
      CREATE TABLE IF NOT EXISTS catalog_versions (hierarchy_id TEXT NOT NULL REFERENCES catalog_hierarchies(id), version INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(hierarchy_id,version));
      CREATE TABLE IF NOT EXISTS catalog_nodes (hierarchy_id TEXT NOT NULL, version INTEGER NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL, parent_id TEXT, PRIMARY KEY(hierarchy_id,version,member_id), FOREIGN KEY(hierarchy_id,version) REFERENCES catalog_versions(hierarchy_id,version));
      CREATE TRIGGER IF NOT EXISTS catalog_versions_no_update BEFORE UPDATE ON catalog_versions BEGIN SELECT RAISE(ABORT,'Versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS catalog_versions_no_delete BEFORE DELETE ON catalog_versions BEGIN SELECT RAISE(ABORT,'Versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS catalog_nodes_no_update BEFORE UPDATE ON catalog_nodes BEGIN SELECT RAISE(ABORT,'Versions are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS catalog_nodes_no_delete BEFORE DELETE ON catalog_nodes BEGIN SELECT RAISE(ABORT,'Versions are immutable'); END;
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO catalog_applications VALUES (?,?)').run('pilot-app', 'Financial Planning');
      this.db.prepare('INSERT OR IGNORE INTO catalog_models VALUES (?,?,?)').run('pilot-model', 'pilot-app', 'Planning');
      this.db.prepare('INSERT OR IGNORE INTO catalog_dimensions VALUES (?,?,?,?)').run('pilot-accounts', 'pilot-model', 'Account', 'accounts');
      this.db.prepare('INSERT OR IGNORE INTO catalog_dimensions VALUES (?,?,?,?)').run('pilot-departments', 'pilot-model', 'Department', 'departments');
      this.db.exec(`INSERT OR IGNORE INTO catalog_members SELECT id,'pilot-accounts',name FROM accounts;
                    INSERT OR IGNORE INTO catalog_members SELECT id,'pilot-departments',name FROM departments;`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  db: DatabaseSync;
  rows(query: string, ...args: string[]): Row[] { return this.db.prepare(query).all(...args); }

  catalog(): Catalog {
    return this.rows('SELECT id,name FROM catalog_applications ORDER BY rowid').map<Application>((app) => ({
      id: text(app.id), name: text(app.name),
      models: this.rows('SELECT id,name FROM catalog_models WHERE application_id=? ORDER BY rowid', text(app.id)).map<Model>((model) => ({
        id: text(model.id), name: text(model.name),
        dimensions: this.rows('SELECT id,name,binding FROM catalog_dimensions WHERE model_id=? ORDER BY rowid', text(model.id)).map<Dimension>((dim) => {
          const dimensionId = text(dim.id);
          const binding = dim.binding;
          if (binding !== null && binding !== 'accounts' && binding !== 'departments') throw new Error('Invalid dimension binding');
          return {
            id: dimensionId, name: text(dim.name), binding,
            members: this.rows('SELECT id,name FROM catalog_members WHERE dimension_id=? ORDER BY rowid', dimensionId).map((member) => ({ id: text(member.id), name: text(member.name) })),
            hierarchies: this.rows('SELECT id,name FROM catalog_hierarchies WHERE dimension_id=? ORDER BY rowid', dimensionId).map<Hierarchy>((hierarchy) => {
              const hierarchyId = text(hierarchy.id);
              return {
                id: hierarchyId, name: text(hierarchy.name),
                versions: this.rows('SELECT version,created_at FROM catalog_versions WHERE hierarchy_id=? ORDER BY version DESC', hierarchyId).map<HierarchyVersion>((version) => ({
                  version: integer(version.version), createdAt: text(version.created_at),
                  nodes: this.db.prepare('SELECT member_id,name,parent_id FROM catalog_nodes WHERE hierarchy_id=? AND version=? ORDER BY rowid').all(hierarchyId, integer(version.version)).map<HierarchyNode>((node) => ({
                    memberId: text(node.member_id), name: text(node.name), parentId: node.parent_id === null ? null : text(node.parent_id),
                  })),
                })),
              };
            }),
          };
        }),
      })),
    }));
  }
  addApplication(name: string) { this.db.prepare('INSERT INTO catalog_applications VALUES (?,?)').run(randomUUID(), name); }
  addModel(applicationId: string, name: string) { this.db.prepare('INSERT INTO catalog_models VALUES (?,?,?)').run(randomUUID(), applicationId, name); }
  addDimension(modelId: string, name: string) { this.db.prepare('INSERT INTO catalog_dimensions VALUES (?,?,?,NULL)').run(randomUUID(), modelId, name); }
  addMember(dimensionId: string, name: string) {
    const dimension = this.db.prepare('SELECT binding FROM catalog_dimensions WHERE id=?').get(dimensionId);
    if (!dimension) throw new Error('Member not found');
    if (dimension.binding !== null) throw new Error('Use the planning model editor for this dimension');
    this.db.prepare('INSERT INTO catalog_members VALUES (?,?,?)').run(randomUUID(), dimensionId, name);
  }
  renameMember(dimensionId: string, id: string, name: string) {
    const dimension = this.db.prepare('SELECT binding FROM catalog_dimensions WHERE id=?').get(dimensionId);
    if (!dimension) throw new Error('Member not found');
    if (dimension.binding !== null) throw new Error('Use the planning model editor for this dimension');
    if (this.db.prepare('UPDATE catalog_members SET name=? WHERE dimension_id=? AND id=?').run(name, dimensionId, id).changes !== 1) throw new Error('Member not found');
  }
  addHierarchy(dimensionId: string, name: string) { this.db.prepare('INSERT INTO catalog_hierarchies VALUES (?,?,?)').run(randomUUID(), dimensionId, name); }
  publish(hierarchyId: string, expectedVersion: number, nodes: { memberId: string; parentId: string | null }[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const hierarchy = this.db.prepare('SELECT dimension_id FROM catalog_hierarchies WHERE id=?').get(hierarchyId);
      if (!hierarchy) throw new Error('Member not found');
      const latest = this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM catalog_versions WHERE hierarchy_id=?').get(hierarchyId);
      if (integer(latest?.version) !== expectedVersion) throw new Error('Hierarchy changed; reload before publishing');
      const members = this.rows('SELECT id,name FROM catalog_members WHERE dimension_id=? ORDER BY rowid', text(hierarchy.dimension_id));
      const names = new Map(members.map((member) => [text(member.id), text(member.name)]));
      const parents = new Map(nodes.map((node) => [node.memberId, node.parentId]));
      if (!members.length || nodes.length !== members.length || parents.size !== members.length || nodes.some((node) => !names.has(node.memberId) || (node.parentId !== null && !names.has(node.parentId)))) throw new Error('Hierarchy must contain each current member once');
      for (const id of parents.keys()) {
        const visited = new Set<string>();
        let current: string | null = id;
        while (current !== null) {
          if (visited.has(current)) throw new Error('Hierarchy contains a cycle');
          visited.add(current);
          current = parents.get(current) ?? null;
        }
      }
      const next = expectedVersion + 1;
      this.db.prepare('INSERT INTO catalog_versions VALUES (?,?,?)').run(hierarchyId, next, new Date().toISOString());
      const insert = this.db.prepare('INSERT INTO catalog_nodes VALUES (?,?,?,?,?)');
      for (const member of members) {
        const id = text(member.id);
        insert.run(hierarchyId, next, id, text(member.name), parents.get(id) ?? null);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
