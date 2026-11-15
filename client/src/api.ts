const KEY = 'ds_token';
export const token = {
  get: () => localStorage.getItem(KEY),
  set: (t: string) => localStorage.setItem(KEY, t),
  clear: () => localStorage.removeItem(KEY),
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: any) {
    super(message);
  }
}

function headers() {
  const t = token.get();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method ?? 'GET',
    headers: headers(),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token.get()) {
      token.clear();
      window.dispatchEvent(new Event('ds-auth'));
    }
    throw new ApiError(data?.error ?? res.statusText, res.status, data?.details);
  }
  return data as T;
}

export async function download(path: string, filename: string) {
  const res = await fetch('/api' + path, { headers: headers() });
  if (!res.ok) throw new ApiError('Download failed', res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
