import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleBudget } from '../../commands/budget';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handleBudget command', () => {
	let db: D1Database;
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		vi.clearAllMocks();
	});

	it('should reject in group chat', async () => {
		const ctx = createMockContext();

		await handleBudget(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('only works in private chat'),
			expect.any(Object)
		);
	});

	describe('Set budget', () => {
		it('should set a monthly budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Food & Dining" 500 monthly' },
			});

			await handleBudget(ctx, db);

			expect(mockPreparedStatement.run).toHaveBeenCalled();
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Budget set successfully'),
				expect.any(Object)
			);
		});

		it('should set a weekly budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set Transportation 100 weekly' },
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Transportation: $100.00/week'),
				expect.any(Object)
			);
		});

		it('should reject invalid amount', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Food" abc monthly' },
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Invalid amount'),
				expect.any(Object)
			);
		});

		it('should reject invalid period', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Food" 500 yearly' },
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Period must be'),
				expect.any(Object)
			);
		});
	});

	describe('View budgets', () => {
		it('should show all budgets with spending', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget view' },
			});

			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{
						category: 'Food & Dining',
						amount: 500,
						period: 'monthly',
						spent: 350,
						percentage: 70,
					},
					{
						category: 'Transportation',
						amount: 100,
						period: 'weekly',
						spent: 80,
						percentage: 80,
					},
				],
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('📊 <b>Your Budgets</b>'),
				expect.any(Object)
			);
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Food & Dining'),
				expect.any(Object)
			);
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('$350.00 / $500.00'),
				expect.any(Object)
			);
		});

		it('should show warning for over-budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget view' },
			});

			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{
						category: 'Shopping',
						amount: 200,
						period: 'monthly',
						spent: 250,
						percentage: 125,
					},
				],
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('🚨'),
				expect.any(Object)
			);
		});

		it('should handle no budgets', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget view' },
			});

			mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('No budgets set yet'),
				expect.any(Object)
			);
		});
	});

	describe('Delete budget', () => {
		it('should delete a budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget delete "Food & Dining"' },
			});

			mockPreparedStatement.run.mockResolvedValueOnce({ changes: 1 });

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Budget deleted successfully'),
				expect.any(Object)
			);
		});

		it('should handle non-existent budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget delete "Unknown"' },
			});

			mockPreparedStatement.run.mockResolvedValueOnce({ changes: 0 });

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('No budget found'),
				expect.any(Object)
			);
		});
	});

	describe('Menu navigation', () => {
		it('should show budget menu on /budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget' },
			});

			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{ category: 'Food & Dining', amount: 500, period: 'monthly' },
				],
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('💰 <b>Budget Management</b>'),
				expect.objectContaining({
					reply_markup: expect.objectContaining({
						inline_keyboard: expect.any(Array),
					}),
				})
			);
		});
	});
});