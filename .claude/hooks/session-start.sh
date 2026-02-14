#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/home/user/olympus-web}"

##
# 1. Install GitHub CLI (gh) — the official binary from GitHub
#    The npm 'gh' package at /opt/node22/bin/gh is NOT the real CLI.
#    We install to /usr/local/bin which takes precedence after removing the fake.
##
if ! /usr/local/bin/gh --version &>/dev/null 2>&1; then
  echo "Installing GitHub CLI..."
  GH_VERSION="2.67.0"
  GH_ARCHIVE="gh_${GH_VERSION}_linux_amd64.tar.gz"
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_ARCHIVE}" -o "/tmp/${GH_ARCHIVE}"
  tar -xzf "/tmp/${GH_ARCHIVE}" -C /tmp
  cp "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh
  rm -rf "/tmp/${GH_ARCHIVE}" "/tmp/gh_${GH_VERSION}_linux_amd64"
fi
# Remove the fake npm 'gh' if it shadows the real one
if [ -f /opt/node22/bin/gh ] && ! /opt/node22/bin/gh --version 2>&1 | grep -q "gh version"; then
  rm -f /opt/node22/bin/gh
fi
echo "GitHub CLI: $(/usr/local/bin/gh --version | head -1)"

##
# 2. Install Firebase CLI
##
if ! command -v firebase &>/dev/null; then
  echo "Installing Firebase CLI..."
  npm install -g firebase-tools
  echo "Firebase CLI installed: $(firebase --version)"
else
  echo "Firebase CLI already installed: $(firebase --version)"
fi

##
# 3. Install root project dependencies (eslint, prettier)
##
echo "Installing project dependencies..."
cd "$PROJECT_DIR"
npm install

##
# 4. Install scripts/ dependencies (firebase-admin, google-auth-library)
##
echo "Installing scripts dependencies..."
cd "$PROJECT_DIR/scripts"
npm install

echo "Session environment ready."
