export type AccountKind = 'revenue' | 'expense';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
}

export interface Department {
  id: string;
  name: string;
  weightBps: number;
}

export interface Workspace {
  accounts: Account[];
  departments: Department[];
  actuals: Record<string, number>;
  plans: Record<string, Record<string, number>>;
  commentary: Record<string, string>;
}
