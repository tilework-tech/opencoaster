#!/bin/bash
while ! grep -q QUEUE4DONE /tmp/proof/run.log; do sleep 15; done
export PATH=$HOME/.local/bin:$PATH
OUT=/tmp/proof/out; LOG=/tmp/proof/run.log
MAIN=/home/sprite/org/workspace/oc-main; HEAD=/home/sprite/org/workspace/opencoaster
serve() {
  for p in $(pgrep -f "vite --host 127.0.0.1 --port 4173"); do kill $p 2>/dev/null; done
  sleep 3
  (cd $1 && nohup pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort > /tmp/proof/vite.log 2>&1 &)
  sleep 20
}
serve $MAIN
cd $MAIN
for kind in steel wooden; do
  echo "=== $(date +%T) mainc $kind WebGL2 build (clean overlay)" >> $LOG
  PROOF_GUESTS=1 PROOF_LABEL=mainc PROOF_OUT=$OUT PROOF_KIND=$kind PROOF_BACKEND=WebGL2 PROOF_MODE=build npx playwright test --config=playwright.e2e.config.ts e2e/proof-pr145.spec.ts >> $LOG 2>&1
  echo "--- exit $?" >> $LOG
done
serve $HEAD
cd $HEAD
for kind in steel wooden; do
  echo "=== $(date +%T) headc $kind WebGL2 build (clean overlay)" >> $LOG
  PROOF_GUESTS=1 PROOF_LABEL=headc PROOF_OUT=$OUT PROOF_KIND=$kind PROOF_BACKEND=WebGL2 PROOF_MODE=build npx playwright test --config=playwright.e2e.config.ts e2e/proof-pr145.spec.ts >> $LOG 2>&1
  echo "--- exit $?" >> $LOG
done
echo QUEUE5DONE >> $LOG
