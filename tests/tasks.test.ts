import { describe, expect, it } from 'vitest';
import type { Task } from '../src/lib/api';
import { matchesTaskFilter } from '../src/tasks';

const task = (statuses: Record<string, 'todo' | 'in_progress' | 'done'>): Task => ({
  id: 't', title: 'T', description: null, due_date: null, location: null, shift_id: null, archived: false, created_at: '',
  assignments: Object.entries(statuses).map(([volunteer_id, status]) => ({ volunteer_id, status, updated_at: '' })),
});

describe('admin task filters', () => {
  const shared = task({ ann: 'done', ben: 'todo' });
  it('outstanding means someone still has work left', () => {
    expect(matchesTaskFilter(shared, '', 'outstanding')).toBe(true);
    expect(matchesTaskFilter(task({ ann: 'done', ben: 'done' }), '', 'outstanding')).toBe(false);
    expect(matchesTaskFilter(task({}), '', 'outstanding')).toBe(true); // unassigned still needs doing
  });
  it('filters by one volunteer’s own status', () => {
    expect(matchesTaskFilter(shared, 'ann', 'done')).toBe(true);
    expect(matchesTaskFilter(shared, 'ann', 'outstanding')).toBe(false);
    expect(matchesTaskFilter(shared, 'ben', 'todo')).toBe(true);
    expect(matchesTaskFilter(shared, 'cam', 'any')).toBe(false);
  });
});
