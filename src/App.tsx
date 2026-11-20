import { useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { configured, supabase } from './lib/api';
import { Account, Login, SetPassword } from './pages/Account';
import Home from './pages/Home';
import Notes from './pages/Notes';
import Schedule from './pages/Schedule';
import Tasks from './pages/Tasks';
import Volunteers from './pages/Volunteers';
import { ErrorBox, Loading, ToastProvider } from './ui';

const TABS = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/schedule', label: 'Schedule', icon: '▦' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
];

function ProfileMenu() {
  const { profile, isAdmin } = useAuth();
  const ref = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => { ref.current?.removeAttribute('open'); }, [location]);
  useEffect(() => {
    const onDoc = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.removeAttribute('open'); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && ref.current?.open) { ref.current.removeAttribute('open'); ref.current.querySelector('summary')?.focus(); } };
    document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);
  const initials = profile!.full_name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <details className="profile-menu" ref={ref}>
      <summary aria-label="Account menu"><span className="avatar" aria-hidden>{initials}</span></summary>
      <div className="menu">
        <p className="menu-name">{profile!.full_name}<span>{isAdmin ? 'Admin' : 'Volunteer'}</span></p>
        <NavLink to="/account">Account settings</NavLink>
        <NavLink to="/notes">Notes & announcements</NavLink>
        {isAdmin && <NavLink to="/volunteers">Manage volunteers</NavLink>}
        <button type="button" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </details>
  );
}

function Shell() {
  const { isAdmin } = useAuth();
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <NavLink to="/" className="brand"><span className="brand-mark" aria-hidden>▲</span> Toah Nipi <span className="brand-sub">Volunteers</span></NavLink>
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.to === '/'}><span aria-hidden>{t.icon}</span> {t.label}</NavLink>)}
        </nav>
        <ProfileMenu />
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/account" element={<Account />} />
          <Route path="/volunteers" element={isAdmin ? <Volunteers /> : <Navigate to="/" replace />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

function Gate() {
  const { session, profile, ready, error, refresh, recovering } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => { if (recovering) navigate('/set-password'); }, [recovering, navigate]);

  if (!configured) {
    return <div className="auth-page"><div className="card auth-card"><h1>Setup needed</h1>
      <p>Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Supabase URL and anon key, then restart the dev server.</p></div></div>;
  }
  if (pathname === '/set-password') return <SetPassword />;
  if (!ready) return <div className="auth-page"><Loading label="Opening Toah Nipi Volunteers…" /></div>;
  if (!session) return <Login />;
  if (error) return <div className="auth-page"><div className="card auth-card"><ErrorBox message={error} onRetry={refresh} /></div></div>;
  if (!profile?.active) {
    return (
      <div className="auth-page"><div className="card auth-card">
        <h1>Account not active</h1>
        <p>Your volunteer account isn’t active right now. If you think this is a mistake, please contact the volunteer coordinator.</p>
        <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div></div>
    );
  }
  return <Shell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
