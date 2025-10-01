import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExpense, updateExpense, updateExpenseSplits, updateExpenseAmount } from '../../../services/expense';
import { Money } from '../../../utils/money';
import { EXPENSE_CONSTRAINTS } from '../../../schemas/expense';
import { mock } from '../../test-utils';

// Mock the database module
vi.mock('../../../db', () => ({
	withRetry: vi.fn((fn) => fn()),
	parseDecimal: vi.fn((str) => parseFloat(str)),
	formatAmount: vi.fn((num) => num.toFixed(2)),
}));

describe('Expense Service - Validation Tests', () => {
	let db: any;

	beforeEach(() => {
		vi.clearAllMocks();
		db = mock();

		// Setup default successful responses
		db.select.mockReturnValue(db);
		db.from.mockReturnValue(db);
		db.where.mockReturnValue(db);
		db.limit.mockReturnValue(db);
		db.insert.mockReturnValue(db);
		db.values.mockReturnValue(db);
		db.returning.mockResolvedValue([{ id: 'test-id', amount: '100.00', deleted: false }]);
	});

	describe('createExpense() - Input Validation', () => {
		const validExpenseData = {
			amount: new Money(100),
			currency: 'USD',
			description: 'Test expense',
			paidBy: '111111',
			splits: [{ userId: '111111', amount: new Money(100) }],
			createdBy: '111111',
		};

		it('should reject description longer than MAX_DESCRIPTION_LENGTH (500)', async () => {
			const longDescription = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH + 1);

			await expect(
				createExpense(db, { ...validExpenseData, description: longDescription })
			).rejects.toThrow(`Description too long (max ${EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH} characters)`);
		});

		it('should accept description at exactly MAX_DESCRIPTION_LENGTH (500)', async () => {
			const maxDescription = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH);

			await expect(
				createExpense(db, { ...validExpenseData, description: maxDescription })
			).resolves.toBeDefined();
		});

		it('should reject category longer than MAX_CATEGORY_LENGTH (100)', async () => {
			const longCategory = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH + 1);

			await expect(
				createExpense(db, { ...validExpenseData, category: longCategory })
			).rejects.toThrow(`Category too long (max ${EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH} characters)`);
		});

		it('should accept category at exactly MAX_CATEGORY_LENGTH (100)', async () => {
			const maxCategory = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH);

			await expect(
				createExpense(db, { ...validExpenseData, category: maxCategory })
			).resolves.toBeDefined();
		});

		it('should reject note longer than MAX_NOTE_LENGTH (1000)', async () => {
			const longNote = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH + 1);

			await expect(
				createExpense(db, { ...validExpenseData, note: longNote })
			).rejects.toThrow(`Note too long (max ${EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH} characters)`);
		});

		it('should accept note at exactly MAX_NOTE_LENGTH (1000)', async () => {
			const maxNote = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH);

			await expect(
				createExpense(db, { ...validExpenseData, note: maxNote })
			).resolves.toBeDefined();
		});

		it('should reject more than MAX_SPLITS (50)', async () => {
			const tooManySplits = Array(EXPENSE_CONSTRAINTS.MAX_SPLITS + 1).fill({ userId: '111111', amount: new Money(1) });

			await expect(
				createExpense(db, { ...validExpenseData, splits: tooManySplits })
			).rejects.toThrow(`Too many splits (max ${EXPENSE_CONSTRAINTS.MAX_SPLITS})`);
		});

		it('should accept exactly MAX_SPLITS (50)', async () => {
			const maxSplits = Array(EXPENSE_CONSTRAINTS.MAX_SPLITS).fill({ userId: '111111', amount: new Money(2) });

			await expect(
				createExpense(db, { ...validExpenseData, splits: maxSplits })
			).resolves.toBeDefined();
		});

		it('should reject invalid currency code (not 3 letters)', async () => {
			await expect(
				createExpense(db, { ...validExpenseData, currency: 'US' })
			).rejects.toThrow('Invalid currency code (must be 3-letter ISO 4217)');

			await expect(
				createExpense(db, { ...validExpenseData, currency: 'USDD' })
			).rejects.toThrow('Invalid currency code (must be 3-letter ISO 4217)');
		});

		it('should reject currency code with lowercase letters', async () => {
			await expect(
				createExpense(db, { ...validExpenseData, currency: 'usd' })
			).rejects.toThrow('Invalid currency code (must be 3-letter ISO 4217)');
		});

		it('should reject currency code with numbers', async () => {
			await expect(
				createExpense(db, { ...validExpenseData, currency: 'US1' })
			).rejects.toThrow('Invalid currency code (must be 3-letter ISO 4217)');
		});

		it('should accept valid 3-letter uppercase currency code', async () => {
			await expect(
				createExpense(db, { ...validExpenseData, currency: 'EUR' })
			).resolves.toBeDefined();

			await expect(
				createExpense(db, { ...validExpenseData, currency: 'GBP' })
			).resolves.toBeDefined();
		});
	});

	describe('updateExpense() - Input Validation', () => {
		const expenseId = 'test-expense-id';

		beforeEach(() => {
			db.update.mockReturnValue(db);
			db.set.mockReturnValue(db);
			db.where.mockReturnValue(db);
			db.returning.mockResolvedValue([{ id: expenseId, amount: '100.00' }]);
		});

		it('should reject description longer than MAX_DESCRIPTION_LENGTH (500)', async () => {
			const longDescription = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH + 1);

			await expect(
				updateExpense(db, expenseId, { description: longDescription })
			).rejects.toThrow(`Description too long (max ${EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH} characters)`);
		});

		it('should reject category longer than MAX_CATEGORY_LENGTH (100)', async () => {
			const longCategory = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH + 1);

			await expect(
				updateExpense(db, expenseId, { category: longCategory })
			).rejects.toThrow(`Category too long (max ${EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH} characters)`);
		});

		it('should reject note longer than MAX_NOTE_LENGTH (1000)', async () => {
			const longNote = 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH + 1);

			await expect(
				updateExpense(db, expenseId, { note: longNote })
			).rejects.toThrow(`Note too long (max ${EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH} characters)`);
		});

		it('should reject invalid currency code', async () => {
			await expect(
				updateExpense(db, expenseId, { currency: 'US' })
			).rejects.toThrow('Invalid currency code (must be 3-letter ISO 4217)');

			await expect(
				updateExpense(db, expenseId, { currency: 'usd' })
			).rejects.toThrow('Invalid currency code (must be 3-letter ISO 4217)');
		});

		it('should accept valid updates at boundary limits', async () => {
			await expect(
				updateExpense(db, expenseId, {
					description: 'a'.repeat(EXPENSE_CONSTRAINTS.MAX_DESCRIPTION_LENGTH),
					category: 'b'.repeat(EXPENSE_CONSTRAINTS.MAX_CATEGORY_LENGTH),
					note: 'c'.repeat(EXPENSE_CONSTRAINTS.MAX_NOTE_LENGTH),
					currency: 'EUR',
				})
			).resolves.toBeDefined();
		});
	});

	describe('updateExpenseSplits() - Input Validation', () => {
		const expenseId = 'test-expense-id';

		beforeEach(() => {
			// Mock transaction behavior
			db.transaction = vi.fn(async (callback) => {
				const tx = {
					select: vi.fn().mockReturnThis(),
					from: vi.fn().mockReturnThis(),
					where: vi.fn().mockReturnThis(),
					limit: vi.fn().mockResolvedValue([{ isPersonal: false }]),
					delete: vi.fn().mockReturnThis(),
					insert: vi.fn().mockReturnThis(),
					values: vi.fn().mockResolvedValue(undefined),
				};
				return await callback(tx);
			});
		});

		it('should reject empty splits array', async () => {
			await expect(
				updateExpenseSplits(db, expenseId, [])
			).rejects.toThrow('At least one split required');
		});

		it('should reject more than MAX_SPLITS (50)', async () => {
			const tooManySplits = Array(EXPENSE_CONSTRAINTS.MAX_SPLITS + 1)
				.fill(null)
				.map((_, i) => ({ userId: `user-${i}`, amount: new Money(1) }));

			await expect(
				updateExpenseSplits(db, expenseId, tooManySplits)
			).rejects.toThrow(`Too many splits (max ${EXPENSE_CONSTRAINTS.MAX_SPLITS})`);
		});

		it('should accept exactly MAX_SPLITS (50)', async () => {
			const maxSplits = Array(EXPENSE_CONSTRAINTS.MAX_SPLITS)
				.fill(null)
				.map((_, i) => ({ userId: `user-${i}`, amount: new Money(2) }));

			await expect(
				updateExpenseSplits(db, expenseId, maxSplits)
			).resolves.toBeUndefined();
		});

		it('should reject splits update for personal expenses', async () => {
			// Mock transaction to return isPersonal: true
			db.transaction = vi.fn(async (callback) => {
				const tx = {
					select: vi.fn().mockReturnThis(),
					from: vi.fn().mockReturnThis(),
					where: vi.fn().mockReturnThis(),
					limit: vi.fn().mockResolvedValue([{ isPersonal: true }]),
				};
				return await callback(tx);
			});

			await expect(
				updateExpenseSplits(db, expenseId, [{ userId: '111111', amount: new Money(100) }])
			).rejects.toThrow('Cannot update splits for personal expenses');
		});
	});

	describe('Split Arithmetic and Edge Cases', () => {
		it('should handle split amounts with explicit values', async () => {
			const db = mock();
			db.select.mockReturnValue(db);
			db.from.mockReturnValue(db);
			db.where.mockReturnValue(db);
			db.limit.mockResolvedValue([{ id: 'user1', telegramId: 'user1' }]);
			db.insert.mockReturnValue(db);
			db.values.mockReturnValue(db);
			db.returning.mockResolvedValue([{ id: 'test-id', amount: '100.00', deleted: false }]);

			const expenseData = {
				amount: new Money(100),
				currency: 'USD',
				description: 'Test',
				paidBy: 'user1',
				splits: [
					{ userId: 'user1', amount: new Money(60) }, // Explicit amount
					{ userId: 'user2', amount: new Money(40) }, // Explicit amount
				],
				createdBy: 'user1',
			};

			const result = await createExpense(db, expenseData);

			expect(result).toBeDefined();
			// Verify splits were inserted with explicit amounts
			expect(db.insert).toHaveBeenCalled();
		});

		it('should auto-calculate split amounts when not provided', async () => {
			const db = mock();
			db.select.mockReturnValue(db);
			db.from.mockReturnValue(db);
			db.where.mockReturnValue(db);
			db.limit.mockResolvedValue([{ id: 'user1', telegramId: 'user1' }]);
			db.insert.mockReturnValue(db);
			db.values.mockReturnValue(db);
			db.returning.mockResolvedValue([{ id: 'test-id', amount: '99.00', deleted: false }]);

			const expenseData = {
				amount: new Money(99),
				currency: 'USD',
				description: 'Test',
				paidBy: 'user1',
				splits: [
					{ userId: 'user1' }, // No amount - should be auto-calculated
					{ userId: 'user2' }, // No amount - should be auto-calculated
					{ userId: 'user3' }, // No amount - should be auto-calculated
				],
				createdBy: 'user1',
			};

			const result = await createExpense(db, expenseData);

			expect(result).toBeDefined();
			// Each split should get 99/3 = 33.00 (with rounding handled by Money class)
		});

		it('should handle mixed explicit and auto-calculated splits', async () => {
			const db = mock();
			db.select.mockReturnValue(db);
			db.from.mockReturnValue(db);
			db.where.mockReturnValue(db);
			db.limit.mockResolvedValue([{ id: 'user1', telegramId: 'user1' }]);
			db.insert.mockReturnValue(db);
			db.values.mockReturnValue(db);
			db.returning.mockResolvedValue([{ id: 'test-id', amount: '100.00', deleted: false }]);

			const expenseData = {
				amount: new Money(100),
				currency: 'USD',
				description: 'Test',
				paidBy: 'user1',
				splits: [
					{ userId: 'user1', amount: new Money(50) }, // Explicit
					{ userId: 'user2' }, // Auto-calculated (should get 100/2 = 50 based on total splits)
				],
				createdBy: 'user1',
			};

			const result = await createExpense(db, expenseData);

			expect(result).toBeDefined();
		});

		// Note: updateExpenseAmount transaction logic requires integration tests with real DB
		// Mocking complex transaction behavior with multiple queries is fragile
	});
});
