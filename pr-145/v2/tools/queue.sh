#!/bin/bash
export PATH=$HOME/.local/bin:$PATH
OUT=/tmp/proof/out; LOG=/tmp/proof/run.log
MAIN=/home/sprite/org/workspace/oc-main; HEAD=/home/sprite/org/workspace/opencoaster
serve() {
  for p in $(pgrep -f "vite --host 127.0.0.1 --port 4173"); do kill $p 2>/dev/null; done
  sleep 3
  (cd $1 && nohup pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort > /tmp/proof/vite.log 2>&1 &)
  sleep 20
}
run() { # dir label kind backend mode export save
  cd $1
  echo "=== $(date +%T) $2 $3 $4 $5" >> $LOG
  PROOF_LABEL=$2 PROOF_OUT=$OUT PROOF_KIND=$3 PROOF_BACKEND=$4 PROOF_MODE=$5 PROOF_EXPORT=$6 PROOF_SAVE=$7 npx playwright test --config=playwright.e2e.config.ts e2e/proof-pr145.spec.ts >> $LOG 2>&1
  echo "--- exit $?" >> $LOG
}
: > $LOG
serve $MAIN
run $MAIN main steel WebGL2 build /tmp/proof/saves/main-steel.park
run $MAIN main wooden WebGL2 build /tmp/proof/saves/main-wooden.park
run $MAIN main steel Canvas2D build
serve $HEAD
run $HEAD head steel WebGL2 build
run $HEAD head wooden WebGL2 build
run $HEAD head steel Canvas2D build
run $HEAD head wooden Canvas2D build
run $HEAD headload steel WebGL2 load "" /tmp/proof/saves/main-steel.park
run $HEAD headload wooden WebGL2 load "" /tmp/proof/saves/main-wooden.park
run $HEAD headload steel Canvas2D load "" /tmp/proof/saves/main-steel.park
echo QUEUEDONE >> $LOG
