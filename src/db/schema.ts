import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  smallint,
  bigint,
  uuid,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ==========================================
// 1. ENUMS
// ==========================================

export const userRoleEnum = pgEnum('user_role', [
  'PARTICIPANT',
  'VOLUNTEER',
  'EVENT_LEAD',
  'LEAD',
  'SUPER_ADMIN',
]);

export const eventCategoryEnum = pgEnum('event_category', [
  'TECHNICAL',
  'CULTURAL',
  'E_SPORTS',
  'MANAGEMENT',
  'LITERARY',
  'SPORTS',
  'WORKSHOP',
  'INTERACTIVE',
  'RECREATIONAL',
  'SHOWCASE',
  'OTHER',
]);

export const eventStatusEnum = pgEnum('event_status', [
  'DRAFT',
  'OPEN',
  'CLOSED',
  'COMPLETED',
  'CANCELLED',
]);

export const eventFormatEnum = pgEnum('event_format', [
  'INDIVIDUAL',
  'TEAM',
  'EITHER',
]);

export const priceModelEnum = pgEnum('price_model', [
  'FREE',
  'PER_PARTICIPANT',
  'PER_TEAM',
]);

export const capacityUnitEnum = pgEnum('capacity_unit', [
  'SEATS',
  'TEAMS',
  'ENTRIES',
]);

export const scoringStatusEnum = pgEnum('scoring_status', [
  'NOT_APPLICABLE',
  'OPEN',
  'DRAFT',
  'FINALIZED',
]);

export const teamStatusEnum = pgEnum('team_status', [
  'DRAFT',
  'READY',
  'LOCKED',
  'CONFIRMED',
  'CANCELLED',
]);

export const teamMemberRoleEnum = pgEnum('team_member_role', [
  'LEADER',
  'MEMBER',
]);

export const teamMemberStatusEnum = pgEnum('team_member_status', [
  'INVITED',
  'ACCEPTED',
  'DECLINED',
  'REJECTED',
  'REMOVED',
]);

export const purchaseStatusEnum = pgEnum('purchase_status', [
  'AWAITING_PAYMENT',
  'PENDING_VERIFICATION',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'FULFILLMENT_FAILED',
]);

export const itemTypeEnum = pgEnum('item_type', [
  'GATE_PASS',
  'EVENT_PASS',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'SUBMITTED',
  'PENDING',
  'ON_HOLD',
  'APPROVED',
  'SUCCESS',
  'REJECTED',
  'WITHDRAWN',
]);

export const ticketStatusEnum = pgEnum('ticket_status', [
  'ACTIVE',
  'CANCELLED',
  'REVOKED',
  'REPLACED',
  'USED',
  'EXPIRED',
  'VOID',
]);

export const ticketTierEnum = pgEnum('ticket_tier', [
  'GENERAL',
  'STUDENT',
]);

export const checkinOutcomeEnum = pgEnum('checkin_outcome', [
  'ACCEPTED',
  'ADMITTED',
  'ALREADY_USED',
  'INVALID',
  'REVOKED',
  'DENIED',
  'WRONG_EVENT',
  'NOT_YET_VALID',
  'EVENT_CLOSED',
]);

export const fulfillmentStatusEnum = pgEnum('fulfillment_status', [
  'PENDING',
  'COMPLETE',
  'RETRY_REQUIRED',
  'FAILED',
]);

// ==========================================
// 2. TABLES
// ==========================================

