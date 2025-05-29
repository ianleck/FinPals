# FinPals Bot Tests

This directory contains comprehensive tests for the FinPals Telegram bot.

## Test Structure

```
__tests__/
├── commands/          # Unit tests for individual commands
│   ├── add.test.ts
│   ├── balance.test.ts
│   ├── budget.test.ts
│   └── settle.test.ts
├── utils/            # Unit tests for utility functions
│   ├── currency.test.ts
│   ├── message-cleanup.test.ts
│   └── smart-insights.test.ts
├── integration/      # Integration tests for full workflows
│   ├── expense-flow.test.ts
│   └── personal-expense-flow.test.ts
├── mocks/           # Mock utilities
│   ├── context.ts
│   └── database.ts
├── edge-cases.test.ts  # Edge cases and error scenarios
└── setup.ts         # Test environment setup
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage

# Run specific test file
npm test add.test.ts

# Run tests matching pattern
npm test -- --grep "personal"
```

## Test Categories

### Unit Tests

1. **Command Tests** - Test individual bot commands in isolation
   - Input validation
   - Success scenarios
   - Error handling
   - Edge cases

2. **Utility Tests** - Test helper functions
   - Currency formatting and conversion
   - Message cleanup
   - Smart insights generation

### Integration Tests

1. **Expense Flow** - Test complete expense tracking workflows
   - Add expense → Check balance → Settle → Verify
   - Multiple participants
   - Trip management

2. **Personal Expense Flow** - Test private chat features
   - Budget management
   - Personal expense tracking
   - Combined summaries

### Edge Cases

- Unicode and special characters
- Numeric edge cases (very large/small amounts)
- Concurrent operations
- Missing or invalid data
- Database errors
- Permission scenarios

## Writing New Tests

### Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCommand } from '../../commands/command';
import { createMockContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('Command name', () => {
  let db: D1Database;
  let mockPreparedStatement: any;

  beforeEach(() => {
    db = createMockDB();
    mockPreparedStatement = (db as any)._getMockStatement();
    vi.clearAllMocks();
  });

  it('should do something', async () => {
    // Arrange
    const ctx = createMockContext({
      message: { text: '/command args' }
    });
    
    // Mock database responses
    mockPreparedStatement.first.mockResolvedValueOnce({ /* data */ });
    
    // Act
    await handleCommand(ctx, db);
    
    // Assert
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('expected text'),
      expect.any(Object)
    );
  });
});
```

### Mock Utilities

1. **Context Mocks**
   - `createMockContext()` - Creates a group chat context
   - `createPrivateContext()` - Creates a private chat context

2. **Database Mocks**
   - `createMockDB()` - Creates a mock D1 database
   - Use `mockPreparedStatement` to mock query results

### Best Practices

1. **Isolation** - Each test should be independent
2. **Clear naming** - Describe what the test verifies
3. **Arrange-Act-Assert** - Structure tests clearly
4. **Mock external dependencies** - Database, API calls, etc.
5. **Test both success and failure cases**
6. **Use descriptive assertions**

## Coverage Goals

- Command handlers: 90%+ coverage
- Utility functions: 100% coverage
- Edge cases: Comprehensive
- Integration flows: Key user journeys

## CI/CD Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Before deployment

Failed tests will block deployment to production.