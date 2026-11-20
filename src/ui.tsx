import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { STATUS_LABEL, type TaskStatus } from './lib/api';
import type { Timing } from './lib/time';

// ── Data loading: keeps previous data while reloading so lists don't flash ──
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState((s) => ({ ...s, error: e.message, loading: false })),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Wraps an async action with a busy flag (prevents double submits) and an error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }, [busy]);
  return { busy, error, run, setError };
}

// ── Toasts ──
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">{msg && <div className="toast">✓ {msg}</div>}</div>
    </ToastCtx.Provider>
  );
}

// ── Dialog (native <dialog>: focus trapping, Escape to close) ──
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}>
      <div className="dialog-inner">
        <header className="dialog-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}

// ── Small presentational pieces ──
export const Loading = ({ label = 'Loading…' }: { label?: string }) =>
  <p className="loading" role="status"><span className="spinner" aria-hidden /> {label}</p>;

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="error-box" role="alert">
    <span>{message}</span>
    {onRetry && <button type="button" className="btn small" onClick={onRetry}>Try again</button>}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>;

const STATUS_ICON: Record<TaskStatus, string> = { todo: '○', in_progress: '◐', done: '●' };
export const StatusBadge = ({ status }: { status: TaskStatus }) =>
  <span className={`badge status-${status}`}><span aria-hidden>{STATUS_ICON[status]}</span> {STATUS_LABEL[status]}</span>;

const TIMING_LABEL: Record<Timing, string | null> = { past: 'Past', now: 'Happening now', today: 'Today', upcoming: null };
export function TimingBadge({ timing, cancelled }: { timing: Timing; cancelled?: boolean }) {
  if (cancelled) return <span className="badge cancelled">Cancelled</span>;
  const label = TIMING_LABEL[timing];
  return label ? <span className={`badge timing-${timing}`}>{label}</span> : null;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Checkbox list of volunteers. Inactive people only appear if already selected (history). */
export function VolunteerPicker({ value, onChange, legend = 'Volunteers' }:
  { value: string[]; onChange: (ids: string[]) => void; legend?: string }) {
  const { team } = useAuth();
  const people = team.filter((p) => p.active || value.includes(p.id));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const activeIds = team.filter((p) => p.active).map((p) => p.id);
  const allSelected = activeIds.every((id) => value.includes(id));
  return (
    <fieldset className="picker">
      <legend>{legend} <span className="muted">({value.length} selected)</span></legend>
      {people.length > 3 && (
        <button type="button" className="link-btn" onClick={() => onChange(allSelected ? [] : activeIds)}>
          {allSelected ? 'Clear all' : 'Select everyone'}
        </button>
      )}
      <div className="picker-list">
        {people.map((p) => (
          <label key={p.id} className="check">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
            <span>{p.full_name || 'Unnamed volunteer'}{!p.active && <span className="muted"> (inactive)</span>}</span>
          </label>
        ))}
        {people.length === 0 && <span className="muted">No active volunteers yet. Invite some from Volunteers.</span>}
      </div>
    </fieldset>
  );
}

export const joinNames = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
