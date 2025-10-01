import { Context } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { type Database, withRetry, formatAmount, parseDecimal } from '../db';
import { expenses, expenseSplits, users } from '../db/schema';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { DEFAULT_CURRENCY } from '../utils/currency-constants';
import { parseEnhancedSplits } from '../utils/split-parser';
import { logger } from '../utils/logger';
import { Money } from '../utils/money';
import * as expenseService from '../services/expense';

export async function handleEdit(ctx: Context, db: Database) {
	const message = ctx.message?.text || '';
	const args = message
		.split(' ')
		.filter((s) => s.length > 0)
		.slice(1);

	if (args.length < 2) {
		await reply(
			ctx,
			'❌ Invalid format!\n\n' +
				'Usage: /edit [expense_id] [field] [new_value]\n\n' +
				'Fields:\n' +
				'• amount - Change expense amount\n' +
				'• description - Change description\n' +
				'• category - Change category\n' +
				"• splits - Change how it's split\n\n" +
				'Examples:\n' +
				'• /edit abc123 amount 50\n' +
				'• /edit abc123 description "Team lunch"\n' +
				'• /edit abc123 category "Food & Dining"\n' +
				'• /edit abc123 splits @john=30 @mary=20',
			{ parse_mode: 'HTML' },
		);
		return;
	}

	const [expenseId, field, ...valueArgs] = args;
	const value = valueArgs.join(' ');

	if (!value) {
		await reply(ctx, '❌ Please provide a new value');
		return;
	}

	const userId = ctx.from!.id.toString();
	const groupId = ctx.chat?.id.toString();

	try {
		// Get expense using service layer
		const expense = await expenseService.getExpenseById(db, expenseId);

		if (!expense) {
			await reply(ctx, '❌ Expense not found');
			return;
		}

		// Ensure it's from the right group context
		if (expense.groupId !== groupId) {
			await reply(ctx, '❌ Expense not found');
			return;
		}

		// Get payer info for display
		const payer = await withRetry(async () => {
			const result = await db
				.select({ username: users.username, firstName: users.firstName })
				.from(users)
				.where(eq(users.telegramId, expense.paidBy))
				.limit(1);
			return result[0];
		});

		// Check permissions - only creator or payer can edit
		if (expense.createdBy !== userId && expense.paidBy !== userId) {
			await reply(ctx, '❌ Only the expense creator or payer can edit it');
			return;
		}

		// Ensure it's from the right group/personal context
		const isPersonal = ctx.chat?.type === 'private';
		if (isPersonal && !expense.isPersonal) {
			await reply(ctx, '❌ This is a group expense. Edit it in the group.');
			return;
		}
		if (!isPersonal && expense.groupId !== groupId) {
			await reply(ctx, '❌ This expense belongs to a different group');
			return;
		}

		let updateMessage = '';
		const currentAmount = parseDecimal(expense.amount);

		switch (field.toLowerCase()) {
			case 'amount': {
				const newAmount = parseFloat(value);
				if (isNaN(newAmount) || newAmount <= 0) {
					await reply(ctx, '❌ Invalid amount');
					return;
				}

				// Use service layer with transaction support for atomicity
				await expenseService.updateExpenseAmount(db, expenseId, new Money(newAmount));

				updateMessage = `✅ Amount updated from ${formatCurrency(currentAmount, expense.currency || DEFAULT_CURRENCY)} to ${formatCurrency(newAmount, expense.currency || DEFAULT_CURRENCY)}`;
				break;
			}

			case 'description': {
				const newDescription = value.trim();
				if (!newDescription) {
					await reply(ctx, '❌ Description cannot be empty');
					return;
				}

				await expenseService.updateExpense(db, expenseId, { description: newDescription });

				updateMessage = `✅ Description updated to "${newDescription}"`;
				break;
			}

			case 'category': {
				const newCategory = value.trim();
				const validCategories = [
					'Food & Dining',
					'Transportation',
					'Entertainment',
					'Shopping',
					'Bills & Utilities',
					'Travel',
					'Healthcare',
					'Education',
					'Other',
				];

				if (!validCategories.includes(newCategory)) {
					await reply(ctx, '❌ Invalid category. Valid categories:\n' + validCategories.join(', '));
					return;
				}

				await expenseService.updateExpense(db, expenseId, { category: newCategory });

				updateMessage = `✅ Category updated to "${newCategory}"`;
				break;
			}

			case 'notes': {
				const newNote = value.trim();

				await expenseService.updateExpense(db, expenseId, { note: newNote || undefined });

				updateMessage = newNote ? `✅ Note updated to "${newNote}"` : `✅ Note removed`;
				break;
			}

			case 'splits': {
				if (expense.isPersonal) {
					await reply(ctx, '❌ Cannot change splits for personal expenses');
					return;
				}

				// Parse new splits
				const splitArgs = value.split(' ').filter((s) => s.startsWith('@'));
				if (splitArgs.length === 0) {
					await reply(ctx, '❌ Please specify participants with @mentions');
					return;
				}

				let parsedSplits;
				try {
					parsedSplits = parseEnhancedSplits(splitArgs, currentAmount);
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : 'Unknown error';
					await reply(ctx, `❌ ${errorMessage}`);
					return;
				}

				// Resolve usernames to user IDs (presentation logic)
				const { splits } = parsedSplits;
				const resolvedSplits: Array<{ userId: string; amount: Money }> = [];

				for (const [mention, splitInfo] of splits) {
					const username = mention.substring(1);
					const user = await withRetry(async () => {
						const result = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.username, username)).limit(1);
						return result[0];
					});

					if (user) {
						resolvedSplits.push({
							userId: user.telegramId,
							amount: new Money(splitInfo.value),
						});
					}
				}

				if (resolvedSplits.length === 0) {
					await reply(ctx, '❌ No valid users found in mentions');
					return;
				}

				// Use service layer with transaction support for atomicity
				await expenseService.updateExpenseSplits(db, expenseId, resolvedSplits);

				updateMessage = `✅ Splits updated for ${resolvedSplits.length} participants`;
				break;
			}

			default:
				await reply(ctx, '❌ Invalid field. Use: amount, description, category, notes, or splits');
				return;
		}

		// Show update confirmation
		const payerName = payer?.username || payer?.firstName || 'Unknown';
		await reply(
			ctx,
			`${updateMessage}\n\n` +
				`📝 <b>Expense Details:</b>\n` +
				`ID: <code>${expenseId}</code>\n` +
				`Description: ${expense.description || 'No description'}\n` +
				`Amount: ${formatCurrency(currentAmount, expense.currency || DEFAULT_CURRENCY)}\n` +
				`Paid by: @${payerName}\n` +
				`Category: ${expense.category || 'Uncategorized'}`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '✏️ Edit Again', callback_data: `edit:${expenseId}` },
							{ text: '🗑️ Delete', callback_data: `del:${expenseId}` },
						],
						[{ text: '✅ Done', callback_data: 'close' }],
					],
				},
			},
		);
	} catch (error) {
		logger.error('Error editing expense', error);
		await reply(ctx, '❌ Error editing expense. Please try again.');
	}
}

