import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { isSafeReturnTo } from '@arthakram/shared';
import { Spinner } from '../ui/index.js';
import { useSession } from './session.js';

/** Route guard for presentation only: the API enforces access independently (PRD §8). */
export function RequireAuth() {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

export function RedirectIfAuthed() {
  const { user, loading } = useSession();
  const location = useLocation();
  const [params] = useSearchParams();
  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  if (user) {
    // Already signed in (for example from an emailed link): continue to where the person was going.
    const next = (location.state as { from?: string } | null)?.from ?? params.get('next');
    return <Navigate to={isSafeReturnTo(next) ? next : '/events'} replace />;
  }
  return <Outlet />;
}
