/**
 * Resilient API Client Utility
 * Safely handles API responses, ensuring HTML error fallbacks (e.g. from Vite SPA or proxy)
 * do not throw uncaught `SyntaxError: Unexpected token '<'`.
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error?: string;
  status?: number;
}

export async function safePostJson<T = any>(
  url: string,
  body: any,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    const contentType = res.headers.get('content-type') || '';

    // If server returned non-JSON (such as Vite SPA fallback HTML index or an Express HTML error page)
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      const isHtml = text.trim().startsWith('<') || text.includes('<!DOCTYPE') || text.includes('<!doctype');
      const errorMsg = isHtml
        ? `API returned unexpected HTML (${res.status}). Server may be initializing.`
        : `API returned unexpected content-type (${contentType})`;

      return {
        success: false,
        data: null,
        error: errorMsg,
        status: res.status,
      };
    }

    // Response is JSON - parse safely
    const json = await res.json();
    return {
      success: res.ok && json.success !== false,
      data: json,
      error: res.ok ? undefined : (json.error || `HTTP error ${res.status}`),
      status: res.status,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        success: false,
        data: null,
        error: 'Request aborted',
      };
    }

    return {
      success: false,
      data: null,
      error: err?.message || 'Network request failed',
    };
  }
}
