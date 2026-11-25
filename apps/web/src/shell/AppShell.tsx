import { LogOut } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { Button, Logo } from '../ui/index.js';
import { useSession } from './session.js';

/**
 * Top bar for signed-in screens outside an event (My events, Create event). Inside an event the EventLayout
 * draws its own header, sidebar and panel.
 */
export function AppShell() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inEvent = /^\/events\/(?!new(?:\/|$))[^/]+/.test(pathname);
  if (inEvent) return <Outlet />;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-workspace items-center justify-between gap-3 px-4 py-2 sm:px-8">
          <Link to="/events" aria-label="My events" className="shrink-0">
            <Logo width={132} className="hidden sm:block" />
            <Logo mark width={36} className="sm:hidden" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-[10rem] truncate text-sm text-ink sm:max-w-none">
              {user?.name}
            </span>
            <Button
              variant="ghost"
              icon={<LogOut aria-hidden className="size-4" />}
              onClick={async () => {
                // Leave the event first, so the next person to sign in is not sent back to this page.
                navigate('/login', { replace: true });
                await signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
