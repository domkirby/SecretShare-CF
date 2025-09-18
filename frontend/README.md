# SecretShare Frontend

Static frontend for SecretShare application, designed for deployment on Cloudflare Pages.

## Configuration

### API Base URL

The frontend can be configured to point to different API endpoints using environment variables:

**Default**: `https://dkc-secretshare-api.dom-kirby-creative.workers.dev`

### For Cloudflare Pages Deployment

1. In Cloudflare Dashboard → Pages → Your Site → Settings → Environment Variables
2. Add: `API_BASE_URL` = `https://your-api-worker.your-domain.workers.dev`

### For Local Development

```bash
# Set environment variable and build
export API_BASE_URL="http://localhost:8787"
npm run build

# Or inline
API_BASE_URL="https://your-api.workers.dev" npm run build
```

### For Manual Deployment

```bash
# Build with custom API URL
API_BASE_URL="https://your-api-worker.workers.dev" npm run build

# Deploy the dist/ folder to your hosting provider
```

## Development

```bash
# Install dependencies (if any added later)
npm install

# Build the frontend
npm run build

# Serve locally for testing
npm run dev
```

## File Structure

- `index.html` - Main application page
- `app.js` - Main application logic
- `crypto.js` - Encryption/decryption utilities
- `_routes.json` - Cloudflare Pages routing configuration
- `build.js` - Build script for environment variable substitution
- `dist/` - Built files ready for deployment (created by build script)

## Deployment Options

1. **Cloudflare Pages** (Recommended)
   - Connect your Git repository
   - Set build command: `npm run build`
   - Set output directory: `dist`
   - Add `API_BASE_URL` environment variable in Pages settings

2. **Static Hosting**
   - Run `npm run build`
   - Upload contents of `dist/` folder to any static host

3. **CDN**
   - Build and deploy `dist/` contents to your preferred CDN