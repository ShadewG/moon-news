#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/apps/moon-news"
BIN="$ROOT/.venv-ytdlp/bin/yt-dlp"
COOKIE_FILE="${MOON_YTDLP_COOKIES:-$ROOT/.secrets/youtube-cookies.txt}"
PROXY_POOL_RAW="${MOON_YTDLP_PROXY_POOL:-}"
MAX_PROXY_ATTEMPTS="${MOON_YTDLP_MAX_PROXY_ATTEMPTS:-4}"

TMP_COOKIE_FILE=""
TMP_STDOUT_FILE=""
TMP_STDERR_FILE=""

cleanup() {
  if [[ -n "$TMP_COOKIE_FILE" && -f "$TMP_COOKIE_FILE" ]]; then
    rm -f "$TMP_COOKIE_FILE"
  fi
  if [[ -n "$TMP_STDOUT_FILE" && -f "$TMP_STDOUT_FILE" ]]; then
    rm -f "$TMP_STDOUT_FILE"
  fi
  if [[ -n "$TMP_STDERR_FILE" && -f "$TMP_STDERR_FILE" ]]; then
    rm -f "$TMP_STDERR_FILE"
  fi
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

append_unique_proxy() {
  local candidate
  candidate="$(trim "$1")"
  if [[ -z "$candidate" ]]; then
    return
  fi
  local existing
  for existing in "${PROXY_CANDIDATES[@]:-}"; do
    if [[ "$existing" == "$candidate" ]]; then
      return
    fi
  done
  PROXY_CANDIDATES+=("$candidate")
}

is_retryable_ytdlp_error() {
  local haystack
  haystack="$(printf '%s\n%s' "${1:-}" "${2:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$haystack" == *"sign in to confirm you’re not a bot"* ]] && return 0
  [[ "$haystack" == *"sign in to confirm you're not a bot"* ]] && return 0
  [[ "$haystack" == *"requested format is not available"* ]] && return 0
  [[ "$haystack" == *"only images are available for download"* ]] && return 0
  [[ "$haystack" == *"challenge solving failed"* ]] && return 0
  [[ "$haystack" == *"http error 429"* ]] && return 0
  [[ "$haystack" == *"request blocked"* ]] && return 0
  return 1
}

trap cleanup EXIT

if [[ ! -x "$BIN" ]]; then
  echo "yt-dlp binary not found at $BIN" >&2
  exit 1
fi

ARGS=(--js-runtimes node)
PROXY_URL="${MOON_YTDLP_PROXY:-${ALL_PROXY:-${HTTPS_PROXY:-${HTTP_PROXY:-}}}}"
declare -a PROXY_CANDIDATES=()

if [[ -n "$PROXY_POOL_RAW" ]]; then
  IFS=',' read -r -a RAW_PROXIES <<< "$PROXY_POOL_RAW"
  for proxy in "${RAW_PROXIES[@]}"; do
    append_unique_proxy "$proxy"
  done
fi
append_unique_proxy "$PROXY_URL"

if [[ -f "$COOKIE_FILE" ]]; then
  COOKIE_ARG_FILE="$COOKIE_FILE"
  if [[ ! -w "$COOKIE_FILE" ]]; then
    TMP_COOKIE_FILE="$(mktemp)"
    cp "$COOKIE_FILE" "$TMP_COOKIE_FILE"
    chmod 600 "$TMP_COOKIE_FILE"
    COOKIE_ARG_FILE="$TMP_COOKIE_FILE"
  fi
  ARGS+=(--cookies "$COOKIE_ARG_FILE")
fi

if [[ "${#PROXY_CANDIDATES[@]}" -eq 0 ]]; then
  PROXY_CANDIDATES+=("")
fi

ATTEMPT_COUNT="${#PROXY_CANDIDATES[@]}"
if [[ "$MAX_PROXY_ATTEMPTS" =~ ^[0-9]+$ ]] && [[ "$MAX_PROXY_ATTEMPTS" -gt 0 ]] && [[ "$MAX_PROXY_ATTEMPTS" -lt "$ATTEMPT_COUNT" ]]; then
  ATTEMPT_COUNT="$MAX_PROXY_ATTEMPTS"
fi

LAST_EXIT_CODE=1
LAST_STDOUT=""
LAST_STDERR=""

for (( index=0; index<ATTEMPT_COUNT; index++ )); do
  proxy="${PROXY_CANDIDATES[$index]}"
  CMD=("$BIN" "${ARGS[@]}")
  if [[ -n "$proxy" ]]; then
    CMD+=(--proxy "$proxy")
  fi

  TMP_STDOUT_FILE="$(mktemp)"
  TMP_STDERR_FILE="$(mktemp)"

  if "${CMD[@]}" "$@" >"$TMP_STDOUT_FILE" 2>"$TMP_STDERR_FILE"; then
    cat "$TMP_STDOUT_FILE"
    cat "$TMP_STDERR_FILE" >&2
    exit 0
  fi

  LAST_EXIT_CODE=$?
  LAST_STDOUT="$(cat "$TMP_STDOUT_FILE" 2>/dev/null || true)"
  LAST_STDERR="$(cat "$TMP_STDERR_FILE" 2>/dev/null || true)"

  if ! is_retryable_ytdlp_error "$LAST_STDOUT" "$LAST_STDERR"; then
    printf '%s' "$LAST_STDOUT"
    printf '%s' "$LAST_STDERR" >&2
    exit "$LAST_EXIT_CODE"
  fi
done

printf '%s' "$LAST_STDOUT"
printf '%s' "$LAST_STDERR" >&2
exit "$LAST_EXIT_CODE"
