import { createBrowserRouter } from 'react-router';
import { HomePage } from './pages/HomePage.js';

export const router = createBrowserRouter([{ path: '/', element: <HomePage /> }]);
