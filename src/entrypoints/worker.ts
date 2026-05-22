import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// SP-1 registers the queue names but does not process real jobs yet.
const queues = ['emails', 'csv.imports', 'inventory.alerts', 'search.reindex',
                'webhook.dispatch', 'image.post-process', 'reservation.ttl.sweep'] as const;

async function main() {
  logger.info({ role: 'worker', queues }, 'worker starting');
  for (const name of queues) {
    // Touch the queue so BullMQ creates the key in Redis.
    new Queue(name, { connection });
    new Worker(name, async job => {
      logger.info({ queue: name, id: job.id, data: job.data }, 'job received (SP-1 no-op)');
    }, { connection });
  }
  logger.info('worker ready');
}

main().catch(err => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
