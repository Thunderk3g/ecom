import { NextResponse } from 'next/server';

export type FieldError = { path: (string | number)[]; message: string };

export function problem(status: number, title: string, detail: string, errors: FieldError[] = []): NextResponse {
  return NextResponse.json(
    { type: 'about:blank', title, status, detail, errors },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}
