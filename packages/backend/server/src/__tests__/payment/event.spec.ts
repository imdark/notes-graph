import { PrismaClient } from '@prisma/client';
import ava, { TestFn } from 'ava';

import { EventBus, JobQueue } from '../../base';
import { WorkspacePolicyService } from '../../core/permission';
import { QuotaStateService } from '../../core/quota/state';
import { WorkspaceService } from '../../core/workspaces';
import { StripeWebhookController } from '../../plugins/payment/controller';
import { SubscriptionCronJobs } from '../../plugins/payment/cron';
import { PaymentEventHandlers } from '../../plugins/payment/event';
import {
  SubscriptionPlan,
  SubscriptionRecurring,
} from '../../plugins/payment/types';

type Context = Record<string, never>;

const test = ava as TestFn<Context>;

test('workspace subscription activation only sends upgrade notification', async t => {
  const events: Array<{ name: string; payload: unknown }> = [];
  let reconciled = false;
  const handler = new PaymentEventHandlers(
    {
      isTeamWorkspace: async () => true,
      sendTeamWorkspaceUpgradedEmail: async () => {},
    } as unknown as WorkspaceService,
    {
      reconcileWorkspaceQuotaState: async () => {
        reconciled = true;
      },
    } as unknown as WorkspacePolicyService,
    {
      reconcileWorkspaceQuotaState: async () => ({ seatLimit: 7 }),
    } as unknown as QuotaStateService,
    {
      emit: (name: string, payload: unknown) => events.push({ name, payload }),
    } as unknown as EventBus
  );

  await handler.onWorkspaceSubscriptionUpdated({
    workspaceId: 'ws',
    plan: SubscriptionPlan.Team,
    recurring: SubscriptionRecurring.Yearly,
    quantity: 999,
  });

  t.deepEqual(events, []);
  t.false(reconciled);
});

test('workspace entitlement change allocates seats from effective quota state', async t => {
  const events: Array<{ name: string; payload: unknown }> = [];
  const handler = new PaymentEventHandlers(
    {} as unknown as WorkspaceService,
    {} as unknown as WorkspacePolicyService,
    {
      reconcileWorkspaceQuotaState: async () => ({
        plan: 'team',
        seatLimit: 7,
      }),
    } as unknown as QuotaStateService,
    {
      emit: (name: string, payload: unknown) => events.push({ name, payload }),
    } as unknown as EventBus
  );

  await handler.onEntitlementChanged({
    targetType: 'workspace',
    targetId: 'ws',
  });

  t.deepEqual(events, [
    {
      name: 'workspace.members.allocateSeats',
      payload: { workspaceId: 'ws', quantity: 7 },
    },
  ]);
});

test('stripe webhook persists failed async processing for retry visibility', async t => {
  const event = {
    id: 'evt_1',
    type: 'invoice.paid',
    created: 1710000000,
    data: { object: { id: 'in_1' } },
  };
  const updates: unknown[] = [];
  const db = {
    paymentEvent: {
      findUnique: async () => null,
      create: async (input: unknown) => {
        updates.push(input);
        return { id: 'payment_event_1' };
      },
      updateMany: async (input: unknown) => {
        updates.push(input);
        return { count: 1 };
      },
      update: async (input: unknown) => {
        updates.push(input);
        return {};
      },
    },
  } as unknown as PrismaClient;
  const controller = new StripeWebhookController(
    { payment: { stripe: { webhookKey: 'whsec' } } } as never,
    db,
    {
      stripe: {
        webhooks: {
          constructEvent: () => event,
        },
      },
    } as never,
    {
      emitAsync: async () => {
        throw new Error('handler failed');
      },
    } as unknown as EventBus
  );

  await controller.handleWebhook({
    rawBody: Buffer.from('{}'),
    headers: { 'stripe-signature': 'sig' },
  } as never);
  await new Promise(resolve => setImmediate(resolve));

  t.like(updates[0], {
    data: {
      provider: 'stripe',
      eventType: 'invoice.paid',
      externalEventId: 'evt_1',
    },
  });
  t.deepEqual(
    updates.slice(1).map(update => (update as { data: unknown }).data),
    [
      {
        processingStatus: 'processing',
        processingAttempts: { increment: 1 },
      },
      {
        processingStatus: 'failed',
        lastError: 'handler failed',
      },
    ]
  );
});

