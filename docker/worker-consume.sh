#!/bin/bash
set -uo pipefail
cd /var/www/html

echo "Starting messenger worker (email, hit, failed)..."
while true; do
    php bin/console messenger:consume email hit failed \
        --env=prod --no-debug \
        --time-limit=3600 --memory-limit=256M -vv
    code=$?
    echo "messenger:consume exited (code ${code}), restarting in 5s..."
    sleep 5
done
