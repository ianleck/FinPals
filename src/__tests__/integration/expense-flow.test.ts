import { describe, it, expect } from 'vitest';
import { Money, sumMoney } from '../../utils/money';

describe('Expense Flow Integration', () => {
	describe('Debt Simplification', () => {
		it('should simplify circular debts', () => {
			// A owes B $30, B owes C $20, C owes A $10
			const debts = [
				{ from: 'A', to: 'B', amount: new Money(30) },
				{ from: 'B', to: 'C', amount: new Money(20) },
				{ from: 'C', to: 'A', amount: new Money(10) }
			];

			// Manual simplification logic for testing
			const balances = new Map<string, Money>();

			// Calculate net balances
			for (const debt of debts) {
				const fromBalance = balances.get(debt.from) || new Money(0);
				const toBalance = balances.get(debt.to) || new Money(0);

				balances.set(debt.from, fromBalance.subtract(debt.amount));
				balances.set(debt.to, toBalance.add(debt.amount));
			}

			// Create simplified debts
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

			// Match debtors with creditors
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

			// Should simplify the debts
			expect(simplified.length).toBeGreaterThan(0);
			expect(simplified.length).toBeLessThanOrEqual(2);

			// Verify net flow is preserved (but less total transactions)
			const totalOriginal = sumMoney(debts.map(d => d.amount));
			const totalSimplified = sumMoney(simplified.map(d => d.amount));
			expect(totalOriginal.toNumber()).toBe(60);
			expect(totalSimplified.toNumber()).toBeLessThan(totalOriginal.toNumber());
		});

		it('should handle equal split correctly', () => {
			const total = new Money(90);
			const splits = total.splitEvenly(3);

			expect(splits).toHaveLength(3);
			splits.forEach(split => {
				expect(split.toNumber()).toBe(30);
			});

			// Verify total is preserved
			const sum = sumMoney(splits);
			expect(sum.toNumber()).toBe(90);
		});

		it('should handle unequal split with remainder', () => {
			const total = new Money(100);
			const splits = total.splitEvenly(3);

			expect(splits).toHaveLength(3);
			expect(splits[0].toNumber()).toBe(33.34);
			expect(splits[1].toNumber()).toBe(33.33);
			expect(splits[2].toNumber()).toBe(33.33);

			// Verify total is preserved
			const sum = sumMoney(splits);
			expect(sum.toNumber()).toBe(100);
		});
	});

	describe('Settlement Calculations', () => {
		it('should calculate settlement amounts correctly', () => {
			// User balances after expenses
			const balances = new Map<string, Money>([
				['user1', new Money(60)],   // Paid more, is owed
				['user2', new Money(-30)],  // Owes money
				['user3', new Money(-30)]   // Owes money
			]);

			// Calculate who owes whom
			const settlements = [];
			const creditors = [];
			const debtors = [];

			for (const [userId, balance] of balances) {
				if (balance.isPositive()) {
					creditors.push({ userId, amount: balance });
				} else if (balance.isNegative()) {
					debtors.push({ userId, amount: balance.abs() });
				}
			}

			// Simple settlement algorithm
			for (const debtor of debtors) {
				for (const creditor of creditors) {
					if (debtor.amount.isZero() || creditor.amount.isZero()) continue;

					const settleAmount = debtor.amount.isLessThan(creditor.amount)
						? debtor.amount
						: creditor.amount;

					if (settleAmount.isPositive()) {
						settlements.push({
							from: debtor.userId,
							to: creditor.userId,
							amount: settleAmount
						});

						debtor.amount = debtor.amount.subtract(settleAmount);
						creditor.amount = creditor.amount.subtract(settleAmount);
					}
				}
			}

			expect(settlements).toHaveLength(2);
			expect(settlements[0]).toEqual({
				from: 'user2',
				to: 'user1',
				amount: new Money(30)
			});
			expect(settlements[1]).toEqual({
				from: 'user3',
				to: 'user1',
				amount: new Money(30)
			});
		});
	});
});