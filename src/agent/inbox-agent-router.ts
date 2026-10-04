import { createHash, randomUUID } from 'node:crypto';
import type { ConversationProvider, MessageRef } from '../core/conversation-provider.ts';
import type { UnifiedMessage } from '../core/unified-message.ts';
import type { HandoffPolicy } from './handoff-policy.ts';
import type {
  ChannelConnectionRepository,
  ConversationLinkRepository,
  MessageLinkRepository,
} from '../persistence/repositories.ts';
import type { GeminiClient } from './gemini-client.ts';
import type { BusinessToolRegistry } from './business-tools.ts';
import { ProviderPermanentError } from '../core/errors.ts';
import { channelEnabled } from '../config/feature-flags.ts';

export interface AgentGenerateOptions {
  model?: string;
  systemPrompt?: string;
  generateReplyFn?: (incomingText: string) => Promise<string>;
}

export interface AgentReplyResult {
  triggered: boolean;
  skipped: boolean;
  reason?: string;
  messageRef?: MessageRef;
  provenance?: {
    model: string;
    durationMs: number;
    tokensEstimated: number;
    toolUsed?: string;
  };
}

export class InboxAgentRouter {
  private handoffPolicy: HandoffPolicy;
  private conversationProvider: ConversationProvider;
  private conversationRepo: ConversationLinkRepository;
  private messageRepo: MessageLinkRepository;
  private geminiClient?: GeminiClient;
  private toolRegistry?: BusinessToolRegistry;
  private connectionRepo?: ChannelConnectionRepository;
  private defaultModel = 'gemini-2.5-flash';

  constructor(
    handoffPolicy: HandoffPolicy,
    conversationProvider: ConversationProvider,
    conversationRepo: ConversationLinkRepository,
    messageRepo: MessageLinkRepository,
    geminiClient?: GeminiClient,
    toolRegistry?: BusinessToolRegistry,
    connectionRepo?: ChannelConnectionRepository
  ) {
    this.handoffPolicy = handoffPolicy;
    this.conversationProvider = conversationProvider;
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.geminiClient = geminiClient;
    this.toolRegistry = toolRegistry;
    this.connectionRepo = connectionRepo;
  }


