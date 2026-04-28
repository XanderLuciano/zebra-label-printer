// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: [
      'dist/**',
      'dist-zebra/**',
      'web/**',
      'web/.nuxt/**',
      'data/**',
      '**/node_modules/**'
    ]
  },

  // Stylistic rules matching shop-planr conventions
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      // Brace style: 1tbs
      '@stylistic/brace-style': ['error', '1tbs'],
      // No trailing commas
      '@stylistic/comma-dangle': ['error', 'never'],
      // Single quotes
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      // No semicolons
      '@stylistic/semi': ['error', 'never'],
      // 2-space indent
      '@stylistic/indent': ['error', 2],
      // No trailing spaces
      '@stylistic/no-trailing-spaces': 'error',
      // Consistent eol
      '@stylistic/eol-last': ['error', 'always'],
      // Arrow parens only when needed
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      // Curly braces on if/else/for/while
      curly: ['error', 'multi-line'],
      // Object shorthand
      'object-shorthand': 'error',
      // Prefer const
      'prefer-const': 'error',
      // No unused vars (warn, not error — TS handles type-level)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // No explicit any
      '@typescript-eslint/no-explicit-any': 'warn',
      // Consistent type imports
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }]
    }
  },

  // Relax some rules for test files
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
)
