#!/usr/bin/env bash
# Sovereign Sign installer (macOS / Linux).
# Copies the skill into ~/.claude/skills/ and writes a config.json
# pointing at this clone so the skill can find it later.

set -euo pipefail

PORT="${PORT:-3789}"
FORCE="${FORCE:-0}"
SKIP_DEPS="${SKIP_DEPS:-0}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port) PORT="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --skip-deps) SKIP_DEPS=1; shift ;;
        -h|--help)
            cat <<'EOF'
Usage: install.sh [--port N] [--force] [--skip-deps]
  --port N      port the dev server will use (default 3789)
  --force       overwrite an existing ~/.claude/skills/sovereign-sign
  --skip-deps   skip "npm install" (assume deps already present)
EOF
            exit 0
            ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="${REPO_ROOT}/.claude/skills/sovereign-sign"
CLAUDE_ROOT="${HOME}/.claude"
SKILL_DEST="${CLAUDE_ROOT}/skills/sovereign-sign"

echo "Sovereign Sign installer"
echo "  repo:  ${REPO_ROOT}"
echo "  skill: ${SKILL_DEST}"
echo "  port:  ${PORT}"

if [[ ! -d "${SKILL_SRC}" ]]; then
    echo "Skill source not found at ${SKILL_SRC}" >&2
    exit 1
fi

if [[ -d "${SKILL_DEST}" && "${FORCE}" != "1" ]]; then
    echo "Skill already installed. Re-run with --force to overwrite."
else
    rm -rf "${SKILL_DEST}"
    mkdir -p "${SKILL_DEST}"
fi

cp "${SKILL_SRC}/SKILL.md" "${SKILL_DEST}/SKILL.md"

cat > "${SKILL_DEST}/config.json" <<EOF
{
  "repoPath": "${REPO_ROOT}",
  "port": ${PORT},
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "Wrote ${SKILL_DEST}/config.json"

if [[ "${SKIP_DEPS}" != "1" ]]; then
    echo "Installing npm dependencies (this also copies the pdfjs worker)..."
    ( cd "${REPO_ROOT}" && npm install )
fi

cat <<EOF

Done.
  - Start the server manually:  npm run dev -- --port ${PORT}
  - Then in Claude Code:         /sovereign-sign
EOF
