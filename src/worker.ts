export interface Env {
  SECRETS_KV: KVNamespace;
  CSRF_SECRET: string;
  ALLOWED_ORIGINS?: string;
}

interface SecretData {
  encryptedData: string;
  maxViews: number;
  viewCount: number;
  createdAt: number;
}

interface CreateSecretRequest {
  encryptedData: string;
  maxViews: number;
  expirationHours: number;
  csrfToken: string;
}

interface RetrieveSecretRequest {
  secretId: string;
  csrfToken: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    
    // Validate origin if ALLOWED_ORIGINS is set
    const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || ['*'];
    const isOriginAllowed = allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin));
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': isOriginAllowed ? (origin || '*') : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!isOriginAllowed && origin) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      // Handle API routes
      if (url.pathname.startsWith('/api/')) {
        switch (`${request.method} ${url.pathname}`) {
          case 'GET /api/csrf-token':
            return handleGetCSRFToken(env, corsHeaders);
          
          case 'POST /api/create':
            return handleCreateSecret(request, env, corsHeaders);
          
          case 'POST /api/retrieve':
            return handleRetrieveSecret(request, env, corsHeaders);
          
          case 'GET /api/health':
            return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          
          default:
            return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
      }
      
      // For non-API routes, return a simple 404 for now
      // TODO: Add static file serving after confirming worker deployment works
      return new Response('Page not found', {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
      });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

async function handleGetCSRFToken(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const token = await generateCSRFToken(env.CSRF_SECRET);
  
  return new Response(JSON.stringify({ csrfToken: token }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleCreateSecret(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  let data: CreateSecretRequest;
  
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate required fields
  if (!data.encryptedData || !data.csrfToken || data.maxViews === undefined || data.expirationHours === undefined) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate input ranges
  if (data.maxViews < 1 || data.maxViews > 100) {
    return new Response(JSON.stringify({ error: 'Max views must be between 1 and 100' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (data.expirationHours < 1 || data.expirationHours > 8760) { // Max 1 year
    return new Response(JSON.stringify({ error: 'Expiration hours must be between 1 and 8760' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate CSRF token
  if (!await validateCSRFToken(data.csrfToken, env.CSRF_SECRET)) {
    return new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Generate unique secret ID
  const secretId = await generateSecretId();
  
  // Hash the secret ID for storage (prevents URL matching if KV is compromised)
  const hashedSecretId = await hashSecretId(secretId);
  
  const secretData: SecretData = {
    encryptedData: data.encryptedData,
    maxViews: data.maxViews,
    viewCount: 0,
    createdAt: Date.now(),
  };

  // Calculate expiration timestamp
  const expirationSeconds = data.expirationHours * 3600;
  
  try {
    // Store in KV using hashed secret ID
    await env.SECRETS_KV.put(hashedSecretId, JSON.stringify(secretData), {
      expirationTtl: expirationSeconds,
    });
  } catch (error) {
    console.error('KV put error:', error);
    return new Response(JSON.stringify({ error: 'Failed to store secret' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ 
    secretId, // Return the original (non-hashed) ID for the URL
    expiresAt: Date.now() + (expirationSeconds * 1000),
    maxViews: data.maxViews,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleRetrieveSecret(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  let data: RetrieveSecretRequest;
  
  try {
    data = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!data.secretId || !data.csrfToken) {
    return new Response(JSON.stringify({ error: 'Missing secretId or csrfToken' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validate CSRF token
  if (!await validateCSRFToken(data.csrfToken, env.CSRF_SECRET)) {
    return new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Hash the secret ID for KV lookup
  const hashedSecretId = await hashSecretId(data.secretId);

  // Retrieve secret from KV using hashed ID
  let storedData: string | null;
  try {
    storedData = await env.SECRETS_KV.get(hashedSecretId);
  } catch (error) {
    console.error('KV get error:', error);
    return new Response(JSON.stringify({ error: 'Failed to retrieve secret' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  if (!storedData) {
    return new Response(JSON.stringify({ error: 'Secret not found or expired' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let secretData: SecretData;
  try {
    secretData = JSON.parse(storedData);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid secret data' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  // Check view count
  if (secretData.viewCount >= secretData.maxViews) {
    await env.SECRETS_KV.delete(hashedSecretId);
    return new Response(JSON.stringify({ error: 'Secret has exceeded maximum views' }), {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Increment view count
  secretData.viewCount++;
  
  // Return the client-encrypted data directly
  const clientEncryptedData = secretData.encryptedData;
  
  // If this was the last allowed view, delete the secret
  if (secretData.viewCount >= secretData.maxViews) {
    try {
      await env.SECRETS_KV.delete(hashedSecretId);
    } catch (error) {
      console.error('KV delete error:', error);
    }
  } else {
    // Update view count
    try {
      await env.SECRETS_KV.put(hashedSecretId, JSON.stringify(secretData));
    } catch (error) {
      console.error('KV update error:', error);
    }
  }

  return new Response(JSON.stringify({ 
    encryptedData: clientEncryptedData,
    viewCount: secretData.viewCount,
    maxViews: secretData.maxViews,
    isLastView: secretData.viewCount >= secretData.maxViews,
    createdAt: secretData.createdAt,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// CSRF Token Generation and Validation
async function generateCSRFToken(secret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const data = new TextEncoder().encode(timestamp);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return `${timestamp}.${signatureHex}`;
}

async function validateCSRFToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  
  const [timestamp, providedSignature] = parts;
  if (!timestamp || !providedSignature) return false;
  
  // Check if token is too old (30 minutes)
  const tokenAge = Date.now() - parseInt(timestamp);
  if (tokenAge > 30 * 60 * 1000 || tokenAge < 0) return false;
  
  const data = new TextEncoder().encode(timestamp);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return signatureHex === providedSignature;
}

// Secret ID Generation and Hashing
async function generateSecretId(): Promise<string> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  return base64urlEncode(randomBytes);
}

async function hashSecretId(secretId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secretId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(hashBuffer));
}

// Base64URL encoding/decoding utilities
function base64urlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(str: string): Uint8Array {
  // Add padding if needed
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = str
    .replace(/-/g, '+')
    .replace(/_/g, '/') + padding;
  
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}