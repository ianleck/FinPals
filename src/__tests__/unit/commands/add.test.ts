import { test, expect, describe, vi, beforeEach } from 'vitest';
import { handleAdd } from '../../../commands/add';
import { mock, ctx, mockDbForAdd } from '../../test-utils';

vi.mock('../../../db', () => ({
  withRetry: vi.fn((fn) => fn()),
}));

vi.mock('../../../utils/message', () => ({
  replyAndCleanup: vi.fn(async (ctx, text) => {
    await ctx.reply(text);
  }),
}));

vi.mock('../../../utils/reply', () => ({
  reply: vi.fn(async (ctx, text) => {
    await ctx.reply(text);
  }),
}));

describe('add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validation', () => {
    test('rejects missing amount', async () => {
      const c = ctx({ message: { text: '/add' } });
      const db = mock();

      await handleAdd(c, db);

      expect(c.reply).toHaveBeenCalledWith(
        expect.stringContaining('Invalid format')
      );
    });

    test('rejects invalid amount', async () => {
      const c = ctx({ message: { text: '/add abc lunch' } });
      const db = mock();

      await handleAdd(c, db);

      expect(c.reply).toHaveBeenCalledWith(
        expect.stringContaining('valid number')
      );
    });

    test('rejects negative amount', async () => {
      const c = ctx({ message: { text: '/add -50 lunch' } });
      const db = mock();

      await handleAdd(c, db);

      expect(c.reply).toHaveBeenCalledWith(
        expect.stringContaining('valid number')
      );
    });

    test('rejects zero amount', async () => {
      const c = ctx({ message: { text: '/add 0 lunch' } });
      const db = mock();

      await handleAdd(c, db);

      expect(c.reply).toHaveBeenCalledWith(
        expect.stringContaining('valid number')
      );
    });
  });

  test('handles database errors gracefully', async () => {
    const c = ctx({ message: { text: '/add 50 test' } });
    const db = mockDbForAdd();
    db.limit.mockRejectedValue(new Error('DB error'));

    await handleAdd(c, db as any);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Error')
    );
  });

  describe('happy path', () => {
    test('creates personal expense successfully', async () => {
      const c = ctx({
        chat: { id: 111111, type: 'private' },
        message: { text: '/add 50 lunch' }
      });
      const db = mockDbForAdd();
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'e1' }]);

      await handleAdd(c, db as any);

      expect(db.insert).toHaveBeenCalled();
      expect(c.reply).toHaveBeenCalledWith(
        expect.stringContaining('$50.00'),
        expect.any(Object)
      );
    });

    test('creates group expense with even split', async () => {
      const c = ctx({
        chat: { id: -123456789, type: 'group' },
        message: { text: '/add 90 dinner' }
      });
      const db = mockDbForAdd();
      db.limit.mockResolvedValueOnce([{ telegramId: '111111' }])
        .mockResolvedValueOnce([{ telegramId: '-123456789' }])
        .mockResolvedValueOnce([{ groupId: '-123456789' }]);
      db.returning.mockResolvedValue([{ id: 'e1' }]);

      await handleAdd(c, db as any);

      expect(db.insert).toHaveBeenCalled();
      expect(c.reply).toHaveBeenCalled();
    });
  });
});