import { Router, Request, Response } from 'express';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { sendSuccess, sendError } from '../common/response';

export const healthRouter = Router();

healthRouter.get('/health', (req: Request, res: Response) => {
  sendSuccess(res, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/ready', async (req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);
    sendSuccess(res, {
      status: 'ready',
      database: 'connected',
    });
  } catch (err: any) {
    sendError(
      res,
      'SERVICE_UNAVAILABLE',
      'Database readiness check failed',
      503,
      [{ message: err?.message || 'Database connection error' }]
    );
  }
});
