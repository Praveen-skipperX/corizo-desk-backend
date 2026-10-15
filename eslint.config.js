import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'uploads/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: Object.fromEntries([
      'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'URL', 'URLSearchParams', 'fetch', 'AbortController', 'AbortSignal',
    ].map((name) => [name, 'readonly'])) },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
];