test('stripe webhook skips already processed events', async t => {
  const event = {
    id: 'evt_processed',
    type: 'invoice.paid',
    created: 1710000000,
    data: { object: { id: 'in_1' } },
  };
  const controller = new StripeWebhookController(
    { payment: { stripe: { webhookKey: 'whsec' } } } as never,
    {
      paymentEvent: {
        findUnique: async () => ({
          id: 'payment_event_processed',
          processingStatus: 'processed',
        }),
      },
    } as unknown as PrismaClient,
    {
      stripe: {
        webhooks: {
          constructEvent: () => event,
        },
      },
    } as never,
    {
      emitAsync: async () => {
        t.fail('processed event should not be emitted again');
      },
    } as unknown as EventBus
  );

  await controller.handleWebhook({
    rawBody: Buffer.from('{}'),
    headers: { 'stripe-signature': 'sig' },
  } as never);
  await new Promise(resolve => setImmediate(resolve));

  t.pass();
});

test('stripe webhook skips events already claimed by another processor', async t => {
  const event = {
    id: 'evt_claimed',
    type: 'invoice.paid',
    created: 1710000000,
    data: { object: { id: 'in_1' } },
  };
  const controller = new StripeWebhookController(
    { payment: { stripe: { webhookKey: 'whsec' } } } as never,
    {
      paymentEvent: {
        findUnique: async () => null,
        create: async () => ({ id: 'payment_event_claimed' }),
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as PrismaClient,
    {
      stripe: {
        webhooks: {
          constructEvent: () => event,
        },
      },
    } as never,
    {
      emitAsync: async () => {
        t.fail('unclaimed event should not be emitted');
      },
    } as unknown as EventBus
  );

  await controller.handleWebhook({
    rawBody: Buffer.from('{}'),
    headers: { 'stripe-signature': 'sig' },
  } as never);
  await new Promise(resolve => setImmediate(resolve));

  t.pass();
});

test('stripe webhook replay job reprocesses pending events', async t => {
  const updates: unknown[] = [];
  const emitted: unknown[] = [];
  let findManyInput: unknown;
  const cron = new SubscriptionCronJobs(
    {
      paymentEvent: {
        findMany: async (input: unknown) => {
          findManyInput = input;
          return [
            {
              id: 'payment_event_1',
              eventType: 'invoice.paid',
              metadata: { id: 'in_1' },
            },
          ];
        },
        updateMany: async (input: unknown) => {
          updates.push(input);
          return { count: 1 };
        },
        update: async (input: unknown) => {
          updates.push(input);
          return {};
        },
      },
    } as unknown as PrismaClient,
    {
      emitAsync: async (name: string, payload: unknown) => {
        emitted.push({ name, payload });
      },
    } as unknown as EventBus,
    {} as unknown as JobQueue,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await cron.replayStripeWebhookEvents();

  t.deepEqual(emitted, [
    { name: 'stripe.invoice.paid', payload: { id: 'in_1' } },
  ]);
  t.like(findManyInput, {
    where: {
      OR: [
        { processingStatus: { in: ['pending', 'failed'] } },
        { processingStatus: 'processing' },
      ],
    },
  });
  t.deepEqual((updates[0] as { data: unknown }).data, {
    processingStatus: 'processing',
    processingAttempts: { increment: 1 },
  });
  t.like((updates[1] as { data: unknown }).data, {
    processingStatus: 'processed',
    lastError: null,
  });
  t.true(
    (updates[1] as { data: { processedAt: Date } }).data.processedAt instanceof
      Date
  );
});

test('stripe webhook replay job keeps failed events retryable', async t => {
  const updates: unknown[] = [];
  const cron = new SubscriptionCronJobs(
    {
      paymentEvent: {
        findMany: async () => [
          {
            id: 'payment_event_1',
            eventType: 'invoice.paid',
            metadata: { id: 'in_1' },
          },
        ],
        updateMany: async (input: unknown) => {
          updates.push(input);
          return { count: 1 };
        },
        update: async (input: unknown) => {
          updates.push(input);
          return {};
        },
      },
    } as unknown as PrismaClient,
    {
      emitAsync: async () => {
        throw new Error('handler still failing');
      },
    } as unknown as EventBus,
    {} as unknown as JobQueue,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  await cron.replayStripeWebhookEvents();

  t.deepEqual(
    updates.map(update => (update as { data: unknown }).data),
    [
      {
        processingStatus: 'processing',
        processingAttempts: { increment: 1 },
      },
      {
        processingStatus: 'failed',
        lastError: 'handler still failing',
      },
    ]
  );
});
