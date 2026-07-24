const API_BASE = import.meta.env.VITE_API_BASE as string;

export interface CreateSecretRequest {
  ciphertext: string;
  kdf?: { salt: string; iterations: number; verifier: string };
  maxViews: number;
  ttlMinutes?: number;
  turnstileToken?: string;
}

export interface CreateSecretResponse {
  id: string;
  expiresAt: string;
}

export interface ProbeSecretResponse {
  exists: true;
  requiresPassword: boolean;
  kdf?: { salt: string; iterations: number };
  viewsRemaining: number;
  expiresAt: string;
}

export interface ProbeSecretNotFound {
  exists: false;
}

export interface RevealSecretResponse {
  ciphertext: string;
  kdf?: { salt: string; iterations: number };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // non-JSON error body, fall back to statusText
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function createSecret(req: CreateSecretRequest): Promise<CreateSecretResponse> {
  return fetch(`${API_BASE}/api/secrets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  }).then(handle<CreateSecretResponse>);
}

export async function probeSecret(
  id: string
): Promise<ProbeSecretResponse | ProbeSecretNotFound> {
  const res = await fetch(`${API_BASE}/api/secrets/${encodeURIComponent(id)}`);
  if (res.status === 404) return { exists: false };
  return handle<ProbeSecretResponse>(res);
}

export function revealSecret(id: string, turnstileToken?: string): Promise<RevealSecretResponse> {
  return fetch(`${API_BASE}/api/secrets/${encodeURIComponent(id)}/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken }),
  }).then(handle<RevealSecretResponse>);
}

export async function verifyPassword(
  id: string,
  verifier: string,
  turnstileToken?: string
): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/secrets/${encodeURIComponent(id)}/verify-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verifier, turnstileToken }),
  });
  const { valid } = await handle<{ valid: boolean }>(res);
  return valid;
}

export function deleteSecret(id: string): Promise<void> {
  return fetch(`${API_BASE}/api/secrets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then(handle<void>);
}
