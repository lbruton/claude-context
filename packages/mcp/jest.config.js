/** @type {import('jest').Config} */
export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: [],
    transform: {
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: 'tsconfig.test.json',
                useESM: false,
            },
        ],
    },
    moduleNameMapper: {
        // Map .js extensions to .ts for local imports (ESM -> CJS resolution)
        '^(\\.{1,2}/.*)\\.js$': '$1',
        // Mock the core package to avoid workspace resolution issues in tests
        '@lbruton/claude-context-core': '<rootDir>/src/__tests__/__mocks__/claude-context-core.ts',
    },
    testMatch: ['**/src/__tests__/**/*.test.ts'],
    clearMocks: true,
};