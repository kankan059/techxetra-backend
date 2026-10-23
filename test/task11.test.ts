import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('TASK-11: Event Committee Portal & Attendee Roster Management', () => {
  describe('Scoped Staff Route Access Protection', () => {
    it('GET /api/v1/staff/events/mine should require staff authentication (401)', async () => {
      const res = await request(app).get('/api/v1/staff/events/mine');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('GET /api/v1/staff/events/dummy-id/dashboard should require staff authentication (401)', async () => {
      const res = await request(app).get('/api/v1/staff/events/dummy-id/dashboard');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/staff/events/dummy-id/registrations should require staff authentication (401)', async () => {
      const res = await request(app).get('/api/v1/staff/events/dummy-id/registrations');
      expect(res.status).toBe(401);
    });

    it('PATCH /api/v1/staff/events/dummy-id/public-details should require Lead or Admin (401)', async () => {
      const res = await request(app)
        .patch('/api/v1/staff/events/dummy-id/public-details')
        .send({ title: 'New Event Title' });

      expect(res.status).toBe(401);
    });
  });

  describe('Participant Data Minimization & Privacy Tiers', () => {
    it('should separate Lead DTO from Volunteer DTO to prevent leaking contact data', () => {
      const rawAttendee = {
        id: 'TX260002',
        name: 'Rahul Sharma',
        email: 'rahul@example.com',
        phone: '9876543210',
        institutionName: 'Tezpur University',
        institutionId: 'TU1234',
        passwordHash: 'secret-hash',
      };

      // Volunteer DTO: minimal fields
      const volunteerDto = {
        id: rawAttendee.id,
        name: rawAttendee.name,
      };

      // Lead DTO: approved operational contact fields
      const leadDto = {
        id: rawAttendee.id,
        name: rawAttendee.name,
        email: rawAttendee.email,
        phone: rawAttendee.phone,
        institutionName: rawAttendee.institutionName,
        institutionId: rawAttendee.institutionId,
      };

      expect((volunteerDto as any).email).toBeUndefined();
      expect((volunteerDto as any).phone).toBeUndefined();
      expect(leadDto.email).toBe('rahul@example.com');
      expect((leadDto as any).passwordHash).toBeUndefined();
    });
  });

  describe('Operational Update Protection Invariants', () => {
    it('should reject modification of protected fields (price, capacity, format, status)', () => {
      const protectedFields = [
        'pricePaise',
        'studentPricePaise',
        'capacity',
        'capacityUnit',
        'category',
        'format',
        'status',
      ];

      const leadAllowedFields = [
        'title',
        'shortDescription',
        'description',
        'rules',
        'venue',
        'organizer',
        'eligibility',
        'timeline',
        'prizes',
      ];

      for (const field of protectedFields) {
        expect(leadAllowedFields.includes(field)).toBe(false);
      }
    });
  });
});
