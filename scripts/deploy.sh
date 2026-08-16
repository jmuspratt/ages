#!/bin/bash
set -e

# Load environment variables
if [ -f .env ]; then
  source .env
fi

if [ -z "$DEPLOY_PATH" ]; then
  echo "Error: DEPLOY_PATH is not set"
  echo "Set it in .env file: DEPLOY_PATH=user@server:/path/to/web/root"
  exit 1
fi

echo "Source: app/"
echo "Destination: $DEPLOY_PATH"
echo "This will DELETE files in the destination that don't exist in source!"
read -p "Are you sure? (type 'yes' to continue): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

# Bump SW cache version to current timestamp so installed PWAs pick up changes
STAMP=$(date +%Y%m%d%H%M%S)
sed -i '' "s/const CACHE = ['\"]people-dates-[^'\"]*['\"]/const CACHE = 'people-dates-${STAMP}'/" app/sw.js
echo "SW cache version: people-dates-${STAMP}"

# Sync the version shown in Manage with package.json. app/ ships without
# package.json, so the constant in app.js is the only copy that reaches the
# device — bumping package.json alone is enough, this propagates it.
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
if [ -z "$VERSION" ]; then
  echo "Error: could not read version from package.json"
  exit 1
fi
sed -i '' "s/const VERSION = \"[^\"]*\"/const VERSION = \"${VERSION}\"/" app/app.js
echo "App version: ${VERSION}"

rsync -azP --delete app/ "$DEPLOY_PATH"
echo "Deploy complete!"
