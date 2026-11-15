import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, token } from '../api';

export default function Auth({ onDone }: { onDone: () => void }) {
  const status = useQuery({ queryKey: ['auth-status'], queryFn: () => api<{ hasUsers: boolean }>('/auth/status') });
  const first = status.data && !status.data.hasUsers;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await api<{ token: string }>(first ? '/auth/bootstrap' : '/auth/login', { method: 'POST', body: { email, password } });
      token.set(out.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-5 p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <div className="brand-mark grid h-12 w-12 place-items-center rounded-2xl text-xl font-bold text-white shadow-md" aria-hidden="true">D</div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">Debenhams · Workforce</p>
            <h1 className="mt-1 text-xl">{first ? 'Create the manager account' : 'Welcome back'}</h1>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          {first ? 'This is the first run. Create the manager account to set up people and schedules.' : 'Sign in to manage your team and weekly schedule.'}
        </p>
        {status.isLoading && <p className="text-sm text-muted" role="status">Checking account setup…</p>}
        {status.error && <p className="text-sm text-red-700">Cannot reach the server. Is it running on port 4000?</p>}
        <label className="block text-sm font-bold">Email
          <input className="input mt-1 w-full" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label className="block text-sm font-bold">Password
          <input className="input mt-1 w-full" type="password" required minLength={first ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={first ? 'new-password' : 'current-password'} />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button className="btn btn-primary w-full py-2.5" disabled={busy || status.isLoading || !status.data}>{busy ? 'Please wait…' : first ? 'Create account' : 'Sign in'}</button>
      </form>
    </div>
  );
}
