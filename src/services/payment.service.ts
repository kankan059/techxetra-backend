import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  payments,
  paymentAuditLogs,
  purchases,
  purchaseItems,
  registrations,
  teams,
  teamMembers,
  users,
  tickets,
  festDays,
  events,
} from '../db/schema';
import { env } from '../config/env';
import { AppError } from '../common/errors';
import { generateTicketPublicId } from './purchase.service';
import { signTicketQr } from '../lib/crypto';
import type { UserSelect } from '../types/express';

/**
 * Idempotently issues digital tickets for all confirmed registrations in a paid purchase.
 */
export async function fulfillTicketsForPurchase(purchaseId: string): Promise<number> {
  return await db.transaction(async (tx) => {
    // 1. Lock purchase row for update
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for('update');

    if (!purchase || purchase.status !== 'PAID') {
      throw AppError.badRequest('Tickets can only be fulfilled for purchases in PAID status');
    }

    // If already complete, return early
    if (purchase.fulfillmentStatus === 'COMPLETE') {
      const existingCount = await tx
        .select()
        .from(tickets)
        .innerJoin(purchaseItems, eq(tickets.purchaseItemId, purchaseItems.id))
        .where(eq(purchaseItems.purchaseId, purchaseId));
      if (existingCount.length > 0) {
        return 0;
      }
    }

    const allFestDays = await tx.select().from(festDays);
    const minFestStart =
      allFestDays.length > 0 ? Math.min(...allFestDays.map((d) => d.validFrom)) : Date.now();
    const maxFestEnd =
      allFestDays.length > 0
        ? Math.max(...allFestDays.map((d) => d.validTo))
        : Date.now() + 3 * 86400000;
    const festDayMap = new Map(allFestDays.map((d) => [d.dayNumber, d]));

    const items = await tx
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, purchaseId));
    const now = Date.now();
    let createdCount = 0;

    for (const item of items) {
      if (item.itemType === 'GATE_PASS') {
        const [existingTicket] = await tx
          .select()
          .from(tickets)
          .where(
            and(eq(tickets.purchaseItemId, item.id), eq(tickets.itemType, 'GATE_PASS'))
          )
          .limit(1);

        if (!existingTicket) {
          try {
            await tx.insert(tickets).values({
              publicId: generateTicketPublicId(),
              purchaseItemId: item.id,
              beneficiaryId: item.beneficiaryId || purchase.buyerId,
              itemType: 'GATE_PASS',
              tier: item.tier,
              status: 'ACTIVE',
              qrVersion: 1,
              validFrom: minFestStart,
              validTo: maxFestEnd,
              createdAt: now,
              updatedAt: now,
            });
            createdCount++;
          } catch (err: any) {
            // Concurrency-safe: ignore duplicate key violations on retries
            if (err?.code !== '23505') throw err;
          }
        }
        continue;
      }

      // EVENT_PASS
      const itemRegistrations = await tx
        .select()
        .from(registrations)
        .where(
          and(
            eq(registrations.purchaseItemId, item.id),
            eq(registrations.status, 'CONFIRMED')
          )
        );

      let eventValidFrom = minFestStart;
      let eventValidTo = maxFestEnd;
      if (item.eventId) {
        const [ev] = await tx
          .select()
          .from(events)
          .where(eq(events.id, item.eventId))
          .limit(1);
        if (ev && ev.festDay && festDayMap.has(ev.festDay)) {
          const fd = festDayMap.get(ev.festDay)!;
          eventValidFrom = fd.validFrom;
          eventValidTo = fd.validTo;
        }
      }

      for (const reg of itemRegistrations) {
        const [existingTicket] = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.registrationId, reg.id))
          .limit(1);

        if (!existingTicket) {
          try {
            await tx.insert(tickets).values({
              publicId: generateTicketPublicId(),
              purchaseItemId: item.id,
              registrationId: reg.id,
              beneficiaryId: reg.participantId,
              itemType: 'EVENT_PASS',
              eventId: reg.eventId,
              tier: item.tier,
              status: 'ACTIVE',
              qrVersion: 1,
              validFrom: eventValidFrom,
              validTo: eventValidTo,
              createdAt: now,
              updatedAt: now,
            });
            createdCount++;
          } catch (err: any) {
            if (err?.code !== '23505') throw err;
          }
        }
      }
    }

    await tx
      .update(purchases)
      .set({
        fulfillmentStatus: 'COMPLETE',
        fulfillmentLastError: null,
        updatedAt: now,
      })
      .where(eq(purchases.id, purchaseId));

    return createdCount;
  });
}

