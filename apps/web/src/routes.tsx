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
import { CreateEventPage } from './features/events/CreateEventPage.js';
import { SetupPage } from './features/events/SetupPage.js';
import { RoundsPage } from './features/events/RoundsPage.js';
import { StructurePage } from './features/events/StructurePage.js';
import { GuidebookPage } from './features/events/GuidebookPages.js';
import { AnnouncementsPage } from './features/events/AnnouncementsPage.js';
import { PublicEventPage } from './features/events/PublicEventPage.js';

const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/e/:slug', element: <PublicEventPage /> },
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
          { path: '/events/new', element: <CreateEventPage /> },
          {
            path: '/events/:eventId',
            element: <EventLayout />,
            children: [
              { index: true, element: <EventOverviewPage /> },
              { path: 'setup', element: <SetupPage /> },
              { path: 'rounds', element: <RoundsPage /> },
              { path: 'structure', element: <StructurePage /> },
              { path: 'guidebook', element: <GuidebookPage /> },
              { path: 'announcements', element: <AnnouncementsPage /> },
            ],
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
