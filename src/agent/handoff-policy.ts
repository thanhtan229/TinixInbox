import type { AIMode } from '../core/types.ts';
import { AIStateRepository } from '../persistence/repositories.ts';
import { FeatureFlagManager } from '../config/feature-flags.ts';

export interface CanReplyDecision {
  canReply: boolean;
  mode: AIMode;
  version: number;
  reason?: string;
}

export class HandoffPolicy {
  private aiStateRepo: AIStateRepository;

  constructor(aiStateRepo: AIStateRepository) {
    this.aiStateRepo = aiStateRepo;
  }

  public checkCanAIReply(workspaceId: string, providerConversationId: string): CanReplyDecision {
    const state = this.aiStateRepo.getState(workspaceId, providerConversationId);
    const flags = FeatureFlagManager.getInstance();
    if (!flags.isEnabled('tinix_inbox_enabled') || !flags.isEnabled('tinix_inbox_ai_enabled')) {
      return { canReply: false, mode: state?.mode === 'human' ? 'human' : 'paused', version: state?.version || 1, reason: 'AI feature is disabled' };
    }
    if (!state) {
      // Fresh conversation defaults to active AI mode with version 1
      return {
        canReply: true,
        mode: 'ai',
        version: 1,
      };
    }

    if (state.mode === 'human') {
      return {
        canReply: false,
        mode: state.mode,
        version: state.version,
        reason: 'Human agent has taken over this conversation.',
      };
    }

    if (state.mode === 'paused' || state.mode === 'hybrid') {
      return {
        canReply: false,
        mode: state.mode,
        version: state.version,
        reason: `AI is paused: ${state.pauseReason || 'no reason provided'}`,
      };
    }

    return {
      canReply: true,
      mode: state.mode,
      version: state.version,
    };
  }

  public takeOverByHuman(
    workspaceId: string,
    conversationProvider: string,
    providerConversationId: string,
    humanOwnerId: string
  ): void {
    this.aiStateRepo.setMode(
      workspaceId,
      conversationProvider,
      providerConversationId,
      'human',
      undefined,
      { humanOwnerId }
    );
  }

  public resumeAI(
    workspaceId: string,
    conversationProvider: string,
    providerConversationId: string
  ): void {
    this.aiStateRepo.setMode(
      workspaceId,
      conversationProvider,
      providerConversationId,
      'ai'
    );
  }

  public pauseAI(
    workspaceId: string,
    conversationProvider: string,
    providerConversationId: string,
    pauseReason: string
  ): void {
    this.aiStateRepo.setMode(
      workspaceId,
      conversationProvider,
      providerConversationId,
      'paused',
      undefined,
      { pauseReason }
    );
  }

  public commitAIReply(
    workspaceId: string,
    conversationProvider: string,
    providerConversationId: string,
    expectedVersion: number
  ): boolean {
    if (!this.checkCanAIReply(workspaceId, providerConversationId).canReply) return false;
    const currentState = this.aiStateRepo.getState(workspaceId, providerConversationId);
    if (!currentState) {
      // If no state record was created yet and expectedVersion is 1, it's a fresh conversation in default 'ai' mode
      return expectedVersion === 1;
    }

    // Concurrency check: If a human took over while AI was generating, version will have incremented
    if (currentState.version !== expectedVersion || currentState.mode === 'human' || currentState.mode === 'paused') {
      return false; // Race condition caught! AI send aborted.
    }

    return true;
  }
}