/**
 * Submits a manual UPI UTR transaction ID for an unpaid purchase reservation.
 */
export async function submitUpiPayment(
  purchaseId: string,
  buyer: UserSelect,
  transactionId: string
) {
  // Normalize UTR: trim, strip spaces and hyphens, uppercase
  const normalizedUtr = transactionId.trim().replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z0-9]{8,35}$/.test(normalizedUtr)) {
    throw AppError.badRequest(
      'Invalid UPI transaction ID. UTR must be between 8 and 35 alphanumeric characters.',
      'INVALID_UTR_FORMAT'
    );
  }

  const now = Date.now();

  return await db.transaction(async (tx) => {
    // 1. Lock purchase row
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for('update');

    if (!purchase) {
      throw AppError.notFound(`Purchase '${purchaseId}' not found`);
    }

    if (purchase.buyerId !== buyer.id) {
      throw AppError.forbidden('You can only submit payments for your own purchases');
    }

    if (purchase.status !== 'AWAITING_PAYMENT') {
      throw AppError.badRequest(
        `Cannot submit payment for purchase in status '${purchase.status}'`,
        'PURCHASE_NOT_AWAITING_PAYMENT'
      );
    }

    if (purchase.reservationExpiresAt && now > purchase.reservationExpiresAt) {
      throw AppError.badRequest('Your 15-minute reservation has expired', 'RESERVATION_EXPIRED');
    }

    // 2. Check for duplicate active UTR
    const [existingUtr] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.transactionId, normalizedUtr),
          inArray(payments.status, ['SUBMITTED', 'PENDING', 'ON_HOLD', 'APPROVED', 'SUCCESS'])
        )
      )
      .limit(1);

    if (existingUtr) {
      throw AppError.conflict(
        'This UPI transaction ID (UTR) has already been submitted for another order.',
        'DUPLICATE_TRANSACTION_ID'
      );
    }

    // 3. Freeze reservation timer and transition purchase to PENDING_VERIFICATION
    await tx
      .update(purchases)
      .set({
        status: 'PENDING_VERIFICATION',
        updatedAt: now,
      })
      .where(eq(purchases.id, purchaseId));

    // 4. Insert payment submission
    const [payment] = await tx
      .insert(payments)
      .values({
        purchaseId,
        amountPaise: purchase.totalAmountPaise,
        paymentMethod: 'UPI',
        transactionId: normalizedUtr,
        status: 'SUBMITTED',
        submittedBy: buyer.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 5. Append payment audit log
    await tx.insert(paymentAuditLogs).values({
      paymentId: payment.id,
      actorId: buyer.id,
      fromStatus: null,
      toStatus: 'SUBMITTED',
      decision: null,
      notes: `User submitted UPI transaction ID ${normalizedUtr}`,
      createdAt: now,
    });

    return payment;
  });
}

/**
 * Withdraws a submitted UTR while review is pending, returning order to AWAITING_PAYMENT with fresh 15m.
 */
export async function withdrawPaymentSubmission(purchaseId: string, buyerId: string) {
  const now = Date.now();

  return await db.transaction(async (tx) => {
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .for('update');

    if (!purchase) throw AppError.notFound(`Purchase '${purchaseId}' not found`);
    if (purchase.buyerId !== buyerId) throw AppError.forbidden('You can only withdraw your own payment submissions');
    if (purchase.status !== 'PENDING_VERIFICATION') {
      throw AppError.badRequest(`Cannot withdraw payment for purchase in status '${purchase.status}'`);
    }

    const [activePayment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.purchaseId, purchaseId), inArray(payments.status, ['SUBMITTED', 'PENDING', 'ON_HOLD'])))
      .limit(1);

    if (activePayment) {
      await tx
        .update(payments)
        .set({ status: 'WITHDRAWN', updatedAt: now })
        .where(eq(payments.id, activePayment.id));

      await tx.insert(paymentAuditLogs).values({
        paymentId: activePayment.id,
        actorId: buyerId,
        fromStatus: activePayment.status,
        toStatus: 'WITHDRAWN',
        notes: 'User withdrew payment submission',
        createdAt: now,
      });
    }

    // Reset purchase back to AWAITING_PAYMENT with fresh 15-minute countdown
    const freshExpiry = now + env.PURCHASE_RESERVATION_TTL_MS;
    await tx
      .update(purchases)
      .set({
        status: 'AWAITING_PAYMENT',
        reservationExpiresAt: freshExpiry,
        updatedAt: now,
      })
      .where(eq(purchases.id, purchaseId));

    return {
      message: 'Payment submission withdrawn. A fresh 15-minute reservation timer has been granted.',
      reservationExpiresAt: freshExpiry,
    };
  });
}

