import { createHash } from 'node:crypto';

export interface BusinessToolCall {
  toolName: string;
  parameters: Record<string, unknown>;
  correlationId?: string;
}

export interface BusinessToolResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  executedAt: string;
}

export interface BusinessToolsOptions {
  n8nWebhookBaseUrl?: string;
  n8nWebhookAuthToken?: string;
  fetchFn?: typeof fetch;
  demoMode?: boolean;
}

export class BusinessToolRegistry {
  private n8nWebhookBaseUrl?: string;
  private n8nWebhookAuthToken?: string;
  private fetchFn: typeof fetch;
  private demoMode: boolean;

  private async postN8n(path: string, payload: unknown, idempotencyKey?: string): Promise<unknown> {
    const response = await this.fetchFn(`${this.n8nWebhookBaseUrl}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.n8nWebhookAuthToken ? { Authorization: `Bearer ${this.n8nWebhookAuthToken}` } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Business tool endpoint failed with HTTP ${response.status}`);
    }
    if (response.status === 204) return { accepted: true };
    return response.json();
  }

  private writeIdempotencyKey(call: BusinessToolCall): string | undefined {
    if (!call.correlationId) return undefined;
    return createHash('sha256')
      .update(`tinix-business-tool:v1\0${call.correlationId}\0${call.toolName}`)
      .digest('hex');
  }

  constructor(options: BusinessToolsOptions = {}) {
    this.n8nWebhookBaseUrl = options.n8nWebhookBaseUrl;
    this.n8nWebhookAuthToken = options.n8nWebhookAuthToken;
    this.fetchFn = options.fetchFn || fetch;
    this.demoMode = options.demoMode === true;
  }

  public async executeTool(call: BusinessToolCall): Promise<BusinessToolResult> {
    const executedAt = new Date().toISOString();

    if (!this.n8nWebhookBaseUrl && !this.demoMode) {
      return {
        toolName: call.toolName,
        success: false,
        error: 'Business tool integration is not configured',
        executedAt,
      };
    }

    if (this.n8nWebhookBaseUrl && !this.n8nWebhookAuthToken) {
      return {
        toolName: call.toolName,
        success: false,
        error: 'Business tool authentication is not configured',
        executedAt,
      };
    }

    if (this.n8nWebhookBaseUrl && process.env.NODE_ENV === 'production' && !this.n8nWebhookBaseUrl.startsWith('https://')) {
      return {
        toolName: call.toolName,
        success: false,
        error: 'Production business tool endpoint must use HTTPS',
        executedAt,
      };
    }

    switch (call.toolName) {
      case 'lookup_order':
        return this.lookupOrder(call.parameters, executedAt);
      case 'lookup_customer':
        return this.lookupCustomer(call.parameters, executedAt);
      case 'create_crm_lead':
        if (this.n8nWebhookBaseUrl && !call.correlationId?.trim()) {
          return { toolName: call.toolName, success: false, error: 'Stable message correlation is required for n8n write actions', executedAt };
        }
        return this.createCrmLead(call.parameters, executedAt, this.writeIdempotencyKey(call));
      case 'send_internal_notification':
        if (this.n8nWebhookBaseUrl && !call.correlationId?.trim()) {
          return { toolName: call.toolName, success: false, error: 'Stable message correlation is required for n8n write actions', executedAt };
        }
        return this.sendInternalNotification(call.parameters, executedAt, this.writeIdempotencyKey(call));
      default:
        return {
          toolName: call.toolName,
          success: false,
          error: `Unknown business tool: ${call.toolName}`,
          executedAt,
        };
    }
  }

  private async lookupOrder(params: Record<string, unknown>, executedAt: string): Promise<BusinessToolResult> {
    const orderId = String(params.orderId || params.order_id || '');
    if (!orderId) {
      return { toolName: 'lookup_order', success: false, error: 'Missing orderId parameter', executedAt };
    }

    if (this.n8nWebhookBaseUrl) {
      try {
        const data = await this.postN8n('order-lookup', { orderId });
        return { toolName: 'lookup_order', success: true, data, executedAt };
      } catch (err) {
        return { toolName: 'lookup_order', success: false, error: (err as Error).message, executedAt };
      }
    }

    // Default internal fallback data
    return {
      toolName: 'lookup_order',
      success: true,
      data: {
        orderId,
        status: 'shipping',
        carrier: 'Giao Hàng Tiết Kiệm (GHTK)',
        trackingCode: `GHTK-${orderId}`,
        estimatedDelivery: 'Trong 24-48 giờ tới',
        items: [{ name: 'Áo thun Tinix Premium', quantity: 1, price: 250000 }],
        totalAmount: 250000,
      },
      executedAt,
    };
  }

  private async lookupCustomer(params: Record<string, unknown>, executedAt: string): Promise<BusinessToolResult> {
    const query = String(params.phoneNumber || params.email || params.customerId || '');
    if (!query) {
      return { toolName: 'lookup_customer', success: false, error: 'Missing customer query parameter', executedAt };
    }

    if (this.n8nWebhookBaseUrl) {
      try {
        const data = await this.postN8n('customer-lookup', { query });
        return { toolName: 'lookup_customer', success: true, data, executedAt };
      } catch (err) {
        return { toolName: 'lookup_customer', success: false, error: (err as Error).message, executedAt };
      }
    }

    return {
      toolName: 'lookup_customer',
      success: true,
      data: {
        customerId: `CUST-${query}`,
        name: 'Nguyễn Văn A',
        tier: 'VIP Gold',
        totalOrders: 5,
        totalSpend: 1850000,
        tags: ['khach_quen', 'thich_khuyen_mai'],
      },
      executedAt,
    };
  }

  private async createCrmLead(params: Record<string, unknown>, executedAt: string, idempotencyKey?: string): Promise<BusinessToolResult> {
    if (this.n8nWebhookBaseUrl) {
      try {
        const data = await this.postN8n('crm-lead', params, idempotencyKey);
        return { toolName: 'create_crm_lead', success: true, data, executedAt };
      } catch (err) {
        return { toolName: 'create_crm_lead', success: false, error: (err as Error).message, executedAt };
      }
    }

    return {
      toolName: 'create_crm_lead',
      success: true,
      data: {
        leadId: `LEAD-${Date.now()}`,
        status: 'created',
        assignedTo: 'Sales Team',
      },
      executedAt,
    };
  }

  private async sendInternalNotification(params: Record<string, unknown>, executedAt: string, idempotencyKey?: string): Promise<BusinessToolResult> {
    if (this.n8nWebhookBaseUrl) {
      try {
        const data = await this.postN8n('notify', params, idempotencyKey);
        return { toolName: 'send_internal_notification', success: true, data, executedAt };
      } catch (err) {
        return { toolName: 'send_internal_notification', success: false, error: (err as Error).message, executedAt };
      }
    }

    return {
      toolName: 'send_internal_notification',
      success: true,
      data: { sent: true, channel: params.channel || 'general' },
      executedAt,
    };
  }
}
