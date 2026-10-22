export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(statusCode: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: any) {
    return new AppError(400, code, message, details);
  }

  static validation(message = 'Request validation failed', details?: any) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new AppError(409, code, message);
  }

  static capacityExceeded(message = 'Event capacity has been exceeded', code = 'CAPACITY_EXCEEDED') {
    return new AppError(409, code, message);
  }

  static reservationExpired(message = 'Reservation has expired', code = 'RESERVATION_EXPIRED') {
    return new AppError(410, code, message);
  }

  static rateLimited(message = 'Too many requests, please try again later', code = 'RATE_LIMITED') {
    return new AppError(429, code, message);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    return new AppError(500, code, message);
  }
}
