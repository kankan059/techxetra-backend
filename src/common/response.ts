import { Response, Request } from 'express';

export interface MetaEnvelope {
  requestId: string;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  [key: string]: any;
}

export interface ApiSuccessResponse<T = any> {
  success: boolean;
  data: T;
  meta: MetaEnvelope;
  request_id: string;
}

export interface ApiErrorDetail {
  path?: string | (string | number)[];
  message: string;
  [key: string]: any;
}

export interface ApiErrorResponse {
  success: boolean;
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
  meta: MetaEnvelope;
  request_id: string;
}

export function sendSuccess<T = any>(
  res: Response,
  data: T,
  statusCode = 200,
  extraMeta: Record<string, any> = {}
): Response {
  const req = res.req as Request;
  const requestId = req?.requestId || 'req_unknown';

  const meta: MetaEnvelope = {
    requestId,
    ...extraMeta,
  };

  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    meta,
    request_id: requestId,
  };

  return res.status(statusCode).json(body);
}

export function sendPaginated<T = any>(
  res: Response,
  data: T[],
  page: number,
  pageSize: number,
  total: number,
  statusCode = 200,
  extraMeta: Record<string, any> = {}
): Response {
  const totalPages = Math.ceil(total / pageSize) || 0;
  return sendSuccess(res, data, statusCode, {
    page,
    pageSize,
    total,
    totalPages,
    ...extraMeta,
  });
}

export function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode = 400,
  details: any[] = []
): Response {
  const req = res.req as Request;
  const requestId = req?.requestId || 'req_unknown';

  const meta: MetaEnvelope = {
    requestId,
  };

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details.length > 0 ? { details } : {}),
    },
    meta,
    request_id: requestId,
  };

  return res.status(statusCode).json(body);
}
