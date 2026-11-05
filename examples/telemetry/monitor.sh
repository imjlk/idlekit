#!/usr/bin/env bash
# Retention drift monitor for a cron job or CI schedule.
# Runs locally on an exported cohort batch; nothing is uploaded.
#
#   COHORTS=exports/cohorts.csv SCENARIO=scenarios/live.json ./monitor.sh
#
# Exit status: 0 no drift, 2 drift (report written first), anything else is an input or tool error.
set -euo pipefail

COHORTS="${COHORTS:-examples/telemetry/cohorts.csv}"
SCENARIO="${SCENARIO:-examples/tutorials/11-my-game-v1.json}"
THRESHOLD_PP="${THRESHOLD_PP:-5}"
REPORT_DIR="${REPORT_DIR:-tmp/telemetry-monitor}"
IDK="${IDK:-idk}"

mkdir -p "$REPORT_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

# Reject a malformed export before comparing anything.
$IDK telemetry validate "$COHORTS" --format json --out "$REPORT_DIR/validate-$stamp.json"

set +e
$IDK telemetry drift "$COHORTS" --scenario "$SCENARIO" --threshold-pp "$THRESHOLD_PP" \
  --fail-on-drift --format md --out "$REPORT_DIR/drift-$stamp.md"
status=$?
set -e

case "$status" in
  0) echo "retention within threshold: $REPORT_DIR/drift-$stamp.md" ;;
  2)
    echo "retention drift detected: $REPORT_DIR/drift-$stamp.md" >&2
    # Hook point: post the report to your own alerting. Keep player rows out of the alert.
    ;;
  *) echo "drift check failed with status $status" >&2 ;;
esac
exit "$status"
