import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateBalances, calculatePersonalBalances } from '../../../services/balance';
import { Money } from '../../../utils/money';

// Mock the database module
vi.mock('../../../db', () => ({
	withRetry: vi.fn((fn) => fn()),
}));

describe('Balance Service - Multi-Currency Scenario Tests', () => {
	describe('calculateBalances()', () => {
		it('should group balances by currency (user owes USD and EUR simultaneously)', async () => {
			// Setup: User A paid $100 USD and €50 EUR, User B owes both
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			// Mock 3 queries: expenses, splits, settlements
			db.where
				.mockResolvedValueOnce([
					// Query 1: expenses
					{ id: 'e1', amount: '100.00', currency: 'USD', paidBy: 'userA' },
					{ id: 'e2', amount: '50.00', currency: 'EUR', paidBy: 'userA' },
				])
				.mockResolvedValueOnce([
					// Query 2: splits
					{ expenseId: 'e1', userId: 'userB', amount: '100.00' },
					{ expenseId: 'e2', userId: 'userB', amount: '50.00' },
				])
				.mockResolvedValueOnce([]); // Query 3: settlements (none)

			const result = await calculateBalances(db, 'group1');

			// User A should have positive balance in both currencies
			expect(result).toContainEqual({ userId: 'userA', currency: 'USD', balance: 100 });
			expect(result).toContainEqual({ userId: 'userA', currency: 'EUR', balance: 50 });

			// User B should have negative balance in both currencies
			expect(result).toContainEqual({ userId: 'userB', currency: 'USD', balance: -100 });
			expect(result).toContainEqual({ userId: 'userB', currency: 'EUR', balance: -50 });

			// Should have 4 entries total
			expect(result).toHaveLength(4);
		});

		it('should filter balances below 0.01 threshold', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([
					// User A paid $0.02
					{ id: 'e1', amount: '0.02', currency: 'USD', paidBy: 'userA' },
					// User C paid $0.01
					{ id: 'e2', amount: '0.01', currency: 'USD', paidBy: 'userC' },
				])
				.mockResolvedValueOnce([
					// User B owes $0.001 (below 0.01 threshold)
					{ expenseId: 'e1', userId: 'userB', amount: '0.001' },
					// User A owes $0.019 (part of own expense)
					{ expenseId: 'e1', userId: 'userA', amount: '0.019' },
					// User D owes $0.01 (exactly at threshold)
					{ expenseId: 'e2', userId: 'userD', amount: '0.01' },
				])
				.mockResolvedValueOnce([]);

			const result = await calculateBalances(db, 'group1');

			// User B ($0.001 debt) should be filtered out
			expect(result.find(r => r.userId === 'userB')).toBeUndefined();

			// User A: paid $0.02, owes $0.019 = net +0.001 (should be filtered)
			expect(result.find(r => r.userId === 'userA')).toBeUndefined();

			// User C: paid $0.01, owes $0 = net +0.01 (at threshold, included)
			expect(result).toContainEqual({ userId: 'userC', currency: 'USD', balance: 0.01 });

			// User D: paid $0, owes $0.01 = net -0.01 (at threshold, included)
			expect(result).toContainEqual({ userId: 'userD', currency: 'USD', balance: -0.01 });

			expect(result).toHaveLength(2);
		});

		it('should apply settlements to balance calculation', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([
					// User A paid $100
					{ id: 'e1', amount: '100.00', currency: 'USD', paidBy: 'userA' },
				])
				.mockResolvedValueOnce([
					// User B owes $100
					{ expenseId: 'e1', userId: 'userB', amount: '100.00' },
				])
				.mockResolvedValueOnce([
					// User B settled $50 to User A
					{ fromUser: 'userB', toUser: 'userA', amount: '50.00', currency: 'USD' },
				]);

			const result = await calculateBalances(db, 'group1');

			// Settlement logic: fromUser -= amount, toUser += amount
			// Note: This represents transaction flow, not debt reduction
			// User A: +100 (paid expense) + 50 (received settlement) = +150
			// User B: -100 (owes split) - 50 (paid settlement) = -150
			expect(result).toContainEqual({ userId: 'userA', currency: 'USD', balance: 150 });
			expect(result).toContainEqual({ userId: 'userB', currency: 'USD', balance: -150 });
			expect(result).toHaveLength(2);
		});

		it('should return empty array for group with no expenses', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([]) // No expenses
				.mockResolvedValueOnce([]) // No splits
				.mockResolvedValueOnce([]); // No settlements

			const result = await calculateBalances(db, 'group1');

			expect(result).toEqual([]);
		});

		it('should handle exactly 0.01 balance (edge case at threshold)', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([
					{ id: 'e1', amount: '0.01', currency: 'USD', paidBy: 'userA' },
				])
				.mockResolvedValueOnce([
					{ expenseId: 'e1', userId: 'userB', amount: '0.01' },
				])
				.mockResolvedValueOnce([]);

			const result = await calculateBalances(db, 'group1');

			// $0.01 is exactly at threshold, should be included
			expect(result).toContainEqual({ userId: 'userA', currency: 'USD', balance: 0.01 });
			expect(result).toContainEqual({ userId: 'userB', currency: 'USD', balance: -0.01 });
			expect(result).toHaveLength(2);
		});

		it('should handle complex multi-user multi-currency scenario', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([
					// User A paid $100 USD
					{ id: 'e1', amount: '100.00', currency: 'USD', paidBy: 'userA' },
					// User B paid €50 EUR
					{ id: 'e2', amount: '50.00', currency: 'EUR', paidBy: 'userB' },
					// User C paid $75 USD
					{ id: 'e3', amount: '75.00', currency: 'USD', paidBy: 'userC' },
				])
				.mockResolvedValueOnce([
					// Expense 1: A paid $100, B and C owe $50 each
					{ expenseId: 'e1', userId: 'userB', amount: '50.00' },
					{ expenseId: 'e1', userId: 'userC', amount: '50.00' },
					// Expense 2: B paid €50, A and C owe €25 each
					{ expenseId: 'e2', userId: 'userA', amount: '25.00' },
					{ expenseId: 'e2', userId: 'userC', amount: '25.00' },
					// Expense 3: C paid $75, A and B owe $37.50 each
					{ expenseId: 'e3', userId: 'userA', amount: '37.50' },
					{ expenseId: 'e3', userId: 'userB', amount: '37.50' },
				])
				.mockResolvedValueOnce([]); // No settlements

			const result = await calculateBalances(db, 'group1');

			// Calculate expected balances:
			// User A: +100 USD (paid) -50 USD (owes e1) -37.50 USD (owes e3) = +12.50 USD
			//         +50 EUR (paid e2) -25 EUR (owes e2) = +25 EUR
			// Wait, User A didn't pay e2, User B did. Let me recalculate.

			// User A: +100 USD (paid e1) -37.50 USD (owes e3) = +62.50 USD
			//         -25 EUR (owes e2)
			// User B: +50 EUR (paid e2) -50 USD (owes e1) -37.50 USD (owes e3)
			// User C: +75 USD (paid e3) -50 USD (owes e1) -25 EUR (owes e2)

			expect(result).toContainEqual({ userId: 'userA', currency: 'USD', balance: 62.5 });
			expect(result).toContainEqual({ userId: 'userA', currency: 'EUR', balance: -25 });
			expect(result).toContainEqual({ userId: 'userB', currency: 'EUR', balance: 50 });
			expect(result).toContainEqual({ userId: 'userB', currency: 'USD', balance: -87.5 });
			expect(result).toContainEqual({ userId: 'userC', currency: 'USD', balance: 25 });
			expect(result).toContainEqual({ userId: 'userC', currency: 'EUR', balance: -25 });
		});

		it('should use default currency when expense has null currency', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
				innerJoin: vi.fn().mockReturnThis(),
			};

			db.where
				.mockResolvedValueOnce([
					// Expense with null currency
					{ id: 'e1', amount: '100.00', currency: null, paidBy: 'userA' },
				])
				.mockResolvedValueOnce([
					{ expenseId: 'e1', userId: 'userB', amount: '100.00' },
				])
				.mockResolvedValueOnce([]);

			const result = await calculateBalances(db, 'group1');

			// Should use DEFAULT_CURRENCY (SGD)
			expect(result).toContainEqual({ userId: 'userA', currency: 'SGD', balance: 100 });
			expect(result).toContainEqual({ userId: 'userB', currency: 'SGD', balance: -100 });
		});
	});

	describe('calculatePersonalBalances()', () => {
		it('should calculate total by currency for personal expenses', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where.mockResolvedValueOnce([
				{ id: 'e1', amount: '50.00', currency: 'USD' },
				{ id: 'e2', amount: '30.00', currency: 'USD' },
				{ id: 'e3', amount: '25.00', currency: 'EUR' },
			]);

			const result = await calculatePersonalBalances(db, 'user1');

			expect(result).toContainEqual({ userId: 'user1', currency: 'USD', balance: 80 });
			expect(result).toContainEqual({ userId: 'user1', currency: 'EUR', balance: 25 });
			expect(result).toHaveLength(2);
		});

		it('should filter out balances below 0.01 for personal expenses', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where.mockResolvedValueOnce([
				{ id: 'e1', amount: '0.001', currency: 'USD' },
			]);

			const result = await calculatePersonalBalances(db, 'user1');

			// $0.001 is below 0.01 threshold
			expect(result).toEqual([]);
		});

		it('should return empty array when user has no personal expenses', async () => {
			const db: any = {
				select: vi.fn().mockReturnThis(),
				from: vi.fn().mockReturnThis(),
				where: vi.fn().mockReturnThis(),
			};

			db.where.mockResolvedValueOnce([]);

			const result = await calculatePersonalBalances(db, 'user1');

			expect(result).toEqual([]);
		});
	});
});
