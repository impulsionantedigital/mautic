#!/bin/bash
set -euo pipefail

host="${MAUTIC_DB_HOST:?MAUTIC_DB_HOST is required}"
port="${MAUTIC_DB_PORT:-3306}"
timeout="${DB_WAIT_TIMEOUT:-60}"

echo "Waiting for database at ${host}:${port} (timeout: ${timeout}s)..."

elapsed=0
until php -r "exit(@fsockopen('${host}', ${port}) ? 0 : 1);" >/dev/null 2>&1; do
    elapsed=$((elapsed + 2))
    if [ "${elapsed}" -ge "${timeout}" ]; then
        echo "Timed out waiting for database at ${host}:${port}" >&2
        exit 1
    fi
    sleep 2
done

echo "Database is reachable."
