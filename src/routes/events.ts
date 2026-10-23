import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { eq, and, or, sql, ilike, ne, count } from 'drizzle-orm';
import { db } from '../db';
import { events, eventCategoryEnum, eventFormatEnum } from '../db/schema';
import { sendSuccess, sendPaginated } from '../common/response';
import { AppError } from '../common/errors';
import { optionalAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

export const eventsRouter = Router();

const getEventsQuerySchema = z
  .object({
    category: z.enum(eventCategoryEnum.enumValues).optional(),
    day: z.coerce.number().int().min(1).max(3).optional(),
    is_team: z
      .union([z.boolean(), z.enum(['true', 'false', '0', '1'])])
      .transform((val) => val === true || val === 'true' || val === '1')
      .optional(),
    format: z.enum(eventFormatEnum.enumValues).optional(),
    search: z.string().optional(),
    q: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

export function formatEventResponse(event: typeof events.$inferSelect) {
  const now = Date.now();
  const seatsRemaining =
    event.capacity !== null && event.capacity !== undefined
      ? Math.max(0, event.capacity - event.seatsTaken)
      : null;

  const isWindowOpen =
    (!event.registrationOpensAt || now >= event.registrationOpensAt) &&
    (!event.registrationClosesAt || now <= event.registrationClosesAt);

  const hasCapacity = event.capacity === null || event.capacity === undefined || event.seatsTaken < event.capacity;
  const registrationOpen = event.status === 'OPEN' && isWindowOpen && hasCapacity;

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    category: event.category,
    format: event.format,
    festDay: event.festDay,
    shortDescription: event.shortDescription,
    description: event.description,
    rules: event.rules,
    venue: event.venue,
    organizer: event.organizer,
    eligibility: event.eligibility,
    timeline: event.timeline,
    prizes: event.prizes,
    priceModel: event.priceModel,
    pricePaise: event.pricePaise,
    studentPricePaise: event.studentPricePaise,
    isTeam: Boolean(event.isTeam),
    minTeamSize: event.minTeamSize,
    maxTeamSize: event.maxTeamSize,
    capacity: event.capacity,
    capacityUnit: event.capacityUnit,
    seatsTaken: event.seatsTaken,
    seatsRemaining,
    availableCapacity: seatsRemaining,
    status: event.status,
    registrationOpen,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    scoringEnabled: Boolean(event.scoringEnabled),
    scoringStatus: event.scoringStatus,
    leaderboardPublic: Boolean(event.leaderboardPublic),
    formSchema: event.formSchema,
  };
}

// 1. GET /events
eventsRouter.get(
  '/events',
  validate({ query: getEventsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as any;
      const page = query.page || 1;
      const pageSize = query.limit || query.pageSize || 20;
      const offset = (page - 1) * pageSize;

      const conditions = [
        // Public output must never expose DRAFT events
        ne(events.status, 'DRAFT'),
      ];

      if (query.category) {
        conditions.push(eq(events.category, query.category));
      }

      if (query.day) {
        conditions.push(eq(events.festDay, query.day));
      }

      if (query.is_team !== undefined) {
        conditions.push(eq(events.isTeam, query.is_team ? 1 : 0));
      }

      if (query.format) {
        conditions.push(eq(events.format, query.format));
      }

      const searchTerm = query.search || query.q;
      if (searchTerm && searchTerm.trim()) {
        const pattern = `%${searchTerm.trim()}%`;
        conditions.push(
          or(
            ilike(events.title, pattern),
            ilike(events.shortDescription, pattern),
            ilike(events.description, pattern)
          )!
        );
      }

      const whereClause = and(...conditions);

      // Get total count
      const [totalCountResult] = await db
        .select({ count: count() })
        .from(events)
        .where(whereClause);

      const total = Number(totalCountResult?.count || 0);

      // Fetch paginated events
      const eventList = await db
        .select()
        .from(events)
        .where(whereClause)
        .orderBy(sql`${events.festDay} ASC NULLS LAST`, events.title)
        .limit(pageSize)
        .offset(offset);

      const formattedEvents = eventList.map(formatEventResponse);

      sendPaginated(res, formattedEvents, page, pageSize, total);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /events/:idOrSlug
eventsRouter.get(
  '/events/:idOrSlug',
  optionalAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idOrSlug = req.params.idOrSlug as string;

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);

      const [event] = await db
        .select()
        .from(events)
        .where(isUuid ? eq(events.id, idOrSlug) : eq(events.slug, idOrSlug))
        .limit(1);

      if (!event) {
        throw AppError.notFound(`Event '${idOrSlug}' not found`);
      }

      // If event is in DRAFT, check caller authorization
      if (event.status === 'DRAFT') {
        const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
        if (!isSuperAdmin) {
          throw AppError.notFound(`Event '${idOrSlug}' not found`);
        }
      }

      sendSuccess(res, formatEventResponse(event));
    } catch (err) {
      next(err);
    }
  }
);
