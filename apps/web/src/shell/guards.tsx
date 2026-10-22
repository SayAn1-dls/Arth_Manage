import { Navigate, Outlet, useLocation } from 'react-router';
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
  if (loading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Loading" />
      </div>
    );
  if (user) return <Navigate to="/events" replace />;
  return <Outlet />;
}
