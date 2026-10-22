import type { ErrorRequestHandler, RequestHandler } from 'express';

/** An error whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'not_found', message);
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(AppError.notFound());

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Unknown errors: log in full, return a generic message (no stack traces to clients).
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
