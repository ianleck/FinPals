import { Bot, Context } from 'grammy';
import type { Database } from '../db';
import { sql } from 'drizzle-orm';
import { formatCurrency, convertCurrencySync, refreshRatesCache } from './currency';
import { DEFAULT_CURRENCY } from './currency-constants';
import { toResultArray, hasResults, getFirstResult } from './db-helpers';
import { logger } from './logger';
import type { BudgetWithCurrency, ExpenseRow, CountResult } from '../types/common';

interface BudgetAlert {
	userId: string;
	category: string;
	spent: number;
	limit: number;
	currency: string;
	percentage: number;
	period: string;
	message: string;
}

export async function checkBudgetAlerts(
	db: Database,
	userId: string,
	groupId?: string,
	newExpenseAmount?: number,
	newExpenseCategory?: string,
	newExpenseCurrency?: string,
): Promise<BudgetAlert[]> {
	const alerts: BudgetAlert[] = [];

	// Refresh currency cache
	await refreshRatesCache(db);

	// Get user's budgets with currency info
	const budgets = await db.execute(sql`
        SELECT b.*, COALESCE(b.currency, u.preferred_currency, 'USD') as currency
        FROM budgets b
        LEFT JOIN users u ON b.user_id = u.telegram_id
        WHERE b.user_id = ${userId} 
        ORDER BY b.category
    `);

	if (!hasResults(budgets)) {
		return alerts;
	}

	// Calculate current spending for each budget
	for (const budget of toResultArray<BudgetWithCurrency>(budgets)) {
		const category = budget.category;
		const limit = budget.amount;
		const period = budget.period;

		// Calculate date range based on period
		const now = new Date();
		let startDate: Date;

		switch (period) {
			case 'daily':
				startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
				break;
			case 'weekly': {
				const dayOfWeek = now.getDay();
				startDate = new Date(now);
				startDate.setDate(now.getDate() - dayOfWeek);
				startDate.setHours(0, 0, 0, 0);
				break;
			}
			case 'monthly':
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				break;
			default:
				continue;
		}

		const budgetCurrency = budget.currency;

		// Get spending in this category with currency info
		const expenses = await db.execute(sql`
            SELECT amount, currency
            FROM (
                -- Personal expenses
                SELECT amount, currency
                FROM expenses 
                WHERE paid_by = ${userId} 
                    AND category = ${category} 
                    AND created_at >= ${startDate.toISOString()}
                    AND deleted = FALSE
                    AND is_personal = TRUE
                
                UNION ALL
                
                -- Group expense splits
                SELECT es.amount, e.currency
                FROM expense_splits es
                JOIN expenses e ON e.id = es.expense_id
                WHERE es.user_id = ${userId} 
                    AND e.category = ${category} 
                    AND e.created_at >= ${startDate.toISOString()}
                    AND e.deleted = FALSE
                    AND e.is_personal = FALSE
            )
        `);

		// Convert all expenses to budget currency and sum
		let currentSpent = 0;
		for (const expense of toResultArray<ExpenseRow>(expenses)) {
			const amount = expense.amount;
			const currency = expense.currency || DEFAULT_CURRENCY;
			currentSpent += currency === budgetCurrency ? amount : convertCurrencySync(amount, currency, budgetCurrency);
		}

		// Add the new expense if it's in this category
		if (newExpenseAmount && newExpenseCategory === category) {
			const convertedAmount =
				newExpenseCurrency && newExpenseCurrency !== budgetCurrency
					? convertCurrencySync(newExpenseAmount, newExpenseCurrency, budgetCurrency)
					: newExpenseAmount;
			currentSpent += convertedAmount;
		}

		const percentage = (currentSpent / limit) * 100;

		// Generate alerts based on percentage thresholds
		if (percentage >= 100) {
			alerts.push({
				userId,
				category,
				spent: currentSpent,
				limit,
				currency: budgetCurrency,
				percentage,
				period,
				message: `🚨 Budget exceeded for ${category}! You've spent ${formatCurrency(currentSpent, budgetCurrency)} of your ${formatCurrency(limit, budgetCurrency)} ${period} budget.`,
			});
		} else if (percentage >= 90) {
			alerts.push({
				userId,
				category,
				spent: currentSpent,
				limit,
				currency: budgetCurrency,
				percentage,
				period,
				message: `⚠️ 90% of ${category} budget used! ${formatCurrency(currentSpent, budgetCurrency)} of ${formatCurrency(limit, budgetCurrency)} ${period} budget spent.`,
			});
		} else if (percentage >= 75) {
			alerts.push({
				userId,
				category,
				spent: currentSpent,
				limit,
				currency: budgetCurrency,
				percentage,
				period,
				message: `💡 75% of ${category} budget used. ${formatCurrency(limit - currentSpent, budgetCurrency)} remaining for this ${period}.`,
			});
		}
	}

	return alerts;
}

