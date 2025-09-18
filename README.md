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

> **📋 For complete deployment instructions, see [DEPLOY.md](DEPLOY.md)**

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/SecretShare-CF.git
   cd SecretShare-CF
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd frontend && npm install && cd ..
   ```

3. **Set up development environment**
   ```bash
   # Copy example environment file
   cp wrangler.toml.template wrangler.toml
   # Edit wrangler.toml with your configuration
   ```

4. **Start development**
   ```bash
   # Start the worker in development mode
   npx wrangler dev
   
   # In another terminal, build and serve frontend
   cd frontend && npm run build && python -m http.server 8080
   ```

For production deployment with Cloudflare Pages + Workers, custom domains, and Git integration, see **[DEPLOY.md](DEPLOY.md)** for comprehensive instructions.

## ⚙️ Configuration

> **📋 For complete configuration and deployment setup, see [DEPLOY.md](DEPLOY.md)**

The application uses the split architecture with Cloudflare Workers (API) and Cloudflare Pages (frontend). Key configuration includes:

- **Worker Environment Variables**: CSRF secrets, CORS origins, KV namespace binding
- **Frontend Environment Variables**: API endpoint URL for cross-origin requests  
- **Build Process**: Environment variable substitution and static file generation

See [DEPLOY.md](DEPLOY.md) for step-by-step configuration instructions.

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

> **📋 For complete deployment instructions, see [DEPLOY.md](DEPLOY.md)**

SecretShare uses a split architecture with Cloudflare Workers (API backend) and Cloudflare Pages (static frontend). The deployment process involves:

1. **Deploy API Worker**: Configure KV namespace, set environment variables, deploy worker
2. **Build & Deploy Frontend**: Set API endpoint, build with environment substitution, deploy to Pages  
3. **Configure CORS**: Set up cross-origin communication between Pages and Workers
4. **Optional**: Custom domains and Git integration

**[DEPLOY.md](DEPLOY.md)** provides comprehensive step-by-step instructions for both testing and production deployments.

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

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/domkirby/secretshare-cf/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/domkirby/secretshare-cf/discussions)
- 📧 **Security Issues**: Please email security concerns privately

---

**⭐ Star this repo if you find it useful! ⭐**

[Live Demo](https://share.domk.pro) • [Documentation](https://github.com/domkirby/secretshare-cf/wiki)