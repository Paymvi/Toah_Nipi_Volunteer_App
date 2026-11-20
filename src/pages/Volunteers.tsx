import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { fetchProfiles, inviteVolunteer, updateProfile, type Profile, type Role } from '../lib/api';
import { Dialog, Empty, ErrorBox, Field, Loading, useAction, useAsync, useToast } from '../ui';

export default function Volunteers() {
  const { refresh } = useAuth();
  const people = useAsync(fetchProfiles, []);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const changed = () => { people.reload(); refresh(); };
  const list = (people.data ?? []).filter((p) => showInactive || p.active);
  const inactiveCount = (people.data ?? []).filter((p) => !p.active).length;

  return (
    <div className="page">
      <h1>Volunteers</h1>
      <InviteForm onInvited={changed} />

      <section aria-labelledby="team-h">
        <div className="page-head">
          <h2 id="team-h">Team ({list.length})</h2>
          {inactiveCount > 0 && (
            <label className="check">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              <span>Show inactive ({inactiveCount})</span>
            </label>
          )}
        </div>
        {people.error && <ErrorBox message={people.error} onRetry={people.reload} />}
        {people.loading && !people.data ? <Loading /> : list.length ? (
          <ul className="stack plain">
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" className={`card person${p.active ? '' : ' is-inactive'}`} onClick={() => setEditing(p)}>
                  <span className="shift-top">
                    <strong>{p.full_name || 'Unnamed volunteer'}</strong>
                    <span>
                      {p.role === 'admin' && <span className="badge timing-today">Admin</span>}{' '}
                      {!p.active && <span className="badge cancelled">Inactive</span>}
                    </span>
                  </span>
                  <span className="shift-meta">{p.email}{p.phone && ` · ${p.phone}`}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty>No volunteers yet. Send your first invitation above.</Empty>}
      </section>
      {editing && <EditPerson person={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); }} />}
    </div>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const action = useAction();
  const toast = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => inviteVolunteer(name.trim(), email.trim()))) {
      toast(`Invitation sent to ${email.trim()}`);
      setName(''); setEmail(''); onInvited();
    }
  };
  return (
    <form className="card form invite" onSubmit={submit}>
      <h2>Invite a volunteer</h2>
      <p className="field-hint">They’ll get an email with a link to set their password. New people start as volunteers.</p>
      <div className="row">
        <Field label="Full name"><input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Email"><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
      </div>
      {action.error && <ErrorBox message={action.error} />}
      <div className="actions"><button className="btn primary" disabled={action.busy}>{action.busy ? 'Sending…' : 'Send invitation'}</button></div>
    </form>
  );
}

function EditPerson({ person, onClose, onSaved }: { person: Profile; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const self = person.id === profile?.id;
  const [f, setF] = useState({ full_name: person.full_name, phone: person.phone ?? '', role: person.role });
  const action = useAction();
  const toast = useToast();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => updateProfile(person.id, { full_name: f.full_name.trim(), phone: f.phone.trim() || null, ...(self ? {} : { role: f.role }) }))) {
      toast('Saved'); onSaved();
    }
  };
  const toggleActive = async () => {
    const msg = person.active
      ? `Deactivate ${person.full_name}? They won’t be able to see the schedule or be assigned new work. Their past shifts and tasks stay on record, and you can reactivate them later.`
      : `Reactivate ${person.full_name}? They’ll regain access right away.`;
    if (!window.confirm(msg)) return;
    if (await action.run(() => updateProfile(person.id, { active: !person.active }))) {
      toast(person.active ? 'Volunteer deactivated' : 'Volunteer reactivated'); onSaved();
    }
  };
  return (
    <Dialog title={person.full_name || 'Volunteer'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <p className="muted">{person.email}</p>
        <Field label="Full name"><input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Phone (optional, admins only)"><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Role" hint={self ? 'You can’t change your own role.' : 'Admins can manage volunteers, shifts, tasks and notes.'}>
          <select value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="volunteer">Volunteer</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        {action.error && <ErrorBox message={action.error} />}
        <div className="actions">
          <button className="btn primary" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save'}</button>
          {!self && (
            <button type="button" className={`btn ${person.active ? 'danger' : ''}`} onClick={toggleActive} disabled={action.busy}>
              {person.active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
