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

rsync -azP --delete app/ "$DEPLOY_PATH"
echo "Deploy complete!"
