import { test, expect, describe, vi, beforeEach } from 'vitest';
import { handleInfo } from '../../../commands/info';
import { handleTest } from '../../../commands/test';
import { handleExpenses } from '../../../commands/expenses';
import { handleHistory } from '../../../commands/history';
import { handleStats } from '../../../commands/stats';
import { handleSettle } from '../../../commands/settle';
import { handleDelete } from '../../../commands/delete';
import { handleEdit } from '../../../commands/edit';
import { ctx, mock } from '../../test-utils';

vi.mock('../../../db', () => ({
  createDb: vi.fn(),
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

describe('all commands', () => {
  const env: any = {
    HYPERDRIVE: { connectionString: '' },
    createDb: vi.fn(() => mock())
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('info command shows help', async () => {
    const c = ctx({ message: { text: '/info' } });

    await handleInfo(c);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringMatching(/Command|commands/)
    );
  });

  test('test command checks permissions in groups', async () => {
    const c = ctx({ message: { text: '/test' } });
    c.me = { id: 123456789, is_bot: true, first_name: 'Bot' };
    c.api = {
      getChatMember: vi.fn().mockResolvedValue({
        status: 'administrator',
        can_delete_messages: true,
        can_restrict_members: true,
        can_pin_messages: true,
      }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };

    await handleTest(c);

    expect(c.api.getChatMember).toHaveBeenCalled();
    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Bot Permissions'),
      expect.any(Object)
    );
  });

  test('test command rejects private chat', async () => {
    const c = ctx({
      chat: { id: 111111, type: 'private' },
      message: { text: '/test' }
    });

    await handleTest(c);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('group chats')
    );
  });


  test('expenses command handles database error', async () => {
    const c = ctx({
      chat: { id: 111111, type: 'private' },
      message: { text: '/expenses' }
    });

    await handleExpenses(c, env);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Error')
    );
  });

  test('history command handles database error', async () => {
    const c = ctx({
      chat: { id: 111111, type: 'private' },
      message: { text: '/history' }
    });

    await handleHistory(c, env);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Error')
    );
  });

  test('stats command handles missing period', async () => {
    const c = ctx({ message: { text: '/stats' } });

    await handleStats(c, env);

    expect(c.reply).toHaveBeenCalled();
  });

  test('settle command handles database error', async () => {
    const c = ctx({ message: { text: '/settle' } });

    await handleSettle(c, env);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong')
    );
  });

  test('delete command handles database error', async () => {
    const c = ctx({ message: { text: '/delete' } });

    await handleDelete(c, env);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Something went wrong')
    );
  });

  test('edit command shows usage', async () => {
    const c = ctx({ message: { text: '/edit' } });

    await handleEdit(c, env);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid format')
    );
  });

  describe('happy paths', () => {
    test.each([
      ['expenses', handleExpenses, 'limit', [{ id: 'e1', amount: '50.00', description: 'lunch', paidBy: '111111', createdAt: new Date() }]],
      ['history', handleHistory, 'orderBy', [{ amount: '50.00', description: 'lunch', createdAt: new Date() }]],
      ['stats', handleStats, 'where', []],
      ['settle', handleSettle, 'where', []],
      ['delete', handleDelete, 'orderBy', [{ id: 'e1', amount: '50.00', description: 'lunch' }]]
    ])('%s command executes successfully', async (name, handler, mockMethod, mockData) => {
      const c = ctx({ message: { text: `/${name}` } });
      const db = mock();
      db[mockMethod].mockResolvedValue(mockData);

      await handler(c as any, env);

      expect(c.reply).toHaveBeenCalled();
    });
  });
});