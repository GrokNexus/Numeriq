import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Account, AccountKind, Department, Workspace } from '../shared/types.ts';
import { allocate } from '../shared/calculations.ts';
import CatalogStudio from './Catalog.tsx';

type View = 'planning' | 'model' | 'catalog';
type Basis = 'current' | 'original';

const paths: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  down: <path d="m7 10 5 5 5-5"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  filter: <><path d="M4 7h16M7 12h10M10 17h4"/></>,
  chart: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
  spark: <><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></>,
  message: <><path d="M4 5h16v12H9l-5 3V5Z"/><path d="M8 9h8M8 13h5"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const money = (cents: number | undefined) => cents === undefined ? '—' : new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const fullMoney = (cents: number | undefined) => cents === undefined ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100);
const signed = (cents: number | undefined) => cents === undefined ? '—' : `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
const percent = (delta: number | undefined, base: number | undefined) => delta === undefined || base === undefined || base === 0 ? '—' : `${delta > 0 ? '+' : ''}${(delta / base * 100).toFixed(1)}%`;
const amountText = (cents: number | undefined) => cents === undefined ? '' : (cents / 100).toFixed(2);

async function request(path: string, method = 'GET', data?: unknown): Promise<Workspace> {
  const response = await fetch(`/api/${path}`, { method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as { error?: string };
    throw new Error(error.error ?? 'The request failed');
  }
  return result as Workspace;
}

function MoneyInput({ value, label, disabled, save }: { value: number | undefined; label: string; disabled: boolean; save: (value: string | null) => void }) {
  const [text, setText] = useState(amountText(value));
  useEffect(() => setText(amountText(value)), [value]);
  function commit(input: string) {
    const next = input.trim();
    if (next === amountText(value)) return;
    save(next === '' ? null : next);
  }
  return <input className="money-input" aria-label={label} inputMode="decimal" placeholder="—" value={text} disabled={disabled}
    onChange={(event) => setText(event.target.value)} onFocus={(event) => event.currentTarget.select()}
    onBlur={(event) => commit(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = amountText(value); setText(amountText(value)); event.currentTarget.blur(); } }} />;
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [view, setView] = useState<View>('planning');
  const [basis, setBasis] = useState<Basis>('current');
  const [department, setDepartment] = useState('all');
  const [selected, setSelected] = useState('revenue');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { request('workspace').then(setWorkspace).catch((e: Error) => setError(e.message)); }, []);

  async function mutate(path: string, method: string, data: unknown, success: string) {
    setError(''); setNotice(''); setBusy(true);
    try { setWorkspace(await request(path, method, data)); setNotice(success); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'The request failed'); return false; }
    finally { setBusy(false); }
  }

  const calculations = useMemo(() => {
    if (!workspace) return [];
    return workspace.accounts.map((account) => {
      const source = workspace.actuals[account.id];
      const allocations = source === undefined ? {} : allocate(source, workspace.departments);
      const actual = department === 'all' ? source : basis === 'current' ? allocations[department] : undefined;
      const planRows = workspace.plans[account.id] ?? {};
      const values = department === 'all' ? workspace.departments.map((item) => planRows[item.id]) : [planRows[department]];
      const plan = values.every((item) => item !== undefined) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
      const delta = actual !== undefined && plan !== undefined ? plan - actual : undefined;
      return { account, actual, plan, delta, allocations };
    });
  }, [workspace, basis, department]);
  const revenue = calculations.find((row) => row.account.id === 'revenue');
  const selectedRow = calculations.find((row) => row.account.id === selected) ?? calculations[0];
  const chosenDepartment = workspace?.departments.find((item) => item.id === department);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Numeriq home"><span className="brand-mark"><span></span><span></span><span></span><span></span></span><span>numeriq<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-switch"><span className="workspace-icon">N</span><span><strong>Northstar Group</strong><small>Planning workspace</small></span><Icon name="down" size={15}/></div>
      <div className="nav-label">YOUR WORKSPACE</div>
      <nav className="side-nav" aria-label="Workspace navigation">
        <button className={view === 'planning' ? 'nav-item active' : 'nav-item'} onClick={() => setView('planning')}><Icon name="grid"/><span>Planning studio</span><span className="nav-active-dot"/></button>
        <button className={view === 'model' ? 'nav-item active' : 'nav-item'} onClick={() => setView('model')}><Icon name="layers"/><span>Model &amp; dimensions</span></button>
        <button className={view === 'catalog' ? 'nav-item active' : 'nav-item'} onClick={() => setView('catalog')}><Icon name="layers"/><span>Model catalog</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-callout"><span className="callout-icon"><Icon name="spark" size={15}/></span><strong>Built for clarity.</strong><p>One place to bring your plan and your business together.</p></div>
        <div className="profile"><span className="avatar">N</span><span><strong>Local workspace</strong><small>Sample data · Pilot</small></span></div>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={13}/><strong>{view === 'planning' ? 'Planning studio' : view === 'model' ? 'Model & dimensions' : 'Model catalog'}</strong></div><div className="top-actions"><span className="local-badge"><span/> LOCAL PILOT</span><span className="top-avatar">N</span></div></header>
      <main className="content">
        {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
        {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
        {!workspace ? <div className="loading">{error ? 'Unable to load the workspace.' : 'Loading your workspace…'}</div> : view === 'planning' ? <>
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> FINANCIAL PLANNING <span className="eyebrow-divider">/</span> FY 2027</div><h1>A clearer view of <em>what’s next.</em></h1><p>Bring your actuals and plans together, in context.</p></div><button className="outline-button" onClick={() => setView('model')}><Icon name="layers" size={16}/> Manage model</button></div>
          <div className="overview">
            <section className="hero-card"><div className="hero-top"><span className="hero-tag"><span/> PLANNING OVERVIEW</span><Icon name="chart" size={19}/></div><div className="hero-title">A little more clarity.<br/><span>A lot more possibility.</span></div><p>Your financial story, connected from actuals to plan.</p><div className="hero-bottom"><span>FY26 ACTUAL → FY27 PLAN</span><button onClick={() => document.getElementById('planning-grid')?.scrollIntoView({ behavior: 'smooth' })}>Explore your plan <Icon name="arrow" size={15}/></button></div><div className="hero-decoration decoration-one"/><div className="hero-decoration decoration-two"/></section>
            <MetricCard label={`${revenue?.account.name.toUpperCase() ?? 'REVENUE'} ACTUAL`} value={fullMoney(revenue?.actual)} caption={basis === 'current' && department !== 'all' ? 'Recast to current structure' : 'FY 2026 · historical actual'} icon="chart" />
            <MetricCard label={`${revenue?.account.name.toUpperCase() ?? 'REVENUE'} PLAN`} value={fullMoney(revenue?.plan)} caption="FY 2027 · working plan" icon="layers" />
            <MetricCard label={`${revenue?.account.name.toUpperCase() ?? 'REVENUE'} MOVEMENT`} value={fullMoney(revenue?.delta)} caption={revenue?.delta === undefined ? 'Comparison unavailable' : `${percent(revenue.delta, revenue.actual)} vs prior-year actual`} icon="arrow" positive={(revenue?.delta ?? 0) >= 0} />
          </div>
          <div className="section-heading"><div><div className="section-kicker">YOUR WORKING VIEW</div><h2>Financial plan <span className="heading-dot">.</span></h2><p>Compare your prior-year actuals with your working plan.</p></div><span className="live-tag"><span/> CONNECTED TO YOUR MODEL</span></div>
          <section className="grid-card" id="planning-grid">
            <div className="grid-top"><div><div className="grid-title"><span className="grid-title-icon"><Icon name="grid" size={17}/></span><div><h3>Account comparison</h3><span>Actuals vs. plan · GBP</span></div></div></div><div className="grid-controls"><label className="select-wrap"><span className="sr-only">Department</span><Icon name="filter" size={15}/><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All departments</option>{workspace.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Icon name="down" size={14}/></label></div></div>
            <div className="basis-row"><span>REPORTING BASIS</span><div className="segmented" aria-label="Reporting basis"><button className={basis === 'current' ? 'selected' : ''} onClick={() => setBasis('current')}>Current structure</button><button className={basis === 'original' ? 'selected' : ''} onClick={() => setBasis('original')}>Original structure</button></div><span className="basis-description">{basis === 'current' ? 'FY26 actuals are recast using your current allocation.' : 'FY26 actuals remain in UK Operations.'}</span></div>
            {basis === 'original' && department !== 'all' && <div className="inline-info">Original actuals belong to UK Operations, not {chosenDepartment?.name}. Select all departments to compare totals.</div>}
            <div className="table-scroll"><table className="planning-table"><thead><tr><th>ACCOUNT <span className="th-count">{workspace.accounts.length}</span></th><th>FY26 ACTUAL <span className="th-sub">{basis === 'current' ? 'RECAST' : 'ORIGINAL'}</span></th><th>FY27 PLAN <span className="th-sub">WORKING</span></th><th>VARIANCE <span className="th-sub">PLAN − ACTUAL</span></th><th>VARIANCE %</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>
              {calculations.map(({ account, actual, plan, delta }) => {
                const favorable = delta !== undefined && (account.kind === 'revenue' ? delta >= 0 : delta <= 0);
                return <tr key={account.id} className={selected === account.id ? 'row-selected' : ''} onClick={() => setSelected(account.id)}><td><div className="account-cell"><span className={`account-symbol ${account.kind}`}>{account.kind === 'revenue' ? 'R' : 'E'}</span><div><strong>{account.name}</strong><small>{account.kind === 'revenue' ? 'Revenue' : 'Expense'}</small></div></div></td><td>{money(actual)}</td><td>{department === 'all' ? <span>{money(plan)}</span> : <MoneyInput value={plan} label={`${account.name} plan for ${chosenDepartment?.name}`} disabled={busy} save={(amount) => { void mutate('plans', 'PUT', { accountId: account.id, departmentId: department, amount }, 'Plan saved'); }} />}</td><td className={delta === undefined ? '' : favorable ? 'number-positive' : 'number-negative'}>{signed(delta)}</td><td><span className={delta === undefined ? 'variance neutral' : favorable ? 'variance up' : 'variance down'}>{percent(delta, actual)}</span></td><td><button className="row-arrow" aria-label={`View ${account.name} details`} onClick={() => setSelected(account.id)}><Icon name="chevron" size={16}/></button></td></tr>;
              })}
            </tbody></table></div>
            <div className="grid-footer"><span><span className="footer-dot"/> {department === 'all' ? 'Select a department to edit its plan' : `Editing ${chosenDepartment?.name} · values in GBP`}</span><button onClick={() => setView('model')}>View model details <Icon name="arrow" size={14}/></button></div>
          </section>
          <div className="bottom-grid">
            <section className="detail-card"><div className="card-title-row"><div><div className="section-kicker">UNDERSTAND THE MOVEMENT</div><h3>{selectedRow?.account.name ?? 'Select an account'}</h3></div><span className="detail-icon"><Icon name="chart"/></span></div>{selectedRow && <><p className="detail-copy">Plan compared with {basis === 'current' ? 'recast' : 'original'} prior-year actual{department === 'all' ? ' across all departments' : ` for ${chosenDepartment?.name}`}.</p><div className="detail-values"><div><span>FY26 ACTUAL</span><strong>{fullMoney(selectedRow.actual)}</strong></div><div><span>FY27 PLAN</span><strong>{fullMoney(selectedRow.plan)}</strong></div><div><span>MOVEMENT</span><strong>{signed(selectedRow.delta)}</strong></div></div><div className="detail-note"><Icon name="spark" size={16}/><span>Movement is calculated as plan minus actual. A positive expense movement is not necessarily favorable.</span></div></>}</section>
            <Commentary account={selectedRow?.account} current={selectedRow ? workspace.commentary[selectedRow.account.id] ?? '' : ''} busy={busy} save={(accountId, body) => mutate('commentary', 'PUT', { accountId, body }, 'Commentary saved')} />
          </div>
          <div className="page-footnote">NUMERIQ PILOT <span>·</span> Local sample workspace. Not for sensitive or production data.</div>
        </> : view === 'model' ? <ModelStudio workspace={workspace} busy={busy} mutate={mutate} /> : <CatalogStudio />}
      </main>
    </div>
  </div>;
}

function MetricCard({ label, value, caption, icon, positive }: { label: string; value: string; caption: string; icon: string; positive?: boolean }) {
  return <section className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon name={icon} size={16}/></span></div><strong className={positive ? 'metric-value positive' : 'metric-value'}>{value}</strong><p>{caption}</p><div className="metric-accent"/></section>;
}

function Commentary({ account, current, busy, save }: { account: Account | undefined; current: string; busy: boolean; save: (accountId: string, body: string) => void }) {
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current, account?.id]);
  return <section className="detail-card commentary-card"><div className="card-title-row"><div><div className="section-kicker">THE STORY BEHIND THE NUMBERS</div><h3>Commentary</h3></div><span className="detail-icon purple"><Icon name="message"/></span></div><p className="detail-copy">Capture context for {account?.name ?? 'the selected account'}.</p><label className="sr-only" htmlFor="commentary">Account commentary</label><textarea id="commentary" value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="Add a note for your team…" /><div className="comment-footer"><span>Saved to this local workspace</span><button className="small-button" disabled={busy || !account || text === current} onClick={() => account && save(account.id, text)}>Save note</button></div></section>;
}

function ModelStudio({ workspace, busy, mutate }: { workspace: Workspace; busy: boolean; mutate: (path: string, method: string, data: unknown, success: string) => Promise<boolean> }) {
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [accountName, setAccountName] = useState('');
  const [accountKind, setAccountKind] = useState<AccountKind>('revenue');
  const [departmentName, setDepartmentName] = useState('');
  const [localError, setLocalError] = useState('');
  useEffect(() => setWeights(Object.fromEntries(workspace.departments.map((item) => [item.id, (item.weightBps / 100).toFixed(2)]))), [workspace.departments]);
  const total = workspace.departments.reduce((sum, item) => sum + Number(weights[item.id] || 0), 0);
  function submitRecast(event: FormEvent) {
    event.preventDefault();
    const values = workspace.departments.map((item) => ({ id: item.id, value: weights[item.id] ?? '' }));
    if (values.some((item) => !/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(item.value))) { setLocalError('Enter percentages with up to two decimal places.'); return; }
    setLocalError('');
    void mutate('recast', 'PUT', { weights: values.map((item) => ({ id: item.id, weightBps: Math.round(Number(item.value) * 100) })) }, 'Recast updated');
  }
  return <>
    <div className="page-heading model-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> FINANCIAL PLANNING <span className="eyebrow-divider">/</span> MODEL STUDIO</div><h1>Make the model <em>yours.</em></h1><p>Shape the dimensions and structure behind your planning view.</p></div></div>
    <div className="model-banner"><span className="model-banner-icon"><Icon name="layers" size={21}/></span><div><strong>Financial planning model</strong><p>One connected model · GBP · Prior-year actuals and working plan</p></div><span className="model-status"><span/> ACTIVE</span></div>
    <div className="studio-grid">
      <section className="studio-card"><div className="card-title-row"><div><div className="section-kicker">DIMENSION 01</div><h3>Accounts</h3></div><span className="count-chip">{workspace.accounts.length} members</span></div><p className="detail-copy">The financial lines in your planning grid. Rename a member or add a new one.</p><div className="member-list">{workspace.accounts.map((account) => <MemberRow key={account.id} item={account} type="accounts" busy={busy} mutate={mutate} />)}</div><form className="add-form" onSubmit={(event) => { event.preventDefault(); if (!accountName.trim()) return; void mutate('accounts', 'POST', { name: accountName, kind: accountKind }, 'Account added').then((ok) => { if (ok) setAccountName(''); }); }}><input aria-label="New account name" placeholder="New account name" value={accountName} onChange={(event) => setAccountName(event.target.value)} maxLength={80}/><select aria-label="Account type" value={accountKind} onChange={(event) => setAccountKind(event.target.value as AccountKind)}><option value="revenue">Revenue</option><option value="expense">Expense</option></select><button disabled={busy || !accountName.trim()} aria-label="Add account"><Icon name="plus" size={17}/></button></form></section>
      <section className="studio-card"><div className="card-title-row"><div><div className="section-kicker">DIMENSION 02</div><h3>Departments</h3></div><span className="count-chip">{workspace.departments.length} members</span></div><p className="detail-copy">Your current reporting structure. New members start with a 0% recast weight.</p><div className="member-list">{workspace.departments.map((item) => <MemberRow key={item.id} item={item} type="departments" busy={busy} mutate={mutate} />)}</div><form className="add-form" onSubmit={(event) => { event.preventDefault(); if (!departmentName.trim()) return; void mutate('departments', 'POST', { name: departmentName }, 'Department added').then((ok) => { if (ok) setDepartmentName(''); }); }}><input aria-label="New department name" placeholder="New department name" value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} maxLength={80}/><button disabled={busy || !departmentName.trim()} aria-label="Add department"><Icon name="plus" size={17}/></button></form></section>
      <section className="studio-card recast-card"><div className="card-title-row"><div><div className="section-kicker">STRUCTURE CHANGE</div><h3>Recast actuals</h3></div><span className="detail-icon purple"><Icon name="layers"/></span></div><p className="detail-copy">Allocate prior-year UK Operations actuals to your current departments. The original actuals remain unchanged.</p><form onSubmit={submitRecast}><div className="recast-source"><span>ORIGINAL STRUCTURE</span><strong>UK Operations</strong><small>FY26 actuals</small></div><div className="recast-arrow"><Icon name="down"/></div><div className="recast-label">CURRENT STRUCTURE <span>ALLOCATION</span></div>{workspace.departments.map((item) => <label className="weight-row" key={item.id}><span>{item.name}</span><span className="weight-input"><input aria-label={`${item.name} recast percentage`} inputMode="decimal" value={weights[item.id] ?? ''} onChange={(event) => setWeights({ ...weights, [item.id]: event.target.value })}/><span>%</span></span></label>)}<div className="weight-total"><span>Total allocation</span><strong className={Math.abs(total - 100) < 0.0001 ? 'number-positive' : 'number-negative'}>{total.toFixed(2)}%</strong></div>{localError && <p className="form-error" role="alert">{localError}</p>}<button className="primary-button" disabled={busy}>Save allocation <Icon name="arrow" size={16}/></button></form></section>
      <section className="studio-card actual-card"><div className="card-title-row"><div><div className="section-kicker">SOURCE DATA</div><h3>Original actuals</h3></div><span className="count-chip">FY 2026</span></div><p className="detail-copy">Edit the original UK Operations values. Recast values update from these amounts.</p><div className="member-list">{workspace.accounts.map((account) => <div className="actual-row" key={account.id}><span>{account.name}</span><MoneyInput value={workspace.actuals[account.id]} label={`${account.name} original actual`} disabled={busy} save={(amount) => mutate('actuals', 'PUT', { accountId: account.id, amount }, 'Actual saved')} /></div>)}</div><div className="detail-note"><Icon name="spark" size={16}/><span>Values are stored locally in GBP. Empty values remain missing, not zero.</span></div></section>
    </div><div className="page-footnote">NUMERIQ PILOT <span>·</span> Changes are saved locally. This pilot does not provide user access controls or historical versions.</div>
  </>;
}

function MemberRow({ item, type, busy, mutate }: { item: Account | Department; type: 'accounts' | 'departments'; busy: boolean; mutate: (path: string, method: string, data: unknown, success: string) => Promise<boolean> }) {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);
  return <div className="member-row"><span className="member-icon">{type === 'accounts' ? 'A' : 'D'}</span><input aria-label={`Rename ${item.name}`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} onBlur={() => { if (name.trim() && name.trim() !== item.name) void mutate(type, 'PATCH', { id: item.id, name }, 'Member renamed'); else setName(item.name); }} disabled={busy}/><span className="member-hint">{type === 'accounts' && 'kind' in item ? item.kind : 'Member'}</span></div>;
}

export default App;