// Users
export const users = pgTable('users', {
  id: varchar('id', { length: 32 }).primaryKey(), // TX26XXXX or uuid
  googleSub: text('google_sub').unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  phone: varchar('phone', { length: 20 }),
  isStudent: smallint('is_student').notNull().default(0),
  institutionName: text('institution_name'),
  institutionId: text('institution_id'),
  studentFieldsLocked: smallint('student_fields_locked').notNull().default(0),
  role: userRoleEnum('role').notNull().default('PARTICIPANT'),
  canReviewPayments: smallint('can_review_payments').notNull().default(0), // inert legacy
  isActive: smallint('is_active').notNull().default(1),
  emailVerifiedAt: bigint('email_verified_at', { mode: 'number' }),
  profileCompletedAt: bigint('profile_completed_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// Sessions
export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(), // SHA-256 hex digest of raw session token
    userId: varchar('user_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    lastSeenAt: bigint('last_seen_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

// Fest Days
export const festDays = pgTable('fest_days', {
  dayNumber: integer('day_number').primaryKey(),
  date: varchar('date', { length: 10 }).notNull().unique(), // YYYY-MM-DD
  validFrom: bigint('valid_from', { mode: 'number' }).notNull(),
  validTo: bigint('valid_to', { mode: 'number' }).notNull(),
  description: text('description'),
});

// Settings
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: varchar('updated_by', { length: 32 }).references(() => users.id),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

// Events
export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    imageUrl: text('image_url'),
    whatsappUrl: text('whatsapp_url'),
    category: eventCategoryEnum('category').notNull(),
    format: eventFormatEnum('format').notNull().default('INDIVIDUAL'),
    festDay: integer('fest_day').references(() => festDays.dayNumber),
    shortDescription: text('short_description'),
    description: text('description'),
    rules: text('rules'),
    venue: text('venue'),
    organizer: text('organizer'),
    eligibility: text('eligibility'),
    timeline: jsonb('timeline').notNull().default([]),
    prizes: jsonb('prizes').notNull().default([]),
    metadata: jsonb('metadata').notNull().default({}),
    priceModel: priceModelEnum('price_model').notNull().default('FREE'),
    pricePaise: integer('price_paise').notNull().default(0),
    studentPricePaise: integer('student_price_paise').notNull().default(0),
    isTeam: smallint('is_team').notNull().default(0),
    minTeamSize: integer('min_team_size').notNull().default(1),
    maxTeamSize: integer('max_team_size').notNull().default(1),
    capacity: integer('capacity'), // null means unlimited
    seatsTaken: integer('seats_taken').notNull().default(0),
    capacityUnit: capacityUnitEnum('capacity_unit').notNull().default('SEATS'),
    status: eventStatusEnum('status').notNull().default('DRAFT'),
    scoringEnabled: smallint('scoring_enabled').notNull().default(0),
    scoringStatus: scoringStatusEnum('scoring_status').notNull().default('NOT_APPLICABLE'),
    leaderboardPublic: smallint('leaderboard_public').notNull().default(0),
    volunteersCanScore: smallint('volunteers_can_score').notNull().default(0),
    maxRounds: integer('max_rounds').notNull().default(1),
    formSchema: jsonb('form_schema'),
    registrationOpensAt: bigint('registration_opens_at', { mode: 'number' }),
    registrationClosesAt: bigint('registration_closes_at', { mode: 'number' }),
    startsAt: bigint('starts_at', { mode: 'number' }),
    endsAt: bigint('ends_at', { mode: 'number' }),
    createdBy: varchar('created_by', { length: 32 }).references(() => users.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_events_status_category').on(table.status, table.category),
    index('idx_events_fest_day').on(table.festDay),
  ]
);

// Event Form Versions (Immutable Published Question Schemas)
export const eventFormVersions = pgTable(
  'event_form_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    schema: jsonb('schema').notNull(),
    publishedAt: bigint('published_at', { mode: 'number' }),
    createdBy: varchar('created_by', { length: 32 }).references(() => users.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_event_form_versions_event_version').on(table.eventId, table.version),
  ]
);

// Event Staff Assignments (Scoped to specific events)
export const eventStaff = pgTable(
  'event_staff',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 32 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
    assignedBy: varchar('assigned_by', { length: 32 }).references(() => users.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
  ]
);

// Gate Staff (General venue admission staff)
export const gateStaff = pgTable('gate_staff', {
  userId: varchar('user_id', { length: 32 })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  assignedBy: varchar('assigned_by', { length: 32 }).references(() => users.id),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Teams
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    leaderId: varchar('leader_id', { length: 32 })
      .notNull()
      .references(() => users.id),
    status: teamStatusEnum('status').notNull().default('DRAFT'),
    lockedAt: bigint('locked_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Unique active team name per event
    uniqueIndex('idx_teams_event_name_unique')
      .on(table.eventId, sql`lower(${table.name})`)
      .where(sql`${table.status} != 'CANCELLED'`),
  ]
);

// Team Members
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 32 }).references(() => users.id, { onDelete: 'set null' }),
    invitedEmail: text('invited_email').notNull(),
    role: teamMemberRoleEnum('role').notNull().default('MEMBER'),
    status: teamMemberStatusEnum('status').notNull().default('INVITED'),
    respondedAt: bigint('responded_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Unique active membership per team
    uniqueIndex('idx_team_members_team_user_unique')
      .on(table.teamId, table.userId)
      .where(sql`${table.userId} IS NOT NULL AND ${table.status} IN ('INVITED', 'ACCEPTED')`),
    // Unique active invited email per team
    uniqueIndex('idx_team_members_team_email_unique')
      .on(table.teamId, sql`lower(${table.invitedEmail})`)
      .where(sql`${table.status} IN ('INVITED', 'ACCEPTED')`),
  ]
);

// Purchases (Orders)
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    publicId: varchar('public_id', { length: 32 }).notNull().unique(), // TX26-ORD-XXXX
    buyerId: varchar('buyer_id', { length: 32 })
      .notNull()
      .references(() => users.id),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    subtotalPaise: integer('subtotal_paise').notNull().default(0),
    totalAmountPaise: integer('total_amount_paise').notNull().default(0),
    paymentMethod: text('payment_method'), // 'UPI' or 'FREE'
    status: purchaseStatusEnum('status').notNull().default('AWAITING_PAYMENT'),
    reservationExpiresAt: bigint('reservation_expires_at', { mode: 'number' }),
    fulfillmentStatus: fulfillmentStatusEnum('fulfillment_status').notNull().default('PENDING'),
    fulfillmentLastError: text('fulfillment_last_error'),
    fulfillmentAttempts: integer('fulfillment_attempts').notNull().default(0),
    idempotencyKey: text('idempotency_key').unique(),
    paidAt: bigint('paid_at', { mode: 'number' }),
    cancelledAt: bigint('cancelled_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_purchases_buyer_id').on(table.buyerId),
    index('idx_purchases_status').on(table.status),
  ]
);

