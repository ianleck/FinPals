import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSettle } from '../../commands/settle';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handleSettle command', () => {
	let db: D1Database;
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		vi.clearAllMocks();
	});

	it('should reject settle in private chat', async () => {
		const ctx = createPrivateContext({
			message: { text: '/settle @john 50' },
		});

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('only works in group chats'),
			expect.any(Object)
		);
	});

	it('should settle with mentioned user', async () => {
		const ctx = createMockContext({
			message: {
				text: '/settle @john 50',
				entities: [
					{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321, username: 'john' },
					},
				],
			},
		});

		await handleSettle(ctx, db);

		expect(mockPreparedStatement.run).toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('💰 <b>Settlement Recorded</b>'),
			expect.any(Object)
		);
		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('@testuser paid @john: $50.00'),
			expect.any(Object)
		);
	});

	it('should handle username mentions', async () => {
		const ctx = createMockContext({
			message: {
				text: '/settle @sarah 25.50',
				entities: [{ type: 'mention', offset: 8, length: 6 }],
			},
		});

		mockPreparedStatement.first.mockResolvedValueOnce({
			telegram_id: '555555555',
			username: 'sarah',
		});

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('@testuser paid @sarah: $25.50'),
			expect.any(Object)
		);
	});

	it('should reject invalid amount', async () => {
		const ctx = createMockContext({
			message: { text: '/settle @john abc' },
		});

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('Please enter a valid amount'),
			expect.any(Object)
		);
	});

	it('should reject missing user', async () => {
		const ctx = createMockContext({
			message: { text: '/settle 50' },
		});

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('Invalid format'),
			expect.any(Object)
		);
	});

	it('should reject settlement to self', async () => {
		const ctx = createMockContext({
			message: {
				text: '/settle @testuser 50',
				entities: [
					{
						type: 'text_mention',
						offset: 8,
						length: 9,
						user: { id: 123456789 },
					},
				],
			},
		});

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining("can't settle with yourself"),
			expect.any(Object)
		);
	});

	it('should handle unknown user', async () => {
		const ctx = createMockContext({
			message: {
				text: '/settle @unknown 50',
				entities: [{ type: 'mention', offset: 8, length: 8 }],
			},
		});

		mockPreparedStatement.first.mockResolvedValueOnce(null);

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining("hasn't interacted with the bot yet"),
			expect.any(Object)
		);
	});

	it('should include trip in settlement if active', async () => {
		const ctx = createMockContext({
			message: {
				text: '/settle @john 50',
				entities: [
					{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321 },
					},
				],
			},
		});

		mockPreparedStatement.first.mockResolvedValueOnce({
			id: 'trip-123',
			name: 'Beach Trip',
		});

		await handleSettle(ctx, db);

		expect(ctx.reply).toHaveBeenCalledWith(
			expect.stringContaining('Trip: Beach Trip'),
			expect.any(Object)
		);
	});

	it('should send DM notification on settlement', async () => {
		const ctx = createMockContext({
			message: {
				text: '/settle @john 50',
				entities: [
					{
						type: 'text_mention',
						offset: 8,
						length: 5,
						user: { id: 987654321 },
					},
				],
			},
		});

		await handleSettle(ctx, db);

		expect(ctx.api.sendMessage).toHaveBeenCalledWith(
			987654321,
			expect.stringContaining('received your payment'),
			expect.any(Object)
		);
	});
});