export interface ReviewDecisionInput {
  decision: 'APPROVE' | 'APPROVED' | 'REJECT' | 'REJECTED' | 'HOLD' | 'ON_HOLD';
  reasonCode?: string;
  rejectionReason?: string;
  internalNote?: string;
  privateNote?: string;
}

/**
 * Super Admin review desk for UPI payments.
 * Enforces Anti-Self-Dealing and the Durable Payment Truth Invariant.
 */
export async function reviewPaymentSubmission(
  paymentId: string,
  reviewer: UserSelect,
  input: ReviewDecisionInput,
  requestId?: string
) {
  const normalizedDecision = input.decision.toUpperCase();
  const reasonCode = input.reasonCode || input.rejectionReason;
  const privateNote = input.internalNote || input.privateNote;
  const now = Date.now();

  let approvedPurchaseId: string | null = null;

  // Execute review decision transaction
  await db.transaction(async (tx) => {
    // 1. Lock payment row
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');

    if (!payment) {
      throw AppError.notFound(`Payment '${paymentId}' not found`);
    }

    // 2. Lock purchase row
    const [purchase] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, payment.purchaseId))
      .for('update');

    if (!purchase) {
      throw AppError.notFound(`Associated purchase '${payment.purchaseId}' not found`);
    }

    // 3. The Anti-Self-Dealing Invariant: Reviewer cannot review their own payment!
    if (reviewer.id === purchase.buyerId) {
      throw AppError.forbidden(
        'Anti-Self-Dealing Violation: Super Admins cannot review or approve their own payments.',
        'CANNOT_REVIEW_OWN_PAYMENT'
      );
    }

    // Payment state validation: cannot review already resolved or withdrawn payments
    if (payment.status === 'APPROVED' || payment.status === 'SUCCESS') {
      throw AppError.conflict('Payment has already been approved', 'PAYMENT_ALREADY_RESOLVED');
    }
    if (payment.status === 'REJECTED') {
      throw AppError.conflict('Payment has already been rejected', 'PAYMENT_ALREADY_RESOLVED');
    }
    if (payment.status === 'WITHDRAWN') {
      throw AppError.conflict('Payment was withdrawn by the submitter', 'PAYMENT_WITHDRAWN');
    }

    // Purchase state validation: a paid purchase must NEVER revert or be altered by review
    if (purchase.status === 'PAID') {
      throw AppError.conflict('Associated purchase has already been marked PAID', 'PURCHASE_ALREADY_PAID');
    }
    if (purchase.status === 'CANCELLED' || purchase.status === 'EXPIRED') {
      throw AppError.conflict('Associated purchase is no longer active', 'PURCHASE_NOT_ACTIVE');
    }

    // 4. Decision: APPROVE
    if (normalizedDecision === 'APPROVE' || normalizedDecision === 'APPROVED') {
      await tx
        .update(payments)
        .set({
          status: 'APPROVED',
          reviewedBy: reviewer.id,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));

      await tx
        .update(purchases)
        .set({
          status: 'PAID',
          paidAt: now,
          reservationExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(purchases.id, purchase.id));

      // Confirm all registrations
      const purchaseLineItems = await tx
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, purchase.id));

      const lineItemIds = purchaseLineItems.map((i) => i.id);

      if (lineItemIds.length > 0) {
        await tx
          .update(registrations)
          .set({ status: 'CONFIRMED', confirmedAt: now, updatedAt: now })
          .where(inArray(registrations.purchaseItemId, lineItemIds));
      }

      // Confirm teams and lock student status for beneficiaries
      const attendeeIds = new Set<string>();
      attendeeIds.add(purchase.buyerId);

      for (const item of purchaseLineItems) {
        if (item.teamId) {
          await tx
            .update(teams)
            .set({ status: 'CONFIRMED', updatedAt: now })
            .where(eq(teams.id, item.teamId));

          const members = await tx
            .select()
            .from(teamMembers)
            .where(and(eq(teamMembers.teamId, item.teamId), eq(teamMembers.status, 'ACCEPTED')));

          for (const m of members) {
            if (m.userId) attendeeIds.add(m.userId);
          }
        }
        if (item.beneficiaryId) {
          attendeeIds.add(item.beneficiaryId);
        }
      }

      // Lock student fields for all attendees of this purchase
      const attendeeList = Array.from(attendeeIds);
      if (attendeeList.length > 0) {
        await tx
          .update(users)
          .set({ studentFieldsLocked: 1, updatedAt: now })
          .where(inArray(users.id, attendeeList));
      }

      // Append immutable audit log
      await tx.insert(paymentAuditLogs).values({
        paymentId: payment.id,
        actorId: reviewer.id,
        fromStatus: payment.status,
        toStatus: 'APPROVED',
        decision: 'APPROVED',
        reasonCode,
        notes: privateNote,
        requestId,
        createdAt: now,
      });

      approvedPurchaseId = purchase.id;
    } else if (normalizedDecision === 'HOLD' || normalizedDecision === 'ON_HOLD') {
      // 5. Decision: HOLD
      await tx
        .update(payments)
        .set({ status: 'ON_HOLD', updatedAt: now })
        .where(eq(payments.id, payment.id));

      await tx.insert(paymentAuditLogs).values({
        paymentId: payment.id,
        actorId: reviewer.id,
        fromStatus: payment.status,
        toStatus: 'ON_HOLD',
        decision: 'ON_HOLD',
        reasonCode,
        notes: privateNote,
        requestId,
        createdAt: now,
      });
    } else if (normalizedDecision === 'REJECT' || normalizedDecision === 'REJECTED') {
      // 6. Decision: REJECT
      await tx
        .update(payments)
        .set({
          status: 'REJECTED',
          reviewedBy: reviewer.id,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));

      // Reset purchase to AWAITING_PAYMENT with fresh 15-minute countdown for retry
      const freshExpiry = now + env.PURCHASE_RESERVATION_TTL_MS;
      await tx
        .update(purchases)
        .set({
          status: 'AWAITING_PAYMENT',
          reservationExpiresAt: freshExpiry,
          updatedAt: now,
        })
        .where(eq(purchases.id, purchase.id));

      await tx.insert(paymentAuditLogs).values({
        paymentId: payment.id,
        actorId: reviewer.id,
        fromStatus: payment.status,
        toStatus: 'REJECTED',
        decision: 'REJECTED',
        reasonCode,
        notes: privateNote,
        requestId,
        createdAt: now,
      });
    } else {
      throw AppError.badRequest(`Unknown decision action: '${input.decision}'`);
    }
  });

  // After transaction commits: execute ticket fulfillment if approved
  if (approvedPurchaseId) {
    try {
      await fulfillTicketsForPurchase(approvedPurchaseId);
    } catch (fulfillmentErr: any) {
      // Durable Payment Truth Invariant:
      // An error in ticket fulfillment NEVER reverts the payment approval!
      console.error(
        `[DURABLE PAYMENT TRUTH] Ticket fulfillment failed for paid purchase ${approvedPurchaseId}:`,
        fulfillmentErr
      );

      await db
        .update(purchases)
        .set({
          fulfillmentStatus: 'FAILED',
          fulfillmentLastError: fulfillmentErr?.message || String(fulfillmentErr),
          updatedAt: Date.now(),
        })
        .where(eq(purchases.id, approvedPurchaseId));
    }
  }

  return {
    paymentId,
    decision: normalizedDecision,
    status: normalizedDecision === 'APPROVE' ? 'APPROVED' : normalizedDecision === 'HOLD' ? 'ON_HOLD' : 'REJECTED',
    reviewedAt: now,
  };
}

/**
 * Super Admin payment queue listing.
 */
export async function getPaymentReviewQueue(statusFilter?: string, page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;

  const baseQuery = db
    .select({
      payment: payments,
      purchase: purchases,
      buyer: {
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        isStudent: users.isStudent,
        institutionName: users.institutionName,
      },
    })
    .from(payments)
    .innerJoin(purchases, eq(payments.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.buyerId, users.id));

  const whereClause = statusFilter ? eq(payments.status, statusFilter as any) : undefined;

  const queue = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .orderBy(sql`${payments.createdAt} DESC`)
    .limit(pageSize)
    .offset(offset);

  return queue.map((row) => ({
    id: row.payment.id,
    purchaseId: row.purchase.id,
    purchasePublicId: row.purchase.publicId,
    amountPaise: row.payment.amountPaise,
    amountInr: row.payment.amountPaise / 100,
    transactionId: row.payment.transactionId,
    status: row.payment.status,
    createdAt: row.payment.createdAt,
    buyer: row.buyer,
  }));
}
