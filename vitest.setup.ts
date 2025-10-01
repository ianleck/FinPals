import { beforeEach, vi } from 'vitest';

// Mock logger globally to suppress stderr output during tests
vi.mock('./src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Global setup - runs once for all tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Note: Database mocks are handled per test file for flexibility
// This allows integration tests to use different mock strategies