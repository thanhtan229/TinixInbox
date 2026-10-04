import type { ChannelCapabilities, ChannelProvider } from './types.ts';

export const DEFAULT_CAPABILITIES: Record<ChannelProvider, ChannelCapabilities> = {
  meta: {
    inboundText: true,
    outboundText: true,
    attachments: ['image'],
    deliveryReceipts: true,
    readReceipts: true,
    markRead: false,
    typing: false,
    reactions: false,
    replyToMessage: false,
  },
  zalo: {
    inboundText: true,
    outboundText: true,
    attachments: ['image', 'file'],
    deliveryReceipts: false,
    readReceipts: false,
    markRead: false,
    typing: false,
    reactions: false,
    replyToMessage: false,
  },
  tiktok_shop: {
    inboundText: true,
    outboundText: true,
    attachments: ['image'],
    deliveryReceipts: false,
    readReceipts: false,
    markRead: true,
    typing: false,
    reactions: false,
    replyToMessage: false,
  },
  shopee: {
    inboundText: false,
    outboundText: false,
    attachments: [],
    deliveryReceipts: false,
    readReceipts: false,
    markRead: false,
    typing: false,
    reactions: false,
    replyToMessage: false,
  },
  synthetic: {
    inboundText: true,
    outboundText: true,
    attachments: ['image', 'file'],
    deliveryReceipts: true,
    readReceipts: true,
    markRead: true,
    typing: true,
    reactions: true,
    replyToMessage: true,
  },
};

export class CapabilityRegistry {
  private static instance: CapabilityRegistry;
  private registry: Map<string, ChannelCapabilities> = new Map();

  private constructor() {
    for (const [provider, caps] of Object.entries(DEFAULT_CAPABILITIES)) {
      this.registry.set(provider, { ...caps });
    }
  }

  public static getInstance(): CapabilityRegistry {
    if (!CapabilityRegistry.instance) {
      CapabilityRegistry.instance = new CapabilityRegistry();
    }
    return CapabilityRegistry.instance;
  }

  public getCapabilities(provider: string): ChannelCapabilities {
    const existing = this.registry.get(provider);
    if (existing) return { ...existing };
    return {
      inboundText: true,
      outboundText: true,
      attachments: [],
      deliveryReceipts: false,
      readReceipts: false,
      markRead: false,
      typing: false,
      reactions: false,
      replyToMessage: false,
    };
  }

  public register(provider: string, capabilities: Partial<ChannelCapabilities>): void {
    const current = this.getCapabilities(provider);
    this.registry.set(provider, { ...current, ...capabilities });
  }

  public supportsAttachment(provider: string, mimeOrType: string): boolean {
    const caps = this.getCapabilities(provider);
    return caps.attachments.some((type) => mimeOrType.toLowerCase().includes(type));
  }
}
