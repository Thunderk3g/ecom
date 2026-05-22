import 'dotenv/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

async function main() {
  logger.info({ role: 'scheduler' }, 'scheduler starting');
  // SP-1: register the schedule shape but use a no-op repeat cycle.
  const q = new Queue('reservation.ttl.sweep', { connection });
  await q.add(
    'sweep',
    { reason: 'ttl' },
    { repeat: { pattern: '*/5 * * * *' }, removeOnComplete: true, removeOnFail: 50 },
  );
  logger.info('scheduler registered repeating jobs');
  // Hold the process open.
  await new Promise(() => {});
}

main().catch(err => {
  logger.error({ err }, 'scheduler failed');
  process.exit(1);
});
