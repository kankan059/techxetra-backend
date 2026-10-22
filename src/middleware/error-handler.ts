import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../common/errors';
import { sendError } from '../common/response';
import { logger } from '../common/logger';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  // 1. AppError (custom domain error)
  if (err instanceof AppError) {
    sendError(res, err.code, err.message, err.statusCode, err.details ? [err.details] : []);
    return;
  }

  // 2. Zod validation error
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));
    sendError(res, 'VALIDATION_ERROR', 'Request validation failed', 400, details);
    return;
  }

  // 3. Express JSON parse syntax error
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    sendError(res, 'BAD_REQUEST', 'Malformed JSON payload in request body', 400);
    return;
  }

  // 4. PostgreSQL driver errors
  if (err && typeof err.code === 'string') {
    // Unique violation
    if (err.code === '23505') {
      sendError(res, 'CONFLICT', 'A record with this identifier or unique field already exists', 409);
      return;
    }
    // Foreign key violation
    if (err.code === '23503') {
      sendError(res, 'BAD_REQUEST', 'Referenced record does not exist', 400);
      return;
    }
    // Check constraint violation
    if (err.code === '23514') {
      sendError(res, 'BAD_REQUEST', 'Operation violates a database constraint', 400);
      return;
    }
  }

  // 5. Unhandled internal server error
  logger.error('Unhandled server error', {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    error: err?.message || String(err),
    stack: err?.stack,
  });

  sendError(res, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
}