export async function sendBudgetAlerts<T extends Context = Context>(bot: Bot<T>, alerts: BudgetAlert[], chatId: string): Promise<void> {
	if (alerts.length === 0) return;

	// Combine multiple alerts into one message
	let message = '💰 <b>Budget Alerts</b>\n\n';

	for (const alert of alerts) {
		message += alert.message + '\n\n';
	}

	// Add budget management tip
	message += '<i>Tip: Use /budget in DM to manage your budgets</i>';

	try {
		await bot.api.sendMessage(chatId, message, {
			parse_mode: 'HTML',
			reply_markup: {
				inline_keyboard: [
					[{ text: '📊 View Budgets', url: `https://t.me/${bot.botInfo.username}?start=budget` }],
					[{ text: '❌ Dismiss', callback_data: 'dismiss_budget_alert' }],
				],
			},
		});
	} catch (error) {
		logger.error('Error sending budget alert', error);
	}
}

// Check if we should send budget alerts for a user
export async function shouldSendAlert(
	db: Database,
	userId: string,
	category: string,
	alertLevel: number, // 75, 90, or 100
): Promise<boolean> {
	// Get current period start
	const now = new Date();
	const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

	// Check if alert was already sent
	const existing = await db.execute(sql`
        SELECT COUNT(*) as count
        FROM budget_alerts_sent
        WHERE user_id = ${userId}
            AND category = ${category}
            AND alert_level = ${alertLevel}
            AND period_start = ${periodStart}
    `);

	const firstRow = getFirstResult<CountResult>(existing);
	if (firstRow && firstRow.count > 0) {
		return false;
	}

	// Record that we're sending this alert
	await db.execute(sql`
        INSERT OR IGNORE INTO budget_alerts_sent 
        (id, user_id, category, alert_level, period_start)
        VALUES (${crypto.randomUUID()}, ${userId}, ${category}, ${alertLevel}, ${periodStart})
    `);

	return true;
}

// Integrate with expense creation
export async function checkBudgetAfterExpense<T extends Context = Context>(
	db: Database,
	bot: Bot<T>,
	userId: string,
	groupId: string,
	amount: number,
	category: string,
): Promise<void> {
	try {
		// Check for budget alerts
		const alerts = await checkBudgetAlerts(db, userId, groupId, amount, category);

		// Filter alerts based on whether they've been sent
		const alertsToSend: BudgetAlert[] = [];

		for (const alert of alerts) {
			const alertLevel = alert.percentage >= 100 ? 100 : alert.percentage >= 90 ? 90 : 75;

			if (await shouldSendAlert(db, userId, alert.category, alertLevel)) {
				alertsToSend.push(alert);
			}
		}

		// Send alerts
		if (alertsToSend.length > 0) {
			await sendBudgetAlerts(bot, alertsToSend, userId);
		}
	} catch (error) {
		logger.error('Error checking budget alerts', error);
	}
}
