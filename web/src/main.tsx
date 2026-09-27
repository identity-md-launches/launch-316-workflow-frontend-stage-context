import { createRoot } from 'react-dom/client';
import App from './App';
import { loadRuntime } from './config';
import './style.css';
const root = createRoot(document.getElementById('root')!);
root.render(<main className="boot"><p className="eyebrow">arbiter.</p><h1>Loading deployment…</h1><p role="status">Checking configuration and contract ABIs.</p></main>);
loadRuntime().then(runtime => root.render(<App runtime={runtime} />)).catch(error => root.render(<main className="boot"><p className="eyebrow">arbiter.</p><h1>Deployment unavailable</h1><p role="alert">{error instanceof Error ? error.message : 'Could not load the deployment.'}</p><button onClick={() => location.reload()}>Reload deployment</button></main>));
