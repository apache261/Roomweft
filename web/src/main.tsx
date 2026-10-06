import { enablePerformanceDiagnostics } from './performanceMetrics';
import {ThemeProvider,ThemeSwitch} from './Theme';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { request, type Project } from './api';
import './style.css';
import { PublicViewer } from './PublicViewer';
import { ProjectScenes } from './ProjectScenes';

const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong';

enablePerformanceDiagnostics(import.meta.env.DEV && new URLSearchParams(location.search).get('perf') === '1');

function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    request<Project[]>('/projects').then(data => { if (active) setProjects(data); })
      .catch(err => { if (active) setError(message(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const project = await request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name }) });
      navigate(`/projects/${project.id}`);
    } catch (err) { setError(message(err)); } finally { setSaving(false); }
  }
  return <main>
    <div className="eyebrow">YOUR WORKSPACE</div>
    <h1>A place for every tour.</h1>
    <p className="intro">Create a project and start shaping your next virtual experience.</p>
    <form className="create-form" onSubmit={create}>
      <label htmlFor="new-name">Project name</label>
      <div className="form-row"><input id="new-name" placeholder="e.g. Ancestral House" value={name} onChange={e => setName(e.target.value)} maxLength={120} required />
      <button disabled={saving || !name.trim()}>{saving ? 'Creating…' : '+ Create project'}</button></div>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="section-title"><h2>Projects</h2><span>{projects.length} total</span></div>
    {loading ? <p role="status">Loading projects…</p> : projects.length ? <div className="project-grid">{projects.map(project =>
      <Link key={project.id} to={`/projects/${project.id}`} className="project-card">
        <div className="card-art" aria-hidden="true">◇</div>
        <div className="card-body"><h3>{project.name}</h3><p>{project.description || 'Ready for your first scene.'}</p><span>Open project →</span></div>
      </Link>)}</div> : !error && <div className="empty"><h3>Your first tour starts here</h3><p>Create a project using the form above.</p></div>}
  </main>;
}

function Builder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const detailsDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(detailsOpen)detailsDialog.current?.showModal();},[detailsOpen]);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setProject(null);
    request<Project>(`/projects/${id}`).then(data => {
      if (active) { setProject(data); setName(data.name); setDescription(data.description); }
    }).catch(err => { if (active) setError(message(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const data = await request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ name, description }) });
      setProject(data); setName(data.name); setSaved(true);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete “${project?.name}”? This cannot be undone.`)) return;
    setBusy(true); setError('');
    try { await request<void>(`/projects/${id}`, { method: 'DELETE' }); navigate('/'); }
    catch (err) { setError(message(err)); setBusy(false); }
  }
  return <main className="editor-shell">
    {loading ? <p role="status">Loading project…</p> : <>
      {error && !detailsOpen && <p role="alert" className="error">{error}</p>}
      {project && <><div className="project-header"><Link className="back" to="/">← Projects</Link><span className="header-divider"/><h1>{project.name}</h1><span className="editor-label">Tour editor</span><button className="secondary" onClick={()=>setDetailsOpen(true)}>Project details</button></div>
        <div className="builder-grid">
          <ProjectScenes key={project.id} projectID={project.id} />
          {detailsOpen && <dialog ref={detailsDialog} className="project-details-dialog" aria-label="Project details" onCancel={()=>setDetailsOpen(false)}><form className="settings" onSubmit={save}><div className="library-heading"><h2>Project details</h2><button type="button" className="secondary" onClick={()=>setDetailsOpen(false)} aria-label="Close project details">✕</button></div>
            {error && <p role="alert" className="error">{error}</p>}
            <label htmlFor="name">Name</label><input id="name" value={name} onChange={e => { setName(e.target.value); setSaved(false); }} maxLength={120} required disabled={busy} />
            <label htmlFor="description">Description</label><textarea id="description" value={description} onChange={e => { setDescription(e.target.value); setSaved(false); }} maxLength={5000} rows={5} disabled={busy} />
            <button disabled={busy || !name.trim()}>{busy ? 'Working…' : 'Save changes'}</button>
            {saved && <p role="status" className="saved">Changes saved.</p>}
            <button type="button" className="delete" onClick={remove} disabled={busy}>Delete project</button>
          </form></dialog>}
        </div></>}
    </>}
  </main>;
}

function App() {
  return <BrowserRouter><header><Link to="/" className="brand"><span aria-hidden="true">◇</span> Virtual Tour Studio</Link><div className="header-actions"><span className="badge">Proof of concept</span><ThemeSwitch /></div></header>
    <Routes><Route path="/" element={<Dashboard />} /><Route path="/projects/:id" element={<Builder />} /><Route path="/t/:slug" element={<PublicViewer />} /><Route path="/embed/:slug" element={<PublicViewer embed />} /><Route path="*" element={<main><h1>Page not found</h1><Link to="/">Back to projects</Link></main>} /></Routes>
  </BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><App /></ThemeProvider>);
