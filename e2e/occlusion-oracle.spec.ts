import { occlusionOracleTest } from './occlusion-oracle-runner';

/** The full fuzzed-park matrix: three seeds, four rotations, zoom 1 and 2, both renderers. */
occlusionOracleTest({ seeds: '1,2,3', zooms: '1,2' });
