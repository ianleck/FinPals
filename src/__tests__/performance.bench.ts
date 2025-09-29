import { bench, describe } from 'vitest';
import { handleBalance } from '../commands/balance';
import { handleAdd } from '../commands/add';
import { mock, ctx } from './test-utils';

describe('Performance', () => {
  bench('balance calculation', async () => {
    const db = mock();
    db.limit.mockResolvedValue([]);
    db.where.mockResolvedValue([]);
    await handleBalance(ctx(), { HYPERDRIVE: { connectionString: '' } } as any);
  });

  bench('add expense', async () => {
    const c = ctx({ message: { text: '/add 100 test' } });
    const db = mock();
    db.limit.mockResolvedValue([]);
    db.returning.mockResolvedValue([{ id: 'e1' }]);
    await handleAdd(c, db);
  });

  bench('1000 mock operations', () => {
    const db = mock();
    for (let i = 0; i < 1000; i++) {
      db.select().from().where().limit();
    }
  });
});