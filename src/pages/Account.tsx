import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { supabase, updateProfile } from '../lib/api';
import { ErrorBox, Field, useAction, useToast } from '../ui';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'forgot' | 'sent'>('signin');
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'signin') {
      await action.run(async () => {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(/invalid/i.test(error.message) ? 'That email and password don’t match. Please try again.' : error.message);
      });
    } else if (await action.run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password` });
      if (error) throw error;
    })) setMode('sent');
  };

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand-mark" aria-hidden>▲</div>
        <h1>Toah Nipi Volunteers</h1>
        {mode === 'sent' ? (
          <>
            <p>If <strong>{email}</strong> has an account, we’ve sent a link to set a new password. Check your inbox.</p>
            <button type="button" className="btn" onClick={() => setMode('signin')}>Back to sign in</button>
          </>
        ) : (
          <form className="form" onSubmit={submit}>
            <p className="muted">{mode === 'signin' ? 'Welcome! Sign in to see when you’re serving.' : 'Enter your email and we’ll send you a link to set a new password.'}</p>
            <Field label="Email"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            {mode === 'signin' && (
              <Field label="Password"><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            )}
            {action.error && <ErrorBox message={action.error} />}
            <button className="btn primary block" disabled={action.busy}>
              {action.busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
            </button>
            <button type="button" className="link-btn" onClick={() => { setMode(mode === 'signin' ? 'forgot' : 'signin'); action.setError(null); }}>
              {mode === 'signin' ? 'Forgot your password?' : 'Back to sign in'}
            </button>
            <p className="field-hint">New volunteer? Ask the volunteer coordinator to send you an invitation.</p>
          </form>
        )}
      </div>
    </div>
  );
}

function PasswordForm({ onDone, submitLabel }: { onDone: () => void; submitLabel: string }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return action.setError('Please use at least 8 characters.');
    if (pw !== confirm) return action.setError('The two passwords don’t match.');
    if (await action.run(async () => { const { error } = await supabase.auth.updateUser({ password: pw }); if (error) throw error; })) {
      setPw(''); setConfirm(''); onDone();
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="New password" hint="At least 8 characters"><input type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Confirm password"><input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {action.error && <ErrorBox message={action.error} />}
      <button className="btn primary" disabled={action.busy}>{action.busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

/** Landing page for invite and password-reset links (Supabase signs the user in from the link). */
export function SetPassword() {
  const { session, ready } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const linkError = new URLSearchParams(window.location.hash.slice(1)).get('error_description');
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand-mark" aria-hidden>▲</div>
        <h1>Set your password</h1>
        {!ready ? <p>Checking your link…</p> : session ? (
          <>
            <p className="muted">Choose a password you’ll use to sign in from now on.</p>
            <PasswordForm submitLabel="Save password and continue" onDone={() => { toast('Password saved. Welcome!'); navigate('/', { replace: true }); }} />
          </>
        ) : (
          <>
            <ErrorBox message={linkError ?? 'This link has expired or was already used.'} />
            <p>Ask your volunteer coordinator to send a new invitation, or use “Forgot your password?” on the sign-in page.</p>
            <a className="btn" href="/">Go to sign in</a>
          </>
        )}
      </div>
    </div>
  );
}

export function Account() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ full_name: profile!.full_name, phone: profile!.phone ?? '' });
  const action = useAction();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => updateProfile(profile!.id, { full_name: f.full_name.trim(), phone: f.phone.trim() || null }))) {
      toast('Your details were saved'); refresh();
    }
  };
  return (
    <div className="page">
      <h1>Your account</h1>
      <form className="card form" onSubmit={save}>
        <h2>Your details</h2>
        <p className="muted">Signed in as {profile!.email} · {profile!.role === 'admin' ? 'Admin' : 'Volunteer'}</p>
        <Field label="Full name" hint="Shown to your team on the schedule."><input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Phone (optional)" hint="Only coordinators can see this."><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        {action.error && <ErrorBox message={action.error} />}
        <div className="actions"><button className="btn primary" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save'}</button></div>
      </form>
      <section className="card">
        <h2>Change password</h2>
        <PasswordForm submitLabel="Update password" onDone={() => toast('Password updated')} />
      </section>
    </div>
  );
}
