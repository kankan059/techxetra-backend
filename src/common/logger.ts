const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'rawtoken',
  'session',
  'authorization',
  'cookie',
  'transaction_id',
  'transactionid',
  'utr',
  'id_token',
  'idtoken',
  'phone',
  'phonenumber',
  'secret',
  'hmacsecret',
]);

function redactValue(key: string, value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
  if (SENSITIVE_KEYS.has(lowerKey)) {
    return '[REDACTED]';
  }

  if (typeof value === 'object') {
    return redactObject(value);
  }

  return value;
}

export function redactObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    sanitized[k] = redactValue(k, v);
  }
  return sanitized;
}

export const logger = {
  info: (message: string, context: Record<string, any> = {}) => {
    console.log(
      JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        message,
        ...redactObject(context),
      })
    );
  },
  warn: (message: string, context: Record<string, any> = {}) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        message,
        ...redactObject(context),
      })
    );
  },
  error: (message: string, context: Record<string, any> = {}) => {
    console.error(
      JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        message,
        ...redactObject(context),
      })
    );
  },
};
