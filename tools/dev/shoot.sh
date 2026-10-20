#!/bin/bash
# usage: shoot.sh <url> <steps.mjs> <prefix> [w] [h]   — real-GPU Brave, retries when Vite reloads the page mid-run
cd "$(dirname "$0")"  # run from tools/dev; steps files live next to it
for attempt in 1 2 3 4; do
  out=$(BROWSER="C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe" GPU=1 timeout 170 node cdp.mjs "$1" "$2" "$3" "${4:-1280}" "${5:-760}" 2>&1)
  if echo "$out" | grep -q "Inspected target navigated"; then sleep 6; continue; fi
  echo "$out" | grep -vE "vite|^---|Shell"
  exit 0
done
echo "gave up after retries"; exit 1
