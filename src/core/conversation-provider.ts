import type { Attachment, Direction } from './types.ts';

export interface EnsureChannelIdentityInput {
  workspaceId: string;
  channelConnectionId: string;
  externalUserId: string;
  displayName?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelIdentityRef {
  contactId: number;
  contactInboxId?: number;
  sourceId: string;
}

export interface EnsureConversationInput {
  workspaceId: string;
  channelConnectionId: string;
  contactId: number;
  sourceId: string;
  externalConversationId?: string;
  tinixThreadKey: string;
}

export interface ConversationRef {
  conversationId: number;
  displayId: number;
  uuid?: string;
}

export interface IncomingConversationMessage {
  workspaceId: string;
  channelConnectionId: string;
  conversationId: number;
  sourceId?: string;
  externalMessageId: string;
  text?: string;
  attachments?: Attachment[];
  sentAt?: string;
}

export interface OutgoingConversationMessage {
  workspaceId: string;
  channelConnectionId: string;
  conversationId: number;
  text: string;
  attachments?: Attachment[];
  isPrivate?: boolean;
  operationId?: string;
}

export interface MessageRef {
  messageId: number;
  conversationId: number;
  content: string;
  direction: Direction;
  isPrivate: boolean;
  status: string;
  createdAt: string;
  attachments?: Attachment[];
  externalMessageId?: string;
  operationId?: string;
}

export interface DownloadMessageAttachmentInput {
  workspaceId: string;
  conversationDisplayId: number;
  messageId: number;
  attachmentIndex: number;
}

export interface DownloadedMessageAttachment {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

export interface ListMessagesInput {
  workspaceId: string;
  conversationDisplayId: number;
  before?: number;
}

export interface MessagePage {
  messages: MessageRef[];
}

export interface UpdateSupportStateInput {
  workspaceId: string;
  conversationDisplayId: number;
  status: 'open' | 'resolved' | 'pending' | 'snoozed';
}

export interface AssignConversationInput {
  workspaceId: string;
  conversationDisplayId: number;
  agentId?: number;
}

export interface ConversationAgent {
  id: number;
  name: string;
}

export interface ConversationAssignment {
  agents: ConversationAgent[];
  assignee: ConversationAgent | null;
}

export interface ConversationListSummaryInput {
  workspaceId: string;
  conversations: Array<{
    conversationLinkId: string;
    channelConnectionId: string;
    conversationDisplayId: number;
  }>;
}

export interface ConversationListProjection {
  assignee?: ConversationAgent | null;
  contactName?: string;
}

export interface PrivateNoteInput {
  workspaceId: string;
  conversationDisplayId: number;
  content: string;
  operationId?: string;
}

export interface ReconcileConversationInput {
  workspaceId: string;
  conversationDisplayId: number;
  sinceTimestamp?: number;
}

export interface ReconcileResult {
  unprocessedOutgoingMessages: MessageRef[];
  incomingMessages?: MessageRef[];
  privateMessages?: MessageRef[];
}

export interface ConversationProvider {
  readonly providerName: string;
  provisionChannel?(input: { accountId: number; name: string; callbackUrl: string; inboxId?: number }): Promise<{
    inboxId: number; identifier: string; callbackSecret: string;
  }>;

  ensureIdentity(input: EnsureChannelIdentityInput): Promise<ChannelIdentityRef>;

  ensureConversation(input: EnsureConversationInput): Promise<ConversationRef>;

  createIncomingMessage(input: IncomingConversationMessage): Promise<MessageRef>;

  createOutgoingMessage(input: OutgoingConversationMessage): Promise<MessageRef>;

  listMessages(input: ListMessagesInput): Promise<MessagePage>;

  updateSupportState(input: UpdateSupportStateInput): Promise<void>;

  assignConversation(input: AssignConversationInput): Promise<void>;

  getAssignment(input: Omit<AssignConversationInput, 'agentId'>): Promise<ConversationAssignment>;

  listConversationSummaries?(input: ConversationListSummaryInput): Promise<Map<string, ConversationListProjection>>;

  downloadMessageAttachment(input: DownloadMessageAttachmentInput): Promise<DownloadedMessageAttachment>;

  addPrivateNote(input: PrivateNoteInput): Promise<MessageRef>;

  reconcileConversation(input: ReconcileConversationInput): Promise<ReconcileResult>;
}
