# PR 147 proof: Swinging Ship as a rigid pendulum

before = main, after = PR head (8c651a1). Scenes built via the sim API and imported as saves (ride Running at chosen progress); 1280x800, default zoom, camera centred on the ship; WebGL2 (SwiftShader) and Canvas2D; rotations r0-r3. Each sheet is one rotation. Before: rest, 12 running frames, unloading. After: rest, 16 poses across the run (build-up, max angle each way, slowing, level stop), unloading.
Scripts: tools/.
