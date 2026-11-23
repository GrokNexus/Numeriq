import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from './store.ts';
import { allowedOrigin } from '../shared/preview.ts';

class InputError extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Expected an object');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 80): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new InputError(`${label} is required and must be at most ${max} characters`);
  return value.trim();
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 20000) throw new InputError('Request is too large');
  }
  try { return object(JSON.parse(text)); } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Invalid JSON');
  }
}
function send(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}

export function createApi(store: Store) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/api/workspace') return send(response, 200, store.workspace());
      if (request.method === 'GET' && path === '/api/catalog') return send(response, 200, store.catalog.catalog());
      if (!['POST', 'PATCH', 'PUT'].includes(request.method ?? '') || !path.startsWith('/api/')) return send(response, 404, { error: 'Not found' });
      if (request.headers.origin && !allowedOrigin(request.headers.origin, process.env)) return send(response, 403, { error: 'Origin not allowed' });
      if (!request.headers['content-type']?.startsWith('application/json')) return send(response, 415, { error: 'JSON is required' });
      const data = await body(request);
      if (request.method === 'POST' && path === '/api/catalog/applications') {
        store.catalog.addApplication(string(data.name, 'Application name'));
      } else if (request.method === 'POST' && path === '/api/catalog/models') {
        store.catalog.addModel(string(data.applicationId, 'Application id'), string(data.name, 'Model name'));
      } else if (request.method === 'POST' && path === '/api/catalog/dimensions') {
        store.catalog.addDimension(string(data.modelId, 'Model id'), string(data.name, 'Dimension name'));
      } else if (request.method === 'POST' && path === '/api/catalog/members') {
        store.catalog.addMember(string(data.dimensionId, 'Dimension id'), string(data.name, 'Member name'));
      } else if (request.method === 'PATCH' && path === '/api/catalog/members') {
        store.catalog.renameMember(string(data.dimensionId, 'Dimension id'), string(data.id, 'Member id'), string(data.name, 'Member name'));
      } else if (request.method === 'POST' && path === '/api/catalog/hierarchies') {
        store.catalog.addHierarchy(string(data.dimensionId, 'Dimension id'), string(data.name, 'Hierarchy name'));
      } else if (request.method === 'POST' && path === '/api/catalog/versions') {
        if (typeof data.expectedVersion !== 'number' || !Number.isSafeInteger(data.expectedVersion) || data.expectedVersion < 0 || !Array.isArray(data.nodes)) throw new InputError('Invalid hierarchy version');
        const nodes = data.nodes.map((entry: unknown) => {
          const item = object(entry);
          if (item.parentId !== null && typeof item.parentId !== 'string') throw new InputError('Invalid parent');
          return { memberId: string(item.memberId, 'Member id'), parentId: item.parentId === null ? null : string(item.parentId, 'Parent id') };
        });
        store.catalog.publish(string(data.hierarchyId, 'Hierarchy id'), data.expectedVersion, nodes);
      } else if (request.method === 'POST' && path === '/api/accounts') {
        const kind = data.kind;
        if (kind !== 'revenue' && kind !== 'expense') throw new InputError('Choose an account type');
        store.addAccount(string(data.name, 'Account name'), kind);
      } else if (request.method === 'POST' && path === '/api/departments') {
        store.addDepartment(string(data.name, 'Department name'));
      } else if (request.method === 'PATCH' && (path === '/api/accounts' || path === '/api/departments')) {
        store.rename(path === '/api/accounts' ? 'accounts' : 'departments', string(data.id, 'Member id'), string(data.name, 'Name'));
      } else if (request.method === 'PUT' && path === '/api/recast') {
        if (!Array.isArray(data.weights)) throw new InputError('Weights are required');
        const weights = data.weights.map((entry: unknown) => {
          const item = object(entry);
          if (typeof item.weightBps !== 'number') throw new InputError('Weight must be a number');
          return { id: string(item.id, 'Department id'), weightBps: item.weightBps };
        });
        store.setRecast(weights);
      } else if (request.method === 'PUT' && (path === '/api/actuals' || path === '/api/plans')) {
        const accountId = string(data.accountId, 'Account id');
        if (data.amount !== null && typeof data.amount !== 'string') throw new InputError('Amount must be text or null');
        if (path === '/api/actuals') store.setActual(accountId, data.amount);
        else store.setPlan(accountId, string(data.departmentId, 'Department id'), data.amount);
      } else if (request.method === 'PUT' && path === '/api/commentary') {
        if (typeof data.body !== 'string' || data.body.length > 2000) throw new InputError('Commentary must be at most 2000 characters');
        store.setCommentary(string(data.accountId, 'Account id'), data.body);
      } else {
        return send(response, 404, { error: 'Not found' });
      }
      return send(response, 200, path.startsWith('/api/catalog/') ? store.catalog.catalog() : store.workspace());
    } catch (error) {
      if (error instanceof InputError) return send(response, 400, { error: error.message });
      if (error instanceof Error && (error.message.includes('UNIQUE constraint') || error.message.includes('FOREIGN KEY constraint') ||
        error.message.includes('Member not found') || error.message.includes('Enter a') || error.message.includes('Recast weights') ||
        error.message.includes('Hierarchy') || error.message.includes('Use the planning model editor'))) {
        return send(response, 400, { error: error.message });
      }
      console.error('Request failed:', error);
      return send(response, 500, { error: 'The request could not be completed' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  mkdirSync(resolve('data'), { recursive: true });
  const store = new Store(resolve('data/numeriq.sqlite'));
  const server = createApi(store);
  server.listen(4318, '127.0.0.1', () => console.log('Numeriq API running on http://127.0.0.1:4318'));
  const stop = () => server.close(() => { store.close(); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
