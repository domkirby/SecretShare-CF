# Contributing to SecretShare

Thank you for your interest in contributing to SecretShare! 🎉 This project is open source and welcomes contributions from the community. Whether you're fixing a bug, adding a feature, improving documentation, or helping with testing, your contributions are valued.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Development Guidelines](#development-guidelines)
- [Security Considerations](#security-considerations)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Community & Support](#community--support)

## 📜 Code of Conduct

This project follows a simple principle: **Be respectful and constructive**. We welcome contributors of all skill levels and backgrounds. Please:

- Use welcoming and inclusive language
- Be respectful of different viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other community members

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have:

- [Node.js](https://nodejs.org/) (18+)
- [Git](https://git-scm.com/)
- A [Cloudflare account](https://cloudflare.com/) (free tier is sufficient)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed globally

### Quick Setup

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/SecretShare-CF.git
   cd SecretShare-CF
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up your development environment** (see [Development Setup](#development-setup))

## 🛠️ Development Setup

### 1. Cloudflare Configuration

1. **Authenticate with Cloudflare**:
   ```bash
   wrangler login
   ```

2. **Create development KV namespaces**:
   ```bash
   npm run kv:create
   npm run kv:create:preview
   ```

3. **Update `wrangler.toml`** with your namespace IDs:
   ```toml
   kv_namespaces = [
     { binding = "SECRETS_KV", preview_id = "your-preview-id", id = "your-dev-id" }
   ]
   ```

### 2. Environment Setup

1. **Generate CSRF secret**:
   ```bash
   # Windows PowerShell
   $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $bytes = New-Object byte[] 32
   $rng.GetBytes($bytes)
   [System.Convert]::ToHexString($bytes).ToLower()
   
   # macOS/Linux
   openssl rand -hex 32
   ```

2. **Set up local environment**:
   ```bash
   # Add to your shell profile or .env (if using one)
   export CSRF_SECRET="your-generated-secret"
   ```

### 3. Start Development

```bash
# Start the development server
npm run dev

# In another terminal, run type checking
npm run type-check
```

Your development environment will be available at `http://localhost:8787`

## 🤝 How to Contribute

### 🐛 Reporting Bugs

1. **Check existing issues** to avoid duplicates
2. **Use the issue template** (if available)
3. **Include details**:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser/environment information
   - Console errors (if any)

### 💡 Suggesting Features

1. **Check existing issues** and discussions
2. **Clearly describe the feature**:
   - What problem does it solve?
   - How would it work?
   - Any security implications?
   - Mockups or examples (if applicable)

### 📝 Improving Documentation

- Fix typos, unclear explanations, or outdated information
- Add examples or clarifications
- Improve setup instructions
- Translate documentation (if multilingual support is added)

### 🔧 Code Contributions

See [Development Guidelines](#development-guidelines) for detailed information.

## 📏 Development Guidelines

### Project Structure

```
SecretShare-CF/
├── src/
│   └── worker.ts          # Cloudflare Worker backend
├── public/
│   ├── index.html         # Main UI
│   ├── app.js            # Frontend logic
│   ├── crypto.js         # Encryption utilities
│   └── (static assets)
├── .github/
│   └── workflows/        # CI/CD pipelines
├── wrangler.toml         # Cloudflare configuration
└── (config files)
```

### Coding Standards

#### TypeScript/JavaScript

- **Use TypeScript** for Worker code (`src/`)
- **Use modern JavaScript** (ES2020+) for frontend
- **Follow consistent naming**:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and types
  - `UPPER_SNAKE_CASE` for constants
- **Add JSDoc comments** for public functions
- **Use meaningful variable names**

#### Frontend Guidelines

- **Vanilla JavaScript** - no frameworks required
- **Progressive Enhancement** - ensure basic functionality without JS
- **Responsive Design** - mobile-first approach
- **Accessibility** - proper ARIA labels, keyboard navigation
- **Performance** - minimize dependencies, optimize loading

#### Backend Guidelines

- **Cloudflare Workers** patterns
- **Type safety** - use proper TypeScript types
- **Error handling** - graceful degradation
- **Security first** - validate all inputs
- **Performance** - minimize compute time

### Security Considerations

⚠️ **Security is paramount** in this project. All contributions must consider:

#### Client-Side Security
- **Never send unencrypted data** to the server
- **Validate encryption** before transmission
- **Secure key generation** using WebCrypto API
- **Proper error handling** without leaking information

#### Server-Side Security
- **Input validation** on all endpoints
- **CSRF protection** via HMAC tokens
- **Rate limiting** considerations
- **No logging of sensitive data**

#### General Security
- **Dependencies** - keep updated, audit regularly
- **Configuration** - no secrets in code
- **Testing** - security-focused test cases

### Code Style

```typescript
// ✅ Good
interface SecretRequest {
  encryptedData: string;
  expiresAt: number;
  maxViews: number;
}

async function createSecret(request: SecretRequest): Promise<ApiResponse> {
  // Validate input
  if (!request.encryptedData || request.maxViews < 1) {
    return new Response('Invalid request', { status: 400 });
  }
  
  // Process request
  const secretId = await generateSecretId();
  // ...
}
```

```javascript
// ✅ Good frontend code
async function handleSecretCreation(formData) {
  try {
    showLoading(true);
    
    const encryptedData = await encryptSecret(formData.secret, formData.key);
    const response = await createSecret(encryptedData);
    
    if (response.success) {
      displaySecretUrl(response.url);
    } else {
      showError('Failed to create secret');
    }
  } catch (error) {
    showError('Encryption failed');
  } finally {
    showLoading(false);
  }
}
```

## 🧪 Testing

### Manual Testing

1. **Test secret creation** with different options:
   - Various expiration times
   - Different view limits
   - Password vs URL-key modes

2. **Test secret retrieval**:
   - Valid secrets
   - Expired secrets
   - Exceeded view limits
   - Invalid URLs

3. **Test error scenarios**:
   - Network failures
   - Invalid encryption keys
   - Malformed data

4. **Cross-browser testing**:
   - Chrome, Firefox, Safari, Edge
   - Mobile browsers
   - Different screen sizes

### Security Testing

- **Verify encryption** in browser dev tools
- **Check network requests** contain no plaintext
- **Test CSRF protection**
- **Validate error messages** don't leak information

### Performance Testing

```bash
# Test local development performance
npm run dev

# Monitor with Wrangler
npm run tail
```

## 📤 Submitting Changes

### Pull Request Process

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make your changes**:
   - Follow the coding guidelines
   - Add/update tests as needed
   - Update documentation

3. **Test thoroughly**:
   ```bash
   npm run type-check
   npm test  # if tests exist
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add password strength indicator"
   git commit -m "fix: resolve CSRF token validation issue"
   git commit -m "docs: update deployment instructions"
   ```

5. **Push and create PR**:
   ```bash
   git push origin feature/your-feature-name
   ```

### PR Guidelines

- **Clear title and description**
- **Reference related issues** (#123)
- **Include screenshots** for UI changes
- **List breaking changes** (if any)
- **Add testing notes** for reviewers

### Commit Message Convention

```
type(scope): description

Examples:
feat(ui): add dark mode toggle
fix(crypto): resolve key derivation issue
docs(readme): update installation steps
refactor(worker): simplify error handling
test(encryption): add key generation tests
```

## 👥 Community & Support

### Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and general discussion
- **Documentation**: Check existing docs first

### Development Discussion

- Share your ideas before implementing large features
- Ask questions about architecture decisions
- Discuss security implications early

## 🎯 Good First Issues

New contributors should look for issues labeled:
- `good first issue`
- `documentation`
- `help wanted`
- `ui/ux`

Common beginner-friendly contributions:
- Improving error messages
- Adding loading indicators
- Enhancing mobile responsiveness
- Writing/improving documentation
- Adding input validation
- Improving accessibility

## 📄 License

By contributing to SecretShare, you agree that your contributions will be licensed under the MIT License. This means:

- ✅ Your code can be used commercially
- ✅ Your code can be modified and distributed
- ✅ You retain copyright of your contributions
- ⚠️ You provide contributions "as-is" without warranty

## 🙏 Recognition

All contributors will be recognized in the project. Significant contributions may be highlighted in release notes.

---

**Thank you for contributing to SecretShare!** 🔐✨

Your efforts help make secure secret sharing accessible to everyone. Whether it's code, documentation, testing, or feedback, every contribution matters.

**Questions?** Don't hesitate to open an issue or start a discussion!