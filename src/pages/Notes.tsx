import { useState } from 'react';
import { useAuth } from '../auth';
import { fetchNotes, type Note } from '../lib/api';
import { NoteCard, NoteForm } from '../notes';
import { Empty, ErrorBox, Loading, useAsync } from '../ui';

export default function Notes() {
  const { isAdmin } = useAuth();
  const notes = useAsync(fetchNotes, []);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Notes & announcements</h1>
        {isAdmin && <button type="button" className="btn primary" onClick={() => setEditing('new')}>＋ Share a note</button>}
      </div>
      {notes.error && <ErrorBox message={notes.error} onRetry={notes.reload} />}
      {notes.loading && !notes.data ? <Loading /> : notes.data?.length ? (
        <div className="stack">
          {notes.data.map((n) => <NoteCard key={n.id} note={n} onEdit={() => setEditing(n)} onDeleted={notes.reload} />)}
        </div>
      ) : <Empty>No notes or announcements yet.</Empty>}
      {editing && <NoteForm note={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); notes.reload(); }} />}
    </div>
  );
}
