import { createBrowserRouter, Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { HomePage } from './pages/HomePage.js';
import { DesignGalleryPage } from './pages/DesignGalleryPage.js';
import { AppShell } from './shell/AppShell.js';
import { EventLayout } from './shell/EventLayout.js';
import { RedirectIfAuthed, RequireAuth } from './shell/guards.js';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages.js';
import { MyEventsPage } from './features/events/MyEventsPage.js';
import { EventOverviewPage } from './features/events/EventOverviewPage.js';

const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    element: <RedirectIfAuthed />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/events', element: <MyEventsPage /> },
          {
            path: '/events/:eventId',
            element: <EventLayout />,
            children: [{ index: true, element: <EventOverviewPage /> }],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

// The component gallery is a development tool for visual QA; it is not shipped to production.
if (import.meta.env.DEV) routes.push({ path: '/_design', element: <DesignGalleryPage /> });

export const router = createBrowserRouter(routes);
