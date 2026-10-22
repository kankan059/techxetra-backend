import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.headers['x-request-id'] as string) || `req_${uuidv4()}`;
  req.requestId = reqId;
  req.now = Date.now();
  res.setHeader('x-request-id', reqId);
  next();
}
