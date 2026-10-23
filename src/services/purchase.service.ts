import crypto from 'node:crypto';
import { eq, and, inArray, sql, isNull, lt } from 'drizzle-orm';
import { db } from '../db';
import {
  purchases,
  purchaseItems,
  registrations,
  events,
  teams,
  teamMembers,
  users,
  settings,
  tickets,
  idempotencyKeys,
} from '../db/schema';
import { env } from '../config/env';
import { AppError } from '../common/errors';
import { validateFormResponses } from './form.service';
import { validateTeamForPurchase } from './team.service';
import { signTicketQr } from '../lib/crypto';
import type { UserSelect } from '../types/express';

export function generateOrderPublicId(): string {
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TX26-ORD-${randomHex}`;
}

export function generateTicketPublicId(): string {
  const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TX26-TKT-${randomHex}`;
}

export interface PurchaseItemInput {
  itemType?: 'GATE_PASS' | 'EVENT_PASS';
  item_type?: 'GATE_PASS' | 'EVENT_PASS';
  eventId?: string;
  event_id?: string;
  teamId?: string;
  team_id?: string;
  participantUserId?: string;
  participant_user_id?: string;
  formResponse?: Record<string, any>;
  form_response?: Record<string, any>;
}

export interface CreatePurchaseInput {
  items: PurchaseItemInput[];
  idempotencyKey?: string;
  idempotency_key?: string;
  acknowledgeStudentIdPolicy?: boolean;
  acknowledge_student_id_policy?: boolean;
}

/**
 * Expire any overdue unpaid reservations (older than 15 mins countdown).
 * Returns number of expired purchases cleaned up.
 */
export async function expireOverduePurchases(): Promise<number> {
  const now = Date.now();

  // Find all overdue unpaid purchases
  const overdue = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.status, 'AWAITING_PAYMENT'),
        lt(purchases.reservationExpiresAt, now)
      )
    );

  if (overdue.length === 0) return 0;

  for (const purchase of overdue) {
    try {
      await cancelOrExpirePurchaseInternal(purchase.id, 'EXPIRED');
    } catch (err) {
      console.error(`Failed to expire overdue purchase ${purchase.id}:`, err);
    }
  }

  return overdue.length;
}

/**
 * Internal helper to atomically release seats, update registrations, and unlock teams.
 */
