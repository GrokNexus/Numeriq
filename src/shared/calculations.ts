import type { Department } from './types.ts';

export function allocate(amount: number, departments: Department[]): Record<string, number> {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Actual must be a non-negative integer number of pence');
  if (departments.reduce((sum, item) => sum + item.weightBps, 0) !== 10000) {
    throw new Error('Recast weights must total 100%');
  }
  const amounts = departments.map((department) => {
    const raw = BigInt(amount) * BigInt(department.weightBps);
    return { id: department.id, cents: Number(raw / 10000n), remainder: raw % 10000n };
  });
  let remaining = amount - amounts.reduce((sum, item) => sum + item.cents, 0);
  for (const item of [...amounts].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining <= 0) break;
    item.cents += 1;
    remaining -= 1;
  }
  return Object.fromEntries(amounts.map((item) => [item.id, item.cents]));
}

export function parseMoney(value: string): number {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('Enter a non-negative amount with up to two decimal places');
  }
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
