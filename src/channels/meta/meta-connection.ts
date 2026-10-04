import { ENV } from '../../config/env.ts';

export class MetaConnectionClient {
  private async request(path: string, token: string, method = 'GET'): Promise<Record<string, any>> {
    const response = await fetch(`https://graph.facebook.com/${ENV.META_GRAPH_API_VERSION}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as Record<string, any>;
    if (!response.ok || data.error) throw new Error('Meta từ chối yêu cầu. Kiểm tra token, quyền và cấu hình ứng dụng.');
    return data;
  }

  public async inspect(token: string): Promise<{ valid: boolean; pageId?: string; pageName?: string; scopes?: string[]; error?: string }> {
    if (!ENV.META_APP_ID || !ENV.META_APP_SECRET || !ENV.META_WEBHOOK_VERIFY_TOKEN || !ENV.META_SECRET_ROTATED) {
      return { valid: false, error: 'Cần rotate App Secret đã lộ, rồi cấu hình META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN và META_SECRET_ROTATED=true trên backend.' };
    }
    if (!token?.trim()) return { valid: false, error: 'Mã truy cập không được để trống' };
    try {
      const { data } = await this.request(`debug_token?input_token=${encodeURIComponent(token.trim())}`, `${ENV.META_APP_ID}|${ENV.META_APP_SECRET}`);
      const scopes: string[] = Array.isArray(data?.scopes) ? data.scopes : [];
      if (!data?.is_valid || data.type !== 'PAGE' || String(data.app_id) !== ENV.META_APP_ID
        || !['pages_messaging', 'pages_manage_metadata'].every(scope => scopes.includes(scope))) {
        return { valid: false, error: 'Cần Page Token hợp lệ của đúng ứng dụng, có pages_messaging và pages_manage_metadata.' };
      }
      const me = await this.request('me?fields=id,name', token.trim());
      if (!me.id || (data.profile_id && String(data.profile_id) !== String(me.id))) return { valid: false, error: 'Page ID không khớp token.' };
      return { valid: true, pageId: String(me.id), pageName: String(me.name || me.id), scopes };
    } catch {
      return { valid: false, error: 'Không xác minh được Page Token. Chưa tạo kết nối.' };
    }
  }

  public async subscribe(pageId: string, token: string): Promise<void> {
    const result = await this.request(`${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`, token, 'POST');
    if (result.success !== true) throw new Error('Meta chưa xác nhận đăng ký webhook.');
  }
}