export async function cancelOrExpirePurchaseInternal(
  purchaseId: string,
  targetStatus: 'CANCELLED' | 'EXPIRED'
) {
  return await db.transaction(async (tx) => {
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for('update');

    if (!purchase || purchase.status !== 'AWAITING_PAYMENT') {
      return false;
    }

    const items = await tx
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, purchaseId));

    // Release capacity on events
    for (const item of items) {
      if (item.eventId && item.holdsSlot === 1) {
        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, item.eventId))
          .for('update');

        if (event) {
          const newSeats = Math.max(0, event.seatsTaken - item.quantity);
          await tx
            .update(events)
            .set({ seatsTaken: newSeats, updatedAt: Date.now() })
            .where(eq(events.id, event.id));
        }
      }

      // Unlock team back to DRAFT
      if (item.teamId) {
        await tx
          .update(teams)
          .set({ status: 'DRAFT', lockedAt: null, updatedAt: Date.now() })
          .where(eq(teams.id, item.teamId));
      }
    }

    // Mark registrations cancelled/expired
    await tx
      .update(registrations)
      .set({
        status: targetStatus,
        cancelledAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(
        and(
          inArray(
            registrations.purchaseItemId,
            items.map((i) => i.id)
          ),
          eq(registrations.status, 'RESERVED')
        )
      );

    // Update purchase status
    await tx
      .update(purchases)
      .set({
        status: targetStatus,
        cancelledAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(eq(purchases.id, purchaseId));

    return true;
  });
}

/**
 * Creates an order, locks seats via interactive PostgreSQL transaction,
 * and sets up a 15-minute reservation hold.
 */
export async function createPurchase(buyer: UserSelect, input: CreatePurchaseInput) {
  // Clean up any overdue purchases first
  await expireOverduePurchases();

  const idempotencyKey = input.idempotencyKey || input.idempotency_key;
  if (idempotencyKey) {
    const [existingKey] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idempotencyKey))
      .limit(1);

    if (existingKey) {
      if (existingKey.status === 'COMPLETED' && existingKey.responseBody) {
        return existingKey.responseBody;
      }
      if (existingKey.status === 'PROCESSING') {
        throw AppError.conflict('A request with this idempotency key is already processing', 'IDEMPOTENCY_CONFLICT');
      }
    }
  }

  // Maximum 3 open unpaid purchases per user
  const openPurchases = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.buyerId, buyer.id),
        eq(purchases.status, 'AWAITING_PAYMENT')
      )
    );

  if (openPurchases.length >= 3) {
    throw AppError.badRequest(
      'You already have 3 open unpaid reservations. Please complete or cancel them before creating a new order.',
      'TOO_MANY_OPEN_PURCHASES'
    );
  }

  if (!input.items || input.items.length === 0) {
    throw AppError.badRequest('Order must contain at least one item');
  }

  const acknowledgeStudent =
    input.acknowledgeStudentIdPolicy === true || input.acknowledge_student_id_policy === true;

  // Fetch gate pass settings
  const allSettings = await db.select().from(settings);
  const settingsMap: Record<string, any> = {};
  for (const s of allSettings) settingsMap[s.key] = s.value;

  const purchasesEnabled = settingsMap['purchases_enabled'] ?? true;
  if (!purchasesEnabled) {
    throw AppError.badRequest('Online pass purchases are currently disabled', 'PURCHASES_DISABLED');
  }

  const gatePassPricePaise: number = settingsMap['gate_pass_price_paise'] ?? 30000;
  const gatePassStudentPricePaise: number = settingsMap['gate_pass_student_price_paise'] ?? 15000;

  // Collect all unique event IDs and sort them to avoid deadlocks
  const rawEventIds = input.items
    .map((i) => i.eventId || i.event_id)
    .filter((id): id is string => Boolean(id));
  const uniqueEventIds = Array.from(new Set(rawEventIds)).sort();

  const now = Date.now();
  const ttlMs = env.PURCHASE_RESERVATION_TTL_MS;
  const reservationExpiresAt = now + ttlMs;

  // Native PostgreSQL transaction with row-level locks
  return await db.transaction(async (tx) => {
    // 1. Lock all relevant event rows in deterministic order
    const lockedEventsMap = new Map<string, typeof events.$inferSelect>();
    if (uniqueEventIds.length > 0) {
      const lockedEvents = await tx
        .select()
        .from(events)
        .where(inArray(events.id, uniqueEventIds))
        .for('update');

      for (const ev of lockedEvents) {
        lockedEventsMap.set(ev.id, ev);
      }
    }

    let calculatedTotalPaise = 0;
    let anyStudentItem = false;

    // Prepared items to insert
    const preparedItems: Array<{
      itemType: 'GATE_PASS' | 'EVENT_PASS';
      eventId?: string;
      teamId?: string;
      beneficiaryId?: string;
      quantity: number;
      unitPricePaise: number;
      lineTotalPaise: number;
      tier: 'GENERAL' | 'STUDENT';
      descriptionSnapshot: Record<string, any>;
      holdsSlot: number;
      // Registrations to create for this line item
      registrationsToCreate: Array<{
        eventId: string;
        teamId?: string;
        participantId: string;
        seatCount: number;
        formResponses: Record<string, any>;
      }>;
    }> = [];

    for (const itemInput of input.items) {
      const itemType = itemInput.itemType || itemInput.item_type || 'EVENT_PASS';
      const eventId = itemInput.eventId || itemInput.event_id;
      const teamId = itemInput.teamId || itemInput.team_id;
      const participantUserId = itemInput.participantUserId || itemInput.participant_user_id || buyer.id;
      const formResponse = itemInput.formResponse || itemInput.form_response || {};

      if (itemType === 'GATE_PASS') {
        const isStudentTier = buyer.isStudent === 1;
        if (isStudentTier) anyStudentItem = true;

        const unitPrice = isStudentTier ? gatePassStudentPricePaise : gatePassPricePaise;
        calculatedTotalPaise += unitPrice;

        preparedItems.push({
          itemType: 'GATE_PASS',
          beneficiaryId: buyer.id,
          quantity: 1,
          unitPricePaise: unitPrice,
          lineTotalPaise: unitPrice,
          tier: isStudentTier ? 'STUDENT' : 'GENERAL',
          descriptionSnapshot: {
            title: 'TechXetra Festival Gate Pass',
            tier: isStudentTier ? 'STUDENT' : 'GENERAL',
          },
          holdsSlot: 0,
          registrationsToCreate: [],
        });
        continue;
      }

      // EVENT_PASS
      if (!eventId) {
        throw AppError.badRequest('eventId is required for EVENT_PASS items');
      }

      const event = lockedEventsMap.get(eventId);
      if (!event) {
        throw AppError.notFound(`Event '${eventId}' not found`);
      }

      if (event.status !== 'OPEN') {
        throw AppError.badRequest(`Event '${event.title}' is not open for registration`, 'EVENT_NOT_OPEN');
      }

      // Check registration window
      if (event.registrationOpensAt && now < event.registrationOpensAt) {
        throw AppError.badRequest(`Registration for '${event.title}' has not opened yet`, 'REGISTRATION_NOT_STARTED');
      }
      if (event.registrationClosesAt && now > event.registrationClosesAt) {
        throw AppError.badRequest(`Registration for '${event.title}' has closed`, 'REGISTRATION_CLOSED');
      }

      // Validate custom dynamic form responses
      let validatedAnswers = {};
      if (event.formSchema && Array.isArray(event.formSchema) && event.formSchema.length > 0) {
        validatedAnswers = validateFormResponses(event.formSchema as any, formResponse);
      }

      // Case A: Team Event
      if (teamId) {
        const { team, acceptedMembers } = await validateTeamForPurchase(teamId, buyer.id);
        const memberCount = acceptedMembers.length;

        // Capacity check
        const capacityRequired = event.capacityUnit === 'TEAMS' ? 1 : memberCount;
        if (event.capacity !== null && event.capacity !== undefined) {
          if (event.seatsTaken + capacityRequired > event.capacity) {
            throw AppError.capacityExceeded(`Event '${event.title}' has reached full capacity`);
          }
        }

        // Increment event seatsTaken atomically
        event.seatsTaken += capacityRequired;
        await tx
          .update(events)
          .set({ seatsTaken: event.seatsTaken, updatedAt: now })
          .where(eq(events.id, event.id));

        // Pricing Matrix for Team
        let teamLineTotal = 0;
        let isStudentRate = false;

        if (event.priceModel === 'FREE') {
          teamLineTotal = 0;
        } else if (event.priceModel === 'PER_TEAM') {
          // The All-Student Rule: 100% of accepted members must be students
          const allStudents = acceptedMembers.every((m) => m.user?.isStudent === 1);
          if (allStudents && event.studentPricePaise > 0) {
            teamLineTotal = event.studentPricePaise;
            isStudentRate = true;
            anyStudentItem = true;
          } else {
            teamLineTotal = event.pricePaise;
          }
        } else if (event.priceModel === 'PER_PARTICIPANT') {
          for (const m of acceptedMembers) {
            const memberIsStudent = m.user?.isStudent === 1;
            if (memberIsStudent && event.studentPricePaise > 0) {
              teamLineTotal += event.studentPricePaise;
              anyStudentItem = true;
            } else {
              teamLineTotal += event.pricePaise;
            }
          }
        }

        calculatedTotalPaise += teamLineTotal;

        // Lock team status
        await tx
          .update(teams)
          .set({ status: 'LOCKED', lockedAt: now, updatedAt: now })
          .where(eq(teams.id, team.id));

        // Create registrations for all accepted members
        const teamRegs = acceptedMembers.map((m) => ({
          eventId: event.id,
          teamId: team.id,
          participantId: m.user!.id,
          seatCount: 1,
          formResponses: m.user!.id === buyer.id ? validatedAnswers : {},
        }));

        preparedItems.push({
          itemType: 'EVENT_PASS',
          eventId: event.id,
          teamId: team.id,
          beneficiaryId: buyer.id,
          quantity: capacityRequired,
          unitPricePaise: teamLineTotal,
          lineTotalPaise: teamLineTotal,
          tier: isStudentRate ? 'STUDENT' : 'GENERAL',
          descriptionSnapshot: {
            eventTitle: event.title,
            teamName: team.name,
            memberCount,
            priceModel: event.priceModel,
          },
          holdsSlot: 1,
          registrationsToCreate: teamRegs,
        });
      } else {
        // Case B: Individual Event
        if (event.capacity !== null && event.capacity !== undefined) {
          if (event.seatsTaken + 1 > event.capacity) {
            throw AppError.capacityExceeded(`Event '${event.title}' has reached full capacity`);
          }
        }

        // Verify participant is not already registered
        const [existingReg] = await tx
          .select()
          .from(registrations)
          .where(
            and(
              eq(registrations.eventId, event.id),
              eq(registrations.participantId, participantUserId),
              inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
            )
          )
          .limit(1);

        if (existingReg) {
          throw AppError.conflict(`Participant is already registered for '${event.title}'`, 'ALREADY_REGISTERED');
        }

        event.seatsTaken += 1;
        await tx
          .update(events)
          .set({ seatsTaken: event.seatsTaken, updatedAt: now })
          .where(eq(events.id, event.id));

        // Pricing Matrix for Solo
        let itemPrice = 0;
        let isStudentRate = false;

        if (event.priceModel === 'FREE') {
          itemPrice = 0;
        } else {
          const isStudent = buyer.isStudent === 1;
          if (isStudent && event.studentPricePaise > 0) {
            itemPrice = event.studentPricePaise;
            isStudentRate = true;
            anyStudentItem = true;
          } else {
            itemPrice = event.pricePaise;
          }
        }

        calculatedTotalPaise += itemPrice;

        preparedItems.push({
          itemType: 'EVENT_PASS',
          eventId: event.id,
          beneficiaryId: participantUserId,
          quantity: 1,
          unitPricePaise: itemPrice,
          lineTotalPaise: itemPrice,
          tier: isStudentRate ? 'STUDENT' : 'GENERAL',
          descriptionSnapshot: {
            eventTitle: event.title,
            format: 'INDIVIDUAL',
          },
          holdsSlot: 1,
          registrationsToCreate: [
            {
              eventId: event.id,
              participantId: participantUserId,
              seatCount: 1,
              formResponses: validatedAnswers,
            },
          ],
        });
      }
    }

    // Student ID Policy Acknowledgment check
    if (anyStudentItem && !acknowledgeStudent) {
      throw AppError.badRequest(
        'Student discount rates applied. You must acknowledge the Student ID verification policy.',
        'STUDENT_POLICY_NOT_ACKNOWLEDGED'
      );
    }

    const isFreeOrder = calculatedTotalPaise === 0;
    const initialStatus = isFreeOrder ? 'PAID' : 'AWAITING_PAYMENT';
    const paymentMethod = isFreeOrder ? 'FREE' : 'UPI';
    const publicOrderId = generateOrderPublicId();

    // 2. Insert purchase header
    const [purchase] = await tx
      .insert(purchases)
      .values({
        publicId: publicOrderId,
        buyerId: buyer.id,
        currency: 'INR',
        subtotalPaise: calculatedTotalPaise,
        totalAmountPaise: calculatedTotalPaise,
        paymentMethod,
        status: initialStatus,
        reservationExpiresAt: isFreeOrder ? null : reservationExpiresAt,
        idempotencyKey,
        paidAt: isFreeOrder ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const createdItems = [];
    const createdTickets = [];

    // 3. Insert purchase line items and registrations
    for (const prepared of preparedItems) {
      const [insertedItem] = await tx
        .insert(purchaseItems)
        .values({
          purchaseId: purchase.id,
          itemType: prepared.itemType,
          eventId: prepared.eventId,
          teamId: prepared.teamId,
          beneficiaryId: prepared.beneficiaryId,
          quantity: prepared.quantity,
          unitPricePaise: prepared.unitPricePaise,
          lineTotalPaise: prepared.lineTotalPaise,
          tier: prepared.tier,
          descriptionSnapshot: prepared.descriptionSnapshot,
          holdsSlot: prepared.holdsSlot,
          createdAt: now,
        })
        .returning();

      createdItems.push(insertedItem);

      // Create registrations
      for (const reg of prepared.registrationsToCreate) {
        const [insertedReg] = await tx
          .insert(registrations)
          .values({
            eventId: reg.eventId,
            teamId: reg.teamId,
            participantId: reg.participantId,
            purchaseItemId: insertedItem.id,
            status: isFreeOrder ? 'CONFIRMED' : 'RESERVED',
            seatCount: reg.seatCount,
            formResponses: reg.formResponses,
            confirmedAt: isFreeOrder ? now : null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // If free order: instantly issue confirmed digital ticket!
        if (isFreeOrder) {
          const ticketPublicId = generateTicketPublicId();
          const [newTicket] = await tx
            .insert(tickets)
            .values({
              publicId: ticketPublicId,
              purchaseItemId: insertedItem.id,
              registrationId: insertedReg.id,
              beneficiaryId: reg.participantId,
              itemType: prepared.itemType,
              eventId: reg.eventId,
              tier: prepared.tier,
              status: 'ACTIVE',
              qrVersion: 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          createdTickets.push({
            ...newTicket,
            qrPayload: signTicketQr(newTicket.id, newTicket.qrVersion),
          });
        }
      }

      // For Gate Pass if free order, issue ticket directly
      if (isFreeOrder && prepared.itemType === 'GATE_PASS') {
        const ticketPublicId = generateTicketPublicId();
        const [newTicket] = await tx
          .insert(tickets)
          .values({
            publicId: ticketPublicId,
            purchaseItemId: insertedItem.id,
            beneficiaryId: buyer.id,
            itemType: 'GATE_PASS',
            tier: prepared.tier,
            status: 'ACTIVE',
            qrVersion: 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        createdTickets.push({
          ...newTicket,
          qrPayload: signTicketQr(newTicket.id, newTicket.qrVersion),
        });
      }

      // If free order and team, mark team CONFIRMED
      if (isFreeOrder && prepared.teamId) {
        await tx
          .update(teams)
          .set({ status: 'CONFIRMED', updatedAt: now })
          .where(eq(teams.id, prepared.teamId));
      }
    }

    const response = {
      purchase: {
        id: purchase.id,
        publicId: purchase.publicId,
        status: purchase.status,
        currency: purchase.currency,
        totalAmountPaise: purchase.totalAmountPaise,
        totalAmountInr: purchase.totalAmountPaise / 100,
        paymentMethod: purchase.paymentMethod,
        reservationExpiresAt: purchase.reservationExpiresAt,
        createdAt: purchase.createdAt,
      },
      items: createdItems,
      tickets: createdTickets,
      isFreeOrder,
      upiInstructions: isFreeOrder
        ? null
        : {
          vpa: env.UPI_VPA,
          payeeName: env.UPI_PAYEE_NAME,
          amountPaise: purchase.totalAmountPaise,
          orderRef: purchase.publicId,
        },
    };

    // Record idempotency response if key provided
    if (idempotencyKey) {
      await tx
        .insert(idempotencyKeys)
        .values({
          key: idempotencyKey,
          status: 'COMPLETED',
          responseStatus: 201,
          responseBody: response,
          expiresAt: now + 86400000, // 24 hours
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: idempotencyKeys.key,
          set: {
            status: 'COMPLETED',
            responseBody: response,
          },
        });
    }

    return response;
  });
}

export async function getPurchaseById(purchaseId: string, userId: string, isSuperAdmin = false) {
  const [purchase] = await db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1);
  if (!purchase) {
    throw AppError.notFound(`Purchase '${purchaseId}' not found`);
  }

  if (!isSuperAdmin && purchase.buyerId !== userId) {
    throw AppError.notFound(`Purchase '${purchaseId}' not found`);
  }

  const items = await db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, purchaseId));
  const userTickets = await db.select().from(tickets).where(eq(tickets.purchaseItemId, items[0]?.id));

  return {
    ...purchase,
    totalAmountInr: purchase.totalAmountPaise / 100,
    items,
    tickets: userTickets,
  };
}

export async function getUserPurchases(userId: string) {
  await expireOverduePurchases();

  const userPurchases = await db
    .select()
    .from(purchases)
    .where(eq(purchases.buyerId, userId))
    .orderBy(sql`${purchases.createdAt} DESC`);

  return userPurchases.map((p) => ({
    ...p,
    totalAmountInr: p.totalAmountPaise / 100,
  }));
}

export async function cancelPurchase(purchaseId: string, userId: string) {
  const [purchase] = await db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1);
  if (!purchase) {
    throw AppError.notFound(`Purchase '${purchaseId}' not found`);
  }

  if (purchase.buyerId !== userId) {
    throw AppError.forbidden('You can only cancel your own purchase reservations');
  }

  if (purchase.status !== 'AWAITING_PAYMENT') {
    throw AppError.badRequest(
      `Cannot cancel purchase with status '${purchase.status}'. Only unpaid reservations can be cancelled.`,
      'CANNOT_CANCEL_ORDER'
    );
  }

  await cancelOrExpirePurchaseInternal(purchaseId, 'CANCELLED');
  return { message: 'Reservation cancelled successfully and capacity released.' };
}
