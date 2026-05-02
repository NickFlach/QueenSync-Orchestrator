#!/usr/bin/env bash
# Dev orchestrator: starts a real NATS broker + fake HRM consumer alongside
# the api-server so Wave 4 (Memory Gate ↔ kannaka-memory bridge) can be
# exercised end-to-end in the Replit workspace. See `.local/tasks/task-27.md`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${REPO_ROOT}/.local/dev-logs"
mkdir -p "${LOG_DIR}"

NATS_HOST="${NATS_HOST:-127.0.0.1}"
NATS_PORT="${NATS_PORT:-4222}"
NATS_URL_DEFAULT="nats://${NATS_HOST}:${NATS_PORT}"
export NATS_URL="${NATS_URL:-${NATS_URL_DEFAULT}}"

NATS_LOG="${LOG_DIR}/nats-server.log"
HRM_LOG="${LOG_DIR}/fake-hrm.log"

NATS_PID=""
HRM_PID=""
API_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    kill "${API_PID}" 2>/dev/null || true
  fi
  if [[ -n "${HRM_PID}" ]] && kill -0 "${HRM_PID}" 2>/dev/null; then
    kill "${HRM_PID}" 2>/dev/null || true
  fi
  if [[ -n "${NATS_PID}" ]] && kill -0 "${NATS_PID}" 2>/dev/null; then
    kill "${NATS_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if ! command -v nats-server >/dev/null 2>&1; then
  echo "[dev-with-nats] ERROR: nats-server is not installed on PATH." >&2
  echo "  Install via the package-management skill: installSystemDependencies(['nats-server'])" >&2
  exit 1
fi

echo "[dev-with-nats] starting nats-server on ${NATS_HOST}:${NATS_PORT} (logs: ${NATS_LOG})"
nats-server --addr "${NATS_HOST}" --port "${NATS_PORT}" \
  >"${NATS_LOG}" 2>&1 &
NATS_PID=$!

# Wait for the broker to accept TCP connections (≤ 5s).
NATS_READY=0
for i in $(seq 1 50); do
  if (echo > "/dev/tcp/${NATS_HOST}/${NATS_PORT}") >/dev/null 2>&1; then
    NATS_READY=1
    echo "[dev-with-nats] nats-server is up (pid=${NATS_PID})"
    break
  fi
  if ! kill -0 "${NATS_PID}" 2>/dev/null; then
    echo "[dev-with-nats] ERROR: nats-server exited before accepting connections" >&2
    tail -n 40 "${NATS_LOG}" >&2 || true
    exit 1
  fi
  sleep 0.1
done
if [[ "${NATS_READY}" -ne 1 ]]; then
  echo "[dev-with-nats] ERROR: nats-server never accepted connections on ${NATS_HOST}:${NATS_PORT} within 5s" >&2
  tail -n 40 "${NATS_LOG}" >&2 || true
  exit 1
fi

echo "[dev-with-nats] starting fake kannaka-memory HRM (logs: ${HRM_LOG})"
(
  cd "${REPO_ROOT}"
  NATS_URL="${NATS_URL}" \
    pnpm --filter @workspace/scripts run --silent dev-fake-hrm \
    >"${HRM_LOG}" 2>&1
) &
HRM_PID=$!

echo "[dev-with-nats] starting api-server (NATS_URL=${NATS_URL})"
cd "${REPO_ROOT}"
NATS_URL="${NATS_URL}" pnpm --filter @workspace/api-server run dev &
API_PID=$!
# Supervise the api-server in the foreground (rather than `exec`-ing it) so
# the EXIT/INT/TERM trap can still tear down nats-server and fake-hrm when
# the api-server exits.
wait "${API_PID}"
EXIT_CODE=$?
API_PID=""
exit "${EXIT_CODE}"
