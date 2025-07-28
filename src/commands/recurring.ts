import { Context } from 'grammy';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { parseEnhancedSplits } from '../utils/split-parser';

export async function handleRecurring(ctx: Context, db: D1Database) {
	const message = ctx.message?.text || '';
	const args = message.split(' ').filter(s => s.length > 0).slice(1);
	const isPersonal = ctx.chat?.type === 'private';
	
	if (args.length === 0) {
		await showRecurringExpenses(ctx, db);
		return;
	}
	
	const subCommand = args[0].toLowerCase();
	
	switch (subCommand) {
		case 'add':
			await handleAddRecurring(ctx, db, args.slice(1));
			break;
		case 'delete':
		case 'remove':
			await handleDeleteRecurring(ctx, db, args.slice(1));
			break;
		case 'pause':
			await handlePauseRecurring(ctx, db, args.slice(1));
			break;
		case 'resume':
			await handleResumeRecurring(ctx, db, args.slice(1));
			break;
		default:
			await reply(ctx,
				'❌ Invalid command!\n\n' +
				'Usage:\n' +
				'• /recurring - List all recurring expenses\n' +
				'• /recurring add [frequency] [amount] [description] [@mentions]\n' +
				'• /recurring delete [id]\n' +
				'• /recurring pause [id]\n' +
				'• /recurring resume [id]\n\n' +
				'Frequencies: daily, weekly, monthly\n\n' +
				'Examples:\n' +
				'• /recurring add monthly 1200 Rent @john @mary\n' +
				'• /recurring add weekly 50 Groceries',
				{ parse_mode: 'HTML' }
			);
	}
}

async function showRecurringExpenses(ctx: Context, db: D1Database) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from!.id.toString();
	const groupId = isPersonal ? null : ctx.chat!.id.toString();
	
	try {
		let query;
		let bindings;
		
		if (isPersonal) {
			// Show personal recurring expenses
			query = `
				SELECT r.*, u.username, u.first_name
				FROM recurring_expenses r
				JOIN users u ON r.created_by = u.telegram_id
				WHERE r.created_by = ? AND r.is_personal = TRUE
				ORDER BY r.active DESC, r.next_due ASC
			`;
			bindings = [userId];
		} else {
			// Show group recurring expenses
			query = `
				SELECT r.*, u.username, u.first_name
				FROM recurring_expenses r
				JOIN users u ON r.created_by = u.telegram_id
				WHERE r.group_id = ?
				ORDER BY r.active DESC, r.next_due ASC
			`;
			bindings = [groupId];
		}
		
		const recurring = await db.prepare(query).bind(...bindings).all();
		
		if (!recurring.results || recurring.results.length === 0) {
			await reply(ctx,
				'📅 <b>No Recurring Expenses</b>\n\n' +
				'Set up recurring expenses with:\n' +
				'<code>/recurring add monthly 1200 Rent</code>',
				{ parse_mode: 'HTML' }
			);
			return;
		}
		
		let message = '📅 <b>Recurring Expenses</b>\n\n';
		const buttons = [];
		
		for (const expense of recurring.results) {
			const status = expense.active ? '🟢' : '⏸️';
			const nextDue = new Date(expense.next_due as string).toLocaleDateString();
			const creatorName = expense.username || expense.first_name || 'Unknown';
			
			message += `${status} <b>${expense.name}</b>\n`;
			message += `   ${formatCurrency(expense.amount as number, expense.currency as string)} ${expense.frequency}\n`;
			message += `   Next: ${nextDue}\n`;
			if (!isPersonal) {
				message += `   Created by: @${creatorName}\n`;
			}
			message += `   ID: <code>${expense.id}</code>\n\n`;
			
			// Add management buttons
			const buttonRow = [];
			if (expense.active) {
				buttonRow.push({ text: '⏸️ Pause', callback_data: `recurring_pause:${expense.id}` });
			} else {
				buttonRow.push({ text: '▶️ Resume', callback_data: `recurring_resume:${expense.id}` });
			}
			buttonRow.push({ text: '🗑️ Delete', callback_data: `recurring_delete:${expense.id}` });
			buttons.push(buttonRow);
		}
		
		buttons.push([{ text: '➕ Add New', callback_data: 'recurring_add_help' }]);
		
		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: { inline_keyboard: buttons }
		});
		
	} catch (error) {
		console.error('Error showing recurring expenses:', error);
		await reply(ctx, '❌ Error loading recurring expenses');
	}
}

