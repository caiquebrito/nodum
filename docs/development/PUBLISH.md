# Publishing Nodum to npm

## Prerequisites

1. **npm Account**: Create one at https://www.npmjs.com if you don't have it
2. **GitHub Repository**: Already configured in package.json
3. **Node 16+**: You have this

## Step-by-Step Publishing

### Option A: Manual Publishing (Quick)

```bash
# 1. Login to npm
npm login
# Enter your npm username, password, and OTP (if 2FA enabled)

# 2. Build the project
npm run build

# 3. Publish
npm publish --access public
```

This publishes `@caiquebrito/nodum` to npm registry.

### Option B: Automated Publishing via GitHub Actions (Recommended)

#### 1. Create .npmrc in root
```bash
echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" > .npmrc
```

#### 2. Create GitHub Actions workflow
Create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

#### 3. Add NPM_TOKEN to GitHub Secrets
1. Go to your repo settings
2. Secrets → New repository secret
3. Name: `NPM_TOKEN`
4. Value: Your npm auth token from `npm token create --read-and-publish`

#### 4. Release & Publish
```bash
# Bump version in package.json
npm version minor

# Tag and push
git push origin main
git push origin --tags

# GitHub Actions will auto-publish!
```

## What Gets Published

The package includes:
- ✅ CLI executable: `@caiquebrito/nodum/bin/nodum.js`
- ✅ Core library: `@caiquebrito/nodum/dist/index.js`
- ✅ Server package: `@caiquebrito/nodum/packages/server`
- ✅ All dependencies and source maps

## Installation (After Publishing)

Users can then install:
```bash
npm install -g @caiquebrito/nodum
# or
npm install --save-dev @caiquebrito/nodum
```

## Testing Before Publishing

```bash
# Pack locally to test
npm pack

# Verify the tarball
tar -tzf caiquebrito-nodum-1.0.0.tgz | head -20

# Test in temp directory
mkdir /tmp/test-nodum
cd /tmp/test-nodum
npm install /path/to/caiquebrito-nodum-1.0.0.tgz
npx nodum status
```

## Next Steps

1. Choose Option A or B above
2. Verify the published package on https://www.npmjs.com/package/@caiquebrito/nodum
3. Proceed to MCP integration (see MCP.md)
