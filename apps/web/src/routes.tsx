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
import { RegisterForEventPage } from './features/participant/RegisterPage.js';
import { TeamPage } from './features/participant/TeamPage.js';
import { ParticipantsPage } from './features/admin/ParticipantsPage.js';
import { ParticipantDetailPage } from './features/admin/ParticipantDetailPage.js';
import { TeamsPage } from './features/admin/TeamsPage.js';
import { TeamDetailPage } from './features/admin/TeamDetailPage.js';
import {
  SubmissionsMonitorPage,
  SubmissionDetailPage,
} from './features/admin/SubmissionsMonitorPage.js';
import { PeoplePage } from './features/admin/PeoplePage.js';
import { ResultsPage } from './features/results/ResultsPage.js';
import { TasksPage, CheckInPage, IssuesPage } from './features/staff/StaffPages.js';
import { AuditPage } from './features/ops/AuditPage.js';
import { RubricPage } from './features/judging/RubricPage.js';
import { JudgingPage } from './features/judging/JudgingPage.js';
import { JudgeIndexPage, JudgeTeamsPage } from './features/judging/JudgePages.js';
import { EvaluationPage } from './features/judging/EvaluationPage.js';
import { AcceptInvitationPage } from './features/auth/AcceptInvitationPage.js';
import { ProfilePage } from './features/participant/ProfilePage.js';
import { SubmissionPage } from './features/participant/SubmissionPage.js';
import { SubmissionIndexPage } from './features/participant/SubmissionIndexPage.js';

import { FeedbackAdminPage } from './features/engage/FeedbackAdminPage.js';
import { FeedbackPage } from './features/engage/FeedbackPage.js';
import { CertificatesAdminPage } from './features/engage/CertificatesAdminPage.js';
import { MyCertificatesPage } from './features/engage/MyCertificatesPage.js';
import { useOutletContext } from 'react-router';
import type { MyEvent } from '@arthakram/shared';

const CertificatesRoute = () =>
  useOutletContext<MyEvent>().role === 'ADMIN' ? <CertificatesAdminPage /> : <MyCertificatesPage />;
const FeedbackRoute = () =>
  useOutletContext<MyEvent>().role === 'ADMIN' ? <FeedbackAdminPage /> : <FeedbackPage />;

const routes: RouteObject[] = [
  { path: '/', element: <HomePage /> },
  { path: '/e/:slug', element: <PublicEventPage /> },
  { path: '/e/:slug/register', element: <RegisterForEventPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/invitations/accept', element: <AcceptInvitationPage /> },
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
              { path: 'results', element: <ResultsPage /> },
              { path: 'tasks', element: <TasksPage /> },
              { path: 'checkin', element: <CheckInPage /> },
              { path: 'issues', element: <IssuesPage /> },
              { path: 'audit', element: <AuditPage /> },
              { path: 'feedback', element: <FeedbackRoute /> },
              { path: 'certificates', element: <CertificatesRoute /> },
              { path: 'rubric', element: <RubricPage /> },
              { path: 'judging', element: <JudgingPage /> },
              { path: 'judge', element: <JudgeIndexPage /> },
              { path: 'judge/:roundId', element: <JudgeTeamsPage /> },
              { path: 'judge/:roundId/:teamId', element: <EvaluationPage /> },
              { path: 'participants', element: <ParticipantsPage /> },
              { path: 'participants/:membershipId', element: <ParticipantDetailPage /> },
              { path: 'teams', element: <TeamsPage /> },
              { path: 'teams/:teamId', element: <TeamDetailPage /> },
              { path: 'submissions', element: <SubmissionsMonitorPage /> },
              { path: 'submissions/:roundId/:teamId', element: <SubmissionDetailPage /> },
              { path: 'people', element: <PeoplePage /> },
              { path: 'team', element: <TeamPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'submission', element: <SubmissionIndexPage /> },
              { path: 'submission/:roundId', element: <SubmissionPage /> },
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
