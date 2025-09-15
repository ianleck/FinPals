/**
 * Helper functions for creating inline keyboard buttons
 */

export function createExpenseActionButtons(expenseId: string, isPersonal: boolean = false) {
	const baseButtons = [
		[
			{ text: '📂 Change Category', callback_data: `cat:${expenseId}` },
			{ text: '📎 Attach Receipt', callback_data: `receipt:${expenseId}` },
		],
		[
			{ text: '🗑️ Delete', callback_data: `del:${expenseId}` },
			{ text: '💵 Add Another', callback_data: 'add_expense_help' },
		],
	];

	// Add view button based on context
	if (isPersonal) {
		baseButtons[1].splice(0, 0, { text: '📊 View Expenses', callback_data: 'view_personal_expenses' });
	} else {
		baseButtons[1].splice(0, 0, { text: '📊 View Balance', callback_data: 'view_balance' });
	}

	// Add done button
	baseButtons.push([{ text: '✅ Done', callback_data: 'close' }]);

	return baseButtons;
}
