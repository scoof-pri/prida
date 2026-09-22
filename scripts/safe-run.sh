#!/bin/bash
# Development tool. usage: scripts/safe-run.sh <script.mjs> <w> <h> <logfile> [timeout-seconds] [lines]
# (script path relative to scripts/; WD=<MB> sets the free-memory floor, default 1600)
# Runs the headless harness with a memory watchdog: Chromium (SwiftShader) is killed before the sandbox runs out
# of memory, and nothing is left running afterwards.
cd "$(dirname "$0")"
LOG=${4:-run.log}
setsid timeout -s KILL ${5:-420} node play-headless.mjs "$1" "$2" "$3" > "$LOG" 2>&1 &
PID=$!
rm -f "$LOG.wd"; min=99999
while kill -0 $PID 2>/dev/null; do
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  if [ "$avail" -lt ${WD:-1600} ]; then echo "WATCHDOG: killed browser at ${avail} MB available" >> "$LOG.wd"; pkill -9 -f "[h]eadless_shell"; fi
  [ "$avail" -lt "$min" ] && min=$avail
  sleep 1
done
pkill -9 -f "[h]eadless_shell" 2>/dev/null
echo "min available: $min MB" >> "$LOG.wd"; cat "$LOG.wd"
grep -v "INVALID_OPERATION\|deprecated\|KHR_parallel" "$LOG" | head -${6:-40}
