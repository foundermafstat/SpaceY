#!/usr/bin/env bash
set -Eeuo pipefail

echo "Legacy PM2 deployment is disabled." >&2
echo "Deploy only exact-SHA images from a signed release manifest via the blue/green runbook." >&2
exit 1
