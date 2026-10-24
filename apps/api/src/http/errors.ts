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

  /** Out-of-scope records answer "not found", never "forbidden" (PRD 8.3). */
  static notFound(message = 'Not found') {
    return new AppError(404, 'not_found', message);
  }
  static unauthorized(message = 'Sign in to continue') {
    return new AppError(401, 'unauthenticated', message);
  }
  static forbidden(message = "You don't have access to this") {
    return new AppError(403, 'forbidden', message);
  }
  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(409, code, message, details);
  }
  static invalid(message: string, fields?: Record<string, string>) {
    return new AppError(422, 'validation_error', message, fields ? { fields } : undefined);
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
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    res
      .status(400)
      .json({ error: { code: 'bad_json', message: 'Request body is not valid JSON' } });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
    res
      .status(413)
      .json({ error: { code: 'too_large', message: 'The request is larger than allowed' } });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && err.type === 'encoding.unsupported') {
    res
      .status(415)
      .json({ error: { code: 'unsupported', message: 'Unsupported request encoding' } });
    return;
  }
  // A filter or id the database layer rejects (unknown enum value, invalid date) is the caller's mistake.
  if (err instanceof Error && err.name === 'PrismaClientValidationError') {
    res.status(400).json({
      error: { code: 'invalid_request', message: 'One of the filters or values is not valid' },
    });
    return;
  }
  // Unknown errors: log in full, return a generic message (no stack traces to clients).
  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
