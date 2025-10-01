import { Context } from 'grammy';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { type Database, withRetry } from '../db';
import { users, groups, groupMembers } from '../db/schema';
import { ERROR_MESSAGES } from '../utils/constants';
import { replyAndCleanup } from '../utils/message';
import { extractNote } from '../utils/note-parser';
import { parseEnhancedSplits } from '../utils/split-parser';
import { formatCurrency } from '../utils/currency';
import { createExpenseActionButtons } from '../utils/button-helpers';
import { Money, parseMoney } from '../utils/money';
import { DEFAULT_CURRENCY } from '../utils/currency-constants';
import * as expenseService from '../services/expense';

// Simple categorization function
function suggestCategory(description: string): string | null {
	const lowerDesc = description.toLowerCase();

	// Check for emojis first
	const emojiCategories: { [key: string]: string } = {
		'🍕🍔🍟🌮🍜🍱🍝🥘🍳☕': 'Food & Dining',
		'🚗🚕🚙🚌🚇✈️🛫⛽': 'Transportation',
		'🎬🎮🎯🎪🎭🎨🎵': 'Entertainment',
		'🛍️👗👕👖👠💄': 'Shopping',
		'🏠💡💧📱💻🔌': 'Bills & Utilities',
		'🏨🏖️✈️🗺️🎒': 'Travel',
		'💊💉🏥👨‍⚕️': 'Healthcare',
		'📚📖✏️🎓': 'Education',
	};

	for (const [emojis, category] of Object.entries(emojiCategories)) {
		if ([...description].some((char) => emojis.includes(char))) {
			return category;
		}
	}

	// Simple keyword matching
	const categoryKeywords: { [key: string]: string[] } = {
		'Food & Dining': ['lunch', 'dinner', 'breakfast', 'food', 'meal', 'restaurant', 'cafe', 'coffee', 'pizza'],
		Transportation: ['uber', 'lyft', 'taxi', 'gas', 'fuel', 'parking', 'bus', 'train', 'flight'],
		Entertainment: ['movie', 'concert', 'game', 'ticket', 'show', 'netflix', 'spotify'],
		Shopping: ['amazon', 'store', 'buy', 'purchase', 'clothes', 'shoes', 'gift'],
		'Bills & Utilities': ['rent', 'electricity', 'water', 'internet', 'phone', 'bill'],
		Travel: ['hotel', 'airbnb', 'booking', 'trip', 'vacation', 'travel'],
		Healthcare: ['doctor', 'medicine', 'pharmacy', 'hospital', 'clinic'],
		Education: ['book', 'course', 'class', 'tuition', 'school'],
	};

	for (const [category, keywords] of Object.entries(categoryKeywords)) {
		for (const keyword of keywords) {
			if (lowerDesc.includes(keyword)) {
				return category;
			}
		}
	}

	return null;
}

