import { Context } from 'grammy';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { format } from 'date-fns';

interface ActivityItem {
	id: string;
	type: 'expense' | 'settlement';
	amount: number;
	description?: string;
	created_at: string;
	created_by: string;
	created_by_username?: string;
	created_by_first_name?: string;
	// For expenses
	participants?: number;
	category?: string;
	// For settlements
	from_user?: string;
	from_username?: string;
	from_first_name?: string;
	to_user?: string;
	to_username?: string;
	to_first_name?: string;
}

export async function handleActivity(ctx: Context, db: D1Database) {
	const isPersonal = ctx.chat?.type === 'private';
	const userId = ctx.from?.id.toString();
	
	if (isPersonal) {
		// Show personal activity across all groups
		await handlePersonalActivity(ctx, db, userId!);
		return;
	}

	const groupId = ctx.chat?.id.toString() || '';
	
	try {
		// Get recent expenses and settlements
		const activities = await db.prepare(`
			WITH recent_expenses AS (
				SELECT 
					e.id,
					'expense' as type,
					e.amount,
					e.description,
					e.created_at,
					e.paid_by as created_by,
					u.username as created_by_username,
					u.first_name as created_by_first_name,
					COUNT(DISTINCT es.user_id) as participants,
					e.category
				FROM expenses e
				LEFT JOIN users u ON e.paid_by = u.telegram_id
				LEFT JOIN expense_splits es ON e.id = es.expense_id
				WHERE e.group_id = ? AND e.deleted = FALSE
				GROUP BY e.id
				ORDER BY e.created_at DESC
				LIMIT 10
			),
			recent_settlements AS (
				SELECT 
					s.id,
					'settlement' as type,
					s.amount,
					NULL as description,
					s.created_at,
					s.created_by,
					uc.username as created_by_username,
					uc.first_name as created_by_first_name,
					NULL as participants,
					NULL as category,
					s.from_user,
					uf.username as from_username,
					uf.first_name as from_first_name,
					s.to_user,
					ut.username as to_username,
					ut.first_name as to_first_name
				FROM settlements s
				LEFT JOIN users uc ON s.created_by = uc.telegram_id
				LEFT JOIN users uf ON s.from_user = uf.telegram_id
				LEFT JOIN users ut ON s.to_user = ut.telegram_id
				WHERE s.group_id = ?
				ORDER BY s.created_at DESC
				LIMIT 10
			)
			SELECT * FROM (
				SELECT * FROM recent_expenses
				UNION ALL
				SELECT id, type, amount, description, created_at, created_by, 
					   created_by_username, created_by_first_name, participants, category,
					   from_user, from_username, from_first_name, to_user, to_username, to_first_name
				FROM recent_settlements
			)
			ORDER BY created_at DESC
			LIMIT 20
		`).bind(groupId, groupId).all<ActivityItem>();

		if (!activities.results || activities.results.length === 0) {
			await reply(ctx, '📊 No activity yet!\n\nStart tracking expenses with /add');
			return;
		}

		let message = '📊 <b>Recent Activity</b>\n\n';
		
		for (const activity of activities.results) {
			const createdAt = new Date(activity.created_at);
			const timeStr = format(createdAt, 'MMM d, h:mm a');
			const creatorName = activity.created_by_username || activity.created_by_first_name || 'User';
			
			if (activity.type === 'expense') {
				const icon = getExpenseIcon(activity.category);
				message += `${icon} <b>${formatCurrency(activity.amount, 'USD')}</b> - ${activity.description || 'Expense'}\n`;
				message += `   @${creatorName} • ${activity.participants} people • ${timeStr}\n\n`;
			} else {
				// Settlement
				const fromName = activity.from_username || activity.from_first_name || 'User';
				const toName = activity.to_username || activity.to_first_name || 'User';
				message += `💰 <b>Settled ${formatCurrency(activity.amount, 'USD')}</b>\n`;
				message += `   @${fromName} → @${toName} • ${timeStr}\n\n`;
			}
		}

		const buttons = [
			[{ text: '💸 Add Expense', callback_data: 'add_expense_help' }],
			[{ text: '📊 View Balance', callback_data: 'view_balance' }]
		];

		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: buttons
			}
		});
	} catch (error) {
		console.error('Error fetching activity:', error);
		await reply(ctx, '❌ Error fetching activity. Please try again.');
	}
}

