# SecretShare

🔐 **Secure temporary secret sharing powered by Cloudflare Workers**

A modern, zero-knowledge secret sharing application that allows you to securely share sensitive information through temporary encrypted links. Built with client-side encryption, automatic expiration, and view limits.

## ✨ Features

- **🔒 Client-Side Encryption**: All encryption happens in your browser using WebCrypto API (AES-GCM-256)
- **⏰ Automatic Expiration**: Secrets automatically delete after specified time (1 hour to 30 days)
- **👀 View Limits**: Control how many times a secret can be accessed (1-100 views)
- **🔑 Dual Access Methods**: URL-based keys or password protection with PBKDF2
- **🌐 Zero-Knowledge**: Server never sees your unencrypted data
- **🚀 Serverless**: Powered by Cloudflare Workers for global performance
- **📱 Responsive**: Works seamlessly on desktop and mobile
- **🌙 Dark Mode**: Automatic dark/light theme switching
- **🔄 Real-time Status**: Loading states and progress indicators
- **📋 One-Click Copy**: Easy sharing with clipboard integration

## 🛡️ Security Features

- **Double Protection**: URL fragment keys never reach the server + password options
- **CSRF Protection**: HMAC-signed tokens prevent cross-site attacks  
- **Database Security**: Secret IDs are SHA-256 hashed before storage
- **Base64URL Encoding**: URL-safe secret identifiers
- **Automatic Cleanup**: TTL-based deletion at infrastructure level
- **No Persistent Storage**: Secrets are permanently deleted after expiration/views

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (18+)
- [Cloudflare Account](https://cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/secretshare-workers.git
   cd secretshare-workers
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create KV namespaces**
   ```bash
   # Create production namespace
   npm run kv:create
   # Create preview namespace for development
   npm run kv:create:preview
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

5. **Update wrangler.toml**
   - Add your KV namespace IDs from step 3
   - Configure your domain settings

6. **Deploy**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm run deploy
   ```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with these values:

```bash
# Cloudflare API Token (for deployment)
CLOUDFLARE_API_TOKEN=your_api_token_here

# CSRF Secret (minimum 32 characters)
CSRF_SECRET=your_super_secret_csrf_key_here_32plus_chars

# KV Namespace IDs (from wrangler kv:namespace create)
PRODUCTION_KV_ID=your_production_kv_namespace_id
STAGING_KV_ID=your_staging_kv_namespace_id
PREVIEW_KV_ID=your_preview_kv_namespace_id
```

### Wrangler Configuration

Update `wrangler.toml` with your namespace IDs:

```toml
kv_namespaces = [
  { binding = "SECRETS_KV", preview_id = "YOUR_PREVIEW_ID", id = "YOUR_PRODUCTION_ID" }
]
```

## 🏗️ Architecture

```
Browser                 Cloudflare Workers              Cloudflare KV
┌─────────────┐        ┌─────────────────┐             ┌──────────────┐
│ 1. Encrypt  │──────▶ │ 2. Store        │───────────▶ │ 3. Encrypted │
│    Secret   │        │    Encrypted    │             │    Storage   │
│    (AES)    │        │    Blob + TTL   │             │              │
└─────────────┘        └─────────────────┘             └──────────────┘
       ▲                        │                              │
       │                        ▼                              │
┌─────────────┐        ┌─────────────────┐             ┌──────────────┐
│ 6. Decrypt  │◀────── │ 5. Retrieve     │◀────────────│ 4. Auto      │
│    Secret   │        │    Encrypted    │             │    Expire    │
│    (AES)    │        │    Blob         │             │              │
└─────────────┘        └─────────────────┘             └──────────────┘
```

### Security Model

1. **Client-Side Encryption**: Secrets encrypted in browser before transmission
2. **Hashed Storage**: Secret IDs are SHA-256 hashed for database storage
3. **TTL Expiration**: Cloudflare KV automatically deletes expired secrets
4. **View Counting**: Manual deletion after maximum views reached
5. **CSRF Protection**: HMAC tokens prevent unauthorized access

## 📚 API Reference

### Create Secret
```
POST /api/create
Content-Type: application/json

{
  "encryptedData": "base64-encoded-encrypted-secret",
  "maxViews": 5,
  "expirationHours": 24,
  "csrfToken": "hmac-signed-token"
}
```

### Retrieve Secret
```
POST /api/retrieve
Content-Type: application/json

{
  "secretId": "base64url-secret-identifier", 
  "csrfToken": "hmac-signed-token"
}
```

### Get CSRF Token
```
GET /api/csrf-token
```

## 🚀 Deployment

### Manual Deployment

```bash
# Deploy to production
npm run deploy:production

# Deploy to staging  
npm run deploy:staging
```

### GitHub Actions

The project includes automated deployment via GitHub Actions:

1. **Set Repository Secrets**:
   - `CLOUDFLARE_API_TOKEN`
   - `CSRF_SECRET_PRODUCTION` 
   - `CSRF_SECRET_STAGING`

2. **Automatic Deployment**:
   - Push to `main` → deploys to production
   - Open PR → deploys to staging

## 🔧 Development

```bash
# Start development server
npm run dev

# Type checking
npm run type-check

# View Worker logs
npm run tail
```

## 📖 Usage Examples

### Creating a Secret

1. Visit your deployed application
2. Enter your secret message
3. Configure expiration and view limits
4. Choose URL key or password protection
5. Click "Create Secret Link"
6. Share the generated URL

### Accessing a Secret

1. Open the shared URL
2. If password-protected, enter the password
3. View the decrypted secret
4. Secret is deleted after max views or expiration

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Add tests if applicable
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Code Style

- Use TypeScript for Worker code
- Follow existing code formatting
- Add JSDoc comments for public functions
- Ensure type safety

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Cloudflare Workers](https://workers.cloudflare.com/) - Serverless compute platform
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) - Browser cryptography
- Inspired by services like [OneTimeSecret](https://onetimesecret.com/) and [PrivateBin](https://privatebin.info/)

## ⚠️ Security Notice

This application is designed for sharing sensitive information securely. However:

- **Use HTTPS**: Never deploy without SSL/TLS
- **Trust Model**: You must trust the server operator not to modify the client-side code
- **Browser Security**: Ensure your browser is up-to-date
- **Network Security**: Avoid public WiFi for sensitive secrets

For maximum security with highly sensitive data, consider running your own instance.

## 📞 Support

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/yourusername/secretshare-workers/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/yourusername/secretshare-workers/discussions)
- 📧 **Security Issues**: Please email security concerns privately

---

**⭐ Star this repo if you find it useful! ⭐**

[Live Demo](https://share.domk.pro) • [Documentation](https://github.com/yourusername/secretshare-workers/wiki)