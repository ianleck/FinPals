import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handleAdd command', () => {
	let db: D1Database;
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		vi.clearAllMocks();
	});

	describe('Group expenses', () => {
		it('should add a simple expense split evenly', async () => {
			const ctx = createMockContext({
				message: { 
					text: '/add 100 dinner',
					entities: [],
				},
			});

			// Mock database responses
			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' }); // group exists
			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{ user_id: '123456789' },
					{ user_id: '987654321' },
					{ user_id: '555555555' },
				],
			}); // group members

			await handleAdd(ctx, db);

			// Verify expense was created
			expect(mockPreparedStatement.run).toHaveBeenCalledTimes(5); // expense + splits
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('✅ <b>Expense Added</b>'),
				expect.objectContaining({ parse_mode: 'HTML' })
			);
		});

		it('should add expense with specific participants', async () => {
			const ctx = createMockContext({
				message: {
					text: '/add 60 lunch @john @sarah',
					entities: [
						{ type: 'mention', offset: 15, length: 5 },
						{ type: 'mention', offset: 21, length: 6 },
					],
				},
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '987654321' }); // john
			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '555555555' }); // sarah

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Split: @testuser, @john, @sarah'),
				expect.any(Object)
			);
		});

		it('should handle custom split amounts', async () => {
			const ctx = createMockContext({
				message: {
					text: '/add 100 dinner @john=30 @sarah=70',
					entities: [
						{ type: 'mention', offset: 16, length: 8 },
						{ type: 'mention', offset: 25, length: 9 },
					],
				},
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('@john ($30.00)'),
				expect.any(Object)
			);
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('@sarah ($70.00)'),
				expect.any(Object)
			);
		});

		it('should reject invalid custom splits', async () => {
			const ctx = createMockContext({
				message: {
					text: '/add 100 dinner @john=60 @sarah=60',
					entities: [],
				},
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('exceed the total expense'),
				expect.any(Object)
			);
		});

		it('should auto-categorize expenses', async () => {
			const ctx = createMockContext({
				message: { text: '/add 25 coffee ☕' },
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
			mockPreparedStatement.all.mockResolvedValueOnce({ results: [{ user_id: '123456789' }] });

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Food & Dining'),
				expect.any(Object)
			);
		});
	});

	describe('Personal expenses', () => {
		it('should add personal expense in private chat', async () => {
			const ctx = createPrivateContext({
				message: { text: '/add 50 groceries' },
			});

			await handleAdd(ctx, db);

			// Verify personal expense was created
			expect(mockPreparedStatement.run).toHaveBeenCalledTimes(3); // user + expense + split
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('✅ <b>Personal Expense Added</b>'),
				expect.any(Object)
			);
		});

		it('should not allow mentions in personal expenses', async () => {
			const ctx = createPrivateContext({
				message: { text: '/add 50 dinner @someone' },
			});

			await handleAdd(ctx, db);

			// Should still create expense but ignore mention
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('dinner @someone'),
				expect.any(Object)
			);
		});
	});

	describe('Error handling', () => {
		it('should reject invalid amount', async () => {
			const ctx = createMockContext({
				message: { text: '/add abc dinner' },
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('valid number'),
				expect.any(Object)
			);
		});

		it('should reject missing description', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50' },
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Invalid format'),
				expect.any(Object)
			);
		});

		it('should handle database errors gracefully', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50 dinner' },
			});

			mockPreparedStatement.run.mockRejectedValueOnce(new Error('DB Error'));

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Something went wrong'),
				expect.any(Object)
			);
		});
	});
});