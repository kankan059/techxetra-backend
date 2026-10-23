import { Router, Request, Response, NextFunction } from 'express';
import { asc } from 'drizzle-orm';
import { db } from '../db';
import { festDays, settings } from '../db/schema';
import { sendSuccess } from '../common/response';

export const catalogRouter = Router();

// 1. GET /festival or /catalog/passes
catalogRouter.get(['/festival', '/catalog/passes'], async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const allSettings = await db.select().from(settings);
    const settingsMap: Record<string, any> = {};
    for (const s of allSettings) {
      settingsMap[s.key] = s.value;
    }

    const days = await db.select().from(festDays).orderBy(asc(festDays.dayNumber));

    const response = {
      purchasesEnabled: settingsMap['purchases_enabled'] ?? true,
      supportEmail: settingsMap['support_email'] ?? 'support@techxetra.in',
      gatePassPricePaise: settingsMap['gate_pass_price_paise'] ?? 30000,
      gatePassStudentPricePaise: settingsMap['gate_pass_student_price_paise'] ?? 15000,
      festDays: days.map((d) => ({
        dayNumber: d.dayNumber,
        date: d.date,
        validFrom: d.validFrom,
        validTo: d.validTo,
        description: d.description,
      })),
    };

    sendSuccess(res, response);
  } catch (err) {
    next(err);
  }
});
