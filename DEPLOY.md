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

## Environment Variables Reference

### Worker Environment Variables (Secrets)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `CSRF_SECRET` | ✅ | Random string for CSRF protection (32+ chars) | `a1b2c3d4e5f6...` |
| `CORS_ORIGINS` | ✅ | Comma-separated allowed origins | `https://*.pages.dev,https://yourdomain.com` |

### Frontend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `API_BASE_URL` | ✅ | Your deployed worker URL | `https://api.yourdomain.com` |

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