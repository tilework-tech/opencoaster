#!/bin/bash
true
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
  echo "=== $(date +%T) mainx $kind WebGL2 build (late export)" >> $LOG
  PROOF_EXPORT_WAIT=150 PROOF_LABEL=mainx PROOF_OUT=$OUT PROOF_KIND=$kind PROOF_BACKEND=WebGL2 PROOF_MODE=build PROOF_EXPORT=/tmp/proof/saves/stuck-$kind.park npx playwright test --config=playwright.e2e.config.ts e2e/proof-pr145.spec.ts >> $LOG 2>&1
  echo "--- exit $?" >> $LOG
done
serve $HEAD
cd $HEAD
for spec in "steel WebGL2" "wooden WebGL2" "steel Canvas2D"; do
  set -- $spec
  echo "=== $(date +%T) headload $1 $2 load (stuck saves)" >> $LOG
  PROOF_GUESTS=1 PROOF_LABEL=headload2 PROOF_OUT=$OUT PROOF_KIND=$1 PROOF_BACKEND=$2 PROOF_MODE=load PROOF_SAVE=/tmp/proof/saves/stuck-$1.park npx playwright test --config=playwright.e2e.config.ts e2e/proof-pr145.spec.ts >> $LOG 2>&1
  echo "--- exit $?" >> $LOG
done
echo QUEUE4DONE >> $LOG
