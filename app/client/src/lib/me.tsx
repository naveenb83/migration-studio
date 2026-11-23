/** Session context: who I am, my team, the public pack. Everything else hangs off this. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Me } from './types';

interface MeState {
  me: Me | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<MeState>({ me: null, error: null, loading: true, refresh: async () => undefined });

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/api/me');
      setMe(m);
      setError(null);
      // Clear stale Genie conversations when the build changes (after a redeploy).
      const key = 'studio_build';
      if (localStorage.getItem(key) !== m.build) {
        Object.keys(localStorage)
          .filter((k) => /genie|conversation/i.test(k))
          .forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(key, m.build);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <Ctx.Provider value={{ me, error, loading, refresh }}>{children}</Ctx.Provider>;
}

export const useMe = () => useContext(Ctx);

/** The signed-in session, asserted present (pages render only after /api/me resolves). */
export function useSession(): Me {
  const { me } = useMe();
  if (!me) throw new Error('session not loaded');
  return me;
}

export function useTask(id: string) {
  const me = useSession();
  return me.pack.tasks.find((t) => t.id === id) ?? null;
}
