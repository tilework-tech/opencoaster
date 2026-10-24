import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The simulation must be deterministic: no wall clock, no Math.random.
    files: ['src/sim/**/*.ts'],
    ignores: ['src/sim/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Prng in sim code.' },
        { object: 'performance', property: 'now', message: 'Sim code must not read the clock.' },
        { object: 'Date', property: 'now', message: 'Sim code must not read the clock.' },
      ],
    },
  },
);
