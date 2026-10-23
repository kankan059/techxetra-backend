import { z } from 'zod';
import { AppError } from '../common/errors';

export const formFieldTypeEnum = z.enum([
  'shortText',
  'longText',
  'number',
  'singleChoice',
  'multipleChoice',
  'checkbox',
  'date',
  'email',
  'phone',
]);

export const formFieldDefinitionSchema = z
  .object({
    id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Field ID must be alphanumeric with underscores or dashes'),
    label: z.string().min(1),
    type: formFieldTypeEnum,
    required: z.boolean().default(false),
    options: z.array(z.string().min(1)).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    scope: z.enum(['PARTICIPANT', 'TEAM']).default('PARTICIPANT'),
    placeholder: z.string().optional(),
    helperText: z.string().optional(),
  })
  .strict();

export const formSchemaValidator = z.array(formFieldDefinitionSchema);

export type FormFieldDefinition = z.infer<typeof formFieldDefinitionSchema>;
export type FormSchema = FormFieldDefinition[];

/**
 * Validates a dynamic form schema structure on creation/update.
 * Ensures field IDs are unique and required options exist for choice fields.
 */
export function validateFormSchema(schema: any): FormSchema {
  if (!schema) return [];

  if (typeof schema === "string") {
    try {
    schema = JSON.parse(schema);
    } catch {
      throw AppError.validation("Form schema must be valid JSON");
    }
  }

  const parsed = formSchemaValidator.safeParse(schema);
  if (!parsed.success) {
    throw AppError.validation('Invalid form schema definition', parsed.error.errors);
  }

  const fields = parsed.data;
  const seenIds = new Set<string>();

  for (const field of fields) {
    if (seenIds.has(field.id)) {
      throw AppError.validation(`Duplicate field ID '${field.id}' found in form schema`);
    }
    seenIds.add(field.id);

    if (
      (field.type === 'singleChoice' || field.type === 'multipleChoice') &&
      (!field.options || field.options.length === 0)
    ) {
      throw AppError.validation(`Field '${field.id}' of type '${field.type}' must have at least one option`);
    }
  }

  return fields;
}

/**
 * Validates participant or team answers against a published FormSchema.
 */
export function validateFormResponses(
  schema: FormSchema,
  responses: Record<string, any> = {}
): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const field of schema) {
    const value = responses[field.id];

    // Check required
    if (field.required) {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        throw AppError.validation(`Field '${field.label}' (${field.id}) is required`);
      }
    }

    if (value === undefined || value === null || value === '') {
      continue;
    }

    switch (field.type) {
      case 'shortText':
      case 'longText': {
        if (typeof value !== 'string') {
          throw AppError.validation(`Field '${field.label}' must be a string`);
        }
        if (field.minLength && value.length < field.minLength) {
          throw AppError.validation(`Field '${field.label}' must be at least ${field.minLength} characters`);
        }
        if (field.maxLength && value.length > field.maxLength) {
          throw AppError.validation(`Field '${field.label}' cannot exceed ${field.maxLength} characters`);
        }
        sanitized[field.id] = value.trim();
        break;
      }
      case 'number': {
        const num = typeof value === 'number' ? value : Number(value);
        if (isNaN(num)) {
          throw AppError.validation(`Field '${field.label}' must be a valid number`);
        }
        if (field.min !== undefined && num < field.min) {
          throw AppError.validation(`Field '${field.label}' must be at least ${field.min}`);
        }
        if (field.max !== undefined && num > field.max) {
          throw AppError.validation(`Field '${field.label}' cannot exceed ${field.max}`);
        }
        sanitized[field.id] = num;
        break;
      }
      case 'singleChoice': {
        if (!field.options?.includes(String(value))) {
          throw AppError.validation(`Field '${field.label}' has an invalid choice '${value}'`);
        }
        sanitized[field.id] = String(value);
        break;
      }
      case 'multipleChoice': {
        if (!Array.isArray(value)) {
          throw AppError.validation(`Field '${field.label}' must be an array of selected options`);
        }
        for (const item of value) {
          if (!field.options?.includes(String(item))) {
            throw AppError.validation(`Invalid option '${item}' for field '${field.label}'`);
          }
        }
        sanitized[field.id] = value.map(String);
        break;
      }
      case 'checkbox': {
        sanitized[field.id] = Boolean(value);
        break;
      }
      case 'email': {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (typeof value !== 'string' || !emailRegex.test(value)) {
          throw AppError.validation(`Field '${field.label}' must be a valid email address`);
        }
        sanitized[field.id] = value.trim().toLowerCase();
        break;
      }
      case 'phone': {
        const phoneRegex = /^[6-9]\d{9}$/;
        if (typeof value !== 'string' || !phoneRegex.test(value.trim())) {
          throw AppError.validation(`Field '${field.label}' must be a valid 10-digit mobile number`);
        }
        sanitized[field.id] = value.trim();
        break;
      }
      case 'date': {
        const timestamp = Date.parse(String(value));
        if (isNaN(timestamp)) {
          throw AppError.validation(`Field '${field.label}' must be a valid date`);
        }
        sanitized[field.id] = new Date(timestamp).toISOString();
        break;
      }
      default:
        sanitized[field.id] = value;
    }
  }

  return sanitized;
}
