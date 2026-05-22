import { NextResponse } from 'next/server';
import { migratorClient } from '@/db/client';
import Redis from 'ioredis';
import { env } from '@/lib/env';

const redis = new Redis(env.REDIS_URL);

export async function GET() {
  const checks: Record<string, 'ok' | 'fail'> = { process: 'ok' };
  try { await migratorClient`SELECT 1`; checks.postgres = 'ok'; } catch { checks.postgres = 'fail'; }
  try { await redis.ping(); checks.redis = 'ok'; } catch { checks.redis = 'fail'; }
  const ok = Object.values(checks).every(v => v === 'ok');
  return NextResponse.json({ status: ok ? 'ok' : 'degraded', checks }, { status: ok ? 200 : 503 });
}
