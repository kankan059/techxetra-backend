import { users, sessions } from '../db/schema';

export type UserSelect = typeof users.$inferSelect;
export type SessionSelect = typeof sessions.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      now: number;
      user?: UserSelect;
      session?: SessionSelect;
    }
  }
}
