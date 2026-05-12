/**
 * Seeds the first tenant: Priority Roofs · Dallas. Idempotent — safe to run on
 * every deploy. Future tenants get added through the team-onboarding flow
 * (not yet built). Run via: `pnpm --filter @vera/web db:seed`.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: 'priority-roofs-dallas' },
    update: {},
    create: {
      name: 'Priority Roofs · Dallas',
      slug: 'priority-roofs-dallas',
      senderDomain: 'makanalytics.org',
      brandColor: '#B85C2A',
      briefingTimeLocal: '07:00',
      briefingTimezone: 'America/Chicago',
    },
  });
  // eslint-disable-next-line no-console
  console.log('Seeded tenant:', tenant);

  // Dev-mode test user — also used by Playwright auth helper. Idempotent.
  const devUser = await db.user.upsert({
    where: { email: 'adityauphade@makanalytics.org' },
    update: {},
    create: {
      email: 'adityauphade@makanalytics.org',
      name: 'Aditya Uphade',
      tenantId: tenant.id,
      role: 'owner',
    },
  });
  // eslint-disable-next-line no-console
  console.log('Seeded dev user:', { id: devUser.id, email: devUser.email });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
