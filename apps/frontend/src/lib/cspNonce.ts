/**
 * The per-response CSP nonce, injected into <head> by the frontend Worker
 * (apps/frontend/worker/index.ts). Anything that adds a <style> element at
 * runtime has to carry it, because style-src allows nonces only — see
 * worker/headers.ts.
 *
 * Empty under `vite dev`, which serves index.html directly with no Worker and
 * therefore no CSP to satisfy.
 */
export const cspNonce: string =
  document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";
