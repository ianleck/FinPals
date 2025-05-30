import { vi, beforeEach } from 'vitest';
import { createMockDB } from './mocks/database';
import { createMockDurableObjectNamespace } from './mocks/session';

// Mock crypto.randomUUID for consistent test IDs
Object.defineProperty(global.crypto, 'randomUUID', {
	value: vi.fn(() => 'test-uuid-' + Date.now()),
	writable: true,
});

// Mock console methods to reduce noise in tests
global.console = {
	...console,
	log: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
};

// Set up global environment
(global as any).Env = {
	BOT_TOKEN: 'test-token',
	TELEGRAM_BOT_API_SECRET_TOKEN: 'test-secret',
	ENV: 'test',
	DB: createMockDB(),
	SESSIONS: createMockDurableObjectNamespace(),
};

// Set up global test environment
beforeEach(() => {
	vi.clearAllMocks();
});