import { assertSafeRuntimeHost, ENV } from './config/env.ts';
import { getDatabase } from './persistence/db.ts';
import {
  AIStateRepository,
  CallbackEventRepository,
  ChannelConnectionRepository,
  ContactLinkRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
  OutboxRepository,
  ProviderWebhookEventRepository,
} from './persistence/repositories.ts';
import { ChatwootClient } from './providers/chatwoot/chatwoot-client.ts';
import { ChatwootConversationProvider } from './providers/chatwoot/chatwoot-provider.ts';
import { SyntheticChannelAdapter } from './channels/synthetic/synthetic-adapter.ts';
import { MetaChannelAdapter } from './channels/meta/meta-adapter.ts';
import { ZaloChannelAdapter } from './channels/zalo/zalo-adapter.ts';
import { TikTokShopChannelAdapter } from './channels/tiktok-shop/tiktok-shop-adapter.ts';
import { ShopeeChannelAdapter } from './channels/shopee/shopee-adapter.ts';
import { InboundService } from './services/inbound-service.ts';
import { OutboundService } from './services/outbound-service.ts';
import { OutboxService } from './services/outbox-service.ts';
import { ReconciliationService } from './services/reconciliation-service.ts';
import { HandoffPolicy } from './agent/handoff-policy.ts';
import { BusinessToolRegistry } from './agent/business-tools.ts';
import { GeminiClient } from './agent/gemini-client.ts';
import { InboxAgentRouter } from './agent/inbox-agent-router.ts';
import { globalEventBus } from './api/event-bus.ts';
import { CallbackController } from './api/callback-controller.ts';
import { WebhookController } from './api/webhook-controller.ts';
import { InboxController } from './api/inbox-controller.ts';
import { createAppServer } from './api/server.ts';


