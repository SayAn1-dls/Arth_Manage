import { Router } from 'express';
import type { Deps } from '../../http/deps.js';
import { assignmentsRouter } from './assignments.js';
import { judgeRouter } from './judge.js';
import { rubricRouter } from './rubric.js';

export function judgingRouter(deps: Deps) {
  const router = Router({ mergeParams: true });
  router.use(rubricRouter(deps));
  router.use(assignmentsRouter(deps));
  router.use(judgeRouter(deps));
  return router;
}
