import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { HomePage } from './pages/HomePage.js';
import { DesignGalleryPage } from './pages/DesignGalleryPage.js';

const routes: RouteObject[] = [{ path: '/', element: <HomePage /> }];

// The component gallery is a development tool for visual QA; it is not shipped to production.
if (import.meta.env.DEV) routes.push({ path: '/_design', element: <DesignGalleryPage /> });

export const router = createBrowserRouter(routes);
