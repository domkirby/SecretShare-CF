# SecretShare Deployment Guide

This guide covers deploying SecretShare on Cloudflare's platform using the split architecture:
- **Cloudflare Workers**: API backend (`src/worker.ts`)
- **Cloudflare Pages**: Static frontend (`frontend/`)

## Architecture Overview

```
┌─────────────────┐    HTTPS/CORS     ┌──────────────────┐
│ Cloudflare Pages │◄──────────────────┤ Cloudflare Worker │
│   (Frontend)     │                   │   (API Backend)   │
│                  │                   │                   │
│ - HTML/CSS/JS    │                   │ - /api/* routes   │
│ - Static assets  │                   │ - KV storage      │
│ - Build process  │                   │ - CSRF protection │
└─────────────────┘                   └──────────────────┘
```

## Prerequisites

1. **Cloudflare Account**: [Sign up](https://dash.cloudflare.com/sign-up) if you don't have one
2. **Node.js**: Version 18+ 
3. **Git**: For repository management
4. **Wrangler CLI**: Cloudflare's deployment tool
5. **Repository Access**: If planning to use Git integration (recommended), [fork this repository](https://github.com/domkirby/SecretShare-CF/fork) to your own GitHub account first

> **💡 Important**: For Git integration deployment, you must fork this repository to your own GitHub account. Cloudflare Pages needs write access to set up webhooks and deploy previews, which requires repository ownership.

### Install Wrangler

```bash
npm install -g wrangler
```

### Authenticate with Cloudflare

```bash
npx wrangler auth login
```

## Part 1: Deploy the API Worker

### 1.1 Configure Environment Variables

Create/update your `.env` file in the project root:

```env
# Required: CSRF secret (32+ character random string)
CSRF_SECRET=your-32-plus-character-random-string-here

# Required: CORS origins (comma-separated, supports wildcards)
CORS_ORIGINS=https://*.pages.dev,https://yourdomain.com

# Optional: Custom KV namespace name
KV_NAMESPACE_NAME=secretshare-storage
```

**Generate a CSRF secret:**
```bash
# Linux/Mac
openssl rand -hex 32

# Windows PowerShell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
[System.Convert]::ToHexString($bytes).ToLower()
```

### 1.2 Create KV Namespace

```bash
npx wrangler kv:namespace create "secretshare-storage"
```

This will output something like:
```
🌀 Creating namespace with title "secretshare-storage"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "SECRETS", id = "abc123def456", preview_id = "preview123" }
```

### 1.3 Update wrangler.toml

Copy the KV namespace configuration to your `wrangler.toml`:

```toml
name = "your-api-worker-name"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

[env.production]
vars = { }

[[env.production.kv_namespaces]]
binding = "SECRETS"
id = "your-actual-kv-namespace-id"
preview_id = "your-preview-id"
```

### 1.4 Set Environment Variables

```bash
# Set CSRF secret
npx wrangler secret put CSRF_SECRET

# Set CORS origins (adjust for your domains)
npx wrangler secret put CORS_ORIGINS
```

When prompted, enter:
- **CSRF_SECRET**: Your generated 32+ character string
- **CORS_ORIGINS**: `https://*.pages.dev,https://yourdomain.com`

### 1.5 Deploy the Worker

```bash
npx wrangler deploy
```

**Expected output:**
```
✨ Built successfully!
🚀 Published your-api-worker-name
   https://your-api-worker-name.your-subdomain.workers.dev
```

**Save the worker URL** - you'll need it for the frontend configuration.

### 1.6 Test the API

```bash
# Test health endpoint
curl https://your-api-worker-name.your-subdomain.workers.dev/api/health

# Expected response:
# {"status":"ok","timestamp":"2025-09-18T..."}
```

## Part 2: Deploy the Frontend (Pages)

### 2.1 Configure Frontend Environment

Create `frontend/.env`:

```env
# Your deployed worker URL from Part 1
API_BASE_URL=https://your-api-worker-name.your-subdomain.workers.dev
```

### 2.2 Build the Frontend

```bash
cd frontend
npm install
npm run build
```

This creates `frontend/dist/` with:
- Environment variables substituted
- All static files ready for deployment

### 2.3 Deploy to Pages

#### Option A: Direct Upload (Recommended for testing)

```bash
# From project root
npx wrangler pages deploy frontend/dist --project-name your-frontend-name
```

#### Option B: Git Integration (Recommended for production)

> **⚠️ Prerequisites**: You must have [forked this repository](https://github.com/domkirby/SecretShare-CF/fork) to your own GitHub account before proceeding with Git integration.

1. **Push your code to GitHub** (your forked repository)
2. **Connect Repository in Cloudflare Dashboard:**
   - Go to Cloudflare Dashboard → Pages
   - Click "Create a project" → "Connect to Git"
   - Select your **forked** repository
   - Configure build settings:
     - **Build command**: `cd frontend && npm install && npm run build`
     - **Build output directory**: `frontend/dist`
     - **Root directory**: `/` (leave empty)

3. **Set Environment Variables in Pages:**
   - In Pages project settings → Environment variables
   - Add: `API_BASE_URL` = `https://your-api-worker-name.your-subdomain.workers.dev`

### 2.4 Test the Frontend

Visit your Pages URL: `https://your-frontend-name.pages.dev`

**Verify functionality:**
1. Create a test secret
2. Retrieve it using the generated link
3. Test the click-to-view functionality
4. Test the delete button

## Part 3: Custom Domain (Optional)

### 3.1 Worker Custom Domain

1. Go to Cloudflare Dashboard → Workers & Pages
2. Select your worker → Settings → Domains & Routes
3. Add custom domain: `api.yourdomain.com`

### 3.2 Pages Custom Domain

1. Go to Cloudflare Dashboard → Pages
2. Select your project → Custom domains
3. Add custom domain: `yourdomain.com`

### 3.3 Update CORS Configuration

After setting up custom domains, update your CORS origins:

```bash
npx wrangler secret put CORS_ORIGINS
# Enter: https://yourdomain.com,https://*.pages.dev
```

And update frontend environment:

```env
# frontend/.env
API_BASE_URL=https://api.yourdomain.com
```

Then rebuild and redeploy the frontend.

## Part 4: Advanced - Worker Routes (Same-Domain Deployment)

> **🚀 Advanced Option**: Deploy both frontend and API on the same domain using Worker Routes to eliminate CORS entirely.

### Overview

Instead of using separate domains for Pages and Workers, you can use **Cloudflare Worker Routes** to serve the API on the same domain as your Pages site. This approach:

- ✅ **Eliminates CORS completely** - no cross-origin requests
- ✅ **Simplifies configuration** - no CORS_ORIGINS needed
- ✅ **Better performance** - no preflight OPTIONS requests
- ✅ **Cleaner URLs** - `/api/create` instead of `https://api-worker.domain.com/api/create`

### Architecture with Worker Routes

```
Same Domain (yourdomain.com)
┌─────────────────────────────────────┐
│  Cloudflare Pages + Worker Routes   │
│                                     │
│  /              → Pages (Frontend)  │
│  /secret/*      → Pages (Frontend)  │
│  /api/*         → Worker (Backend)  │
│  /health        → Worker (Backend)  │
└─────────────────────────────────────┘
```

### 4.1 Prerequisites

- **Custom Domain**: You must have a custom domain added to Cloudflare
- **DNS Management**: Domain's nameservers must point to Cloudflare

### 4.2 Deploy Worker with Routes

1. **Update your `wrangler.toml`** to include route patterns:

```toml
name = "your-api-worker-name"
main = "src/worker.ts"
compatibility_date = "2024-01-01"

# Add route patterns for your domain
[[routes]]
pattern = "yourdomain.com/api/*"
zone_name = "yourdomain.com"

[[routes]]
pattern = "yourdomain.com/health"
zone_name = "yourdomain.com"

[env.production]
vars = { }

[[env.production.kv_namespaces]]
binding = "SECRETS"
id = "your-actual-kv-namespace-id"
preview_id = "your-preview-id"
```

2. **Deploy the worker with routes**:

```bash
npx wrangler deploy
```

### 4.3 Configure Frontend for Same-Domain

Update your frontend environment to use relative URLs:

```env
# frontend/.env
API_BASE_URL=
```

Or alternatively, use your domain:

```env
# frontend/.env  
API_BASE_URL=https://yourdomain.com
```

### 4.4 Simplify Worker Configuration

Since there's no cross-origin communication, you can simplify the worker:

1. **Remove CORS_ORIGINS requirement**:
```bash
# This is now optional since there are no cross-origin requests
npx wrangler secret put CORS_ORIGINS
# Enter: (leave empty or use for development domains only)
```

2. **Update Worker Code** (optional optimization):

In `src/worker.ts`, you can simplify the CORS handling:

```typescript
// For same-domain deployment, CORS headers are not needed
// But keeping them won't hurt for development flexibility
```

### 4.5 Deploy Pages to Custom Domain

1. **Add your domain to Pages**:
   - Go to Cloudflare Dashboard → Pages
   - Select your project → Custom domains  
   - Add: `yourdomain.com`

2. **Configure DNS** (if not already done):
   - Add CNAME record: `yourdomain.com` → `your-pages-site.pages.dev`
   - Or A record pointing to Cloudflare's IPs if using root domain

### 4.6 Build and Deploy Frontend

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name your-frontend-name
```

### 4.7 Test Same-Domain Deployment

Visit `https://yourdomain.com` and verify:

1. **Frontend loads** from Pages
2. **API calls work** to `/api/*` routes (served by Worker)
3. **No CORS errors** in browser console
4. **All functionality** works (create, retrieve, delete)

### Benefits of Worker Routes

| Aspect | Separate Domains | Worker Routes (Same Domain) |
|--------|-----------------|---------------------------|
| **CORS Setup** | Required, complex | Not needed |
| **Configuration** | 2 domains, CORS origins | 1 domain, simpler |
| **Performance** | Preflight requests | Direct requests |
| **URL Structure** | `api.domain.com/api/create` | `domain.com/api/create` |
| **SSL/DNS** | 2 certificates, 2 DNS records | 1 certificate, simpler DNS |

### Considerations

**Advantages:**
- Simpler configuration and maintenance
- Better performance (no CORS preflight)
- Cleaner URL structure
- Easier debugging (same-origin)

**Trade-offs:**
- Requires custom domain (can't use free `*.pages.dev`)
- Worker routes consume request quota
- Slightly more complex initial setup

### Migration from Cross-Origin Setup

If you're migrating from a cross-origin setup:

1. Set up Worker Routes as above
2. Update frontend `API_BASE_URL` to use same domain
3. Rebuild and redeploy frontend
4. Test thoroughly before removing old worker
5. Optionally simplify CORS configuration

## Environment Variables Reference

### Worker Environment Variables (Secrets)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `CSRF_SECRET` | ✅ | Random string for CSRF protection (32+ chars) | `a1b2c3d4e5f6...` |
| `CORS_ORIGINS` | ✅* | Comma-separated allowed origins | `https://*.pages.dev,https://yourdomain.com` |

> **\*** `CORS_ORIGINS` is required for cross-origin deployments but optional when using Worker Routes (same-domain)

### Frontend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `API_BASE_URL` | ✅ | Your deployed worker URL or empty for same-domain | `https://api.yourdomain.com` or `` |

## Troubleshooting

### Common Issues

**1. CORS Errors**
- Verify `CORS_ORIGINS` includes your Pages domain
- Check that origins include the protocol (`https://`)
- Wildcard format: `https://*.pages.dev` (not `*.pages.dev`)

**2. 401 CSRF Errors**
- Ensure `CSRF_SECRET` is set in worker
- Clear browser cache and try again
- Check browser console for detailed error messages

**3. 500 Internal Server Error**
- Check `npx wrangler tail` for real-time logs
- Verify KV namespace is properly bound
- Ensure environment variables are set

**4. Frontend Build Fails**
- Verify `API_BASE_URL` is set in `frontend/.env`
- Check that the URL doesn't end with a trailing slash
- Run `npm install` in frontend directory

**5. Worker Routes Not Working**
- Verify route patterns in `wrangler.toml` match your domain exactly
- Check that DNS is properly configured through Cloudflare
- Ensure the zone_name matches your Cloudflare zone
- Routes may take a few minutes to propagate globally

**6. Same-Domain Setup Issues**
- If using Worker Routes, ensure `API_BASE_URL` is empty or matches your domain
- Check that both Pages and Worker Routes are deployed to the same domain
- Verify no CORS errors appear (they shouldn't with same-domain)

### Monitoring and Logs

**Worker Logs:**
```bash
npx wrangler tail
```

**Check Worker Health:**
```bash
curl https://your-worker-url/api/health
```

**Debug API Calls:**
```bash
# Get CSRF token
curl -X GET https://your-worker-url/api/csrf-token

# Create secret (replace TOKEN with actual token)
curl -X POST https://your-worker-url/api/create \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: TOKEN" \
  -d '{"message":"test","maxViews":1,"expirationHours":24,"csrfToken":"TOKEN"}'
```

## Security Considerations

1. **CSRF Protection**: Always use the provided CSRF tokens
2. **Environment Variables**: Never commit secrets to git
3. **CORS Configuration**: Be specific with allowed origins in production
4. **KV Storage**: Secrets are automatically deleted after max views or expiration
5. **Encryption**: All secrets are encrypted client-side before transmission

## Production Checklist

- [ ] CSRF secret is cryptographically random (32+ characters)
- [ ] CORS origins are configured for your specific domains
- [ ] Custom domains are set up with proper DNS
- [ ] Environment variables are set in both Worker and Pages
- [ ] Test secret creation, retrieval, and deletion
- [ ] Monitor logs for any errors
- [ ] Set up monitoring/alerting for worker health

## Support

If you encounter issues:

1. Check the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
2. Check the [Cloudflare Pages documentation](https://developers.cloudflare.com/pages/)
3. Review error logs with `npx wrangler tail`
4. Open an issue in the repository with logs and configuration details