import { describe, it, expect, vi } from 'vitest';
import { deleteUserMessage, cleanupBotMessage } from '../../utils/message-cleanup';
import { createMockContext } from '../mocks/context';

describe('Message cleanup utilities', () => {
	describe('deleteUserMessage', () => {
		it('should delete user message in group chat', async () => {
			const ctx = createMockContext({
				chat: { id: -1001234567890, type: 'group' },
				message: { message_id: 123 },
			});

			await deleteUserMessage(ctx);

			expect(ctx.deleteMessage).toHaveBeenCalled();
		});

		it('should not delete in private chat', async () => {
			const ctx = createMockContext({
				chat: { id: 123456789, type: 'private' },
				message: { message_id: 123 },
			});

			await deleteUserMessage(ctx);

			expect(ctx.deleteMessage).not.toHaveBeenCalled();
		});

		it('should handle missing message gracefully', async () => {
			const ctx = createMockContext({
				message: null,
			});

			// Should not throw
			await expect(deleteUserMessage(ctx)).resolves.not.toThrow();
		});

		it('should handle deletion errors gracefully', async () => {
			const ctx = createMockContext();
			ctx.deleteMessage = vi.fn().mockRejectedValue(new Error('No permission'));

			// Should not throw
			await expect(deleteUserMessage(ctx)).resolves.not.toThrow();
		});
	});

	describe('cleanupBotMessage', () => {
		it('should schedule message deletion', () => {
			const ctx = createMockContext();
			const messageId = 456;

			vi.useFakeTimers();
			cleanupBotMessage(ctx, messageId, 1000);

			expect(ctx.deleteMessage).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1000);

			expect(ctx.deleteMessage).toHaveBeenCalledWith(messageId);
			vi.useRealTimers();
		});

		it('should use default delay', () => {
			const ctx = createMockContext();
			const messageId = 456;

			vi.useFakeTimers();
			cleanupBotMessage(ctx, messageId);

			vi.advanceTimersByTime(29999);
			expect(ctx.deleteMessage).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1);
			expect(ctx.deleteMessage).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it('should handle cleanup errors gracefully', () => {
			const ctx = createMockContext();
			ctx.deleteMessage = vi.fn().mockRejectedValue(new Error('Message not found'));

			vi.useFakeTimers();
			cleanupBotMessage(ctx, 456);
			
			// Should not throw when timer executes
			expect(() => vi.runAllTimers()).not.toThrow();
			vi.useRealTimers();
		});
	});
});