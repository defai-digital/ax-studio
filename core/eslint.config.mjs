import tseslint from 'typescript-eslint'

export default tseslint.config({
  files: ['src/**/*.ts'],
  ignores: ['dist', 'coverage', 'src/**/*.test.ts', 'src/**/*.d.ts', 'src/test/**'],
  languageOptions: {
    ecmaVersion: 2020,
    parser: tseslint.parser,
    sourceType: 'module',
  },
  rules: {},
})