  public async handleIncomingMessage(
    incomingMessage: UnifiedMessage,
    options: AgentGenerateOptions = {}
  ): Promise<AgentReplyResult> {
    if (!channelEnabled(incomingMessage.provider)) return { triggered: false, skipped: true, reason: 'Channel feature is disabled' };
    const threadKey = incomingMessage.externalConversationId || incomingMessage.sender.externalId;
    const convLink = this.conversationRepo.findByThreadKey(
      incomingMessage.workspaceId,
      incomingMessage.channelConnectionId,
      threadKey
    );

    if (!convLink) {
      return { triggered: false, skipped: true, reason: 'Conversation link not found' };
    }

    const convDisplayIdStr = String(convLink.chatwootConversationDisplayId);
    if (this.connectionRepo) {
      const connection = this.connectionRepo.findById(incomingMessage.channelConnectionId);
      if (!connection || !['connected', 'degraded'].includes(connection.status)) {
        return { triggered: false, skipped: true, reason: 'Channel is unavailable' };
      }
    }

    // 1. Initial handoff policy check
    const decision = this.handoffPolicy.checkCanAIReply(incomingMessage.workspaceId, convDisplayIdStr);
    if (!decision.canReply) {
      return {
        triggered: true,
        skipped: true,
        reason: decision.reason || 'AI reply inhibited by handoff policy',
      };
    }

    const capturedVersion = decision.version;
    const startTime = Date.now();

    // 2. Generate response (LLM or mock generator)
    let replyText: string;
    let usedModel = options.model || this.defaultModel;
    let toolUsed: string | undefined;

    if (options.generateReplyFn) {
      replyText = await options.generateReplyFn(incomingMessage.text || '');
    } else if (this.geminiClient) {
      let historyTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
      try {
        const hist = await this.conversationProvider.listMessages({
          workspaceId: incomingMessage.workspaceId,
          conversationDisplayId: convLink.chatwootConversationDisplayId,
        });
        historyTurns = (hist.messages || [])
          .filter((m) => m.content && !m.isPrivate)
          .map((m) => ({
            role: m.direction === 'incoming' ? 'user' : 'model',
            text: m.content || '',
          }));
      } catch {
        // history fetch is best effort
      }
      let brandName: string | undefined;
      if (this.connectionRepo) {
        const conn = this.connectionRepo.findById(incomingMessage.channelConnectionId);
        if (conn?.displayName) {
          brandName = conn.displayName;
        }
      }
      const geminiRes = await this.geminiClient.generateReply(
        incomingMessage.text || '',
        historyTurns,
        this.toolRegistry,
        createHash('sha256')
          .update(`${incomingMessage.workspaceId}\0${incomingMessage.channelConnectionId}\0${incomingMessage.externalMessageId}`)
          .digest('hex'),
        brandName
      );
      replyText = geminiRes.replyText;
      usedModel = geminiRes.model;
      toolUsed = geminiRes.toolUsed;
    } else {
      throw new ProviderPermanentError('No AI generation runtime is configured', {
        provider: 'ai',
        safeMessage: 'AI replies are unavailable until a generation runtime is configured.',
      });
    }

    const durationMs = Date.now() - startTime;

    // 3. Pre-send Concurrency / Race Check
    // If a human took over while AI was generating, version incremented or mode changed!
    const canCommit = this.handoffPolicy.commitAIReply(
      incomingMessage.workspaceId,
      this.conversationProvider.providerName,
      convDisplayIdStr,
      capturedVersion
    );

    if (!canCommit) {
      return {
        triggered: true,
        skipped: true,
        reason: 'Human agent took over during AI response generation (race condition prevented)',
      };
    }

    // 4. Output ONLY through ConversationProvider (NO direct provider send!)
    const operationId = `ai-${createHash('sha256').update(`${incomingMessage.workspaceId}\0${incomingMessage.channelConnectionId}\0${incomingMessage.externalMessageId}`).digest('hex')}`;
    if (!this.messageRepo.beginSendOperation(operationId, incomingMessage.workspaceId, convLink.id, 'ai',
      createHash('sha256').update(replyText).digest('hex'), capturedVersion)) {
      return { triggered: true, skipped: true, reason: 'AI reply operation already exists' };
    }
    const messageRef = await this.conversationProvider.createOutgoingMessage({
      workspaceId: incomingMessage.workspaceId,
      channelConnectionId: incomingMessage.channelConnectionId,
      conversationId: convLink.chatwootConversationDisplayId,
      text: replyText,
      isPrivate: false,
      operationId,
    });

    this.messageRepo.finishSendOperation(operationId, messageRef);
    // 5. Record AI provenance in message_links
    this.messageRepo.recordAiOutgoing({
      id: randomUUID(),
      workspaceId: incomingMessage.workspaceId,
      channelConnectionId: incomingMessage.channelConnectionId,
      conversationLinkId: convLink.id,
      direction: 'outgoing',
      origin: 'ai',
      chatwootAccountId: convLink.chatwootAccountId,
      chatwootMessageId: messageRef.messageId,
      deliveryState: 'queued',
      correlationId: randomUUID(),
      metadata: {
        aiVersion: capturedVersion,
        operationId,
        aiProvenance: {
          model: usedModel,
          durationMs,
          promptTokens: (incomingMessage.text || '').length,
          completionTokens: replyText.length,
          toolUsed,
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    return {
      triggered: true,
      skipped: false,
      messageRef,
      provenance: {
        model: usedModel,
        durationMs,
        tokensEstimated: (incomingMessage.text || '').length + replyText.length,
        toolUsed,
      },
    };
  }
}
