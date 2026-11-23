import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Catalog, Dimension, Hierarchy } from '../shared/catalog.ts';

async function catalogRequest(path = '', data?: object, method = 'POST'): Promise<Catalog> {
  const response = await fetch(`/api/catalog${path}`, data ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined);
  const result: unknown = await response.json();
  if (!response.ok) throw new Error((result as { error?: string }).error ?? 'Unable to update catalog');
  return result as Catalog;
}

function CreateForm({ label, placeholder, onCreate, disabled }: { label: string; placeholder: string; onCreate: (name: string) => Promise<boolean>; disabled?: boolean }) {
  const [name, setName] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && await onCreate(name.trim())) setName('');
  }
  return <form className="catalog-create" onSubmit={(event) => { void submit(event); }}>
    <input aria-label={label} placeholder={placeholder} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={disabled}/>
    <button className="small-button" disabled={disabled || !name.trim()}>Add</button>
  </form>;
}

function MemberName({ dimension, member, change }: { dimension: Dimension; member: { id: string; name: string }; change: (path: string, data: object, method?: string) => Promise<boolean> }) {
  const [name, setName] = useState(member.name);
  useEffect(() => setName(member.name), [member.name]);
  return <form className="catalog-member" onSubmit={(event) => {
    event.preventDefault();
    if (name.trim() && name.trim() !== member.name) void change('/members', { dimensionId: dimension.id, id: member.id, name }, 'PATCH').then((ok) => { if (!ok) setName(member.name); });
  }}>
    <input aria-label={`Member name ${member.name}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={dimension.binding !== null}/>
    {dimension.binding === null && <button className="small-button" disabled={!name.trim() || name.trim() === member.name}>Rename</button>}
  </form>;
}

function HierarchyEditor({ dimension, hierarchy, change }: { dimension: Dimension; hierarchy: Hierarchy; change: (path: string, data: object, method?: string) => Promise<boolean> }) {
  const latest = hierarchy.versions[0];
  const [version, setVersion] = useState('draft');
  const [parents, setParents] = useState<Record<string, string>>({});
  useEffect(() => {
    const saved = new Map((latest?.nodes ?? []).map((node) => [node.memberId, node.parentId ?? '']));
    setParents(Object.fromEntries(dimension.members.map((member) => [member.id, saved.get(member.id) ?? ''])));
    setVersion('draft');
  }, [hierarchy.id, latest?.version, dimension.members]);
  const historical = hierarchy.versions.find((item) => String(item.version) === version);
  const historicalNames = new Map(historical?.nodes.map((node) => [node.memberId, node.name]) ?? []);
  return <section className="studio-card hierarchy-editor">
    <div className="card-title-row"><div><div className="section-kicker">HIERARCHY</div><h3>{hierarchy.name}</h3></div><span className="count-chip">{latest ? `Latest v${latest.version}` : 'Not published'}</span></div>
    <p className="detail-copy">Each member has at most one parent in this hierarchy. Publishing saves a new immutable structure and member-name snapshot.</p>
    <label className="catalog-label">View version <select aria-label="Hierarchy version" value={version} onChange={(event) => setVersion(event.target.value)}><option value="draft">Edit next version</option>{hierarchy.versions.map((item) => <option key={item.version} value={item.version}>Version {item.version} · {item.createdAt}</option>)}</select></label>
    {version === 'draft' ? <>
      <div className="catalog-parent-heading"><span>MEMBER</span><span>PARENT</span></div>
      {dimension.members.map((member) => <div className="catalog-parent" key={member.id}><span>{member.name}</span><select aria-label={`Parent of ${member.name}`} value={parents[member.id] ?? ''} onChange={(event) => setParents({ ...parents, [member.id]: event.target.value })}><option value="">Root</option>{dimension.members.filter((candidate) => candidate.id !== member.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></div>)}
      {!dimension.members.length && <p className="detail-copy">Add a member before publishing a hierarchy.</p>}
      <button className="primary-button catalog-publish" disabled={!dimension.members.length} onClick={() => void change('/versions', { hierarchyId: hierarchy.id, expectedVersion: latest?.version ?? 0, nodes: dimension.members.map((member) => ({ memberId: member.id, parentId: parents[member.id] || null })) })}>Publish new version</button>
    </> : <div className="catalog-history">
      {historical?.nodes.map((node) => <div className="catalog-parent" key={node.memberId}><span>{node.name}</span><span>{node.parentId === null ? 'Root' : historicalNames.get(node.parentId) ?? 'Unknown parent'}</span></div>)}
      <p className="detail-copy">Read-only snapshot · {historical?.createdAt}</p>
    </div>}
  </section>;
}

export default function CatalogStudio() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [applicationId, setApplicationId] = useState('');
  const [modelId, setModelId] = useState('');
  const [dimensionId, setDimensionId] = useState('');
  const [hierarchyId, setHierarchyId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { catalogRequest().then(setCatalog).catch((e: Error) => setError(e.message)); }, []);
  const application = catalog?.find((item) => item.id === applicationId) ?? catalog?.[0];
  const model = application?.models.find((item) => item.id === modelId) ?? application?.models[0];
  const dimension = model?.dimensions.find((item) => item.id === dimensionId) ?? model?.dimensions[0];
  const hierarchy = dimension?.hierarchies.find((item) => item.id === hierarchyId) ?? dimension?.hierarchies[0];
  async function change(path: string, data: object, method?: string): Promise<boolean> {
    setError(''); setNotice(''); setBusy(true);
    try { setCatalog(await catalogRequest(path, data, method)); setNotice('Saved to this workspace.'); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to update catalog'); return false; }
    finally { setBusy(false); }
  }
  if (!catalog) return <div className="loading">{error || 'Loading model catalog…'}</div>;
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> MODEL CATALOG <span className="eyebrow-divider">/</span> METADATA</div><h1>Build your <em>business structure.</em></h1><p>Create applications and models, then organize their dimensions.</p></div></div>
    <div className="inline-info catalog-warning">Catalog hierarchies are metadata only: they do not yet change the planning grid, recast, or calculations. Account and Department members are shared with the existing planning editor.</div>
    {error && <div className="alert error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
    <div className="catalog-layout">
      <section className="studio-card"><div className="section-kicker">01 · APPLICATION</div><h3>Applications</h3><label className="catalog-label">Selected application<select aria-label="Selected application" value={application?.id ?? ''} onChange={(event) => { setApplicationId(event.target.value); setModelId(''); setDimensionId(''); setHierarchyId(''); }}>{catalog.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><CreateForm label="New application name" placeholder="New application" onCreate={(name) => change('/applications', { name })} disabled={busy}/></section>
      <section className="studio-card"><div className="section-kicker">02 · MODEL</div><h3>Models</h3><label className="catalog-label">Selected model<select aria-label="Selected model" value={model?.id ?? ''} onChange={(event) => { setModelId(event.target.value); setDimensionId(''); setHierarchyId(''); }}><option value="" disabled>No model selected</option>{application?.models.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><CreateForm label="New model name" placeholder="New model" onCreate={(name) => change('/models', { applicationId: application?.id, name })} disabled={busy || !application}/></section>
      <section className="studio-card"><div className="section-kicker">03 · DIMENSION</div><h3>Dimensions</h3><label className="catalog-label">Selected dimension<select aria-label="Selected dimension" value={dimension?.id ?? ''} onChange={(event) => { setDimensionId(event.target.value); setHierarchyId(''); }}><option value="" disabled>No dimension selected</option>{model?.dimensions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><CreateForm label="New dimension name" placeholder="New dimension" onCreate={(name) => change('/dimensions', { modelId: model?.id, name })} disabled={busy || !model}/></section>
    </div>
    {dimension && <div className="studio-grid catalog-detail">
      <section className="studio-card"><div className="card-title-row"><div><div className="section-kicker">DIMENSION MEMBERS</div><h3>{dimension.name}</h3></div><span className="count-chip">{dimension.members.length} members</span></div>
        <p className="detail-copy">{dimension.binding ? 'This dimension is linked to the existing planning grid. Add or rename its members in Model & dimensions.' : 'Add and rename members; published hierarchy snapshots keep their historical names.'}</p>
        <div className="member-list">{dimension.members.map((member) => <MemberName key={member.id} dimension={dimension} member={member} change={change}/>)}</div>
        {!dimension.binding && <CreateForm label="New member name" placeholder="New member" onCreate={(name) => change('/members', { dimensionId: dimension.id, name })} disabled={busy}/>}
      </section>
      <section className="studio-card"><div className="card-title-row"><div><div className="section-kicker">ALTERNATE STRUCTURES</div><h3>Hierarchies</h3></div><span className="count-chip">{dimension.hierarchies.length} structures</span></div><p className="detail-copy">Create separate reporting structures for the same members. Structures are single-parent trees, not allocation rules.</p>
        <label className="catalog-label">Selected hierarchy<select aria-label="Selected hierarchy" value={hierarchy?.id ?? ''} onChange={(event) => setHierarchyId(event.target.value)}><option value="" disabled>No hierarchy selected</option>{dimension.hierarchies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <CreateForm label="New hierarchy name" placeholder="New hierarchy" onCreate={(name) => change('/hierarchies', { dimensionId: dimension.id, name })} disabled={busy}/>
      </section>
      {hierarchy && <HierarchyEditor key={hierarchy.id} dimension={dimension} hierarchy={hierarchy} change={change}/>}
    </div>}
    <div className="page-footnote">LOCAL PILOT · Metadata versions are not effective-dated, approved, secured, or used by the grid.</div>
  </>;
}
