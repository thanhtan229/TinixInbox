import type { BusinessToolRegistry, BusinessToolResult } from './business-tools.ts';
import { ProviderPermanentError, ProviderTemporaryError } from '../core/errors.ts';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export interface GeminiReplyResult {
  replyText: string;
  model: string;
  durationMs: number;
  tokensEstimated: number;
  toolUsed?: string;
}

const DEFAULT_SYSTEM_INSTRUCTION = `Bạn là nhân viên tư vấn bán hàng của shop (tên shop: Tinix).
Phong cách trả lời:
- Tự nhiên, thân thiện, ngắn gọn và đời thường như người thật đang chat tin nhắn (tiếng Việt).
- Tuyệt đối KHÔNG dùng văn mẫu rườm rà, máy móc, ví dụ: "Kính chào quý khách", "Tôi là trợ lý ảo AI", "Tôi có thể giúp gì cho bạn hôm nay".
- Xưng hô "Shop" hoặc "mình", gọi khách là "bạn" hoặc "anh/chị".
- Trả lời thẳng vào trọng tâm câu hỏi. Mỗi câu trả lời chỉ từ 1 đến 3 câu ngắn.
- Nếu khách hỏi tra cứu đơn hàng hoặc khách hàng, hãy gọi công cụ (tool) tương ứng để tra cứu dữ liệu chính xác rồi báo lại ngắn gọn cho khách.`;

const GEMINI_TOOLS_DECLARATION = [
  {
    functionDeclarations: [
      {
        name: 'lookup_order',
        description: 'Tra cứu thông tin trạng thái vận chuyển và chi tiết đơn hàng theo mã đơn',
        parameters: {
          type: 'OBJECT',
          properties: {
            orderId: { type: 'STRING', description: 'Mã đơn hàng, ví dụ DH12345' },
          },
          required: ['orderId'],
        },
      },
      {
        name: 'lookup_customer',
        description: 'Tra cứu thông tin khách hàng và hạng thành viên theo số điện thoại hoặc email',
        parameters: {
          type: 'OBJECT',
          properties: {
            phoneNumber: { type: 'STRING', description: 'Số điện thoại của khách hàng' },
            email: { type: 'STRING', description: 'Email của khách hàng' },
          },
        },
      },
      {
        name: 'create_crm_lead',
        description: 'Tạo khách hàng tiềm năng mới khi khách có nhu cầu mua sỉ hoặc cần báo giá',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Tên khách hàng' },
            phone: { type: 'STRING', description: 'Số điện thoại' },
            note: { type: 'STRING', description: 'Ghi chú nhu cầu' },
          },
          required: ['name'],
        },
      },
      {
        name: 'send_internal_notification',
        description: 'Gửi thông báo nội bộ cho nhân viên khi có vấn đề gấp',
        parameters: {
          type: 'OBJECT',
          properties: {
            message: { type: 'STRING', description: 'Nội dung thông báo' },
            channel: { type: 'STRING', description: 'Kênh thông báo' },
          },
          required: ['message'],
        },
      },
    ],
  },
];

export class GeminiClient {
  private apiKey: string;
  private model: string;
  private fetchFn: typeof fetch;

  constructor(options: GeminiClientOptions = {}) {
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'gemini-2.5-flash';
    this.fetchFn = options.fetchFn || fetch;
  }

  public async generateReply(
    incomingText: string,
    history: ChatTurn[] = [],
    toolRegistry?: BusinessToolRegistry,
    toolCorrelationId?: string,
    brandName?: string
  ): Promise<GeminiReplyResult> {
    const startTime = Date.now();

    if (!this.apiKey.trim()) {
      throw new ProviderPermanentError('Gemini API key is not configured', {
        provider: 'gemini',
        safeMessage: 'AI replies are unavailable until a Gemini API key is configured.',
      });
    }

    try {
      const liveResult = await this.callGeminiAPI(incomingText, history, toolRegistry, toolCorrelationId, brandName);
      return {
        ...liveResult,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ProviderPermanentError || error instanceof ProviderTemporaryError) throw error;
      throw new ProviderTemporaryError('Gemini request failed', {
        provider: 'gemini',
        safeMessage: 'AI reply generation failed temporarily.',
        internalDetails: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      });
    }
  }

  private async callGeminiAPI(
    incomingText: string,
    history: ChatTurn[],
    toolRegistry?: BusinessToolRegistry,
    toolCorrelationId?: string,
    brandName?: string
  ): Promise<{ replyText: string; model: string; tokensEstimated: number; toolUsed?: string }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    // Build contents payload
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    // History turns
    for (const turn of history.slice(-6)) {
      contents.push({
        role: turn.role,
        parts: [{ text: turn.text }],
      });
    }

    // Current turn
    contents.push({
      role: 'user',
      parts: [{ text: incomingText }],
    });

    const instructionText = brandName
      ? DEFAULT_SYSTEM_INSTRUCTION.replace('(tên shop: Tinix)', `(tên shop: ${brandName})`)
      : DEFAULT_SYSTEM_INSTRUCTION;

    const requestBody: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: instructionText }],
      },
      contents,
      tools: toolRegistry ? GEMINI_TOOLS_DECLARATION : undefined,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 256,
      },
    };

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const message = `Gemini API rejected the request with HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) {
        throw new ProviderTemporaryError(message, {
          provider: 'gemini',
          safeMessage: 'AI reply generation failed temporarily.',
          internalDetails: { httpStatus: res.status },
        });
      }
      throw new ProviderPermanentError(message, {
        provider: 'gemini',
        safeMessage: 'AI replies are unavailable because the Gemini request was rejected.',
        internalDetails: { httpStatus: res.status },
      });
    }

    const data = await res.json() as Record<string, unknown>;
    const candidate = (data.candidates as Array<Record<string, unknown>>)?.[0];
    const candidateContent = candidate?.content as Record<string, unknown> | undefined;
    const parts = (candidateContent?.parts as Array<Record<string, unknown>>) || [];

    // Check if Gemini invoked a function call
    let toolUsed: string | undefined;
    for (const part of parts) {
      if (part.functionCall && toolRegistry) {
        const fnCall = part.functionCall as { name: string; args: Record<string, unknown> };
        toolUsed = fnCall.name;
        const toolResult: BusinessToolResult = await toolRegistry.executeTool({
          toolName: fnCall.name,
          parameters: fnCall.args || {},
          correlationId: toolCorrelationId,
        });

        // Send function response back to Gemini for final natural text response
        contents.push({
          role: 'model',
          parts,
        });
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: fnCall.name,
              response: toolResult.data || { error: toolResult.error },
            },
          }],
        });

        const followUpRes = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: DEFAULT_SYSTEM_INSTRUCTION }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (followUpRes.ok) {
          const followUpData = await followUpRes.json() as Record<string, unknown>;
          const finalCandidate = (followUpData.candidates as Array<Record<string, unknown>>)?.[0];
          const finalParts = ((finalCandidate?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>) || [];
          const textPart = finalParts.find((p) => typeof p.text === 'string');
          if (textPart?.text) {
            return {
              replyText: String(textPart.text).trim(),
              model: this.model,
              tokensEstimated: incomingText.length + String(textPart.text).length,
              toolUsed,
            };
          }
        }
      }
    }

    // Direct text response
    const textPart = parts.find((p) => typeof p.text === 'string');
    if (textPart?.text) {
      return {
        replyText: String(textPart.text).trim(),
        model: this.model,
        tokensEstimated: incomingText.length + String(textPart.text).length,
        toolUsed,
      };
    }

    throw new Error('Gemini response did not contain text content');
  }

}
