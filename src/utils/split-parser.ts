/**
 * Enhanced split parser supporting amounts, percentages, and shares
 */

export interface SplitInfo {
	type: 'amount' | 'percentage' | 'share' | 'equal';
	value: number;
	userId: string;
}

export interface ParsedSplits {
	mentions: string[];
	splits: Map<string, SplitInfo>;
	hasCustomSplits: boolean;
	paidBy?: string; // Optional paid by user (@username)
}

/**
 * Parse split arguments supporting multiple formats:
 * @john=50 - Fixed amount
 * @john=50% - Percentage
 * @john=2 @mary=1 - Shares (if all are integers without % and total < expense amount)
 * paid:@john - Specify who paid (if not the message sender)
 */
export function parseEnhancedSplits(args: string[], totalAmount: number): ParsedSplits {
	const mentions: string[] = [];
	const splits = new Map<string, SplitInfo>();
	let hasPercentages = false;
	let hasAmounts = false;
	let hasShares = false; // Default to false, only set true if we find shares
	let totalShares = 0;
	let totalPercentage = 0;
	let totalFixedAmount = 0;
	let paidBy: string | undefined;

	// First pass - parse all splits
	for (const arg of args) {
		// Check for paid:@username syntax
		if (arg.startsWith('paid:@')) {
			paidBy = arg.substring(5); // Remove 'paid:' prefix, keep @username
			continue;
		}

		if (!arg.startsWith('@')) continue;

		if (arg.includes('=')) {
			const [mention, valueStr] = arg.split('=');
			mentions.push(mention);

			if (valueStr.endsWith('%')) {
				// Percentage split
				const percentage = parseFloat(valueStr.slice(0, -1));
				if (!isNaN(percentage) && percentage > 0 && percentage <= 100) {
					splits.set(mention, {
						type: 'percentage',
						value: percentage,
						userId: mention.substring(1),
					});
					totalPercentage += percentage;
					hasPercentages = true;
					hasShares = false;
				}
			} else {
				const value = parseFloat(valueStr);
				if (!isNaN(value) && value > 0) {
					// Could be share or amount - determine later
					splits.set(mention, {
						type: 'share', // Tentative
						value: value,
						userId: mention.substring(1),
					});
					totalShares += value;

					// Assume it's a share unless proven otherwise
					hasShares = true;

					// If it has decimals or is large, likely an amount
					if (!Number.isInteger(value) || value > totalAmount * 0.5) {
						hasShares = false;
					}
				}
			}
		} else {
			// Equal split
			mentions.push(arg);
			splits.set(arg, {
				type: 'equal',
				value: 0, // Will be calculated
				userId: arg.substring(1),
			});
		}
	}

	// Second pass - determine if numeric values are shares or amounts
	if (!hasPercentages && hasShares && totalShares < totalAmount) {
		// Treat as shares
		for (const [, split] of splits.entries()) {
			if (split.type === 'share') {
				split.type = 'share';
			}
		}
	} else if (!hasPercentages) {
		// Treat as fixed amounts
		for (const [, split] of splits.entries()) {
			if (split.type === 'share') {
				split.type = 'amount';
				totalFixedAmount += split.value;
				hasAmounts = true;
				hasShares = false;
			}
		}
	}

	// Validation
	if (hasPercentages && totalPercentage > 100) {
		throw new Error('Total percentage cannot exceed 100%');
	}

	if (hasAmounts && totalFixedAmount > totalAmount) {
		throw new Error('Total of fixed amounts exceeds the expense amount');
	}

	// Calculate actual amounts for each type
	const finalSplits = new Map<string, SplitInfo>();
	let remainingAmount = totalAmount;
	let equalSplitUsers: string[] = [];

	// Process fixed amounts first
	for (const [mention, split] of splits.entries()) {
		if (split.type === 'amount') {
			finalSplits.set(mention, {
				...split,
				value: split.value,
			});
			remainingAmount -= split.value;
		}
	}

	// Process percentages
	for (const [mention, split] of splits.entries()) {
		if (split.type === 'percentage') {
			const amount = (totalAmount * split.value) / 100;
			finalSplits.set(mention, {
				...split,
				type: 'amount',
				value: Number(amount.toFixed(2)),
			});
			remainingAmount -= amount;
		}
	}

	// Process shares
	if (hasShares && totalShares > 0) {
		const shareValue = remainingAmount / totalShares;
		for (const [mention, split] of splits.entries()) {
			if (split.type === 'share') {
				const amount = shareValue * split.value;
				finalSplits.set(mention, {
					...split,
					type: 'amount',
					value: Number(amount.toFixed(2)),
				});
				remainingAmount -= amount;
			}
		}
	}

	// Collect equal split users
	for (const [mention, split] of splits.entries()) {
		if (split.type === 'equal') {
			equalSplitUsers.push(mention);
		}
	}

	// Calculate equal splits for remaining amount
	if (equalSplitUsers.length > 0 && remainingAmount > 0) {
		const equalAmount = remainingAmount / equalSplitUsers.length;
		for (const mention of equalSplitUsers) {
			finalSplits.set(mention, {
				type: 'amount',
				value: Number(equalAmount.toFixed(2)),
				userId: mention.substring(1),
			});
		}
	}

	const result = {
		mentions,
		splits: finalSplits,
		hasCustomSplits: hasPercentages || hasAmounts || hasShares,
		paidBy,
	};

	return result;
}
