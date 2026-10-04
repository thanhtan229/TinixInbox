import test from 'node:test';
import assert from 'node:assert';
import { BusinessToolRegistry } from '../../src/agent/business-tools.ts';
import { getDatabase } from '../../src/persistence/db.ts';
import {
  AIStateRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
} from '../../src/persistence/repositories.ts';
import { HandoffPolicy } from '../../src/agent/handoff-policy.ts';
import { InboxAgentRouter } from '../../src/agent/inbox-agent-router.ts';
import { GeminiClient } from '../../src/agent/gemini-client.ts';
import type { ConversationProvider, MessageRef } from '../../src/core/conversation-provider.ts';
import type { UnifiedMessage } from '../../src/core/unified-message.ts';

class MockConversationProviderForAI implements ConversationProvider {
  readonly providerName = 'chatwoot';
  public outgoingCalls: any[] = [];
  private msgCounter = 700;

  async ensureIdentity() { return { contactId: 1, sourceId: 'src' }; }
  async ensureConversation() { return { conversationId: 1, displayId: 1 }; }
  async createIncomingMessage() { return {} as any; }

  async createOutgoingMessage(input: any): Promise<MessageRef> {
    this.outgoingCalls.push(input);
    return {
      messageId: this.msgCounter++,
      conversationId: input.conversationId,
      content: input.text,
      direction: 'outgoing',
      isPrivate: input.isPrivate || false,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
  }

  async listMessages() { return { messages: [] }; }
  async updateSupportState() {}
  async assignConversation() {}
  async getAssignment() { return { agents: [], assignee: null }; }
  async downloadMessageAttachment(): Promise<import('../../src/core/conversation-provider.ts').DownloadedMessageAttachment> { throw new Error('unused'); }
  async addPrivateNote() { return {} as any; }
  async reconcileConversation() { return { unprocessedOutgoingMessages: [] }; }
}

test('Phase 3 Handoff & AI Agent: Standard AI Reply & Provenance', async () => {
  const db = getDatabase(':memory:');
  const aiStateRepo = new AIStateRepository(db);
  const convRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);

  const mockProvider = new MockConversationProviderForAI();
  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  let capturedRequest: Record<string, any> | undefined;
  const geminiClient = new GeminiClient({
    apiKey: 'synthetic-integration-key',
    model: 'gemini-2.5-flash',
    fetchFn: (async (_url, init) => {
      capturedRequest = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [
        { text: 'Dạ shop còn hàng, bạn nhé.' },
      ] } }] }), { status: 200 });
    }) as typeof fetch,
  });
  const router = new InboxAgentRouter(
    handoffPolicy,
    mockProvider,
    convRepo,
    messageRepo,
    geminiClient,
    new BusinessToolRegistry({ demoMode: true })
  );
  handoffPolicy.resumeAI('ws-ai', 'chatwoot', '1');

  // Setup conversation link
  convRepo.create({
    id: 'conv-ai-1',
    workspaceId: 'ws-ai',
    channelConnectionId: 'conn-1',
    tinixThreadKey: 'cust-001',
    chatwootAccountId: 1,
    chatwootInboxId: 1,
    chatwootConversationRef: '1',
    chatwootConversationDisplayId: 1,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const incomingMsg: UnifiedMessage = {
    id: 'in-1',
    workspaceId: 'ws-ai',
    provider: 'meta',
    channelConnectionId: 'conn-1',
    externalConversationId: 'cust-001',
    externalMessageId: 'mid-001',
    direction: 'incoming',
    messageType: 'text',
    sender: { externalId: 'cust-001' },
    attachments: [],
    text: 'Sản phẩm này có sẵn không?',
    sentAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  const res = await router.handleIncomingMessage(incomingMsg);

  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.skipped, false);
  assert.strictEqual(res.provenance?.model, 'gemini-2.5-flash');
  assert.strictEqual(mockProvider.outgoingCalls.length, 1);
  assert.strictEqual(mockProvider.outgoingCalls[0].text, 'Dạ shop còn hàng, bạn nhé.');
  assert.strictEqual(capturedRequest?.contents.at(-1)?.parts[0]?.text, incomingMsg.text);

  // Check stored message_link has origin: 'ai' and provenance metadata
  const storedMessages = messageRepo.listByConversation('conv-ai-1');
  assert.strictEqual(storedMessages.length, 1);
  assert.strictEqual(storedMessages[0].origin, 'ai');
  assert.ok(storedMessages[0].metadata?.aiProvenance);
});

