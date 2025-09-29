import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		pool: 'threads',
		poolOptions: {
			threads: { maxThreads: 4, minThreads: 2 }
		},
		setupFiles: ['./vitest.setup.ts'],
		testTimeout: 2000,
		hookTimeout: 500,
		isolate: true,
		allowOnly: false,
		reporters: process.env.CI ? ['dot'] : ['default'],
	},
});