// Purchase Items (Line Items)
export const purchaseItems = pgTable('purchase_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  purchaseId: uuid('purchase_id')
    .notNull()
    .references(() => purchases.id, { onDelete: 'cascade' }),
  itemType: itemTypeEnum('item_type').notNull(),
  eventId: uuid('event_id').references(() => events.id),
  teamId: uuid('team_id').references(() => teams.id),
  beneficiaryId: varchar('beneficiary_id', { length: 32 }).references(() => users.id),
  quantity: integer('quantity').notNull().default(1),
  unitPricePaise: integer('unit_price_paise').notNull().default(0),
  lineTotalPaise: integer('line_total_paise').notNull().default(0),
  tier: ticketTierEnum('tier').notNull().default('GENERAL'),
  descriptionSnapshot: jsonb('description_snapshot').notNull().default({}),
  holdsSlot: smallint('holds_slot').notNull().default(1),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Registrations (Per-Participant Event Slots)
export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    teamId: uuid('team_id').references(() => teams.id),
    participantId: varchar('participant_id', { length: 32 })
      .notNull()
      .references(() => users.id),
    purchaseItemId: uuid('purchase_item_id').references(() => purchaseItems.id),
    status: text('status').notNull().default('RESERVED'), // RESERVED, CONFIRMED, CANCELLED, EXPIRED
    seatCount: integer('seat_count').notNull().default(1),
    formVersionId: uuid('form_version_id').references(() => eventFormVersions.id),
    formResponses: jsonb('form_responses').notNull().default({}),
    confirmedAt: bigint('confirmed_at', { mode: 'number' }),
    cancelledAt: bigint('cancelled_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Unique active registration per participant per event
    uniqueIndex('idx_registrations_event_participant_unique')
      .on(table.eventId, table.participantId)
      .where(sql`${table.status} IN ('RESERVED', 'CONFIRMED')`),
  ]
);