// Handle edit callbacks from expense list
export async function handleEditCallback(ctx: Context, db: Database, expenseId: string) {
	await ctx.answerCallbackQuery();

	try {
		const expense = await expenseService.getExpenseById(db, expenseId);

		if (!expense) {
			await ctx.reply('❌ Expense not found');
			return;
		}

		// Get payer info for display
		const payer = await withRetry(async () => {
			const result = await db
				.select({ username: users.username, firstName: users.firstName })
				.from(users)
				.where(eq(users.telegramId, expense.paidBy))
				.limit(1);
			return result[0];
		});

		const payerName = payer?.username || payer?.firstName || 'Unknown';
		const amount = parseDecimal(expense.amount);

		await ctx.reply(
			`✏️ <b>Edit Expense</b>\n\n` +
				`ID: <code>${expenseId}</code>\n` +
				`Description: ${expense.description || 'No description'}\n` +
				`Amount: ${formatCurrency(amount, expense.currency || DEFAULT_CURRENCY)}\n` +
				`Paid by: @${payerName}\n` +
				`Category: ${expense.category || 'Uncategorized'}\n\n` +
				`To edit, use:\n` +
				`<code>/edit ${expenseId} amount 75</code>\n` +
				`<code>/edit ${expenseId} description New description</code>\n` +
				`<code>/edit ${expenseId} category Food & Dining</code>\n` +
				`<code>/edit ${expenseId} splits @john=40 @mary=35</code>`,
			{ parse_mode: 'HTML' },
		);
	} catch (error) {
		logger.error('Error showing edit info', error);
		await ctx.reply('❌ Error loading expense details');
	}
}
