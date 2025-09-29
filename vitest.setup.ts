import { beforeEach, vi } from 'vitest';

// Global setup - runs once for all tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Note: Database mocks are handled per test file for flexibility
// This allows integration tests to use different mock strategies