import { vi } from 'vitest';

// Create a chainable mock database object
export const createMockDb = () => {
  const db: any = {};

  const methods = [
    'select', 'from', 'where', 'limit', 'orderBy',
    'leftJoin', 'innerJoin', 'groupBy',
    'insert', 'values', 'update', 'set', 'delete', 'returning'
  ];

  methods.forEach(method => {
    db[method] = vi.fn().mockReturnValue(db);
  });

  db.then = undefined;

  return db;
};

// Shorthand for convenience
export const mock = createMockDb;

// Create a mock Telegram context
export const createContext = (overrides: any = {}) => {
  const defaults = {
    from: { id: 111111, first_name: 'Alice', username: 'alice' },
    chat: { id: -123456789, type: 'group' as const },
    message: { text: '/', message_id: 1 },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    api: {
      deleteMessage: vi.fn().mockResolvedValue(true),
      getChatMember: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };

  return {
    ...defaults,
    ...overrides,
    from: overrides.from || defaults.from,
    chat: overrides.chat || defaults.chat,
    message: overrides.message || defaults.message,
    callbackQuery: overrides.callbackQuery,
    me: overrides.me,
    api: { ...defaults.api, ...overrides.api },
  };
};

// Shorthand for convenience
export const ctx = createContext;

// Test data factories
export const testData = {
  user: (id = '111111', name = 'Alice') => ({
    telegramId: id,
    firstName: name,
    userId: id,
    users: { telegramId: id, firstName: name }
  }),

  expense: (amount = '100.00', overrides: any = {}) => ({
    id: 'e1',
    amount,
    description: 'test expense',
    createdBy: '111111',
    paidBy: '111111',
    category: 'Other',
    currency: 'USD',
    deleted: false,
    createdAt: new Date(),
    ...overrides
  }),

  group: (overrides: any = {}) => ({
    telegramId: '-123456789',
    name: 'Test Group',
    defaultCurrency: 'USD',
    createdAt: new Date(),
    ...overrides
  }),

  split: (userId: string, share: string) => ({
    userId,
    share,
    telegramId: userId
  }),

  settlement: (from = '222222', to = '111111', amount = '50.00') => ({
    id: 's1',
    fromUserId: from,
    toUserId: to,
    amount,
    status: 'pending',
    createdAt: new Date()
  })
};

// Shorthand for convenience
export const $ = testData;

// Mock expense database for integration tests
export const createMockExpenseDb = () => {
  const expenses = new Map();
  const splits = new Map();

  return {
    addExpense: (expense: any) => {
      const id = Math.random().toString(36).substr(2, 9);
      expenses.set(id, { ...expense, id });
      return id;
    },
    addSplits: (expenseId: string, expenseSplits: any[]) => {
      splits.set(expenseId, expenseSplits);
    },
    getExpense: (id: string) => expenses.get(id),
    getSplits: (expenseId: string) => splits.get(expenseId) || [],
    updateExpense: (id: string, updates: any) => {
      const expense = expenses.get(id);
      if (expense) {
        expenses.set(id, { ...expense, ...updates });
      }
    },
    deleteExpense: (id: string) => {
      expenses.delete(id);
      splits.delete(id);
    }
  };
};

// Helper to setup DB mock for add command tests
export const mockDbForAdd = () => {
  const db = mock();
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  return db;
};