async function handlePersonalActivity(ctx: Context, db: D1Database, userId: string) {
	try {
		// Get recent personal activity across all groups
		const activities = await db.prepare(`
			WITH user_expenses AS (
				SELECT 
					e.id,
					'expense' as type,
					e.amount,
					e.description,
					e.created_at,
					e.group_id,
					e.is_personal,
					g.name as group_name,
					e.category,
					es.amount as user_share
				FROM expenses e
				LEFT JOIN expense_splits es ON e.id = es.expense_id AND es.user_id = ?
				LEFT JOIN telegram_groups g ON e.group_id = g.id
				WHERE (e.paid_by = ? OR es.user_id = ?) AND e.deleted = FALSE
				ORDER BY e.created_at DESC
				LIMIT 15
			),
			user_settlements AS (
				SELECT 
					s.id,
					'settlement' as type,
					s.amount,
					NULL as description,
					s.created_at,
					s.group_id,
					FALSE as is_personal,
					g.name as group_name,
					NULL as category,
					s.amount as user_share,
					s.from_user,
					s.to_user,
					uf.username as from_username,
					ut.username as to_username
				FROM settlements s
				LEFT JOIN telegram_groups g ON s.group_id = g.id
				LEFT JOIN users uf ON s.from_user = uf.telegram_id
				LEFT JOIN users ut ON s.to_user = ut.telegram_id
				WHERE s.from_user = ? OR s.to_user = ?
				ORDER BY s.created_at DESC
				LIMIT 10
			)
			SELECT * FROM (
				SELECT * FROM user_expenses
				UNION ALL
				SELECT id, type, amount, description, created_at, group_id, is_personal, 
					   group_name, category, user_share, from_user, to_user, from_username, to_username
				FROM user_settlements
			)
			ORDER BY created_at DESC
			LIMIT 20
		`).bind(userId, userId, userId, userId, userId).all();

		if (!activities.results || activities.results.length === 0) {
			await reply(ctx, '📊 No personal activity yet!\n\nStart tracking expenses with /add');
			return;
		}

		let message = '📊 <b>Your Recent Activity</b>\n\n';
		
		for (const activity of activities.results) {
			const createdAt = new Date(activity.created_at as string);
			const timeStr = format(createdAt, 'MMM d');
			
			if (activity.type === 'expense') {
				const icon = getExpenseIcon(activity.category as string | undefined);
				const location = activity.is_personal ? '(Personal)' : `(${activity.group_name || 'Group'})`;
				
				message += `${icon} <b>${formatCurrency(activity.amount as number, 'USD')}</b> - ${activity.description || 'Expense'} ${location}\n`;
				if (!activity.is_personal && activity.user_share) {
					message += `   Your share: ${formatCurrency(activity.user_share as number, 'USD')} • ${timeStr}\n\n`;
				} else {
					message += `   ${timeStr}\n\n`;
				}
			} else {
				// Settlement
				const location = `(${activity.group_name || 'Group'})`;
				const direction = activity.from_user === userId ? 'paid' : 'received';
				const otherUser = activity.from_user === userId ? 
					`@${activity.to_username || 'User'}` : 
					`@${activity.from_username || 'User'}`;
				
				message += `💰 <b>${formatCurrency(activity.amount as number, 'USD')}</b> ${direction} ${otherUser} ${location}\n`;
				message += `   ${timeStr}\n\n`;
			}
		}

		await reply(ctx, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 Personal Balance', callback_data: 'personal_balance' }],
					[{ text: '💵 Add Expense', callback_data: 'add_expense_help' }]
				]
			}
		});
	} catch (error) {
		console.error('Error fetching personal activity:', error);
		await reply(ctx, '❌ Error fetching activity. Please try again.');
	}
}

function getExpenseIcon(category?: string): string {
	const categoryIcons: Record<string, string> = {
		'Food': '🍽️',
		'Transport': '🚗',
		'Entertainment': '🎭',
		'Shopping': '🛍️',
		'Bills': '📄',
		'Healthcare': '🏥',
		'Education': '📚',
		'Travel': '✈️',
		'Personal': '👤',
		'Other': '📝'
	};
	
	return categoryIcons[category || 'Other'] || '📝';
}