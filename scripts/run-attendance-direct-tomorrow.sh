#!/bin/sh
set -eu
set -a
. /root/clinyco_AI/.env
set +a
exec /usr/bin/node /root/clinyco_AI/scripts/attendance-direct-tomorrow.mjs
