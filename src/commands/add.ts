import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';
import { replyAndCleanup, MESSAGE_LIFETIMES } from '../utils/message';
import { deleteUserMessage } from '../utils/message-cleanup';
import { generateInsight } from '../utils/smart-insights';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { checkBudgetAfterExpense } from '../utils/budget-alerts';

// Enhanced AI categorization with emoji detection and context
function suggestCategory(description: string, amount?: number): string | null {
	const lowerDesc = description.toLowerCase();
	
	// Check for emojis first (high confidence)
	const emojiCategories: { [key: string]: string } = {
		'🍕🍔🍟🌮🍜🍱🍝🥘🍳☕': 'Food & Dining',
		'🚗🚕🚙🚌🚇✈️🛫⛽': 'Transportation',
		'🎬🎮🎯🎪🎭🎨🎵': 'Entertainment',
		'🛍️👗👕👖👠💄': 'Shopping',
		'🏠💡💧📱💻🔌': 'Bills & Utilities',
		'🏨🏖️✈️🗺️🎒': 'Travel',
		'💊💉🏥👨‍⚕️': 'Healthcare',
		'📚📖✏️🎓': 'Education'
	};
	
	for (const [emojis, category] of Object.entries(emojiCategories)) {
		if ([...description].some(char => emojis.includes(char))) {
			return category;
		}
	}

	const categoryKeywords: { [key: string]: string[] } = {
		'Food & Dining': [
			'lunch',
			'dinner',
			'breakfast',
			'food',
			'meal',
			'restaurant',
			'cafe',
			'coffee',
			'pizza',
			'burger',
			'sushi',
			'drink',
			'bar',
		],
		Transportation: ['uber', 'lyft', 'taxi', 'gas', 'fuel', 'parking', 'toll', 'bus', 'train', 'flight', 'car'],
		Entertainment: ['movie', 'concert', 'game', 'ticket', 'show', 'netflix', 'spotify', 'museum', 'park'],
		Shopping: ['amazon', 'store', 'buy', 'purchase', 'clothes', 'shoes', 'gift'],
		'Bills & Utilities': ['rent', 'electricity', 'water', 'internet', 'phone', 'bill', 'utility'],
		Travel: ['hotel', 'airbnb', 'booking', 'trip', 'vacation', 'travel'],
		Healthcare: ['doctor', 'medicine', 'pharmacy', 'hospital', 'clinic', 'health'],
		Education: ['book', 'course', 'class', 'tuition', 'school', 'university'],
	};

	// Check keywords with context scoring
	let bestMatch = { category: null as string | null, score: 0 };
	
	for (const [category, keywords] of Object.entries(categoryKeywords)) {
		let score = 0;
		for (const keyword of keywords) {
			if (lowerDesc.includes(keyword)) {
				// Exact word match scores higher
				if (lowerDesc.split(/\s+/).includes(keyword)) {
					score += 2;
				} else {
					score += 1;
				}
			}
		}
		if (score > bestMatch.score) {
			bestMatch = { category, score };
		}
	}
	
	// Time-based intelligence
	const hour = new Date().getHours();
	if (!bestMatch.category && lowerDesc.length < 20) {
		if (hour >= 6 && hour < 11) {
			// Morning = likely breakfast/coffee
			if (['coffee', 'breakfast', 'morning'].some(w => lowerDesc.includes(w))) {
				return 'Food & Dining';
			}
		} else if (hour >= 11 && hour < 15) {
			// Lunch time
			if (!lowerDesc.includes('uber') && !lowerDesc.includes('taxi')) {
				return 'Food & Dining';
			}
		} else if (hour >= 18 && hour < 22) {
			// Dinner/entertainment time
			if (amount && amount > 50) return 'Food & Dining';
			if (amount && amount < 20) return 'Transportation';
		}
	}

	return bestMatch.category;
}

// Parse custom split amounts from mentions (e.g., @john=30)
function parseCustomSplits(args: string[]): { mentions: string[]; customSplits: Map<string, number> } {
	const mentions: string[] = [];
	const customSplits = new Map<string, number>();

	for (const arg of args) {
		if (arg.startsWith('@')) {
			if (arg.includes('=')) {
				// Custom split amount
				const [mention, amountStr] = arg.split('=');
				const amount = parseFloat(amountStr);
				if (!isNaN(amount) && amount > 0) {
					customSplits.set(mention, amount);
					mentions.push(mention);
				}
			} else {
				// Regular mention
				mentions.push(arg);
			}
		}
	}

	return { mentions, customSplits };
}

