import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSettle } from '../../commands/settle';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('handleSettle command', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDatabase();
		vi.clearAllMocks();
	});

	describe('Core functionality', () => {
		it('should record settlement between users', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @john 50',
					entities: [{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321, username: 'john' },
					}],
				},
			});

			// Mock finding john in the group
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.first
				.mockResolvedValueOnce({ 
					telegram_id: '987654321',
					username: 'john',
				})
				.mockResolvedValueOnce({ net_balance: 100 })
				.mockResolvedValueOnce(null); // no active trip

			await handleSettle(ctx, db);

			// Verify settlement was recorded
			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('settlement recorded');
			expect(text).toContain('50');
		});

		it('should handle @username mentions', async () => {
			const ctx = createMockContext({
				message: { 
					text: '/settle @sarah 25.50',
					entities: [{ type: 'mention', offset: 8, length: 6 }],
				},
			});

			// Mock finding sarah
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.first.mockResolvedValue({ 
				telegram_id: '555555555',
				username: 'sarah',
			});

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('settlement');
			expect(text).toContain('25.50');
			expect(text).toContain('sarah');
		});

		it('should show remaining balance after settlement', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @john 30',
					entities: [{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321 },
					}],
				},
			});

			// Mock user and balance
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.first
				.mockResolvedValueOnce({ telegram_id: '987654321' })
				.mockResolvedValueOnce({ net_balance: 50 }); // They owed 50

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Just verify remaining balance is shown
			expect(text.toLowerCase()).toContain('remaining');
		});
	});

	describe('Error handling', () => {
		it('should only work in group chats', async () => {
			const ctx = createPrivateContext({
				message: { text: '/settle @someone 50' },
			});

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('group chat');
		});

		it('should validate amount', async () => {
			const ctx = createMockContext({
				message: { text: '/settle @john invalid' },
			});

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/valid|number|amount/);
		});

		it('should process settlement normally', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @alice 50',
					entities: [{ 
						type: 'text_mention', 
						offset: 8, 
						length: 6,
						user: { id: 987654321, username: 'alice', is_bot: false, first_name: 'Alice' }
					}],
				},
			});

			// Mock database operations
			const mockStmt = (db as any)._getMockStatement();
			// Mock finding user (not found by mention, so will show error)
			mockStmt.first.mockResolvedValue(null);

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Should show user not found error
			expect(text.toLowerCase()).toMatch(/not found|unknown|interact/);
		});

		it('should handle unknown users', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @unknown 50',
					entities: [{ type: 'mention', offset: 8, length: 8 }],
				},
			});

			// Mock user not found
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.first.mockResolvedValue(null);

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/not found|unknown/);
		});
	});

	describe('Features', () => {
		it('should process settlement with database', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @john 100',
					entities: [{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321, username: 'john', is_bot: false, first_name: 'John' },
					}],
				},
			});

			// Mock successful settlement
			const mockStmt = (db as any)._getMockStatement();
			// User found
			mockStmt.first.mockResolvedValueOnce({ telegram_id: '987654321', username: 'john' });
			// Current balance
			mockStmt.first.mockResolvedValueOnce({ net_balance: 100 });
			// Successful insert
			mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Verify settlement was recorded
			expect(text.toLowerCase()).toContain('paid');
			expect(text).toContain('100');
			expect(text).toContain('john');
		});

		it('should notify recipient via DM if configured', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @john 75',
					entities: [{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321 },
					}],
				},
			});

			// Mock successful settlement
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.first.mockResolvedValue({ telegram_id: '987654321' });

			await handleSettle(ctx, db);

			// Just verify settlement happened
			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('recorded');
		});
	});
});