export async function handleAdd(ctx: Context, db: Database) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	const groupId = ctx.chat?.id.toString();

	if (!userId) {
		await replyAndCleanup(ctx, ERROR_MESSAGES.GENERIC, {});
		return;
	}

	const message = ctx.message?.text || '';
	const hasQuotes = message.includes('"') || message.includes("'");
	const { cleanedText, note } = hasQuotes ? extractNote(message) : { cleanedText: message, note: null };
	const args = cleanedText
		.split(' ')
		.filter((s) => s.length > 0)
		.slice(1);

	// Validate basic format
	if (args.length < 2) {
		const usage = isPersonal
			? '❌ Invalid format!\n\n' + 'Usage: /add [amount] [description]\n' + 'Examples:\n' + '• /add 120 lunch\n' + '• /add 50 groceries'
			: '❌ Invalid format!\n\n' +
				'Usage: /add [amount] [description] [@mentions]\n' +
				'Examples:\n' +
				'• /add 120 lunch - Split evenly with all\n' +
				'• /add 120 lunch @john @sarah - Split evenly\n' +
				'• /add 120 lunch @john=50 @sarah=70 - Fixed amounts';

		await replyAndCleanup(ctx, usage, { parse_mode: 'HTML' });
		return;
	}

	// Parse amount
	const amount = parseMoney(args[0]);
	if (!amount || amount.isZero() || amount.isNegative()) {
		await replyAndCleanup(ctx, ERROR_MESSAGES.INVALID_AMOUNT, {});
		return;
	}

	// Parse description and mentions
	const descriptionParts: string[] = [];
	const mentionArgs: string[] = [];

	if (isPersonal) {
		// For personal expenses, all args after amount are description
		for (let i = 1; i < args.length; i++) {
			descriptionParts.push(args[i]);
		}
	} else {
		// For group expenses, separate description from mentions
		for (let i = 1; i < args.length; i++) {
			if (args[i].startsWith('@') || args[i].startsWith('paid:@')) {
				mentionArgs.push(args[i]);
			} else if (mentionArgs.length === 0) {
				descriptionParts.push(args[i]);
			}
		}
	}

	const description = descriptionParts.join(' ') || 'Expense';

	try {
		// Parse participants for splits
		let participants: Array<{ userId: string; amount?: Money }> = [];
		let paidBy = userId; // Default to message sender

		if (isPersonal) {
			// Personal expense - only the user pays and owes
			participants = [{ userId: userId, amount: amount }];
		} else {
			// Parse mentions and splits
			let parsedSplits;
			try {
				parsedSplits = parseEnhancedSplits(mentionArgs, amount.toNumber());
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				throw new Error(`Split parsing error: ${errorMessage}`);
			}

			const { mentions, paidBy: paidByMention } = parsedSplits;

			// Handle paid:@user notation
			if (paidByMention && groupId) {
				const paidByUsername = paidByMention.substring(1); // Remove @
				const paidByUser = await withRetry(async () => {
					return await db
						.select()
						.from(users)
						.innerJoin(groupMembers, eq(users.telegramId, groupMembers.userId))
						.where(and(eq(groupMembers.groupId, groupId), eq(users.username, paidByUsername)))
						.limit(1);
				});

				if (paidByUser.length > 0) {
					paidBy = paidByUser[0].users.telegramId;
				}
			}

			// Get participants based on mentions or group members
			if (mentions.length === 0 && groupId) {
				// No mentions - split with all active group members
				const members = await withRetry(async () => {
					return await db
						.select({ userId: groupMembers.userId })
						.from(groupMembers)
						.where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.active, true)));
				});

				if (members.length > 0) {
					participants = members.map((m) => ({ userId: m.userId }));
				} else {
					// Fallback to just the payer
					participants = [{ userId: paidBy }];
				}
			} else if (groupId) {
				// Process mentioned users
				const usernames = mentions.map((m) => m.substring(1).split('=')[0]);
				const mentionedUsers = await withRetry(async () => {
					return await db
						.select({
							telegramId: users.telegramId,
							username: users.username,
						})
						.from(users)
						.innerJoin(groupMembers, eq(users.telegramId, groupMembers.userId))
						.where(and(eq(groupMembers.groupId, groupId), usernames.length > 0 ? inArray(users.username, usernames) : sql`1=0`));
				});

				participants = mentionedUsers.map((u) => ({ userId: u.telegramId }));

				// Always include the payer if not already included
				if (!participants.some((p) => p.userId === paidBy)) {
					participants.push({ userId: paidBy });
				}
			}
		}

		const category = suggestCategory(description);

		// Call service function (same logic, now extracted)
		const result = await expenseService.createExpense(db, {
			amount,
			currency: DEFAULT_CURRENCY,
			description,
			category: category || undefined,
			groupId: isPersonal ? undefined : groupId,
			paidBy,
			splits: participants,
			note: note || undefined,
			createdBy: userId,
		});

		// Format success message
		if (!result) {
			throw new Error('Failed to create expense');
		}

		let message = '';
		const currency = result.currency || 'SGD'; // Use the expense's currency directly
		if (isPersonal) {
			message =
				`✅ Personal expense added!\n\n` +
				`💰 Amount: ${formatCurrency(amount.toNumber(), currency)}\n` +
				`📝 Description: ${description}\n` +
				`${note ? `📌 Note: ${note}\n` : ''}`;
		} else {
			const participantCount = 1; // Simplified for now
			message =
				`✅ Expense added successfully!\n\n` +
				`💰 Amount: ${formatCurrency(amount.toNumber(), currency)}\n` +
				`📝 Description: ${description}\n` +
				`👥 Split between ${participantCount} people\n` +
				`${note ? `📌 Note: ${note}\n` : ''}`;
		}

		// Create action buttons if expense was created
		const buttons = createExpenseActionButtons(result.id, isPersonal);

		await ctx.reply(message, {
			parse_mode: 'HTML',
			reply_markup: buttons ? { inline_keyboard: buttons } : undefined,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		await replyAndCleanup(ctx, `❌ Error adding expense: ${errorMessage}`, {});
	}
}
