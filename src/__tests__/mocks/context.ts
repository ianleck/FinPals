import { Context } from 'grammy';
import { vi } from 'vitest';

export function createMockContext(overrides: any = {}): Context {
	const defaultContext = {
		chat: { id: -1001234567890, type: 'group', title: 'Test Group' },
		from: { id: 123456789, username: 'testuser', first_name: 'Test' },
		message: { text: '', chat: { id: -1001234567890 }, from: { id: 123456789 }, entities: [] },
		update: { update_id: 1, message: {} },
		reply: vi.fn().mockResolvedValue({ message_id: 1 }),
		answerCallbackQuery: vi.fn().mockResolvedValue(true),
		deleteMessage: vi.fn().mockResolvedValue(true),
		editMessageText: vi.fn().mockResolvedValue(true),
		api: {
			sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
			getChatMember: vi.fn().mockResolvedValue({ status: 'member' }),
			deleteMessage: vi.fn().mockResolvedValue(true),
		},
		callbackQuery: null,
		...overrides,
	};

	return defaultContext as unknown as Context;
}

export function createPrivateContext(overrides: any = {}): Context {
	return createMockContext({
		chat: { id: 123456789, type: 'private' },
		message: { 
			text: '', 
			chat: { id: 123456789, type: 'private' }, 
			from: { id: 123456789 },
			entities: [] 
		},
		...overrides,
	});
}

export function createForumSupergroupContext(overrides: any = {}): Context {
	return createMockContext({
		chat: { 
			id: -1001234567890, 
			type: 'supergroup', 
			title: 'Test Forum',
			is_forum: true 
		},
		message: { 
			text: '', 
			chat: { id: -1001234567890, type: 'supergroup', is_forum: true }, 
			from: { id: 123456789 },
			entities: [],
			message_thread_id: 42  // Default topic ID
		},
		...overrides,
	});
}