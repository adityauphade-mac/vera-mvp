import { z } from 'zod';
import { NextResponse } from 'next/server';

export function jsonResponse<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function badRequest(message: string, details?: unknown): NextResponse {
  return NextResponse.json(
    { error: { code: 'bad_request', message, details } },
    { status: 400 },
  );
}

export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  url: URL,
): z.infer<T> | { __error: NextResponse } {
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    params[k] = v;
  }
  const result = schema.safeParse(params);
  if (!result.success) {
    return { __error: badRequest('Invalid query parameters', result.error.flatten()) };
  }
  return result.data;
}
