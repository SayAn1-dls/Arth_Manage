import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useUnsavedGuard } from './useUnsavedGuard.js';

beforeAll(() => {
  // jsdom has no modal dialog support; mimic it closely enough for the Dialog component.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function Editor({
  dirty,
  flush,
  releaseFirst = false,
}: {
  dirty: boolean;
  flush: () => Promise<unknown> | void;
  releaseFirst?: boolean;
}) {
  const guard = useUnsavedGuard({ dirty, flush });
  const navigate = useNavigate();
  return (
    <>
      <h1>Editor</h1>
      <Link to="/elsewhere">Sidebar link</Link>
      <button
        onClick={() => {
          if (releaseFirst) guard.release();
          navigate('/elsewhere');
        }}
      >
        Own next button
      </button>
      {guard.dialog}
    </>
  );
}

function setup(props: Parameters<typeof Editor>[0]) {
  const router = createMemoryRouter(
    [
      { path: '/edit', element: <Editor {...props} /> },
      { path: '/elsewhere', element: <h1>Elsewhere</h1> },
    ],
    { initialEntries: ['/edit'] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

describe('useUnsavedGuard', () => {
  it('lets navigation through and saves nothing when there are no unsaved changes', async () => {
    const flush = vi.fn();
    setup({ dirty: false, flush });
    await userEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
    expect(flush).not.toHaveBeenCalled();
  });

  it('blocks in-app navigation while changes are unsaved, and Stay keeps the page', async () => {
    const flush = vi.fn();
    const { router } = setup({ dirty: true, flush });
    await userEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));
    const dialog = () => screen.getByText('You have unsaved changes').closest('dialog');
    await vi.waitFor(() => expect(dialog()).toHaveAttribute('open'));
    expect(router.state.location.pathname).toBe('/edit');
    await userEvent.click(screen.getByRole('button', { name: 'Stay on this page' }));
    await vi.waitFor(() => expect(dialog()).not.toHaveAttribute('open'));
    expect(router.state.location.pathname).toBe('/edit');
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument();
    expect(flush).not.toHaveBeenCalled();
  });

  it('Leave anyway saves first, then navigates without saving a second time', async () => {
    let resolveSave: () => void = () => undefined;
    const flush = vi.fn(() => new Promise<void>((r) => (resolveSave = r)));
    const { router } = setup({ dirty: true, flush });
    await userEvent.click(screen.getByRole('link', { name: 'Sidebar link' }));
    await vi.waitFor(() =>
      expect(screen.getByText('You have unsaved changes').closest('dialog')).toHaveAttribute(
        'open',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Leave anyway' }));
    expect(flush).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/edit'); // still waiting for the save
    resolveSave();
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending save when the page unmounts instead of dropping it', () => {
    const flush = vi.fn();
    const { unmount } = setup({ dirty: true, flush });
    expect(flush).not.toHaveBeenCalled();
    unmount();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('release() lets a navigation the page already saved for go through', async () => {
    const flush = vi.fn();
    setup({ dirty: true, flush, releaseFirst: true });
    await userEvent.click(screen.getByRole('button', { name: 'Own next button' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeInTheDocument();
    expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
    expect(flush).not.toHaveBeenCalled();
  });
});