async function handleAddRecurring(ctx: Context, db: D1Database, args: string[]) {
	if (args.length < 3) {
		await reply(ctx,
			'❌ Invalid format!\n\n' +
			'Usage: /recurring add [frequency] [amount] [description] [@mentions]\n\n' +
			'Examples:\n' +
			'• /recurring add monthly 1200 Rent @john @mary\n' +
			'• /recurring add weekly 50 Groceries\n' +
			'• /recurring add daily 5 Coffee',
			{ parse_mode: 'HTML' }
		);
		return;
	}
	
	const frequency = args[0].toLowerCase();
	const validFrequencies = ['daily', 'weekly', 'monthly'];
	
	if (!validFrequencies.includes(frequency)) {
		await reply(ctx, '❌ Invalid frequency. Use: daily, weekly, or monthly');
		return;
	}
	
	const amount = parseFloat(args[1]);
	if (isNaN(amount) || amount <= 0) {
		await reply(ctx, '❌ Invalid amount');
		return;
	}
	
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from!.id.toString();
	const groupId = isPersonal ? null : ctx.chat!.id.toString();
	
	// Parse description and participants
	const descriptionParts: string[] = [];
	const mentionArgs: string[] = [];
	
	for (let i = 2; i < args.length; i++) {
		if (args[i].startsWith('@')) {
			mentionArgs.push(args[i]);
		} else if (mentionArgs.length === 0) {
			descriptionParts.push(args[i]);
		}
	}
	
	const description = descriptionParts.join(' ') || 'Recurring expense';
	
	// Calculate next due date
	const now = new Date();
	let nextDue = new Date();
	
	switch (frequency) {
		case 'daily':
			nextDue.setDate(nextDue.getDate() + 1);
			break;
		case 'weekly':
			nextDue.setDate(nextDue.getDate() + 7);
			break;
		case 'monthly':
			nextDue.setMonth(nextDue.getMonth() + 1);
			break;
	}
	
	// Set to start of day for consistency
	nextDue.setHours(0, 0, 0, 0);
	
	try {
		// For group expenses, parse participants
		let participants = 'all';
		if (!isPersonal && mentionArgs.length > 0) {
			// Parse enhanced splits to validate
			const parsedSplits = parseEnhancedSplits(mentionArgs, amount);
			const participantIds = [];
			
			// Get mentioned user IDs
			if (ctx.message?.entities) {
				for (const entity of ctx.message.entities) {
					if (entity.type === 'text_mention' && entity.user) {
						participantIds.push(entity.user.id.toString());
					}
				}
			}
			
			// Try to resolve usernames
			for (const mention of parsedSplits.mentions) {
				const username = mention.substring(1);
				const user = await db.prepare(
					'SELECT telegram_id FROM users u JOIN group_members gm ON u.telegram_id = gm.user_id WHERE gm.group_id = ? AND u.username = ?'
				).bind(groupId, username).first();
				
				if (user) {
					participantIds.push(user.telegram_id as string);
				}
			}
			
			if (participantIds.length > 0) {
				participants = JSON.stringify(participantIds);
			}
		}
		
		// Create recurring expense
		const recurringId = crypto.randomUUID();
		
		await db.prepare(`
			INSERT INTO recurring_expenses (
				id, group_id, name, amount, currency, description, frequency,
				participants, created_by, next_due, is_personal
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).bind(
			recurringId,
			groupId,
			description,
			amount,
			'USD',
			description,
			frequency,
			participants,
			userId,
			nextDue.toISOString(),
			isPersonal
		).run();
		
		let participantsInfo = '';
		if (!isPersonal) {
			if (participants === 'all') {
				participantsInfo = '\n👥 Split with: All group members';
			} else {
				const ids = JSON.parse(participants);
				participantsInfo = `\n👥 Split with: ${ids.length} specific members`;
			}
		}
		
		await reply(ctx,
			`✅ <b>Recurring Expense Created</b>\n\n` +
			`📅 ${description}\n` +
			`💵 ${formatCurrency(amount, 'USD')} ${frequency}\n` +
			`⏰ Next due: ${nextDue.toLocaleDateString()}` +
			participantsInfo +
			`\n\nID: <code>${recurringId}</code>`,
			{
				parse_mode: 'HTML',
				reply_markup: {
					inline_keyboard: [[
						{ text: '📋 View All', callback_data: 'recurring_list' },
						{ text: '✅ Done', callback_data: 'close' }
					]]
				}
			}
		);
		
	} catch (error) {
		console.error('Error creating recurring expense:', error);
		await reply(ctx, '❌ Error creating recurring expense');
	}
}

async function handleDeleteRecurring(ctx: Context, db: D1Database, args: string[]) {
	if (args.length === 0) {
		await reply(ctx, '❌ Please provide the recurring expense ID');
		return;
	}
	
	const recurringId = args[0];
	const userId = ctx.from!.id.toString();
	
	try {
		// Check if expense exists and user has permission
		const expense = await db.prepare(
			'SELECT * FROM recurring_expenses WHERE id = ? AND created_by = ?'
		).bind(recurringId, userId).first();
		
		if (!expense) {
			await reply(ctx, '❌ Recurring expense not found or you don\'t have permission to delete it');
			return;
		}
		
		// Delete the recurring expense
		await db.prepare('DELETE FROM recurring_expenses WHERE id = ?').bind(recurringId).run();
		
		await reply(ctx,
			`✅ <b>Recurring Expense Deleted</b>\n\n` +
			`"${expense.name}" has been removed`,
			{ parse_mode: 'HTML' }
		);
		
	} catch (error) {
		console.error('Error deleting recurring expense:', error);
		await reply(ctx, '❌ Error deleting recurring expense');
	}
}

async function handlePauseRecurring(ctx: Context, db: D1Database, args: string[]) {
	if (args.length === 0) {
		await reply(ctx, '❌ Please provide the recurring expense ID');
		return;
	}
	
	const recurringId = args[0];
	const userId = ctx.from!.id.toString();
	
	try {
		const result = await db.prepare(
			'UPDATE recurring_expenses SET active = FALSE WHERE id = ? AND created_by = ?'
		).bind(recurringId, userId).run();
		
		if (result.meta.changes === 0) {
			await reply(ctx, '❌ Recurring expense not found or you don\'t have permission');
			return;
		}
		
		await reply(ctx, '⏸️ Recurring expense paused');
		
	} catch (error) {
		console.error('Error pausing recurring expense:', error);
		await reply(ctx, '❌ Error pausing recurring expense');
	}
}

async function handleResumeRecurring(ctx: Context, db: D1Database, args: string[]) {
	if (args.length === 0) {
		await reply(ctx, '❌ Please provide the recurring expense ID');
		return;
	}
	
	const recurringId = args[0];
	const userId = ctx.from!.id.toString();
	
	try {
		// Calculate new next_due date based on frequency
		const expense = await db.prepare(
			'SELECT frequency FROM recurring_expenses WHERE id = ? AND created_by = ?'
		).bind(recurringId, userId).first();
		
		if (!expense) {
			await reply(ctx, '❌ Recurring expense not found or you don\'t have permission');
			return;
		}
		
		const now = new Date();
		let nextDue = new Date();
		
		switch (expense.frequency) {
			case 'daily':
				nextDue.setDate(nextDue.getDate() + 1);
				break;
			case 'weekly':
				nextDue.setDate(nextDue.getDate() + 7);
				break;
			case 'monthly':
				nextDue.setMonth(nextDue.getMonth() + 1);
				break;
		}
		
		nextDue.setHours(0, 0, 0, 0);
		
		await db.prepare(
			'UPDATE recurring_expenses SET active = TRUE, next_due = ? WHERE id = ? AND created_by = ?'
		).bind(nextDue.toISOString(), recurringId, userId).run();
		
		await reply(ctx, '▶️ Recurring expense resumed');
		
	} catch (error) {
		console.error('Error resuming recurring expense:', error);
		await reply(ctx, '❌ Error resuming recurring expense');
	}
}

export async function handleRecurringCallbacks(ctx: Context, db: D1Database) {
	const data = ctx.callbackQuery?.data || '';
	const [action, recurringId] = data.split(':');
	
	await ctx.answerCallbackQuery();
	
	switch (action) {
		case 'recurring_pause':
			await handlePauseRecurring(ctx, db, [recurringId]);
			await showRecurringExpenses(ctx, db);
			break;
		case 'recurring_resume':
			await handleResumeRecurring(ctx, db, [recurringId]);
			await showRecurringExpenses(ctx, db);
			break;
		case 'recurring_delete':
			// Show confirmation
			await ctx.editMessageText(
				'⚠️ <b>Delete Recurring Expense?</b>\n\n' +
				'This action cannot be undone.',
				{
					parse_mode: 'HTML',
					reply_markup: {
						inline_keyboard: [[
							{ text: '🗑️ Yes, Delete', callback_data: `recurring_confirm_delete:${recurringId}` },
							{ text: '❌ Cancel', callback_data: 'recurring_list' }
						]]
					}
				}
			);
			break;
		case 'recurring_confirm_delete':
			await handleDeleteRecurring(ctx, db, [recurringId]);
			await showRecurringExpenses(ctx, db);
			break;
		case 'recurring_list':
			await showRecurringExpenses(ctx, db);
			break;
		case 'recurring_add_help':
			await ctx.editMessageText(
				'➕ <b>Add Recurring Expense</b>\n\n' +
				'Usage:\n' +
				'<code>/recurring add [frequency] [amount] [description]</code>\n\n' +
				'Frequencies: daily, weekly, monthly\n\n' +
				'Examples:\n' +
				'• <code>/recurring add monthly 1200 Rent</code>\n' +
				'• <code>/recurring add weekly 50 Groceries</code>\n' +
				'• <code>/recurring add daily 5 Coffee</code>\n\n' +
				'For group expenses, add mentions:\n' +
				'• <code>/recurring add monthly 100 Netflix @john @mary</code>',
				{ parse_mode: 'HTML' }
			);
			break;
	}
}