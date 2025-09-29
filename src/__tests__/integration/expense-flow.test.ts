import { test, expect, describe } from 'vitest';
import { Money, sumMoney, formatMoney } from '../../utils/money';
import { createMockExpenseDb } from '../test-utils';

describe('Money Operations Integration', () => {
  describe('Split Calculations', () => {
    test('splits amount evenly among participants', () => {
      const total = new Money(90);
      const splits = total.splitEvenly(3);

      expect(splits).toHaveLength(3);
      splits.forEach(split => {
        expect(split.toNumber()).toBe(30);
      });

      const sum = sumMoney(splits);
      expect(sum.toNumber()).toBe(90);
    });

    test('handles remainder correctly when splitting unevenly', () => {
      const total = new Money(100);
      const splits = total.splitEvenly(3);

      expect(splits).toHaveLength(3);
      expect(splits[0].toNumber()).toBe(33.34);
      expect(splits[1].toNumber()).toBe(33.33);
      expect(splits[2].toNumber()).toBe(33.33);

      const sum = sumMoney(splits);
      expect(sum.toNumber()).toBe(100);
    });

    test('handles small amounts with many participants', () => {
      const total = new Money(1);
      const splits = total.splitEvenly(7);

      expect(splits).toHaveLength(7);
      expect(splits[0].toNumber()).toBe(0.15);
      expect(splits[6].toNumber()).toBe(0.14);

      const sum = sumMoney(splits);
      expect(sum.toNumber()).toBe(1);
    });
  });

  describe('Currency Operations', () => {
    test('formats money with correct currency symbol', () => {
      const amount = new Money(1234.56);

      expect(formatMoney(amount, 'USD')).toMatch(/\$[\s\u00A0]?1,234\.56/);
      expect(formatMoney(amount, 'EUR')).toMatch(/€[\s\u00A0]?1,234\.56/);
      expect(formatMoney(amount, 'SGD')).toMatch(/SGD[\s\u00A0]1,234\.56/);
    });

    test('handles zero and negative amounts', () => {
      const zero = new Money(0);
      const negative = new Money(-50);

      expect(zero.isZero()).toBe(true);
      expect(negative.isNegative()).toBe(true);
      expect(negative.abs().toNumber()).toBe(50);
    });
  });
});

