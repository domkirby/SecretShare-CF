# Deploy with GitHub Actions

This guide will help you set up automated deployment of the SecretShare application to Cloudflare Workers using GitHub Actions.

## Deployment Scenarios

This guide supports multiple deployment configurations based on your needs:

### 🚀 **Scenario 1: Production-Only Deployment (Recommended for most users)**
- **Use case**: Simple deployment, personal projects, small teams
- **Branches**: Only use `main` branch
- **Environments**: Production only
- **Complexity**: Low

### 🔄 **Scenario 2: Full CI/CD Pipeline with Staging**
- **Use case**: Team development, critical applications, testing required
- **Branches**: `main` (production) and `staging` (staging environment)
- **Environments**: Both staging and production
- **Complexity**: Medium

### ⚙️ **Scenario 3: Custom Workflow**
- **Use case**: Advanced users with specific requirements
- **Branches**: Any configuration
- **Environments**: Customized as needed
- **Complexity**: High (requires workflow modification)

## Choosing Your Deployment Strategy

### 🤔 **Which scenario should I choose?**

**Choose Production-Only (Scenario 1) if:**
- ✅ You're deploying for personal use
- ✅ You're a solo developer or small team
- ✅ You want the simplest setup possible
- ✅ You don't need to test changes before production
- ✅ You're comfortable with direct production deployments

**Choose Full CI/CD Pipeline (Scenario 2) if:**
- ✅ You're working with a team
- ✅ You need to test changes before production
- ✅ You want proper staging environment
- ✅ You're deploying critical applications
- ✅ You want to review changes via Pull Requests

### 🔄 **Can I switch between scenarios later?**

Yes! You can easily switch:

**From Production-Only → Full CI/CD:**
1. Add the staging secrets and variables
2. Create a `staging` branch
3. The workflow will automatically start using staging

**From Full CI/CD → Production-Only:**
1. Delete staging secrets and variables (optional)
2. Delete the `staging` branch (optional)
3. The workflow will automatically skip staging steps

---

## Prerequisites

Before setting up GitHub Actions deployment, ensure you have:

1. A Cloudflare account with Workers enabled
2. A GitHub account
3. Basic knowledge of Git and GitHub

## Step 1: Fork the Repository

1. Fork this repository (domkirby/secretshare-cf)
2. Click the **Fork** button in the top-right corner
3. Select your GitHub account as the destination
4. Wait for the fork to be created

> **Note**: You must fork the repository to set up your own GitHub Actions deployment. This ensures you have full control over the deployment pipeline and secrets.

## Step 2: Set Up Cloudflare API Credentials

### Get Your Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token**
3. Use the **Custom token** template
4. Configure the token with these permissions:
   - **Account** - `Cloudflare Workers:Edit`
   - **Zone** - `Zone Settings:Read`, `Zone:Read` (if using a custom domain)
   - **Zone Resources** - Include specific zones (if using custom domain)
