import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { requestIdMiddleware } from './middleware/request-id';
import { csrfProtection } from './middleware/csrf';
import { errorHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { meRouter } from './routes/me';
import { catalogRouter } from './routes/catalog';
import { eventsRouter } from './routes/events';
import { leaderboardsRouter } from './routes/leaderboards';
import { teamsRouter } from './routes/teams';
import { teamInvitesRouter } from './routes/team-invites';
import { purchasesRouter } from './routes/purchases';
import { paymentsRouter } from './routes/payments';
import { adminPaymentsRouter } from './routes/admin-payments';
import { ticketsRouter } from './routes/tickets';
import { scannerRouter } from './routes/scanner';
import { adminTicketsRouter } from './routes/admin-tickets';
import { staffEsportsRouter } from './routes/staff-esports';
import { staffEventsRouter } from './routes/staff-events';
import { adminUsersRouter } from './routes/admin-users';
import { adminEventsRouter } from './routes/admin-events';
import { adminSettingsRouter } from './routes/admin-settings';
import { adminReportsRouter } from './routes/admin-reports';
import { sendError } from './common/response';

export const app: Express = express();

// Security HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
      },
    },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
  })
);

// CORS configuration - Allows requests from all origins with credentials support
app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'x-request-id',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Cookie',
      'x-test-csrf',
    ],
    exposedHeaders: ['x-request-id'],
  })
);

// Body parsers & Cookie parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Request tracing middleware
app.use(requestIdMiddleware);

// CSRF mutation origin check
app.use(csrfProtection);

// Mount health & readiness
app.use(healthRouter);
app.use('/api/v1', healthRouter);

// Mount Domain Routers under both /api/v1 and root prefixes
const domainRouters = [
  catalogRouter,
  eventsRouter,
  leaderboardsRouter,
  authRouter,
  meRouter,
  teamsRouter,
  teamInvitesRouter,
  purchasesRouter,
  paymentsRouter,
  adminPaymentsRouter,
  ticketsRouter,
  scannerRouter,
  adminTicketsRouter,
  staffEsportsRouter,
  staffEventsRouter,
  adminUsersRouter,
  adminEventsRouter,
  adminSettingsRouter,
  adminReportsRouter,
];

for (const router of domainRouters) {
  app.use('/api/v1', router);
  app.use(router);
}

// 404 Not Found handler for unmatched routes
app.use((req: Request, res: Response) => {
  sendError(res, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`, 404);
});

// Centralized error handling middleware
app.use(errorHandler);
