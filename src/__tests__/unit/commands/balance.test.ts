import { test, expect, describe, vi } from 'vitest';
import { handleBalance } from '../../../commands/balance';
import { ctx, mock } from '../../test-utils';
import { Money } from '../../../utils/money';

describe('balance', () => {
  const env: any = { HYPERDRIVE: { connectionString: '' } };

  test('rejects private chat usage', async () => {
    const c = ctx({ chat: { id: 111111, type: 'private' } });

    await handleBalance(c, env);

    expect(c.reply).toHaveBeenCalledWith(
      expect.stringContaining('group chats')
    );
  });

  test('calculates net balance correctly', () => {
    const paid = new Money(100);
    const owe = new Money(30);
    const net = paid.subtract(owe);

    expect(net.toNumber()).toBe(70);
  });

  test('identifies creditors and debtors', () => {
    const creditor = new Money(50);
    const debtor = new Money(-50);

    expect(creditor.isPositive()).toBe(true);
    expect(debtor.isNegative()).toBe(true);
  });

  test('handles zero balance', () => {
    const balance = new Money(0);

    expect(balance.isZero()).toBe(true);
    expect(balance.isPositive()).toBe(false);
    expect(balance.isNegative()).toBe(false);
  });
});