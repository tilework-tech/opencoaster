import { occlusionOracleTest } from '../e2e/occlusion-oracle-runner';

/**
 * The CI regression gate for draw order: one fixed fuzzed park in four rotations, zoom 1 and 2,
 * both renderers, against the occlusion oracle (see e2e/occlusion-oracle.spec.ts for the full
 * matrix).
 */
occlusionOracleTest({ seeds: '1', zooms: '1,2' });
