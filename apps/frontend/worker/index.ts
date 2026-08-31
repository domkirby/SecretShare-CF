/**
 * A thin Worker in front of the built SPA. Its only job is to stamp the
 * security headers from headers.ts onto every response — Workers Static Assets
 * cannot set them on its own, and a `public/_headers` file is not an option
 * here (see the note in wrangler.jsonc.example about not_found_handling).
 *
 * `run_worker_first: true` in wrangler.jsonc is what makes this run for asset
 * requests too; without it the asset router would answer /assets/*.js before
 * the Worker ever saw the request, and those responses would go out bare.
 */

import { buildSecurityHeaders } from "./headers";

export interface Env {
  ASSETS: Fetcher;
  /** Origin of the API Worker, e.g. https://shareapi.example.com. */
  API_ORIGIN?: string;
}

const NONCE_META = (nonce: string) => `<meta name="csp-nonce" content="${nonce}">`;

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");
}

export default {
  async fetch(request, env): Promise<Response> {
    const assetResponse = await env.ASSETS.fetch(request);
    const html = isHtml(assetResponse);

    // Hex rather than a raw UUID: nothing but [A-Za-z0-9+/=-] belongs in a CSP
    // nonce, and this also keeps it out of trouble in an HTML attribute.
    const nonce = html ? crypto.randomUUID().replaceAll("-", "") : undefined;

    // ASSETS.fetch returns immutable headers, so the response has to be rebuilt
    // before anything can be added to it.
    const body = html
      ? new HTMLRewriter()
          .on("head", {
            element(element) {
              element.prepend(NONCE_META(nonce as string), { html: true });
            },
          })
          .transform(assetResponse).body
      : assetResponse.body;

    const response = new Response(body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: assetResponse.headers,
    });

    for (const [name, value] of Object.entries(
      buildSecurityHeaders({ pageOrigin: new URL(request.url).origin, apiOrigin: env.API_ORIGIN, nonce })
    )) {
      response.headers.set(name, value);
    }

    // The nonce is per-response, so the HTML carrying it must never be reused.
    // The /assets/* files are content-hashed and keep whatever caching the
    // asset server gave them.
    if (html) response.headers.set("Cache-Control", "no-store");

    return response;
  },
} satisfies ExportedHandler<Env>;
