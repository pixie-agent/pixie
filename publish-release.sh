#!/bin/bash

# Script to publish GitHub Release from draft to published
# Usage: ./publish-release.sh <tag-name> <github-token>

TAG_NAME="app-v0.8.1"
GITHUB_TOKEN="$1"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GitHub token is required"
    echo "Usage: ./publish-release.sh <github-token>"
    echo ""
    echo "To create a GitHub token:"
    echo "1. Go to https://github.com/settings/tokens"
    echo "2. Generate a new token with 'repo' scope"
    echo "3. Run this script with the token"
    exit 1
fi

echo "Publishing release for tag: $TAG_NAME"

# Get the release ID for the draft release
RELEASE_INFO=$(curl -s \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/white1or1black/pixie/releases/tags/$TAG_NAME")

RELEASE_ID=$(echo "$RELEASE_INFO" | grep -o '"id": [0-9]*' | head -1 | grep -o '[0-9]*')

if [ -z "$RELEASE_ID" ]; then
    echo "Error: Could not find release for tag $TAG_NAME"
    echo "Please check if the release exists on GitHub"
    exit 1
fi

echo "Found release ID: $RELEASE_ID"

# Update the release from draft to published
curl -s \
  -X PATCH \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/white1or1black/pixie/releases/$RELEASE_ID" \
  -d '{"draft": false, "prerelease": false}'

echo ""
echo "Release $TAG_NAME has been published!"
echo "Visit: https://github.com/white1or1black/pixie/releases/tag/$TAG_NAME"