import { LogOut } from 'lucide-react';
import { Link, Outlet, useNavigate } from 'react-router';
import { Button, Logo } from '../ui/index.js';
import { useSession } from './session.js';

/** Top bar shared by every signed-in screen, whatever the role. */
export function AppShell() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-content items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Link to="/events" aria-label="My events" className="shrink-0">
            <Logo width={132} className="hidden sm:block" />
            <Logo mark width={36} className="sm:hidden" />
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden truncate text-sm text-ink sm:inline">{user?.name}</span>
            <Button
              variant="ghost"
              icon={<LogOut aria-hidden className="size-4" />}
              onClick={async () => {
                await signOut();
                navigate('/login');
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
