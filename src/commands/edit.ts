import { Context } from 'grammy';
import { eq, and } from 'drizzle-orm';
import { type Database, withRetry, formatAmount, parseDecimal } from '../db';
import { expenses, expenseSplits, users } from '../db/schema';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { parseEnhancedSplits } from '../utils/split-parser';
import { logger } from '../utils/logger';

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
		// Get expense details
		const expense = await withRetry(async () => {
			const result = await db
				.select({
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					notes: expenses.notes,
					paidBy: expenses.paidBy,
					createdBy: expenses.createdBy,
					groupId: expenses.groupId,
					isPersonal: expenses.isPersonal,
					payerUsername: users.username,
					payerFirstName: users.firstName,
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(and(eq(expenses.id, expenseId), eq(expenses.deleted, false)))
				.limit(1);
			return result[0];
		});

		if (!expense) {
			await reply(ctx, '❌ Expense not found');
			return;
		}

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

				await withRetry(async () => {
					await db
						.update(expenses)
						.set({ amount: formatAmount(newAmount) })
						.where(eq(expenses.id, expenseId));
				});

				// If not personal, update splits proportionally
				if (!expense.isPersonal) {
					const ratio = newAmount / currentAmount;

					await withRetry(async () => {
						// Get existing splits
						const splits = await db
							.select({
								userId: expenseSplits.userId,
								amount: expenseSplits.amount,
							})
							.from(expenseSplits)
							.where(eq(expenseSplits.expenseId, expenseId));

						// Update each split
						for (const split of splits) {
							const oldSplitAmount = parseDecimal(split.amount);
							const newSplitAmount = oldSplitAmount * ratio;

							await db
								.update(expenseSplits)
								.set({ amount: formatAmount(newSplitAmount) })
								.where(and(eq(expenseSplits.expenseId, expenseId), eq(expenseSplits.userId, split.userId)));
						}
					});
				}

				updateMessage = `✅ Amount updated from ${formatCurrency(currentAmount, expense.currency || 'USD')} to ${formatCurrency(newAmount, expense.currency || 'USD')}`;
				break;
			}

			case 'description': {
				const newDescription = value.trim();
				if (!newDescription) {
					await reply(ctx, '❌ Description cannot be empty');
					return;
				}

				await withRetry(async () => {
					await db.update(expenses).set({ description: newDescription }).where(eq(expenses.id, expenseId));
				});

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

				await withRetry(async () => {
					await db.update(expenses).set({ category: newCategory }).where(eq(expenses.id, expenseId));
				});

				updateMessage = `✅ Category updated to "${newCategory}"`;
				break;
			}

			case 'notes': {
				const newNote = value.trim();

				await withRetry(async () => {
					await db
						.update(expenses)
						.set({ notes: newNote || null })
						.where(eq(expenses.id, expenseId));
				});

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

				await withRetry(async () => {
					// Delete old splits
					await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));

					// Add new splits
					const { splits } = parsedSplits;
					const splitEntries: Array<{ userId: string; amount: number }> = [];

					for (const [mention, splitInfo] of splits) {
						// Resolve username to user ID
						const username = mention.substring(1);
						const user = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.username, username)).limit(1);

						if (user[0]) {
							splitEntries.push({
								userId: user[0].telegramId,
								amount: splitInfo.value,
							});
						}
					}

					// Insert new splits
					if (splitEntries.length > 0) {
						await db.insert(expenseSplits).values(
							splitEntries.map((split) => ({
								expenseId: expenseId,
								userId: split.userId,
								amount: formatAmount(split.amount),
							})),
						);
					}

					updateMessage = `✅ Splits updated for ${splitEntries.length} participants`;
				});
				break;
			}

			default:
				await reply(ctx, '❌ Invalid field. Use: amount, description, category, notes, or splits');
				return;
		}

		// Show update confirmation
		const payerName = expense.payerUsername || expense.payerFirstName || 'Unknown';
		await reply(
			ctx,
			`${updateMessage}\n\n` +
				`📝 <b>Expense Details:</b>\n` +
				`ID: <code>${expenseId}</code>\n` +
				`Description: ${expense.description || 'No description'}\n` +
				`Amount: ${formatCurrency(currentAmount, expense.currency || 'USD')}\n` +
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
		const expense = await withRetry(async () => {
			const result = await db
				.select({
					id: expenses.id,
					amount: expenses.amount,
					currency: expenses.currency,
					description: expenses.description,
					category: expenses.category,
					payerUsername: users.username,
					payerFirstName: users.firstName,
				})
				.from(expenses)
				.innerJoin(users, eq(expenses.paidBy, users.telegramId))
				.where(and(eq(expenses.id, expenseId), eq(expenses.deleted, false)))
				.limit(1);
			return result[0];
		});

		if (!expense) {
			await ctx.reply('❌ Expense not found');
			return;
		}

		const payerName = expense.payerUsername || expense.payerFirstName || 'Unknown';
		const amount = parseDecimal(expense.amount);

		await ctx.reply(
			`✏️ <b>Edit Expense</b>\n\n` +
				`ID: <code>${expenseId}</code>\n` +
				`Description: ${expense.description || 'No description'}\n` +
				`Amount: ${formatCurrency(amount, expense.currency || 'USD')}\n` +
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
