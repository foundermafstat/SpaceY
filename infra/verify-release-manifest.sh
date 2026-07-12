#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  infra/verify-release-manifest.sh [--structure-only] <manifest.json> <full-git-sha> <owner/repo>

Default mode also requires authenticated gh, locally pulled digest references, and verifies:
  - the GitHub attestation for the manifest file;
  - provenance and SPDX attestations for all seven OCI digests;
  - org.opencontainers.image.revision on every locally pulled image.
USAGE
  exit 64
}

structure_only=false
if [[ "${1:-}" == "--structure-only" ]]; then
  structure_only=true
  shift
fi
[[ "$#" -eq 3 ]] || usage

manifest=$1
expected_sha=$2
repository=$3

[[ -f "$manifest" && -s "$manifest" ]] || { echo "Release manifest is missing or empty: $manifest" >&2; exit 1; }
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected SHA must be 40 lowercase hex characters." >&2; exit 1; }
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Repository must use owner/repo syntax." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

normalized_repository=$(printf '%s' "$repository" | tr '[:upper:]' '[:lower:]')
expected_prefix="ghcr.io/${normalized_repository}"

jq -e \
  --arg sha "$expected_sha" \
  --arg prefix "$expected_prefix" \
  '
    ["admin-api", "admin-web", "api", "battle-worker", "game-web", "jobs", "telegram-bot"] as $services
    | ["generatedAt", "gitSha", "imagePrefix", "images", "releaseWorkflowRunId", "schemaVersion", "sourceCiRunId"] as $manifestKeys
    | ["digest", "image", "provenance", "reference", "revision", "sbom", "service", "tag", "taggedReference"] as $imageKeys
    | select(type == "object")
    | select((keys | sort) == ($manifestKeys | sort))
    | select(.schemaVersion == 1 and .gitSha == $sha and .imagePrefix == $prefix)
    | select((.sourceCiRunId | type == "string" and test("^[1-9][0-9]*$")))
    | select((.releaseWorkflowRunId | type == "string" and test("^[1-9][0-9]*$")))
    | select((.generatedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")))
    | select(.images | type == "array" and length == 7)
    | select(([.images[].service] | sort) == $services)
    | select(all(.images[];
        . as $image
        | ($image | keys | sort) == ($imageKeys | sort)
        and $image.tag == $sha
        and $image.revision == $sha
        and $image.image == ($prefix + "/" + $image.service)
        and ($image.digest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
        and $image.taggedReference == ($image.image + ":" + $sha)
        and $image.reference == ($image.image + "@" + $image.digest)
        and $image.sbom == "signed GitHub SPDX attestation"
        and $image.provenance == "BuildKit max plus signed GitHub build provenance attestation"
      ))
  ' "$manifest" >/dev/null || {
    echo "Release manifest structure, repository, SHA, or image records are invalid." >&2
    exit 1
  }

if command -v sha256sum >/dev/null; then
  manifest_digest=$(sha256sum "$manifest" | awk '{print $1}')
else
  manifest_digest=$(shasum -a 256 "$manifest" | awk '{print $1}')
fi
printf 'Manifest structure OK: sha256:%s\n' "$manifest_digest"

if [[ "$structure_only" == true ]]; then
  exit 0
fi

for command in gh docker; do
  command -v "$command" >/dev/null || { echo "$command is required for attestation verification." >&2; exit 1; }
done

gh attestation verify "$manifest" --repo "$repository" >/dev/null

while IFS=$'\t' read -r service reference; do
  gh attestation verify "oci://${reference}" --repo "$repository" >/dev/null
  gh attestation verify "oci://${reference}" --repo "$repository" \
    --predicate-type https://spdx.dev/Document/v2.3 >/dev/null
  revision=$(docker image inspect \
    --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
    "$reference" 2>/dev/null) || {
      echo "Exact image is not locally available; pull it by digest before verification: $reference" >&2
      exit 1
    }
  [[ "$revision" == "$expected_sha" ]] || {
    echo "OCI revision mismatch for $service: expected $expected_sha, got ${revision:-<empty>}." >&2
    exit 1
  }
  printf 'Verified %s: %s\n' "$service" "$reference"
done < <(jq -r '.images[] | [.service, .reference] | @tsv' "$manifest")

printf 'Release manifest and all image attestations verified for %s at %s.\n' "$repository" "$expected_sha"
