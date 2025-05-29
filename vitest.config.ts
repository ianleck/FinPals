import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'miniflare',
		setupFiles: ['./src/__tests__/setup.ts'],
		environmentOptions: {
			bindings: {
				BOT_TOKEN: 'test-token',
				TELEGRAM_BOT_API_SECRET_TOKEN: 'test-secret',
				ENV: 'test',
			},
			kvNamespaces: ['SESSIONS'],
			d1Databases: ['DB'],
		},
	},
});