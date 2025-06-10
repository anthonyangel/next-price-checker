// ESLint v9+ flat config for TypeScript
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];

// Note: The 'extends' key has been removed as it is not supported in ESLint v9+ flat config.
// If you need to use Prettier, import and spread the Prettier config directly.
// For more information, refer to the ESLint migration guide:
// https://eslint.org/docs/latest/use/configure/migration-guide#predefined-and-shareable-configs
// For now, we rely on Prettier via plugin or CLI.
