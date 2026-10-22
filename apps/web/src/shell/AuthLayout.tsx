import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Arc, Logo } from '../ui/index.js';

/** Centered card on Paper with the brand arc kept in a corner, clear of the form. */
export function AuthLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden">
      <Arc className="-top-40 -right-40 size-72 sm:-top-56 sm:-right-56 sm:size-[34rem]" />
      <Arc counter className="-top-32 -right-52 size-72 sm:-top-44 sm:-right-72 sm:size-[34rem]" />
      <div className="relative mx-auto flex min-h-dvh max-w-form flex-col px-4 py-8 sm:px-0">
        <Link to="/" aria-label="Arthakram events home" className="w-fit">
          <Logo width={150} />
        </Link>
        <main className="my-auto py-10">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{title}</h1>
          {intro && <p className="mt-3">{intro}</p>}
          <div className="mt-6 rounded-card bg-white p-5 shadow-card sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
