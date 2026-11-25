#!/usr/bin/env bash
# Build and publish dist/ to the gh-pages branch (GitHub Pages, free). Usage: bash scripts/deploy.sh
set -e
cd "$(dirname "$0")/.."
npm run build
cd dist
touch .nojekyll
git init -q -b gh-pages
git add -A
git commit -qm "deploy $(date -u +%FT%TZ)"
git push -q -f https://github.com/dixxxvhb/holler.git gh-pages
rm -rf .git
echo "pushed; live at https://dixxxvhb.github.io/holler/ in about a minute"