// Payments (Manual UPI Submissions)
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    amountPaise: integer('amount_paise').notNull(),
    paymentMethod: text('payment_method').notNull().default('UPI'),
    transactionId: text('transaction_id').notNull(), // normalized UTR
    status: paymentStatusEnum('status').notNull().default('SUBMITTED'),
    submittedBy: varchar('submitted_by', { length: 32 })
      .notNull()
      .references(() => users.id),
    reviewedBy: varchar('reviewed_by', { length: 32 }).references(() => users.id),
    reviewedAt: bigint('reviewed_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Active UTR must be globally unique across PENDING/SUBMITTED/SUCCESS/APPROVED
    uniqueIndex('idx_payments_active_utr_unique')
      .on(table.transactionId)
      .where(sql`${table.status} IN ('SUBMITTED', 'PENDING', 'ON_HOLD', 'APPROVED', 'SUCCESS')`),
  ]
);

// Payment Review / Audit Logs (Immutable History)
export const paymentAuditLogs = pgTable('payment_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentId: uuid('payment_id')
    .notNull()
    .references(() => payments.id),
  actorId: varchar('actor_id', { length: 32 }).references(() => users.id),
  fromStatus: paymentStatusEnum('from_status'),
  toStatus: paymentStatusEnum('to_status').notNull(),
  decision: text('decision'), // APPROVED, REJECTED, ON_HOLD
  reasonCode: text('reason_code'),
  notes: text('notes'), // strictly private to Super Admin
  requestId: text('request_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Digital Tickets
export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    publicId: varchar('public_id', { length: 32 }).notNull().unique(), // TX26-TKT-XXXX
    purchaseItemId: uuid('purchase_item_id').references(() => purchaseItems.id),
    registrationId: uuid('registration_id').unique().references(() => registrations.id),
    beneficiaryId: varchar('beneficiary_id', { length: 32 })
      .notNull()
      .references(() => users.id),
    itemType: itemTypeEnum('item_type').notNull(),
    eventId: uuid('event_id').references(() => events.id),
    tier: ticketTierEnum('tier').notNull().default('GENERAL'),
    status: ticketStatusEnum('status').notNull().default('ACTIVE'),
    qrVersion: integer('qr_version').notNull().default(1),
    validFrom: bigint('valid_from', { mode: 'number' }),
    validTo: bigint('valid_to', { mode: 'number' }),
    eventCheckedInAt: bigint('event_checked_in_at', { mode: 'number' }),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_tickets_beneficiary_id').on(table.beneficiaryId),
    index('idx_tickets_event_id').on(table.eventId),
    uniqueIndex('idx_tickets_gate_pass_unique')
      .on(table.purchaseItemId)
      .where(sql`${table.itemType} = 'GATE_PASS'`),
  ]
);

// Check-in Logs (Scan Audit History)
export const checkInLogs = pgTable(
  'check_in_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    scannedBy: varchar('scanned_by', { length: 32 })
      .notNull()
      .references(() => users.id),
    context: text('context').notNull(), // GATE or EVENT
    eventId: uuid('event_id').references(() => events.id),
    verdict: text('verdict').notNull(), // ADMITTED or DENIED
    outcome: checkinOutcomeEnum('outcome').notNull(),
    notes: text('notes'),
    deviceId: text('device_id'),
    requestId: text('request_id'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    // Single check-in per event for ADMITTED status
    uniqueIndex('idx_check_in_logs_admitted_unique')
      .on(table.ticketId, table.eventId)
      .where(sql`${table.verdict} = 'ADMITTED' AND ${table.context} = 'EVENT'`),
  ]
);

// E-Sports Matches
export const esportsMatches = pgTable(
  'esports_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    roundNumber: integer('round_number').notNull(),
    matchNumber: integer('match_number').notNull(),
    participantAId: uuid('participant_a_id').references(() => registrations.id),
    participantBId: uuid('participant_b_id').references(() => registrations.id),
    scheduledAt: bigint('scheduled_at', { mode: 'number' }),
    status: text('status').notNull().default('SCHEDULED'), // SCHEDULED, IN_PROGRESS, COMPLETED, VOID
    createdBy: varchar('created_by', { length: 32 }).references(() => users.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_esports_matches_event_round_match').on(
      table.eventId,
      table.roundNumber,
      table.matchNumber
    ),
  ]
);