5. Copy the generated API token (you won't see it again!)

### Get Your Account ID

1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select your account (if you have multiple)
3. In the right sidebar, copy your **Account ID**

## Step 3: Configure GitHub Secrets and Variables

The configuration depends on your chosen deployment scenario:

### 📋 **Required for ALL Scenarios**

1. Go to your forked repository on GitHub
2. Click **Settings** (in the repository, not your profile)
3. In the left sidebar, click **Secrets and variables** → **Actions**

#### Repository Secrets (Required)

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `CLOUDFLARE_API_TOKEN` | Your Cloudflare API token | Created in Step 2 above |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID | Found in Step 2 above |
| `KV_NAMESPACE_ID` | Production KV namespace ID | Cloudflare Dashboard → Workers & Pages → KV → Create namespace |
| `KV_NAMESPACE_PREVIEW_ID` | Preview KV namespace ID | Create a separate KV namespace for development/preview |
| `CSRF_SECRET_PRODUCTION` | CSRF secret for production | Generate with: `openssl rand -hex 32` |

#### Repository Variables (Required)

| Variable Name | Description | Example Value |
|---------------|-------------|---------------|
| `WORKER_NAME` | Base name for your worker | `my-secretshare` |
| `ALLOWED_ORIGINS` | Default allowed origins for CORS | `https://my-secretshare.workers.dev` |

> **Note**: `ALLOWED_ORIGINS` can include multiple comma-separated values for multiple domains, e.g., `https://domain1.com,https://domain2.com,https://subdomain.domain1.com`

### 🎯 **Additional for Production-Only (Scenario 1)**

#### Repository Variables (Optional but Recommended)

| Variable Name | Description | Example Value |
|---------------|-------------|---------------|
| `ALLOWED_ORIGINS_PROD` | Production-specific origins | `https://secretshare.mydomain.com` |

> **Note**: If `ALLOWED_ORIGINS_PROD` is not set, the workflow will fall back to using `ALLOWED_ORIGINS`. All origin variables support comma-separated values for multiple domains.

### 🔄 **Additional for Full CI/CD Pipeline (Scenario 2)**

#### Repository Secrets (Additional)

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `KV_NAMESPACE_STAGING_ID` | Staging KV namespace ID | Create a separate KV namespace for staging |
| `CSRF_SECRET_STAGING` | CSRF secret for staging | Generate with: `openssl rand -hex 32` |

#### Repository Variables (Additional)

| Variable Name | Description | Example Value |
|---------------|-------------|---------------|
| `ALLOWED_ORIGINS_STAGING` | Staging allowed origins | `https://secretshare-staging.mydomain.com` |

> **Important**: The staging deployment will only run if `KV_NAMESPACE_STAGING_ID` is set. If you don't want staging, simply don't set these staging-specific secrets and variables.
> 
> **Tip**: All `ALLOWED_ORIGINS` variables support comma-separated values for multiple domains, e.g., `https://staging.domain.com,https://test.domain.com`

### Creating KV Namespaces

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **KV**
2. Click **Create a namespace**
3. Create namespaces based on your scenario:

#### For All Scenarios:
- `{your-name}-secretshare-production` → use ID for `KV_NAMESPACE_ID`
- `{your-name}-secretshare-preview` → use ID for `KV_NAMESPACE_PREVIEW_ID`

#### Additional for Full CI/CD Pipeline (Scenario 2):
- `{your-name}-secretshare-staging` → use ID for `KV_NAMESPACE_STAGING_ID`

### Generating CSRF Secrets

CSRF secrets should be random 32-byte hex strings. Generate them using:

**On Windows (PowerShell):**
```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
[System.Convert]::ToHexString($bytes).ToLower()
```

**On macOS/Linux:**
```bash
openssl rand -hex 32
```

Generate separate secrets for production and staging environments (if using staging).

## Step 4: Understand Wrangler Configuration

The repository includes two configuration files:

### `wrangler.toml` (Local Development)
- **Purpose**: For local development and testing
- **Configuration**: Static values that you can customize for your development environment
- **Usage**: Edit this file with your own KV namespace IDs for local development

### `wrangler.toml.template` (GitHub Actions Template)
- **Purpose**: Template used by GitHub Actions to generate deployment configuration
- **Configuration**: Uses placeholder variables that get replaced during deployment
- **Usage**: Don't edit this file - it's used automatically by the workflow

### Dynamic Configuration Process

During GitHub Actions deployment:
1. The workflow generates a new `wrangler.toml` file from your GitHub secrets and variables
2. This ensures your sensitive data (like KV namespace IDs) stays secure
3. Each deployment gets the correct configuration for that environment

**Variables used in deployment:**
- `WORKER_NAME` → Worker names (dev, staging, prod)
- `CLOUDFLARE_ACCOUNT_ID` → Your Cloudflare account
- `KV_NAMESPACE_*` → Environment-specific KV namespaces
- `ALLOWED_ORIGINS_*` → Environment-specific CORS settings

> **Note**: This approach keeps secrets secure while making the repository fork-friendly. You never need to commit sensitive data to your repository.

## Step 5: Set Up GitHub Actions Workflow

The repository should already include a `.github/workflows/deploy.yml` file. If not, create it with this content:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        env:
          WORKER_NAME: ${{ vars.WORKER_NAME }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          KV_NAMESPACE_ID: ${{ secrets.KV_NAMESPACE_ID }}
          KV_NAMESPACE_PREVIEW_ID: ${{ secrets.KV_NAMESPACE_PREVIEW_ID }}
          KV_NAMESPACE_STAGING_ID: ${{ secrets.KV_NAMESPACE_STAGING_ID }}
          ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS }}
          ALLOWED_ORIGINS_PROD: ${{ vars.ALLOWED_ORIGINS_PROD }}
          ALLOWED_ORIGINS_STAGING: ${{ vars.ALLOWED_ORIGINS_STAGING }}
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

### Multi-Environment Deployment (Optional)

