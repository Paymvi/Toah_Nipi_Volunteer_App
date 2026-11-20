import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMyProfile, fetchTeam, supabase, type Person, type Profile } from './lib/api';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  team: Person[];
  isAdmin: boolean;
  ready: boolean;
  error: string | null;
  nameOf: (id: string) => string;
  refresh: () => Promise<void>;
  recovering: boolean;
}

const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [team, setTeam] = useState<Person[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
      if (!s) { setProfile(null); setTeam([]); setReady(true); }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const p = await fetchMyProfile(userId);
      setProfile(p);
      setTeam(p?.active ? await fetchTeam() : []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }, [userId]);

  useEffect(() => { if (userId) { setReady(false); refresh(); } }, [userId, refresh]);

  const value = useMemo<AuthState>(() => {
    const names = new Map(team.map((p) => [p.id, p.full_name || 'Unnamed volunteer']));
    return {
      session, profile, team, ready, error, refresh, recovering,
      isAdmin: profile?.role === 'admin' && profile.active,
      nameOf: (id) => names.get(id) ?? 'Former volunteer',
    };
  }, [session, profile, team, ready, error, refresh, recovering]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