// E-Sports Scores
export const esportsScores = pgTable(
  'esports_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    matchId: uuid('match_id').references(() => esportsMatches.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    registrationId: uuid('registration_id')
      .notNull()
      .references(() => registrations.id),
    roundNo: integer('round_no').notNull(),
    score: integer('score').notNull().default(0),
    version: integer('version').notNull().default(1),
    recordedBy: varchar('recorded_by', { length: 32 })
      .notNull()
      .references(() => users.id),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_esports_scores_round_unique').on(
      table.eventId,
      table.registrationId,
      table.roundNo
    ),
  ]
);

// E-Sports Score History (Immutable History)
export const esportsScoreHistory = pgTable('esports_score_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  scoreId: uuid('score_id')
    .notNull()
    .references(() => esportsScores.id),
  eventId: uuid('event_id')
    .notNull()
    .references(() => events.id),
  changedBy: varchar('changed_by', { length: 32 })
    .notNull()
    .references(() => users.id),
  oldScore: integer('old_score'),
  newScore: integer('new_score').notNull(),
  oldVersion: integer('old_version'),
  newVersion: integer('new_version').notNull(),
  reason: text('reason').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Audit Logs (Application-wide Immutable History)
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: varchar('actor_id', { length: 32 }).references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  details: jsonb('details').notNull().default({}),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  ipHash: text('ip_hash'),
  requestId: text('request_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

// Idempotency Keys
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    scope: text('scope').notNull().default('GLOBAL'),
    requestHash: text('request_hash'),
    status: text('status').notNull(), // PROCESSING, COMPLETED
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_idempotency_keys_expires_at').on(table.expiresAt),
  ]
);

// ==========================================
// 3. RELATIONS
// ==========================================

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  teamsLed: many(teams),
  teamMemberships: many(teamMembers),
  purchases: many(purchases),
  registrations: many(registrations),
  tickets: many(tickets),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  festDayRef: one(festDays, {
    fields: [events.festDay],
    references: [festDays.dayNumber],
  }),
  formVersions: many(eventFormVersions),
  staff: many(eventStaff),
  teams: many(teams),
  registrations: many(registrations),
  tickets: many(tickets),
  esportsMatches: many(esportsMatches),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  event: one(events, {
    fields: [teams.eventId],
    references: [events.id],
  }),
  leader: one(users, {
    fields: [teams.leaderId],
    references: [users.id],
  }),
  members: many(teamMembers),
  registrations: many(registrations),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}));

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  buyer: one(users, {
    fields: [purchases.buyerId],
    references: [users.id],
  }),
  items: many(purchaseItems),
  payments: many(payments),
}));

export const purchaseItemsRelations = relations(purchaseItems, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  event: one(events, {
    fields: [purchaseItems.eventId],
    references: [events.id],
  }),
  team: one(teams, {
    fields: [purchaseItems.teamId],
    references: [teams.id],
  }),
  beneficiary: one(users, {
    fields: [purchaseItems.beneficiaryId],
    references: [users.id],
  }),
  registrations: many(registrations),
  tickets: many(tickets),
}));

export const registrationsRelations = relations(registrations, ({ one, many }) => ({
  event: one(events, {
    fields: [registrations.eventId],
    references: [events.id],
  }),
  team: one(teams, {
    fields: [registrations.teamId],
    references: [teams.id],
  }),
  participant: one(users, {
    fields: [registrations.participantId],
    references: [users.id],
  }),
  purchaseItem: one(purchaseItems, {
    fields: [registrations.purchaseItemId],
    references: [purchaseItems.id],
  }),
  tickets: many(tickets),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [payments.purchaseId],
    references: [purchases.id],
  }),
  submittedByUser: one(users, {
    fields: [payments.submittedBy],
    references: [users.id],
  }),
  reviewedByUser: one(users, {
    fields: [payments.reviewedBy],
    references: [users.id],
  }),
  auditLogs: many(paymentAuditLogs),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  purchaseItem: one(purchaseItems, {
    fields: [tickets.purchaseItemId],
    references: [purchaseItems.id],
  }),
  registration: one(registrations, {
    fields: [tickets.registrationId],
    references: [registrations.id],
  }),
  beneficiary: one(users, {
    fields: [tickets.beneficiaryId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [tickets.eventId],
    references: [events.id],
  }),
  checkInLogs: many(checkInLogs),
}));
