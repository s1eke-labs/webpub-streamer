import { base } from 'eslint-config-ali';

export default [
  ...base,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.eslintcache',
    ],
  },
];
