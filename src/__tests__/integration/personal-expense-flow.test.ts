import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { handleBalance } from '../../commands/balance';
import { handleBudget } from '../../commands/budget';
import { handlePersonal } from '../../commands/personal';
import { handleSummary } from '../../commands/summary';
import { createPrivateContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('Personal expense flow integration', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDatabase();
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
		const { text: budgetText } = extractReplyContent(budgetCtx);
		expect(budgetText.toLowerCase()).toContain('budget');
		expect(budgetText).toContain('500');

		// Step 2: Add personal expenses
		const addCtx1 = createPrivateContext({
			message: { text: '/add 25 coffee ☕' },
		});

		await handleAdd(addCtx1, db);
		const { text: addText1 } = extractReplyContent(addCtx1);
		expect(addText1.toLowerCase()).toContain('personal');
		expect(addText1).toContain('25');

		const addCtx2 = createPrivateContext({
			message: { text: '/add 75 lunch' },
		});

		await handleAdd(addCtx2, db);

		// Step 3: Check personal balance
		const balanceCtx = createPrivateContext();
		const mockStmt = (db as any)._getMockStatement();
		mockStmt.first.mockResolvedValueOnce({
			total_spent: 100,
			expense_count: 2,
		});
		mockStmt.all.mockResolvedValueOnce({
			results: [{ category: 'Food & Dining', total: 100, count: 2 }],
		});
		mockStmt.all.mockResolvedValueOnce({
			results: [{ month: '2024-01', total: 100 }],
		});

		await handleBalance(balanceCtx, db);
		const { text: balanceText } = extractReplyContent(balanceCtx);
		expect(balanceText).toContain('100');
		expect(balanceText.toLowerCase()).toContain('spent');

		// Step 4: Check budget status
		const budgetViewCtx = createPrivateContext({
			message: { text: '/budget view' },
		});

		mockStmt.all.mockResolvedValueOnce({
			results: [{
				category: 'Food & Dining',
				amount: 500,
				period: 'monthly',
				spent: 100,
				percentage: 20,
			}],
		});

		await handleBudget(budgetViewCtx, db);
		const { text: budgetViewText } = extractReplyContent(budgetViewCtx);
		expect(budgetViewText).toContain('100');
		expect(budgetViewText).toContain('500');

		// Step 5: Get monthly summary
		const summaryCtx = createPrivateContext({
			message: { text: '/summary' },
		});

		mockStmt.first.mockResolvedValueOnce({
			total_expenses: 2,
			total_amount: 100,
			avg_amount: 50,
		});
		mockStmt.all.mockResolvedValueOnce({
			results: [{ category: 'Food & Dining', count: 2, total: 100 }],
		});

		await handleSummary(summaryCtx, db);
		const { text: summaryText } = extractReplyContent(summaryCtx);
		expect(summaryText.toLowerCase()).toContain('summary');
		expect(summaryText).toContain('January');
	});

	it('should track personal expenses with budgets', async () => {
		// Set budget
		const budgetCtx = createPrivateContext({
			message: { text: '/budget set "Shopping" 200 monthly' },
		});
		await handleBudget(budgetCtx, db);

		// Add expense that exceeds 80% of budget
		const addCtx = createPrivateContext({
			message: { text: '/add 170 clothes' },
		});

		// Mock database operations
		const mockStmt = (db as any)._getMockStatement();
		mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });
		mockStmt.first.mockResolvedValueOnce(null); // no category mapping

		await handleAdd(addCtx, db);

		// Personal expenses are added successfully
		const { text } = extractReplyContent(addCtx);
		expect(text.toLowerCase()).toContain('personal expense');
		expect(text).toContain('170');
		
		// Now check budget status separately
		const budgetViewCtx = createPrivateContext({
			message: { text: '/budget view' },
		});
		
		mockStmt.all.mockResolvedValueOnce({
			results: [{
				category: 'Shopping',
				amount: 200,
				period: 'monthly',
				spent: 170,
				percentage: 85,
			}],
		});
		
		await handleBudget(budgetViewCtx, db);
		const { text: budgetText } = extractReplyContent(budgetViewCtx);
		// Budget view should show the high percentage
		expect(budgetText).toContain('85');
	});

	it('should show combined view in /personal', async () => {
		const ctx = createPrivateContext();

		const mockStmt = (db as any)._getMockStatement();
		// Mock group expenses
		mockStmt.all.mockResolvedValueOnce({
			results: [{
				group_id: '-1001234567890',
				group_name: 'Friends',
				net_balance: 25.50,
			}],
		});

		// Mock spending by group
		mockStmt.all.mockResolvedValueOnce({
			results: [{
				group_name: 'Friends',
				expense_count: 5,
				total_paid: 250,
			}],
		});

		// Mock group categories
		mockStmt.all.mockResolvedValueOnce({
			results: [
				{ category: 'Food & Dining', total: 150, count: 3 },
				{ category: 'Transportation', total: 100, count: 2 },
			],
		});

		// Mock personal expenses
		mockStmt.first.mockResolvedValueOnce({
			expense_count: 10,
			total_amount: 500,
			avg_amount: 50,
		});

		// Mock personal categories
		mockStmt.all.mockResolvedValueOnce({
			results: [
				{ category: 'Groceries', total: 300, count: 6 },
				{ category: 'Entertainment', total: 200, count: 4 },
			],
		});

		await handlePersonal(ctx, db);

		const { text } = extractReplyContent(ctx);
		expect(text.toLowerCase()).toContain('personal');
		expect(text).toContain('Friends');
		expect(text).toContain('25.50');
		expect(text).toContain('Groceries');
		expect(text).toContain('Entertainment');
	});
});