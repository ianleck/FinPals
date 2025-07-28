import { Bot } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { formatCurrency } from './currency';

export async function processRecurringExpenses(db: D1Database, bot: Bot<any>): Promise<{ created: number; errors: number }> {
	const stats = { created: 0, errors: 0 };
	
	try {
		// Get all due recurring expenses
		const now = new Date();
		const dueExpenses = await db.prepare(`
			SELECT r.*, g.title as group_title
			FROM recurring_expenses r
			LEFT JOIN groups g ON r.group_id = g.telegram_id
			WHERE r.active = TRUE AND r.next_due <= ?
		`).bind(now.toISOString()).all();
		
		for (const recurring of dueExpenses.results) {
			try {
				// Create the expense
				const expenseId = crypto.randomUUID();
				
				// Insert the expense
				await db.prepare(`
					INSERT INTO expenses (
						id, group_id, amount, currency, description, category,
						paid_by, created_by, is_personal, recurring_expense_id
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).bind(
					expenseId,
					recurring.group_id,
					recurring.amount,
					recurring.currency || 'USD',
					recurring.description || recurring.name,
					recurring.category,
					recurring.created_by,
					recurring.created_by,
					recurring.is_personal,
					recurring.id
				).run();
				
				// Create splits based on participants
				if (!recurring.is_personal) {
					let participantIds: string[] = [];
					
					if (recurring.participants === 'all') {
						// Get all active group members
						const members = await db.prepare(`
							SELECT user_id FROM group_members 
							WHERE group_id = ? AND active = TRUE
						`).bind(recurring.group_id).all();
						
						participantIds = members.results.map(m => m.user_id as string);
					} else {
						// Parse specific participants
						try {
							participantIds = JSON.parse(recurring.participants as string);
						} catch {
							participantIds = [recurring.created_by as string];
						}
					}
					
					// Always include the creator if not already included
					if (!participantIds.includes(recurring.created_by as string)) {
						participantIds.push(recurring.created_by as string);
					}
					
					// Create even splits
					const splitAmount = (recurring.amount as number) / participantIds.length;
					
					// Batch insert splits
					if (participantIds.length > 0) {
						const values = participantIds.map(() => '(?, ?, ?)').join(',');
						const bindings: any[] = [];
						
						for (const userId of participantIds) {
							bindings.push(expenseId, userId, splitAmount);
						}
						
						await db.prepare(
							`INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ${values}`
						).bind(...bindings).run();
					}
				}
				
				// Calculate next due date
				let nextDue = new Date(recurring.next_due as string);
				
				switch (recurring.frequency) {
					case 'daily':
						nextDue.setDate(nextDue.getDate() + 1);
						break;
					case 'weekly':
						nextDue.setDate(nextDue.getDate() + 7);
						break;
					case 'monthly':
						nextDue.setMonth(nextDue.getMonth() + 1);
						break;
					case 'yearly':
						nextDue.setFullYear(nextDue.getFullYear() + 1);
						break;
				}
				
				// Update recurring expense with new next_due and last_created
				await db.prepare(`
					UPDATE recurring_expenses 
					SET next_due = ?, last_created = ? 
					WHERE id = ?
				`).bind(nextDue.toISOString(), now.toISOString(), recurring.id).run();
				
				stats.created++;
				
				// Send notification to group or user
				if (!recurring.is_personal) {
					try {
						const chatId = recurring.group_id;
						const memberCount = participantIds.length;
						const message = `📅 <b>Recurring Expense Created</b>\n\n` +
							`${recurring.name}\n` +
							`Amount: ${formatCurrency(recurring.amount as number, recurring.currency as string)}\n` +
							`Split between ${memberCount} members`;
						
						await bot.api.sendMessage(chatId as string, message, {
							parse_mode: 'HTML',
							reply_markup: {
								inline_keyboard: [[
									{ text: '📊 View Balance', callback_data: 'view_balance' },
									{ text: '📅 Manage Recurring', callback_data: 'recurring_list' }
								]]
							}
						});
					} catch (error) {
						console.error('Error sending notification for recurring expense:', error);
					}
				}
				
			} catch (error) {
				console.error('Error processing recurring expense:', recurring.id, error);
				stats.errors++;
			}
		}
		
	} catch (error) {
		console.error('Error processing recurring expenses:', error);
		stats.errors++;
	}
	
	return stats;
}