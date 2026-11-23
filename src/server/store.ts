import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Account, AccountKind, Workspace } from '../shared/types.ts';
import { parseMoney } from '../shared/calculations.ts';
import { CatalogStore } from './catalog.ts';

export class Store {
  db: DatabaseSync;
  catalog: CatalogStore;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('revenue','expense')));
      CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, weight_bps INTEGER NOT NULL CHECK(weight_bps BETWEEN 0 AND 10000));
      CREATE TABLE IF NOT EXISTS actuals (account_id TEXT PRIMARY KEY REFERENCES accounts(id), amount INTEGER NOT NULL CHECK(amount >= 0));
      CREATE TABLE IF NOT EXISTS plans (account_id TEXT NOT NULL REFERENCES accounts(id), department_id TEXT NOT NULL REFERENCES departments(id), amount INTEGER NOT NULL CHECK(amount >= 0), PRIMARY KEY(account_id, department_id));
      CREATE TABLE IF NOT EXISTS commentary (account_id TEXT PRIMARY KEY REFERENCES accounts(id), body TEXT NOT NULL);
    `);
    if (this.db.prepare('SELECT COUNT(*) AS count FROM accounts').get()?.count === 0) this.seed();
    this.catalog = new CatalogStore(this.db);
  }

  seed() {
    this.db.exec('BEGIN');
    try {
      const account = this.db.prepare('INSERT INTO accounts VALUES (?, ?, ?)');
      account.run('revenue', 'Revenue', 'revenue');
      account.run('cost', 'Cost of sales', 'expense');
      account.run('opex', 'Operating expenses', 'expense');
      const department = this.db.prepare('INSERT INTO departments VALUES (?, ?, ?)');
      department.run('retail', 'UK Retail', 6000);
      department.run('enterprise', 'UK Enterprise', 4000);
      const actual = this.db.prepare('INSERT INTO actuals VALUES (?, ?)');
      actual.run('revenue', 150000000);
      actual.run('cost', 82500000);
      actual.run('opex', 37500000);
      const plan = this.db.prepare('INSERT INTO plans VALUES (?, ?, ?)');
      for (const row of [
        ['revenue', 'retail', 99000000], ['revenue', 'enterprise', 61000000],
        ['cost', 'retail', 53000000], ['cost', 'enterprise', 35000000],
        ['opex', 'retail', 24000000], ['opex', 'enterprise', 16000000],
      ] as const) plan.run(...row);
      this.db.prepare('INSERT INTO commentary VALUES (?, ?)').run('revenue', 'Review the enterprise growth assumption with the commercial team.');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  workspace(): Workspace {
    const accounts = this.db.prepare('SELECT id, name, kind FROM accounts ORDER BY rowid').all().map<Account>((row) => {
      if (typeof row.id !== 'string' || typeof row.name !== 'string' || (row.kind !== 'revenue' && row.kind !== 'expense')) throw new Error('Invalid account data');
      return { id: row.id, name: row.name, kind: row.kind };
    });
    const departments = this.db.prepare('SELECT id, name, weight_bps AS weightBps FROM departments ORDER BY rowid').all().map((row) => {
      if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.weightBps !== 'number') throw new Error('Invalid department data');
      return { id: row.id, name: row.name, weightBps: row.weightBps };
    });
    const actuals: Workspace['actuals'] = {};
    for (const row of this.db.prepare('SELECT account_id, amount FROM actuals').all()) {
      if (typeof row.account_id !== 'string' || typeof row.amount !== 'number') throw new Error('Invalid actual data');
      actuals[row.account_id] = row.amount;
    }
    const plans: Workspace['plans'] = {};
    for (const row of this.db.prepare('SELECT account_id, department_id, amount FROM plans').all()) {
      if (typeof row.account_id !== 'string' || typeof row.department_id !== 'string' || typeof row.amount !== 'number') throw new Error('Invalid plan data');
      (plans[row.account_id] ??= {})[row.department_id] = row.amount;
    }
    const commentary: Workspace['commentary'] = {};
    for (const row of this.db.prepare('SELECT account_id, body FROM commentary').all()) {
      if (typeof row.account_id !== 'string' || typeof row.body !== 'string') throw new Error('Invalid commentary data');
      commentary[row.account_id] = row.body;
    }
    return { accounts, departments, actuals, plans, commentary };
  }

  addAccount(name: string, kind: AccountKind) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = randomUUID();
      this.db.prepare('INSERT INTO accounts VALUES (?, ?, ?)').run(id, name, kind);
      this.db.prepare('INSERT INTO catalog_members VALUES (?,?,?)').run(id, 'pilot-accounts', name);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  addDepartment(name: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const id = randomUUID();
      this.db.prepare('INSERT INTO departments VALUES (?, ?, 0)').run(id, name);
      this.db.prepare('INSERT INTO catalog_members VALUES (?,?,?)').run(id, 'pilot-departments', name);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  rename(kind: 'accounts' | 'departments', id: string, name: string) {
    const query = kind === 'accounts' ? 'UPDATE accounts SET name=? WHERE id=?' : 'UPDATE departments SET name=? WHERE id=?';
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare(query).run(name, id).changes !== 1) throw new Error('Member not found');
      const dimension = kind === 'accounts' ? 'pilot-accounts' : 'pilot-departments';
      if (this.db.prepare('UPDATE catalog_members SET name=? WHERE dimension_id=? AND id=?').run(name, dimension, id).changes !== 1) throw new Error('Member not found');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  setPlan(accountId: string, departmentId: string, amount: string | null) {
    if (!this.db.prepare('SELECT id FROM accounts WHERE id=?').get(accountId) ||
        !this.db.prepare('SELECT id FROM departments WHERE id=?').get(departmentId)) throw new Error('Member not found');
    if (amount === null) {
      this.db.prepare('DELETE FROM plans WHERE account_id=? AND department_id=?').run(accountId, departmentId);
      return;
    }
    this.db.prepare('INSERT INTO plans VALUES (?, ?, ?) ON CONFLICT(account_id, department_id) DO UPDATE SET amount=excluded.amount').run(accountId, departmentId, parseMoney(amount));
  }
  setActual(accountId: string, amount: string | null) {
    if (!this.db.prepare('SELECT id FROM accounts WHERE id=?').get(accountId)) throw new Error('Member not found');
    if (amount === null) {
      this.db.prepare('DELETE FROM actuals WHERE account_id=?').run(accountId);
      return;
    }
    this.db.prepare('INSERT INTO actuals VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET amount=excluded.amount').run(accountId, parseMoney(amount));
  }
  setRecast(weights: { id: string; weightBps: number }[]) {
    const ids = this.workspace().departments.map((item) => item.id);
    if (weights.length !== ids.length || new Set(weights.map((item) => item.id)).size !== ids.length ||
        weights.some((item) => !ids.includes(item.id) || !Number.isInteger(item.weightBps) || item.weightBps < 0 || item.weightBps > 10000) ||
        weights.reduce((sum, item) => sum + item.weightBps, 0) !== 10000) throw new Error('Enter a weight for every department; the total must equal 100%');
    this.db.exec('BEGIN');
    try {
      const update = this.db.prepare('UPDATE departments SET weight_bps=? WHERE id=?');
      for (const item of weights) update.run(item.weightBps, item.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  setCommentary(accountId: string, body: string) {
    this.db.prepare('INSERT INTO commentary VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET body=excluded.body').run(accountId, body);
  }
  close() { this.db.close(); }
}