test('InboxAgentRouter derives a stable tenant-scoped tool correlation from the inbound message identity', async () => {
  const db = getDatabase(':memory:');
  const aiStateRepo = new AIStateRepository(db);
  const convRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);
  const mockProvider = new MockConversationProviderForAI();
  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  const correlations: Array<string | undefined> = [];
  const geminiClient = {
    async generateReply(_text: string, _history: unknown, _registry: unknown, correlationId?: string) {
      correlations.push(correlationId);
      return { replyText: 'Đã nhận yêu cầu.', model: 'test-model', durationMs: 1, tokensEstimated: 1 };
    },
  };
  const router = new InboxAgentRouter(
    handoffPolicy,
    mockProvider,
    convRepo,
    messageRepo,
    geminiClient as any,
    new BusinessToolRegistry({ demoMode: true })
  );
  handoffPolicy.resumeAI('ws-stable-tools', 'chatwoot', '75');
  convRepo.create({
    id: 'conv-stable-tools',
    workspaceId: 'ws-stable-tools',
    channelConnectionId: 'conn-stable-tools',
    tinixThreadKey: 'customer-stable-tools',
    chatwootAccountId: 1,
    chatwootInboxId: 1,
    chatwootConversationRef: '75',
    chatwootConversationDisplayId: 75,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const message: UnifiedMessage = {
    id: 'in-stable-tools',
    workspaceId: 'ws-stable-tools',
    provider: 'meta',
    channelConnectionId: 'conn-stable-tools',
    externalConversationId: 'customer-stable-tools',
    externalMessageId: 'provider-message-75',
    direction: 'incoming',
    messageType: 'text',
    sender: { externalId: 'customer-stable-tools' },
    attachments: [],
    text: 'Tạo giúp mình một báo giá.',
    sentAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  await router.handleIncomingMessage(message);
  await router.handleIncomingMessage(message);

  assert.equal(correlations.length, 2);
  assert.match(correlations[0]!, /^[a-f0-9]{64}$/);
  assert.equal(correlations[1], correlations[0]);
  db.close();
});

test('Phase 3 Handoff & AI Agent: Skip reply when Human has taken over', async () => {
  const db = getDatabase(':memory:');
  const aiStateRepo = new AIStateRepository(db);
  const convRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);

  const mockProvider = new MockConversationProviderForAI();
  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  const router = new InboxAgentRouter(handoffPolicy, mockProvider, convRepo, messageRepo);
  convRepo.create({
    id: 'conv-ai-2',
    workspaceId: 'ws-ai',
    channelConnectionId: 'conn-1',
    tinixThreadKey: 'cust-002',
    chatwootAccountId: 1,
    chatwootInboxId: 1,
    chatwootConversationRef: '2',
    chatwootConversationDisplayId: 2,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Human takes over
  handoffPolicy.takeOverByHuman('ws-ai', 'chatwoot', '2', 'human-agent-99');

  const incomingMsg: UnifiedMessage = {
    id: 'in-2',
    workspaceId: 'ws-ai',
    provider: 'meta',
    channelConnectionId: 'conn-1',
    externalConversationId: 'cust-002',
    externalMessageId: 'mid-002',
    direction: 'incoming',
    messageType: 'text',
    sender: { externalId: 'cust-002' },
    attachments: [],
    text: 'Tôi cần hỗ trợ gấp',
    sentAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  const res = await router.handleIncomingMessage(incomingMsg);
  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.skipped, true);
  assert.match(res.reason!, /Human agent has taken over/);
  assert.strictEqual(mockProvider.outgoingCalls.length, 0); // No message sent!
});

test('Phase 3 Handoff & AI Agent: Mid-generation Takeover Race Condition is Prevented', async () => {
  const db = getDatabase(':memory:');
  const aiStateRepo = new AIStateRepository(db);
  const convRepo = new ConversationLinkRepository(db);
  const messageRepo = new MessageLinkRepository(db);

  const mockProvider = new MockConversationProviderForAI();
  const handoffPolicy = new HandoffPolicy(aiStateRepo);
  const router = new InboxAgentRouter(handoffPolicy, mockProvider, convRepo, messageRepo);
  handoffPolicy.resumeAI('ws-ai', 'chatwoot', '3');

  convRepo.create({
    id: 'conv-ai-3',
    workspaceId: 'ws-ai',
    channelConnectionId: 'conn-1',
    tinixThreadKey: 'cust-003',
    chatwootAccountId: 1,
    chatwootInboxId: 1,
    chatwootConversationRef: '3',
    chatwootConversationDisplayId: 3,
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const incomingMsg: UnifiedMessage = {
    id: 'in-3',
    workspaceId: 'ws-ai',
    provider: 'meta',
    channelConnectionId: 'conn-1',
    externalConversationId: 'cust-003',
    externalMessageId: 'mid-003',
    direction: 'incoming',
    messageType: 'text',
    sender: { externalId: 'cust-003' },
    attachments: [],
    text: 'Tư vấn cho tôi giá sỉ',
    sentAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  // Simulate long AI generation during which human takes over!
  const slowGenerationFn = async () => {
    // While AI is generating, human takes over!
    handoffPolicy.takeOverByHuman('ws-ai', 'chatwoot', '3', 'human-agent-42');
    return 'Dạ giá sỉ từ 10 sản phẩm là...';
  };

  const res = await router.handleIncomingMessage(incomingMsg, {
    generateReplyFn: slowGenerationFn,
  });

  assert.strictEqual(res.triggered, true);
  assert.strictEqual(res.skipped, true);
  assert.match(res.reason!, /race condition prevented/i);
  assert.strictEqual(mockProvider.outgoingCalls.length, 0); // Discarded! Never double-sent!
});