export async function handleAdd(ctx: Context, db: D1Database) {
	const isPersonal = ctx.chat?.type === 'private';

	const message = ctx.message?.text || '';
	const args = message.split(' ').filter(s => s.length > 0).slice(1); // Remove the /add command and filter empty strings

	if (args.length < 2) {
		const usage = isPersonal
			? '❌ Invalid format!\n\n' +
			  'Usage: /add [amount] [description]\n' +
			  'Examples:\n' +
			  '• /add 120 lunch\n' +
			  '• /add 50 groceries\n' +
			  '• /add 30.50 coffee'
			: '❌ Invalid format!\n\n' +
			  'Usage: /add [amount] [description] [@mentions]\n' +
			  'Examples:\n' +
			  '• /add 120 lunch - Split evenly with all\n' +
			  '• /add 120 lunch @john @sarah - Split evenly\n' +
			  '• /add 120 lunch @john=50 @sarah=70 - Custom amounts';
		
		await replyAndCleanup(
			ctx,
			usage,
			{ parse_mode: 'HTML' },
			MESSAGE_LIFETIMES.ERROR
		);
		return;
	}

	// Parse amount
	const amount = parseFloat(args[0]);
	if (isNaN(amount) || amount <= 0) {
		await replyAndCleanup(ctx, ERROR_MESSAGES.INVALID_AMOUNT, {}, MESSAGE_LIFETIMES.ERROR);
		return;
	}

	// Parse description and mentions
	const descriptionParts: string[] = [];
	const mentionArgs: string[] = [];

	// For personal expenses, all args after amount are description
	if (isPersonal) {
		for (let i = 1; i < args.length; i++) {
			descriptionParts.push(args[i]);
		}
	} else {
		for (let i = 1; i < args.length; i++) {
			if (args[i].startsWith('@')) {
				mentionArgs.push(args[i]);
			} else if (mentionArgs.length === 0) {
				descriptionParts.push(args[i]);
			}
		}
	}

	const description = descriptionParts.join(' ') || 'Expense';
	const { mentions, customSplits } = parseCustomSplits(mentionArgs);

	// Get participants
	const groupId = ctx.chat?.id.toString() || '';
	const paidBy = ctx.from!.id.toString();
	const paidByUsername = ctx.from!.username || ctx.from!.first_name || 'Unknown';

	// Parse mentions from the message entities
	const mentionedUserIds: string[] = [];
	const unknownMentions: string[] = [];
	const userIdToUsername = new Map<string, string>();

	if (mentions.length > 0 && ctx.message?.entities) {
		for (const entity of ctx.message.entities) {
			if (entity.type === 'mention' || entity.type === 'text_mention') {
				if (entity.type === 'text_mention' && entity.user) {
					mentionedUserIds.push(entity.user.id.toString());
					userIdToUsername.set(entity.user.id.toString(), entity.user.username || entity.user.first_name || 'User');
				} else if (entity.type === 'mention') {
					const username = ctx.message.text!.substring(entity.offset + 1, entity.offset + entity.length);
					// Check if this mention has a custom split
					const mentionWithSplit = mentions.find((m) => m.substring(1).startsWith(username));
					if (mentionWithSplit) {
						unknownMentions.push(mentionWithSplit.split('=')[0]);
					}
				}
			}
		}
	}

	try {
		const expenseId = crypto.randomUUID();

		// Get group info or create it (only for group expenses)
		if (!isPersonal) {
			const group = await db.prepare('SELECT * FROM groups WHERE telegram_id = ?').bind(groupId).first();

			if (!group) {
				await db
					.prepare('INSERT INTO groups (telegram_id, title) VALUES (?, ?)')
					.bind(groupId, ctx.chat!.title || 'Group')
					.run();
			}

			// Ensure payer is in group
			await db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').bind(groupId, paidBy).run();
		}

		// Ensure payer is in users table
		await db
			.prepare('INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)')
			.bind(paidBy, ctx.from!.username || null, ctx.from!.first_name || null)
			.run();

		// Get participants based on mentions
		let participants: Array<{ userId: string; amount?: number }> = [];
		let warningMessage = '';

		if (isPersonal) {
			// Personal expenses only have the user as participant
			participants = [{ userId: paidBy, amount: amount }];
		} else {
			if (mentions.length === 0) {
				// Check for recurring expense pattern
				const similarExpenses = await db
					.prepare(
						`
					SELECT es.user_id, COUNT(*) as count
					FROM expenses e
					JOIN expense_splits es ON e.id = es.expense_id
					WHERE e.group_id = ? 
						AND e.deleted = FALSE
						AND LOWER(e.description) LIKE ?
						AND e.created_at > datetime('now', '-30 days')
					GROUP BY es.user_id
					ORDER BY count DESC
				`
					)
					.bind(groupId, `%${description.toLowerCase()}%`)
					.all();

				if (similarExpenses.results.length > 0) {
					participants = similarExpenses.results.map((r) => ({ userId: r.user_id as string }));
				} else {
					const members = await db.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND active = TRUE').bind(groupId).all();

					participants = members.results.map((m) => ({ userId: m.user_id as string }));
				}
			} else {
				// Handle mentioned users with custom amounts
				for (const userId of mentionedUserIds) {
					const username = userIdToUsername.get(userId);
					const customAmount = username ? customSplits.get('@' + username) : undefined;
					participants.push({ userId, amount: customAmount });
				}

				// Try to resolve unknown mentions with batch query
				if (unknownMentions.length > 0) {
					const usernames = unknownMentions.map(m => m.substring(1));
					const placeholders = usernames.map(() => '?').join(',');
					const users = await db
						.prepare(
							`SELECT u.telegram_id, u.username 
							FROM users u 
							JOIN group_members gm ON u.telegram_id = gm.user_id 
							WHERE gm.group_id = ? 
							AND u.username IN (${placeholders})
							AND gm.active = TRUE`
						)
						.bind(groupId, ...usernames)
						.all();

					// Create a map for quick lookup
					const foundUsers = new Map(
						users.results.map(u => [u.username as string, u.telegram_id as string])
					);

					// Process each mention
					for (const mention of unknownMentions) {
						const username = mention.substring(1);
						const userId = foundUsers.get(username);
						
						if (userId) {
							const customAmount = customSplits.get(mention);
							participants.push({ userId, amount: customAmount });
						} else {
							warningMessage += `\n⚠️ ${mention} hasn't interacted with the bot yet`;
						}
					}
				}

				// Always include the payer if not already included
				if (!participants.some((p) => p.userId === paidBy)) {
					participants.push({ userId: paidBy });
				}
			}

			if (participants.length === 0) {
				participants = [{ userId: paidBy }];
			}
		}

		// Validate custom splits if provided (not for personal expenses)
		if (!isPersonal) {
			const hasCustomSplits = participants.some((p) => p.amount !== undefined);
			if (hasCustomSplits) {
				const totalCustom = participants.reduce((sum, p) => sum + (p.amount || 0), 0);
				const remainingAmount = amount - totalCustom;

				// Check if custom amounts exceed total
				if (totalCustom > amount) {
					await reply(ctx, `❌ Custom split amounts ($${totalCustom.toFixed(2)}) exceed the total expense ($${amount.toFixed(2)})!`, {
						parse_mode: 'HTML',
					});
					return;
				}

				// Distribute remaining amount among users without custom amounts
				const usersWithoutCustom = participants.filter((p) => p.amount === undefined);
				if (usersWithoutCustom.length > 0 && remainingAmount > 0) {
					const splitAmount = remainingAmount / usersWithoutCustom.length;
					usersWithoutCustom.forEach((p) => (p.amount = splitAmount));
				} else if (remainingAmount > 0.01) {
					await reply(ctx,
						`❌ Custom splits don't add up to the total!\n` +
							`Total: ${formatCurrency(amount, 'USD')}\n` +
							`Assigned: $${totalCustom.toFixed(2)}\n` +
							`Remaining: $${remainingAmount.toFixed(2)}`,
						{ parse_mode: 'HTML' }
					);
					return;
				}
			} else {
				// Even split for all participants
				const splitAmount = amount / participants.length;
				participants.forEach((p) => (p.amount = splitAmount));
			}
		}

		// Auto-categorize
		let category = suggestCategory(description, amount);

		if (!category) {
			const learned = await db
				.prepare('SELECT category FROM category_mappings WHERE description_pattern = ? ORDER BY confidence DESC LIMIT 1')
				.bind(description.toLowerCase())
				.first();

			if (learned) {
				category = learned.category as string;
			}
		}

		// Check for active trip (only for group expenses)
		let activeTrip = null;
		if (!isPersonal) {
			activeTrip = await db
				.prepare(
					`
				SELECT id, name FROM trips 
				WHERE group_id = ? AND status = 'active'
				LIMIT 1
			`
				)
				.bind(groupId)
				.first();
		}

		// Create expense
		await db
			.prepare(
				'INSERT INTO expenses (id, group_id, trip_id, amount, description, category, paid_by, created_by, is_personal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.bind(expenseId, isPersonal ? null : groupId, activeTrip?.id || null, amount, description, category, paidBy, paidBy, isPersonal)
			.run();

		// Create splits with batch insert
		const notifyUsers: Array<{ userId: string; amount: number }> = [];

		// Prepare batch insert for expense splits
		if (participants.length > 0) {
			const values = participants.map(() => '(?, ?, ?)').join(',');
			const bindings: any[] = [];
			
			for (const participant of participants) {
				bindings.push(expenseId, participant.userId, participant.amount!);
				
				// Collect users to notify (except the payer)
				if (participant.userId !== paidBy) {
					notifyUsers.push({ userId: participant.userId, amount: participant.amount! });
				}
			}
			
			await db
				.prepare(`INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ${values}`)
				.bind(...bindings)
				.run();
		}

		// Get participant names for display
		let participantDisplay = '';
		if (!isPersonal) {
			const participantIds = participants.map((p) => p.userId);
			const participantNames = await db
				.prepare(`SELECT telegram_id, username, first_name FROM users WHERE telegram_id IN (${participantIds.map(() => '?').join(',')})`)
				.bind(...participantIds)
				.all();

			participantDisplay = participantNames.results
				.map((p) => {
					const participant = participants.find((part) => part.userId === p.telegram_id);
					const name = '@' + (p.username || p.first_name || 'User');
					return participant?.amount ? `${name} (${formatCurrency(participant.amount, 'USD')})` : name;
				})
				.join(', ');
		}

		// Helper function to escape HTML
		const escapeHtml = (text: string) => {
			return text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		};

		// Generate smart insight
		const insight = generateInsight(description, amount, category, participants.length);

		// Send confirmation
		if (!isPersonal) {
			await deleteUserMessage(ctx);
		}
		
		const confirmationMessage = isPersonal
			? `✅ <b>Personal Expense Added</b>\n\n` +
			  `💵 Amount: <b>${formatCurrency(amount, 'USD')}</b>\n` +
			  `📝 Description: ${escapeHtml(description)}\n` +
			  (category ? `📂 Category: ${category} (auto-detected)\n` : '') +
			  (insight ? `\n${insight}` : '')
			: `✅ <b>Expense Added</b>\n\n` +
			  `💵 Amount: <b>${formatCurrency(amount, 'USD')}</b>\n` +
			  `📝 Description: ${escapeHtml(description)}\n` +
			  `👤 Paid by: @${paidByUsername}\n` +
			  `👥 Split: ${participantDisplay}\n` +
			  (category ? `📂 Category: ${category} (auto-detected)\n` : '') +
			  (activeTrip ? `🏝 Trip: ${escapeHtml(activeTrip.name as string)}\n` : '') +
			  (insight ? `\n${insight}\n` : '') +
			  warningMessage +
			  (notifyUsers.length > 0 ? '\n\n📨 Notifying participants...' : '');

		const keyboard = isPersonal
			? [
				[
					{ text: '📂 Change Category', callback_data: `cat:${expenseId}` },
					{ text: '🗑️ Delete', callback_data: `del:${expenseId}` },
				],
				[
					{ text: '📊 View Expenses', callback_data: 'view_personal_expenses' },
					{ text: '💵 Add Another', callback_data: 'add_expense_help' },
				],
				[{ text: '✅ Done', callback_data: 'close' }],
			  ]
			: [
				[
					{ text: '📂 Change Category', callback_data: `cat:${expenseId}` },
					{ text: '🗑️ Delete', callback_data: `del:${expenseId}` },
				],
				[
					{ text: '📊 View Balance', callback_data: 'view_balance' },
					{ text: '💵 Add Another', callback_data: 'add_expense_help' },
				],
				[{ text: '✅ Done', callback_data: 'close' }],
			  ];

		await reply(ctx, confirmationMessage, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: keyboard,
			},
		});

		// Note: Auto-deletion of bot messages not supported in serverless environment
		// User message has already been deleted

		// Check budget alerts for all participants
		if (category && participants.length > 0) {
			const bot = ctx.api;
			await Promise.all(
				participants.map(async (participant) => {
					try {
						await checkBudgetAfterExpense(
							db, 
							bot as any, 
							participant.userId, 
							groupId, 
							participant.amount || 0, 
							category
						);
					} catch (error) {
						console.error('Error checking budget for user:', participant.userId, error);
					}
				})
			);
		}

		// Send DM notifications to participants in parallel (only for group expenses)
		if (!isPersonal && notifyUsers.length > 0) {
			await Promise.all(
				notifyUsers.map(async (notify) => {
					try {
						await ctx.api.sendMessage(
							notify.userId,
							`💵 <b>You've been added to an expense!</b>\n\n` +
								`Group: ${ctx.chat?.title || 'your group'}\n` +
								`Description: ${escapeHtml(description)}\n` +
								`Total: ${formatCurrency(amount, 'USD')}\n` +
								`Paid by: @${paidByUsername}\n` +
								`Your share: <b>${formatCurrency(notify.amount, 'USD')}</b>\n\n` +
								`Use /balance in the group to see all balances.`,
							{ parse_mode: 'HTML' }
						);
					} catch (error) {
						// User might have blocked the bot or never started a conversation
					}
				})
			);
		}
	} catch (error) {
		// Error adding expense
		await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
	}
}
