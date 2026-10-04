import type { DeliveryState } from './types.ts';

const VALID_TRANSITIONS: Record<DeliveryState, DeliveryState[]> = {
  queued: ['sending', 'failed'],
  sending: ['provider_accepted', 'retry_wait', 'unknown', 'failed'],
  retry_wait: ['sending', 'failed', 'dead_letter'],
  unknown: ['provider_accepted', 'delivered', 'failed', 'dead_letter'],
  provider_accepted: ['delivered', 'read', 'failed'],
  delivered: ['read'],
  read: [],
  failed: ['retry_wait', 'dead_letter'],
  dead_letter: ['queued'], // manual redrive
};

export class DeliveryStateMachine {
  public static canTransition(current: DeliveryState, next: DeliveryState): boolean {
    if (current === next) return true;
    const allowed = VALID_TRANSITIONS[current];
    return allowed ? allowed.includes(next) : false;
  }

  public static transition(current: DeliveryState, next: DeliveryState): DeliveryState {
    if (this.canTransition(current, next)) {
      return next;
    }
    throw new Error(`Invalid delivery state transition from '${current}' to '${next}'`);
  }

  public static isTerminal(state: DeliveryState): boolean {
    return state === 'read' || state === 'dead_letter';
  }

  public static toUiLabel(state: DeliveryState): string {
    switch (state) {
      case 'queued':
        return 'Chờ gửi';
      case 'sending':
        return 'Đang gửi';
      case 'provider_accepted':
        return 'Đã gửi (Provider nhận)';
      case 'delivered':
        return 'Đã nhận';
      case 'read':
        return 'Đã đọc';
      case 'retry_wait':
        return 'Đang chờ thử lại';
      case 'unknown':
        return 'Chưa xác định';
      case 'failed':
        return 'Gửi thất bại';
      case 'dead_letter':
        return 'Lỗi không thể gửi (Dead Letter)';
      default:
        return state;
    }
  }
}
