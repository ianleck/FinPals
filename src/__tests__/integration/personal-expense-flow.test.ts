import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { handleBalance } from '../../commands/balance';
import { handleBudget } from '../../commands/budget';
import { handlePersonal } from '../../commands/personal';
import { handleSummary } from '../../commands/summary';
import { createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('Personal expense flow integration', () => {
	let db: D1Database;
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-15'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should complete personal expense tracking flow', async () => {
		// Step 1: Set a budget
		const budgetCtx = createPrivateContext({
			message: { text: '/budget set "Food & Dining" 500 monthly' },
		});

		await handleBudget(budgetCtx, db);
		expect(budgetCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('Budget set successfully'),
			expect.any(Object)
		);

		// Step 2: Add personal expenses
		const addCtx1 = createPrivateContext({
			message: { text: '/add 25 coffee ☕' },
		});

		await handleAdd(addCtx1, db);
		expect(addCtx1.reply).toHaveBeenCalledWith(
			expect.stringContaining('✅ <b>Personal Expense Added</b>'),
			expect.any(Object)
		);

		const addCtx2 = createPrivateContext({
			message: { text: '/add 75 lunch' },
		});

		await handleAdd(addCtx2, db);

		// Step 3: Check personal balance
		const balanceCtx = createPrivateContext();
		mockPreparedStatement.first.mockResolvedValueOnce({
			total_spent: 100,
			expense_count: 2,
		});
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{ category: 'Food & Dining', total: 100, count: 2 }],
		});
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{ month: '2024-01', total: 100 }],
		});

		await handleBalance(balanceCtx, db);
		expect(balanceCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('💸 <b>Total Spent:</b> $100.00'),
			expect.any(Object)
		);

		// Step 4: Check budget status
		const budgetViewCtx = createPrivateContext({
			message: { text: '/budget view' },
		});

		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{
				category: 'Food & Dining',
				amount: 500,
				period: 'monthly',
				spent: 100,
				percentage: 20,
			}],
		});

		await handleBudget(budgetViewCtx, db);
		expect(budgetViewCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('$100.00 / $500.00'),
			expect.any(Object)
		);

		// Step 5: Get monthly summary
		const summaryCtx = createPrivateContext({
			message: { text: '/summary' },
		});

		mockPreparedStatement.first.mockResolvedValueOnce({
			total_expenses: 2,
			total_amount: 100,
			avg_amount: 50,
		});
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{ category: 'Food & Dining', count: 2, total: 100 }],
		});

		await handleSummary(summaryCtx, db);
		expect(summaryCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('📊 <b>Personal Summary - January 2024</b>'),
			expect.any(Object)
		);
	});

	it('should alert when approaching budget limit', async () => {
		// Set budget
		const budgetCtx = createPrivateContext({
			message: { text: '/budget set "Shopping" 200 monthly' },
		});
		await handleBudget(budgetCtx, db);

		// Add expense that exceeds 80% of budget
		const addCtx = createPrivateContext({
			message: { text: '/add 170 clothes' },
		});

		// Mock budget check
		mockPreparedStatement.first
			.mockResolvedValueOnce(null) // group check
			.mockResolvedValueOnce(null) // category mapping
			.mockResolvedValueOnce({ 
				amount: 200, 
				period: 'monthly',
				spent: 0,
			}); // budget check

		await handleAdd(addCtx, db);

		// Should show warning about approaching budget
		expect(addCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('⚠️'),
			expect.any(Object)
		);
	});

	it('should show combined view in /personal', async () => {
		const ctx = createPrivateContext();

		// Mock group expenses
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{
				group_id: '-1001234567890',
				group_name: 'Friends',
				net_balance: 25.50,
			}],
		});

		// Mock spending by group
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{
				group_name: 'Friends',
				expense_count: 5,
				total_paid: 250,
			}],
		});

		// Mock group categories
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [
				{ category: 'Food & Dining', total: 150, count: 3 },
				{ category: 'Transportation', total: 100, count: 2 },
			],
		});

		// Mock personal expenses
		mockPreparedStatement.first.mockResolvedValueOnce({
			expense_count: 10,
			total_amount: 500,
			avg_amount: 50,
		});

		// Mock personal categories
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [
				{ category: 'Groceries', total: 300, count: 6 },
				{ category: 'Entertainment', total: 200, count: 4 },
			],
		});

		await handlePersonal(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('👤 <b>Your Personal Summary</b>'),
			expect.any(Object)
		);
		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('Friends: You\'re owed $25.50'),
			expect.any(Object)
		);
		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('💳 <b>Personal Expense Tracking:</b>'),
			expect.any(Object)
		);
	});
});