async function bootstrap() {
  assertSafeRuntimeHost(ENV.NODE_ENV, ENV.HOST);
  console.log('[Tinix Inbox] Initializing persistence...');
  const db = getDatabase();

  const connectionRepo = new ChannelConnectionRepository(db);
  const contactRepo = new ContactLinkRepository(db);
  const conversationRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const recoveredInbound = messageRepo.recoverInterruptedInboundMessages();
  if (recoveredInbound > 0) {
    console.warn(`[InboundRecovery] Marked ${recoveredInbound} interrupted messages as unknown; reconcile with Chatwoot before replay.`);
  }
  const outboxRepo = new OutboxRepository(db);
  const callbackEventRepo = new CallbackEventRepository(db);
  const providerEventRepo = new ProviderWebhookEventRepository(db);
  const aiStateRepo = new AIStateRepository(db);

  console.log('[Tinix Inbox] Initializing providers and adapters...');
  const chatwootClient = new ChatwootClient({
    baseUrl: ENV.CHATWOOT_BASE_URL,
    apiToken: ENV.CHATWOOT_API_TOKEN,
  });

  const conversationProvider = new ChatwootConversationProvider(chatwootClient, connectionRepo);
  const syntheticAdapter = new SyntheticChannelAdapter();
  const metaAdapter = new MetaChannelAdapter();
  const zaloAdapter = new ZaloChannelAdapter();
  const tiktokShopAdapter = new TikTokShopChannelAdapter();
  const shopeeAdapter = new ShopeeChannelAdapter();

  console.log('[Tinix Inbox] Initializing services...');
  for (const connection of connectionRepo.listByProvider('default-workspace', 'meta')) {
    if (connection.status === 'disconnected') continue;
    let credentials: { appSecret?: string } = {};
    try { credentials = JSON.parse(connection.credentialsEncrypted); } catch {}
    if (!ENV.META_SECRET_ROTATED || !ENV.META_APP_SECRET || credentials.appSecret !== ENV.META_APP_SECRET) {
      connectionRepo.updateStatus(connection.id, 'revoked');
      console.warn('[Meta] Connection requires rotated app credentials', { connectionId: connection.id });
    }
  }
  const inboundService = new InboundService(
    conversationProvider,
    contactRepo,
    conversationRepo,
    messageRepo,
    undefined,
    globalEventBus,
    connectionRepo
  );

  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  const outboundService = new OutboundService(
    connectionRepo,
    conversationRepo,
    messageRepo,
    outboxRepo,
    callbackEventRepo,
    handoffPolicy
  );

  const outboxService = new OutboxService(outboxRepo, messageRepo, connectionRepo, globalEventBus, handoffPolicy);
  const recoveredSends = outboxService.recoverInterruptedSends();
  if (recoveredSends > 0) {
    console.warn(`[OutboxWorker] Marked ${recoveredSends} interrupted sends as unknown; operator reconciliation is required.`);
  }
  outboxService.registerAdapter('synthetic', syntheticAdapter);
  outboxService.registerAdapter('meta', metaAdapter);
  outboxService.registerAdapter('zalo', zaloAdapter);
  outboxService.registerAdapter('tiktok_shop', tiktokShopAdapter);
  outboxService.registerAdapter('shopee', shopeeAdapter);

  const toolRegistry = new BusinessToolRegistry({
    n8nWebhookBaseUrl: ENV.N8N_WEBHOOK_BASE_URL || undefined,
    n8nWebhookAuthToken: ENV.N8N_WEBHOOK_AUTH_TOKEN || undefined,
    demoMode: ENV.BUSINESS_TOOLS_DEMO_MODE,
  });
  const geminiClient = new GeminiClient({
    apiKey: ENV.GEMINI_API_KEY,
    model: ENV.GEMINI_MODEL,
  });
  const agentRouter = new InboxAgentRouter(
    handoffPolicy,
    conversationProvider,
    conversationRepo,
    messageRepo,
    geminiClient,
    toolRegistry,
    connectionRepo
  );

  inboundService.setAgentRouter(agentRouter);
  inboundService.setEventBus(globalEventBus);

  const reconciliationService = new ReconciliationService(
    conversationProvider,
    conversationRepo,
    messageRepo,
    outboxRepo,
    handoffPolicy
  );

  console.log('[Tinix Inbox] Initializing controllers...');
  const callbackController = new CallbackController(outboundService, outboxService);
  const webhookController = new WebhookController(inboundService, connectionRepo, providerEventRepo);
  webhookController.registerAdapter('synthetic', syntheticAdapter);
  webhookController.registerAdapter('meta', metaAdapter);
  webhookController.registerAdapter('zalo', zaloAdapter);
  webhookController.registerAdapter('tiktok_shop', tiktokShopAdapter);
  webhookController.registerAdapter('shopee', shopeeAdapter);
  const recoveredWebhookEvents = webhookController.recoverInterruptedEvents();
  if (recoveredWebhookEvents > 0) {
    console.warn(`[ProviderWebhookWorker] Requeued ${recoveredWebhookEvents} interrupted webhook events.`);
  }

  const inboxController = new InboxController(
    connectionRepo,
    conversationRepo,
    messageRepo,
    conversationProvider,
    handoffPolicy,
    aiStateRepo,
    reconciliationService,
    outboxRepo,
    outboxService,
    globalEventBus,
    Boolean(ENV.GEMINI_API_KEY.trim())
  );

  const serverApp = createAppServer({
    port: ENV.PORT,
    host: ENV.HOST,
    callbackController,
    webhookController,
    inboxController,
    eventBus: globalEventBus,
  });

  await serverApp.start();
  const reconcile = () => reconciliationService.reconcileWorkspace('default-workspace', true)
    .catch(error => console.warn('[Reconciliation] Sweep failed; durable cursor retained', { errorName: error.name }));
  void reconcile();
  const reconciliationInterval = setInterval(() => { void reconcile(); }, 60000);

  void webhookController.processPendingProviderEvents().catch((err) => {
    console.error('[ProviderWebhookWorker] Recovery processing failed:', err);
  });

  // Outbox background loop
  const outboxInterval = setInterval(async () => {
    try {
      await outboxService.processPendingOutbox(10);
    } catch (err) {
      console.error('[OutboxWorker] Error processing outbox:', err);
    }
  }, 2000);

  const webhookInterval = setInterval(async () => {
    try {
      await webhookController.processPendingProviderEvents(20);
    } catch (err) {
      console.error('[ProviderWebhookWorker] Error processing pending events:', err);
    }
  }, 2000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Tinix Inbox] Shutting down...');
    clearInterval(outboxInterval);
    clearInterval(webhookInterval);
    clearInterval(reconciliationInterval);
    await serverApp.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (err) => {
    console.error('[Tinix Inbox] Uncaught Exception:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Tinix Inbox] Unhandled Rejection at:', promise, 'reason:', reason);
  });
}

bootstrap().catch((err) => {
  console.error('[Tinix Inbox] Fatal initialization error:', err);
  process.exit(1);
});
