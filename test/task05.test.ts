import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import {
  validateFormSchema,
  validateFormResponses,
  FormSchema,
} from '../src/services/form.service';
import { compareLeaderboardEntries } from '../src/routes/leaderboards';
import { formatEventResponse } from '../src/routes/events';

describe('TASK-05: Public Catalog, Event Discovery & Leaderboards', () => {
  describe('Dynamic Form Schema & Response Validation', () => {
    it('should validate and accept well-formed form schema definitions', () => {
      const validSchema = [
        {
          id: 'github_username',
          label: 'GitHub Profile',
          type: 'shortText',
          required: true,
          minLength: 3,
        },
        {
          id: 'tshirt_size',
          label: 'T-Shirt Size',
          type: 'singleChoice',
          required: true,
          options: ['S', 'M', 'L', 'XL'],
        },
      ];

      const validated = validateFormSchema(validSchema);
      expect(validated).toHaveLength(2);
      expect(validated[0].id).toBe('github_username');
    });

    it('should reject schemas with duplicate field IDs', () => {
      const duplicateSchema = [
        { id: 'fav_lang', label: 'Language', type: 'shortText', required: false },
        { id: 'fav_lang', label: 'Language 2', type: 'shortText', required: false },
      ];

      expect(() => validateFormSchema(duplicateSchema)).toThrowError(/duplicate field id/i);
    });

    it('should reject singleChoice/multipleChoice without options', () => {
      const missingOptions = [
        { id: 'diet', label: 'Dietary Preference', type: 'singleChoice', required: true },
      ];

      expect(() => validateFormSchema(missingOptions)).toThrowError(/must have at least one option/i);
    });

    it('should validate participant responses against the schema', () => {
      const schema: FormSchema = [
        {
          id: 'experience_years',
          label: 'Years of Experience',
          type: 'number',
          required: true,
          min: 0,
          max: 10,
          scope: 'PARTICIPANT',
        },
        {
          id: 'contact_email',
          label: 'Emergency Email',
          type: 'email',
          required: true,
          scope: 'PARTICIPANT',
        },
      ];

      const validAnswers = {
        experience_years: 3,
        contact_email: 'Dev@TechXetra.in',
      };

      const sanitized = validateFormResponses(schema, validAnswers);
      expect(sanitized.experience_years).toBe(3);
      expect(sanitized.contact_email).toBe('dev@techxetra.in'); // Normalized lowercase
    });

    it('should reject missing required response fields', () => {
      const schema: FormSchema = [
        { id: 'required_field', label: 'Mandatory Question', type: 'shortText', required: true, scope: 'PARTICIPANT' },
      ];

      expect(() => validateFormResponses(schema, {})).toThrowError(/is required/i);
    });
  });

  describe('Leaderboard Tie-Breaking Engine', () => {
    it('should rank highest total score first', () => {
      const entryA = { totalScore: 50, rounds: [25, 25] };
      const entryB = { totalScore: 40, rounds: [20, 20] };

      // compareLeaderboardEntries returns negative when A should precede B
      expect(compareLeaderboardEntries(entryA, entryB)).toBeLessThan(0);
      expect(compareLeaderboardEntries(entryB, entryA)).toBeGreaterThan(0);
    });

    it('should break ties using highest individual round score', () => {
      // Both have total = 30
      // Team A had a stellar round of 20, Team B had consistent 10s
      const teamA = { totalScore: 30, rounds: [20, 5, 5] };
      const teamB = { totalScore: 30, rounds: [10, 10, 10] };

      expect(compareLeaderboardEntries(teamA, teamB)).toBeLessThan(0);
    });

    it('should break ties using second highest round when top rounds match', () => {
      // Both top round is 20, but team A has 12 vs team B has 10
      const teamA = { totalScore: 35, rounds: [20, 12, 3] };
      const teamB = { totalScore: 35, rounds: [20, 10, 5] };

      expect(compareLeaderboardEntries(teamA, teamB)).toBeLessThan(0);
    });

    it('should return 0 when all round scores are completely identical', () => {
      const teamA = { totalScore: 30, rounds: [15, 15] };
      const teamB = { totalScore: 30, rounds: [15, 15] };

      expect(compareLeaderboardEntries(teamA, teamB)).toBe(0);
    });
  });

  describe('Event Capacity and Status Computation', () => {
    it('should correctly compute seats remaining and registration open status', () => {
      const mockEvent: any = {
        id: 'mock-id',
        slug: 'robotics-clash',
        title: 'Robotics Clash',
        category: 'TECHNICAL',
        format: 'TEAM',
        capacity: 20,
        seatsTaken: 15,
        status: 'OPEN',
        registrationOpensAt: null,
        registrationClosesAt: null,
      };

      const formatted = formatEventResponse(mockEvent);
      expect(formatted.seatsRemaining).toBe(5);
      expect(formatted.availableCapacity).toBe(5);
      expect(formatted.registrationOpen).toBe(true);
    });

    it('should treat null capacity as unlimited', () => {
      const unlimitedEvent: any = {
        id: 'unlimited-id',
        slug: 'open-quiz',
        title: 'Open Quiz',
        category: 'TECHNICAL',
        format: 'INDIVIDUAL',
        capacity: null,
        seatsTaken: 100,
        status: 'OPEN',
      };

      const formatted = formatEventResponse(unlimitedEvent);
      expect(formatted.seatsRemaining).toBeNull();
      expect(formatted.availableCapacity).toBeNull();
      expect(formatted.registrationOpen).toBe(true);
    });

    it('should flag registrationOpen as false when capacity is reached', () => {
      const fullEvent: any = {
        id: 'full-id',
        slug: 'hackathon',
        title: 'Hackathon',
        category: 'TECHNICAL',
        format: 'TEAM',
        capacity: 30,
        seatsTaken: 30,
        status: 'OPEN',
      };

      const formatted = formatEventResponse(fullEvent);
      expect(formatted.seatsRemaining).toBe(0);
      expect(formatted.registrationOpen).toBe(false);
    });
  });

  describe('Catalog & Event Route Integration', () => {
    it('GET /api/v1/events query validation rejects invalid category', async () => {
      const res = await request(app).get('/api/v1/events?category=INVALID_CAT');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/events query validation rejects invalid day (> 3)', async () => {
      const res = await request(app).get('/api/v1/events?day=4');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
