import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scriptPath = resolve(process.cwd(), 'public/fetchInterceptor.js');
const interceptorScript = readFileSync(scriptPath, 'utf-8');

function installInterceptor(): void {
  (0, eval)(interceptorScript);
}

describe('fetchInterceptor (MAIN world script)', () => {
  let originalFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    delete (window as Window & { __gvFetchInterceptorInstalled?: boolean })
      .__gvFetchInterceptorInstalled;

    document.documentElement.innerHTML = '';

    originalFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    Object.defineProperty(window, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    });
  });

  it('short-circuits known CSP-blocked GTM telemetry requests', async () => {
    installInterceptor();

    const response = await window.fetch('https://www.googletagmanager.com/td?id=G-TEST');

    expect(response.status).toBe(204);
    expect(originalFetch).not.toHaveBeenCalled();
  });

  it('passes through non-target requests to original fetch', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    Object.defineProperty(window, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    });

    installInterceptor();

    const response = await window.fetch('https://example.com/api');

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('rejects invalid bridge response data URLs', async () => {
    installInterceptor();

    const response = new Response('image', {
      status: 200,
      headers: { 'content-length': '100', 'content-type': 'image/png' },
    });
    originalFetch.mockResolvedValue(response);

    const bridge = document.createElement('div');
    bridge.id = 'gv-watermark-bridge';
    bridge.dataset.enabled = 'true';
    document.documentElement.appendChild(bridge);

    const fetchPromise = window.fetch('https://foo.googleusercontent.com/rd-gg-dl/bar=s128');
    await vi.waitFor(() => {
      expect(bridge.dataset.request).toBeTruthy();
    });
    const requestRaw = bridge.dataset.request;
    if (!requestRaw) return;
    const request = JSON.parse(requestRaw) as { requestId?: string };
    bridge.dataset.response = JSON.stringify({
      requestId: request.requestId,
      base64: 'data:text/html,malicious',
    });
    await Promise.resolve();

    const finalResponse = await fetchPromise;
    expect(finalResponse.status).toBe(200);
    expect(originalFetch).toHaveBeenCalledTimes(1);
  });
});
