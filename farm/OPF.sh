#!/bin/sh
# Start OPF up to date on macOS or Linux. See scripts/launch.cjs.
cd "$(dirname "$0")" && exec node scripts/launch.cjs "$@"
