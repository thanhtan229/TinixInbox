import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

export interface InboxSseEvent {
  type: 'message_created' | 'delivery_updated' | 'handoff_updated' | 'connection_updated';
  data: Record<string, unknown>;
  timestamp: string;
}

export class InboxEventBus extends EventEmitter {
  private sseClients: Set<ServerResponse>;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor() {
    super();
    this.sseClients = new Set();
  }

  public registerClient(res: ServerResponse): void {
    this.sseClients.add(res);

    // Initial greeting / connection handshake
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', clientsCount: this.sseClients.size, timestamp: new Date().toISOString() })}\n\n`);

    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        this.ping();
      }, 15_000);
    }
  }

  public removeClient(res: ServerResponse): void {
    this.sseClients.delete(res);
    if (this.sseClients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  public broadcast(type: InboxSseEvent['type'], data: Record<string, unknown>): void {
    const payload: InboxSseEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    const sseMessage = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(sseMessage);
      } catch {
        this.removeClient(client);
      }
    }

    this.emit(type, data);
  }

  public ping(): void {
    for (const client of this.sseClients) {
      try {
        client.write(': ping\n\n');
      } catch {
        this.removeClient(client);
      }
    }
  }

  public getClientsCount(): number {
    return this.sseClients.size;
  }
}

export const globalEventBus = new InboxEventBus();