For more advanced deployments with staging/production environments:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [ main, staging ]
  pull_request:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Deploy to Staging
        if: github.ref == 'refs/heads/staging'
        uses: cloudflare/wrangler-action@v3
        env:
          WORKER_NAME: ${{ vars.WORKER_NAME }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          KV_NAMESPACE_ID: ${{ secrets.KV_NAMESPACE_STAGING_ID }}
          KV_NAMESPACE_PREVIEW_ID: ${{ secrets.KV_NAMESPACE_PREVIEW_ID }}
          ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS_STAGING }}
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env staging
        
      - name: Deploy to Production
        if: github.ref == 'refs/heads/main'
        uses: cloudflare/wrangler-action@v3
        env:
          WORKER_NAME: ${{ vars.WORKER_NAME }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          KV_NAMESPACE_ID: ${{ secrets.KV_NAMESPACE_ID }}
          KV_NAMESPACE_PREVIEW_ID: ${{ secrets.KV_NAMESPACE_PREVIEW_ID }}
          ALLOWED_ORIGINS: ${{ vars.ALLOWED_ORIGINS_PROD }}
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env production
```

## Step 6: Test the Deployment

### For Production-Only Deployment (Scenario 1)

1. Make a small change to your forked repository (e.g., update the README)
2. Commit and push the change to the `main` branch:
   ```bash
   git add .
   git commit -m "Test production deployment"
   git push origin main
   ```
3. Go to the **Actions** tab in your GitHub repository
4. Watch the deployment workflow run
5. The workflow will skip staging and deploy directly to production
6. If successful, your SecretShare app will be deployed to Cloudflare Workers

### For Full CI/CD Pipeline (Scenario 2)

#### Test Staging Deployment:
1. Create and push to a `staging` branch:
   ```bash
   git checkout -b staging
   git push origin staging
   ```
2. Or create a Pull Request against `main`
3. Watch the staging deployment in the Actions tab

#### Test Production Deployment:
1. Merge changes to the `main` branch
2. Watch the production deployment in the Actions tab

### Deployment Behavior Summary

| Trigger | Staging Configured | Staging Deployment | Production Deployment |
|---------|-------------------|-------------------|----------------------|
| Push to `main` | ✅ Yes | ❌ No | ✅ Yes |
| Push to `main` | ❌ No | ❌ No (skipped) | ✅ Yes |
| Push to `staging` | ✅ Yes | ✅ Yes | ❌ No |
| Push to `staging` | ❌ No | ❌ No (skipped) | ❌ No |
| Pull Request | ✅ Yes | ✅ Yes | ❌ No |
| Pull Request | ❌ No | ❌ No (skipped) | ❌ No |

## Step 7: Access Your Deployed Application

1. Go to your [Cloudflare Workers Dashboard](https://dash.cloudflare.com/?to=/:account/workers)
2. Find your deployed worker
3. Click on it to see the deployment details
4. Use the provided URL to access your SecretShare application

## Troubleshooting

### Common Issues

**Deployment fails with "Authentication error"**
- Verify your `CLOUDFLARE_API_TOKEN` is correct and has the right permissions
- Check that your `CLOUDFLARE_ACCOUNT_ID` matches your Cloudflare account

**Worker name conflicts**
- Change the `WORKER_NAME` variable in your GitHub repository settings
- Worker names must be globally unique across all Cloudflare accounts

**Missing KV namespaces**
- Ensure you've created the required KV namespaces in Cloudflare
- Verify the KV namespace IDs are correctly set in GitHub secrets
- For production-only setups, you only need `KV_NAMESPACE_ID` and `KV_NAMESPACE_PREVIEW_ID`

**Staging deployment skipped unexpectedly**
- Check if `KV_NAMESPACE_STAGING_ID` secret is set (required for staging)
- Verify you're pushing to `staging` branch or creating a Pull Request
- Staging is automatically skipped if staging secrets are not configured

**Environment variable substitution fails**
- Check that all required GitHub Variables and Secrets are set
- Verify the variable names match exactly (case-sensitive)
- Remember: staging variables are optional and will fall back to defaults if not set

**Workflow doesn't trigger**
- Ensure you're pushing to the `main` branch
- Check that the workflow file is in `.github/workflows/` directory
- Verify the YAML syntax is correct

### Getting Help

1. Check the GitHub Actions logs for detailed error messages
2. Review the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
3. Consult the [Wrangler CLI documentation](https://developers.cloudflare.com/workers/wrangler/)

## Quick Setup Checklist

### ✅ **Production-Only Setup Checklist**

**Required Secrets:**
- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID` 
- [ ] `KV_NAMESPACE_ID`
- [ ] `KV_NAMESPACE_PREVIEW_ID`
- [ ] `CSRF_SECRET_PRODUCTION`

**Required Variables:**
- [ ] `WORKER_NAME`
- [ ] `ALLOWED_ORIGINS`

**Optional Variables (with fallbacks):**
- [ ] `ALLOWED_ORIGINS_PROD` (falls back to `ALLOWED_ORIGINS`)

### ✅ **Full CI/CD Pipeline Setup Checklist**

**All Production-Only items above, PLUS:**

**Additional Secrets:**
- [ ] `KV_NAMESPACE_STAGING_ID`
- [ ] `CSRF_SECRET_STAGING`

**Additional Variables:**
- [ ] `ALLOWED_ORIGINS_STAGING` (falls back to `ALLOWED_ORIGINS`)

**Branches:**
- [ ] `main` branch exists
- [ ] `staging` branch exists (optional, can be created when needed)

---

## Security Notes

- **Never commit API tokens or secrets to your repository**
- Use GitHub repository secrets for all sensitive information
- Consider using environment-specific tokens for production deployments
- Regularly rotate your API tokens for security

## Next Steps

Once deployment is working:

1. Set up a custom domain (optional)
2. Configure environment-specific settings
3. Set up monitoring and alerts
4. Consider implementing staging deployments for testing

---

**Happy deploying!** 🚀 