import { vi } from 'vitest';

// Mock crypto.randomUUID for consistent test IDs
global.crypto = {
	...global.crypto,
	randomUUID: vi.fn(() => 'test-uuid-' + Date.now()),
};

// Mock console methods to reduce noise in tests
global.console = {
	...console,
	log: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
};

// Set up global test environment
beforeEach(() => {
	vi.clearAllMocks();
});