// Generate "smart" insights based on patterns
export function generateInsight(
	description: string,
	amount: number,
	category: string | null,
	participantCount: number,
	previousExpenses?: any[]
): string | null {
	const insights: string[] = [];
	
	// Price insights
	if (category === 'Food & Dining') {
		if (amount / participantCount < 10) {
			insights.push('💡 Great deal! That\'s quite affordable per person');
		} else if (amount / participantCount > 50) {
			insights.push('🍾 Fancy meal! Hope it was delicious');
		}
		
		// Check if it's a recurring expense
		if (previousExpenses && previousExpenses.length > 2) {
			const avgAmount = previousExpenses.reduce((sum, e) => sum + e.amount, 0) / previousExpenses.length;
			if (amount > avgAmount * 1.3) {
				insights.push('📈 This is 30% more than your usual spending here');
			} else if (amount < avgAmount * 0.7) {
				insights.push('📉 Nice savings! 30% less than usual');
			}
		}
	}
	
	// Transportation insights
	if (category === 'Transportation') {
		const hour = new Date().getHours();
		if (hour >= 22 || hour <= 6) {
			insights.push('🌙 Late night ride - stay safe!');
		}
		if (amount > 40) {
			insights.push('💡 Consider splitting an Uber next time?');
		}
	}
	
	// Shopping insights
	if (category === 'Shopping' && amount > 100) {
		insights.push('🛍️ Big shopping day! Don\'t forget to check for deals');
	}
	
	// Day of week patterns
	const dayOfWeek = new Date().getDay();
	if (dayOfWeek === 5 || dayOfWeek === 6) { // Friday or Saturday
		if (category === 'Food & Dining' && amount > 80) {
			insights.push('🎉 Weekend splurge detected!');
		}
	}
	
	// Monthly patterns
	const dayOfMonth = new Date().getDate();
	if (dayOfMonth <= 5 && category === 'Bills & Utilities') {
		insights.push('📅 Start of month bill payment - right on schedule!');
	}
	
	return insights.length > 0 ? insights[Math.floor(Math.random() * insights.length)] : null;
}

// Generate fun facts about spending
export function generateFunFact(totalSpent: number, expenseCount: number, topCategory: string): string {
	const facts = [
		`🎯 Your group has split ${expenseCount} expenses! That's ${expenseCount} fewer awkward money conversations`,
		`☕ With $${totalSpent.toFixed(2)} spent, you could have bought ${Math.floor(totalSpent / 5)} coffees`,
		`📊 ${topCategory} is your #1 spending category - no surprises there!`,
		`🤝 You're a splitting pro! Keep those friendships debt-free`,
		`💰 Fun fact: You've moved $${(totalSpent * 2).toFixed(2)} worth of IOUs through your group`
	];
	
	return facts[Math.floor(Math.random() * facts.length)];
}