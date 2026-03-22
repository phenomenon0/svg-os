#!/usr/bin/env bash
# Deploy SVG OS demos to femiadeniran.com/svg-os/
set -euo pipefail

SSH="ssh -i ~/.ssh/hetzner root@46.62.210.42"
REMOTE="/var/www/femiadeniran.com/svg-os"
RSYNC_OPTS="-avz -e 'ssh -i ~/.ssh/hetzner'"

echo "==> Creating remote directory structure..."
$SSH "mkdir -p $REMOTE/{editor,studio}"

echo "==> Deploying demo pages (landing + architecture + cards)..."
# Demo dist goes to the root — landing page and demo pages live together
eval rsync $RSYNC_OPTS --delete packages/demo/dist/ root@46.62.210.42:$REMOTE/

echo "==> Deploying editor..."
eval rsync $RSYNC_OPTS --delete packages/editor/dist/ root@46.62.210.42:$REMOTE/editor/

echo "==> Deploying studio..."
eval rsync $RSYNC_OPTS --delete packages/studio/dist/ root@46.62.210.42:$REMOTE/studio/

echo "==> Done! Deployed to https://femiadeniran.com/svg-os/"
echo "    Landing:       https://femiadeniran.com/svg-os/"
echo "    Architecture:  https://femiadeniran.com/svg-os/architecture.html"
echo "    Cards:         https://femiadeniran.com/svg-os/cards.html"
echo "    Editor:        https://femiadeniran.com/svg-os/editor/"
echo "    Studio:        https://femiadeniran.com/svg-os/studio/"
