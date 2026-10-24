import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@arthakram/shared';
import { api } from '../lib/api.js';

interface SessionValue {
  user: MeResponse | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });

  const value: SessionValue = {
    user: me.data ?? null,
    loading: me.isPending,
    signOut: async () => {
      await api.logout();
      qc.setQueryData(['me'], null);
      // Drop every other cached (private) result so the next user never sees it.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
    refresh: async () => {
      await qc.invalidateQueries();
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
