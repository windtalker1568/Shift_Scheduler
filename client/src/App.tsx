import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, token } from './api';
import Auth from './pages/Auth';
import PeopleManager from './pages/PeopleManager';
import Requirements from './pages/Requirements';
import Schedule from './pages/Schedule';
import SettingsPage from './pages/SettingsPage';

type Tab = 'schedule' | 'requirements' | 'people' | 'settings';
const BACKGROUNDS = [
  '/backgrounds/1.jpg',
  '/backgrounds/2.jpg',
  '/backgrounds/3.jpg',
  '/backgrounds/4.jpg',
  '/backgrounds/5.jpg',
  '/backgrounds/6.png',
  '/backgrounds/7.jpg',
];
const TABS: [Tab, string][] = [
  ['schedule', 'Weekly schedule'],
  ['requirements', 'Staffing needs'],
  ['people', 'People'],
  ['settings', 'Settings'],
];

export default function App() {
  const [authed, setAuthed] = useState(!!token.get());
  useEffect(() => {
    const f = () => setAuthed(!!token.get());
    window.addEventListener('ds-auth', f);
    return () => window.removeEventListener('ds-auth', f);
  }, []);
  return (
    <div className="app-root">
      <BackgroundSlideshow />
      {authed
        ? <Shell onSignOut={() => { token.clear(); setAuthed(false); }} />
        : <Auth onDone={() => setAuthed(true)} />}
    </div>
  );
}

function BackgroundSlideshow() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setActive((index) => (index + 1) % BACKGROUNDS.length), 14000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="ambient-background" aria-hidden="true">
      {BACKGROUNDS.map((image, index) => (
        <div
          key={image}
          className={`ambient-background-image ${index === active ? 'ambient-background-image-active' : ''}`}
          style={{ backgroundImage: `url("${image}")` }}
        />
      ))}
      <div className="ambient-background-scrim" />
    </div>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api('/setup/status') });
  const [tab, setTab] = useState<Tab>('schedule');
  const status = setup.data as { setupComplete: boolean; activeCount: number; capacity: number } | undefined;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-max items-center gap-3">
            <div className="brand-mark grid h-10 w-10 place-items-center rounded-xl text-lg font-bold text-white shadow-md" aria-hidden="true">D</div>
            <div>
              <h1 className="text-base sm:text-lg">Debenhams advisor scheduler</h1>
              <p className="hidden text-xs text-muted sm:block">Weekly workforce planning</p>
            </div>
          </div>
          {status?.setupComplete && (
            <nav className="flex flex-1 flex-wrap items-center gap-1 rounded-xl bg-white/45 p-1 backdrop-blur-md sm:ml-4 sm:flex-nowrap" aria-label="Main">
              {TABS.map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={`nav-link whitespace-nowrap ${tab === id ? 'nav-link-active' : ''}`}>
                  {label}
                </button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {status && <span className="capacity-pill" title="Active people / capacity"><span className="capacity-dot" />{status.activeCount} / {status.capacity} people</span>}
            <button className="btn" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {setup.isLoading && <p>Loading…</p>}
        {setup.error && <p className="text-red-700">Cannot reach the server: {(setup.error as Error).message}</p>}
        {status && !status.setupComplete && <PeopleManager setupMode onCompleted={() => qc.invalidateQueries({ queryKey: ['setup'] })} />}
        {status?.setupComplete && tab === 'schedule' && <Schedule />}
        {status?.setupComplete && tab === 'requirements' && <Requirements />}
        {status?.setupComplete && tab === 'people' && <PeopleManager />}
        {status?.setupComplete && tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
