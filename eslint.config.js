// ESLint flat config (ESLint 9) — replaces the legacy .eslintrc.js.
//
// ESLint 9 only reads flat config (this file). We extend Expo's shared rule set
// (eslint-config-expo/flat, version-aligned to the installed SDK) and add the
// project's ignore globs. Run via `npx expo lint` or `npm run lint` (= eslint .).
//
// Prettier is intentionally NOT wired into ESLint here (it was in the old
// config but the packages were never installed, so `npm run lint` was broken).
// Run formatting separately if/when a Prettier setup is added.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      // Kept as a WARNING on purpose (not an error). Several screens use the
      // load-on-focus pattern — useFocusEffect(useCallback(loadX, [])) — and the
      // mount/animation effects depend on stable refs. Adding those to the dep
      // arrays would re-subscribe/reload on every render, so the omissions are
      // deliberate and were reviewed in the audit. Treat a NEW warning here as a
      // prompt to check the deps, not as an automatic bug.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'ios/**', // native prebuild output
      'android/**', // native prebuild output
      '.expo/**',
      '.wrangler/**', // wrangler dev build artifacts
      'dist/**', // expo export output
      'expo-env.d.ts',
    ],
  },
];