describe('Debt Simplification Algorithm', () => {
  test('simplifies circular debts', () => {
    // A owes B $30, B owes C $20, C owes A $10
    const debts = [
      { from: 'A', to: 'B', amount: new Money(30) },
      { from: 'B', to: 'C', amount: new Money(20) },
      { from: 'C', to: 'A', amount: new Money(10) }
    ];

    const balances = new Map<string, Money>();

    for (const debt of debts) {
      const fromBalance = balances.get(debt.from) || new Money(0);
      const toBalance = balances.get(debt.to) || new Money(0);

      balances.set(debt.from, fromBalance.subtract(debt.amount));
      balances.set(debt.to, toBalance.add(debt.amount));
    }

    expect(balances.get('A')?.toNumber()).toBe(-20);
    expect(balances.get('B')?.toNumber()).toBe(10);
    expect(balances.get('C')?.toNumber()).toBe(10);

    const simplified = [];
    const debtors = [];
    const creditors = [];

    for (const [person, balance] of balances) {
      if (balance.isNegative()) {
        debtors.push({ person, amount: balance.abs() });
      } else if (balance.isPositive()) {
        creditors.push({ person, amount: balance });
      }
    }

    for (const debtor of debtors) {
      for (const creditor of creditors) {
        if (debtor.amount.isZero() || creditor.amount.isZero()) continue;

        const settleAmount = debtor.amount.isLessThan(creditor.amount)
          ? debtor.amount
          : creditor.amount;

        simplified.push({
          from: debtor.person,
          to: creditor.person,
          amount: settleAmount
        });

        debtor.amount = debtor.amount.subtract(settleAmount);
        creditor.amount = creditor.amount.subtract(settleAmount);
      }
    }

    expect(simplified).toHaveLength(2);
    expect(simplified[0]).toEqual({
      from: 'A',
      to: 'B',
      amount: new Money(10)
    });
    expect(simplified[1]).toEqual({
      from: 'A',
      to: 'C',
      amount: new Money(10)
    });
  });

  test('handles groups with no debts', () => {
    const balances = new Map<string, Money>([
      ['A', new Money(0)],
      ['B', new Money(0)],
      ['C', new Money(0)]
    ]);

    const hasDebts = Array.from(balances.values()).some(
      balance => !balance.isZero()
    );

    expect(hasDebts).toBe(false);
  });

  test('handles single creditor multiple debtors', () => {
    const balances = new Map<string, Money>([
      ['A', new Money(60)],
      ['B', new Money(-30)],
      ['C', new Money(-30)]
    ]);

    const settlements = [];
    const debtors = [];
    const creditors = [];

    for (const [person, balance] of balances) {
      if (balance.isNegative()) {
        debtors.push({ person, amount: balance.abs() });
      } else if (balance.isPositive()) {
        creditors.push({ person, amount: balance });
      }
    }

    expect(creditors).toHaveLength(1);
    expect(debtors).toHaveLength(2);

    for (const debtor of debtors) {
      for (const creditor of creditors) {
        if (!debtor.amount.isZero() && !creditor.amount.isZero()) {
          settlements.push({
            from: debtor.person,
            to: creditor.person,
            amount: debtor.amount
          });
        }
      }
    }

    expect(settlements).toHaveLength(2);
    expect(settlements).toContainEqual({
      from: 'B',
      to: 'A',
      amount: new Money(30)
    });
    expect(settlements).toContainEqual({
      from: 'C',
      to: 'A',
      amount: new Money(30)
    });
  });
});

describe('Expense Lifecycle Integration', () => {
  test('complete expense lifecycle: add → edit → delete', () => {
    const db = createMockExpenseDb();

    const expenseData = {
      amount: new Money(150),
      description: 'Team lunch',
      paidBy: 'user1',
      category: 'Food',
      groupId: 'group1'
    };

    const expenseId = db.addExpense(expenseData);
    expect(expenseId).toBeDefined();

    const expenseSplits = [
      { userId: 'user1', share: new Money(50) },
      { userId: 'user2', share: new Money(50) },
      { userId: 'user3', share: new Money(50) }
    ];

    db.addSplits(expenseId, expenseSplits);

    const expense = db.getExpense(expenseId);
    expect(expense.amount.toNumber()).toBe(150);
    expect(db.getSplits(expenseId)).toHaveLength(3);

    const newAmount = new Money(180);
    db.updateExpense(expenseId, { amount: newAmount });

    const newSplits = newAmount.splitEvenly(3);
    db.addSplits(expenseId, newSplits.map((share, i) => ({
      userId: `user${i + 1}`,
      share
    })));

    const updatedExpense = db.getExpense(expenseId);
    expect(updatedExpense.amount.toNumber()).toBe(180);

    const updatedSplits = db.getSplits(expenseId);
    expect(updatedSplits[0].share.toNumber()).toBe(60);

    db.deleteExpense(expenseId);

    expect(db.getExpense(expenseId)).toBeUndefined();
    expect(db.getSplits(expenseId)).toHaveLength(0);
  });

  test('handles concurrent expense operations', () => {
    const db = createMockExpenseDb();

    const expenses = [];

    for (let i = 0; i < 5; i++) {
      const id = db.addExpense({
        amount: new Money(100 + i * 10),
        description: `Expense ${i}`,
        paidBy: 'user1'
      });
      expenses.push(id);
    }

    expect(expenses).toHaveLength(5);

    expenses.forEach((id, index) => {
      const expense = db.getExpense(id);
      expect(expense).toBeDefined();
      expect(expense.amount.toNumber()).toBe(100 + index * 10);
    });
  });
});