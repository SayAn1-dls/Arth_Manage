import {
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  UNSAFE_DataRouterContext,
  useBlocker,
  type Blocker,
  type BlockerFunction,
} from 'react-router';
import { Button } from '../ui/Button.js';
import { Dialog } from '../ui/Dialog.js';

export interface UnsavedGuardOptions {
  /**
   * True while the server does not have the latest work yet: a save is scheduled, running or has
   * failed. In-app navigation is blocked while this is true.
   */
  dirty: boolean;
  /**
   * Saves the latest values now. It must read them from refs, not from render-time state, because it
   * also runs when the page unmounts.
   */
  flush: () => Promise<unknown> | void;
}

export interface UnsavedGuard {
  /** The "You have unsaved changes" dialog. Render it once in the page. */
  dialog: ReactNode;
  /**
   * Call right before a navigation the page has already saved for (for example after awaiting its
   * own save), so the guard neither blocks it nor saves a second time on unmount.
   */
  release: () => void;
}

/**
 * Never lose work on in-app navigation (audit P0-07). Autosaving pages wait a moment after the last
 * change before saving; without this, following a sidebar link in that window unmounted the page,
 * cleared the timer and dropped the change. `beforeunload` only covers closing the tab.
 *
 * - When the page unmounts with unsaved work, the save is fired immediately instead of dropped.
 * - In-app navigation is blocked while work is unsaved, with a dialog to stay or leave. Leaving
 *   still attempts the save first.
 */
const IDLE: Blocker = {
  state: 'unblocked',
  proceed: undefined,
  reset: undefined,
  location: undefined,
};

export function useUnsavedGuard({ dirty, flush }: UnsavedGuardOptions): UnsavedGuard {
  const dirtyRef = useRef(dirty);
  const flushRef = useRef(flush);
  dirtyRef.current = dirty;
  flushRef.current = flush;
  const released = useRef(false);
  const [leaving, setLeaving] = useState(false);

  // Once everything is saved there is nothing left to release; a later edit is guarded again.
  useEffect(() => {
    if (!dirty) released.current = false;
  }, [dirty]);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current &&
      !released.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
    [],
  );
  // useBlocker needs a data router (the app uses createBrowserRouter). Under a plain <MemoryRouter>
  // (component tests) there is nothing to block with, so only the unmount flush applies. Whether a
  // data router is present never changes for a mounted tree, so the hook order stays stable.
  const hasDataRouter = useContext(UNSAFE_DataRouterContext) !== null;
  const blocker: Blocker = hasDataRouter ? useBlocker(shouldBlock) : IDLE;

  useEffect(
    () => () => {
      if (!dirtyRef.current || released.current) return;
      try {
        void Promise.resolve(flushRef.current()).catch(() => undefined);
      } catch {
        /* the page reports its own save errors; nothing more to do once it is gone */
      }
    },
    [],
  );

  const release = useCallback(() => {
    released.current = true;
  }, []);

  const stay = () => {
    if (leaving) return;
    if (blocker.state === 'blocked') blocker.reset();
  };
  const leave = async () => {
    if (blocker.state !== 'blocked') return;
    const target = blocker;
    setLeaving(true);
    try {
      await flushRef.current();
    } catch {
      /* the user chose to leave; the page has already shown why the save failed */
    }
    released.current = true;
    setLeaving(false);
    target.proceed();
  };

  const dialog = createElement(Dialog, {
    open: blocker.state === 'blocked',
    title: 'You have unsaved changes',
    onClose: stay,
    actions: [
      createElement(
        Button,
        { key: 'leave', variant: 'secondary', loading: leaving, onClick: () => void leave() },
        'Leave anyway',
      ),
      createElement(Button, { key: 'stay', onClick: stay, disabled: leaving }, 'Stay on this page'),
    ],
    children: createElement(
      'p',
      null,
      'Your latest changes have not been saved yet. Stay on this page to let them save, or leave and we will try to save them one last time on the way out.',
    ),
  });

  return { dialog, release };
}
