import { pgTable, text, timestamp, decimal, boolean, integer, uuid, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table
export const users = pgTable('users', {
	telegramId: text('telegram_id').primaryKey(),
	username: text('username'),
	firstName: text('first_name'),
	lastName: text('last_name'),
	timezone: text('timezone').default('UTC'),
	preferredCurrency: text('preferred_currency').default('USD'),
	premiumUntil: timestamp('premium_until', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Groups table
export const groups = pgTable('groups', {
	telegramId: text('telegram_id').primaryKey(),
	title: text('title'),
	defaultCurrency: text('default_currency').default('USD'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	active: boolean('active').default(true),
});

// Group members junction table
export const groupMembers = pgTable(
	'group_members',
	{
		groupId: text('group_id')
			.references(() => groups.telegramId)
			.notNull(),
		userId: text('user_id')
			.references(() => users.telegramId)
			.notNull(),
		joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
		active: boolean('active').default(true),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.groupId, table.userId] }),
		groupIdx: index('idx_group_members_group').on(table.groupId, table.active),
	}),
);

// Trips table
export const trips = pgTable(
	'trips',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: text('group_id')
			.references(() => groups.telegramId)
			.notNull(),
		name: text('name').notNull(),
		description: text('description'),
		status: text('status').default('active'), // active, ended
		createdBy: text('created_by')
			.references(() => users.telegramId)
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
	},
	(table) => ({
		groupIdx: index('idx_trips_group').on(table.groupId, table.status),
	}),
);

// Expenses table with nullable group_id for personal expenses
export const expenses = pgTable(
	'expenses',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: text('group_id').references(() => groups.telegramId), // NULL for personal expenses
		tripId: uuid('trip_id').references(() => trips.id),
		amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
		currency: text('currency').default('USD'),
		description: text('description'),
		category: text('category'),
		paidBy: text('paid_by')
			.references(() => users.telegramId)
			.notNull(),
		createdBy: text('created_by')
			.references(() => users.telegramId)
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		deleted: boolean('deleted').default(false),
		isPersonal: boolean('is_personal').default(false), // TRUE for personal expenses
		notes: text('notes'),
		receiptUrl: text('receipt_url'),
	},
	(table) => ({
		groupIdx: index('idx_expenses_group').on(table.groupId, table.deleted),
		paidByIdx: index('idx_expenses_paid_by').on(table.paidBy),
		personalIdx: index('idx_expenses_personal').on(table.paidBy, table.isPersonal, table.deleted),
		userPersonalIdx: index('idx_expenses_user_personal').on(table.paidBy, table.isPersonal, table.deleted, table.createdAt),
		groupDateIdx: index('idx_expenses_group_date').on(table.groupId, table.createdAt, table.deleted),
		categoryLookupIdx: index('idx_expenses_category_lookup').on(table.paidBy, table.category, table.deleted),
		budgetQueryIdx: index('idx_expenses_budget_query').on(table.category, table.isPersonal, table.deleted, table.createdAt),
		tripIdx: index('idx_expenses_trip').on(table.tripId, table.deleted),
	}),
);

// Expense participants
export const expenseSplits = pgTable(
	'expense_splits',
	{
		expenseId: uuid('expense_id')
			.references(() => expenses.id)
			.notNull(),
		userId: text('user_id')
			.references(() => users.telegramId)
			.notNull(),
		amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.expenseId, table.userId] }),
		userIdx: index('idx_expense_splits_user').on(table.userId),
		compositeIdx: index('idx_expense_splits_composite').on(table.userId, table.expenseId),
	}),
);

// Settlements
export const settlements = pgTable(
	'settlements',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		groupId: text('group_id').references(() => groups.telegramId), // NULL for personal settlements
		tripId: uuid('trip_id').references(() => trips.id),
		fromUser: text('from_user')
			.references(() => users.telegramId)
			.notNull(),
		toUser: text('to_user')
			.references(() => users.telegramId)
			.notNull(),
		amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
		currency: text('currency').default('USD'),
		createdBy: text('created_by')
			.references(() => users.telegramId)
			.notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		isPersonal: boolean('is_personal').default(false), // TRUE for personal settlements
	},
	(table) => ({
		groupIdx: index('idx_settlements_group').on(table.groupId),
		usersIdx: index('idx_settlements_users').on(table.fromUser, table.toUser),
		dateIdx: index('idx_settlements_date').on(table.createdAt),
	}),
);

// User preferences
export const userPreferences = pgTable('user_preferences', {
	userId: text('user_id')
		.references(() => users.telegramId)
		.primaryKey(),
	notifications: boolean('notifications').default(true),
	weeklySummary: boolean('weekly_summary').default(true),
	autoRemind: boolean('auto_remind').default(false),
	reminderDays: integer('reminder_days').default(7),
});

// Categories for AI training
export const categoryMappings = pgTable(
	'category_mappings',
	{
		descriptionPattern: text('description_pattern').primaryKey(),
		category: text('category').notNull(),
		confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.00'),
		usageCount: integer('usage_count').default(1),
	},
	(table) => ({
		confidenceIdx: index('idx_category_mappings_confidence').on(table.confidence, table.usageCount),
	}),
);

// Budgets table for personal expense tracking
export const budgets = pgTable(
	'budgets',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userId: text('user_id')
			.references(() => users.telegramId)
			.notNull(),
		category: text('category').notNull(),
		amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
		period: text('period').notNull(), // daily, weekly, monthly
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		userIdx: index('idx_budgets_user').on(table.userId),
		uniqueUserCategory: uniqueIndex('idx_budgets_user_category').on(table.userId, table.category),
	}),
);

// Expense templates
export const expenseTemplates = pgTable('expense_templates', {
	id: uuid('id').defaultRandom().primaryKey(),
	userId: text('user_id')
		.references(() => users.telegramId)
		.notNull(),
	groupId: text('group_id').references(() => groups.telegramId),
	name: text('name').notNull(),
	amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
	currency: text('currency').default('USD'),
	description: text('description'),
	category: text('category'),
	participants: text('participants'), // JSON array of user IDs
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Recurring expenses
export const recurringExpenses = pgTable('recurring_expenses', {
	id: uuid('id').defaultRandom().primaryKey(),
	groupId: text('group_id')
		.references(() => groups.telegramId)
		.notNull(),
	amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
	currency: text('currency').default('USD'),
	description: text('description').notNull(),
	category: text('category'),
	paidBy: text('paid_by')
		.references(() => users.telegramId)
		.notNull(),
	participants: text('participants').notNull(), // JSON array
	frequency: text('frequency').notNull(), // daily, weekly, monthly, yearly
	nextDue: timestamp('next_due', { withTimezone: true }).notNull(),
	lastProcessed: timestamp('last_processed', { withTimezone: true }),
	active: boolean('active').default(true),
	createdBy: text('created_by')
		.references(() => users.telegramId)
		.notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Exchange rates table
export const exchangeRates = pgTable('exchange_rates', {
	currencyCode: text('currency_code').primaryKey(),
	rateToUsd: decimal('rate_to_usd', { precision: 20, scale: 10 }).notNull(),
	source: text('source').default('frankfurter'),
	lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow().notNull(),
});

// Relations (for query joins)
export const usersRelations = relations(users, ({ many }) => ({
	expenses: many(expenses),
	expenseSplits: many(expenseSplits),
	groupMemberships: many(groupMembers),
	budgets: many(budgets),
	templates: many(expenseTemplates),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
	members: many(groupMembers),
	expenses: many(expenses),
	trips: many(trips),
	settlements: many(settlements),
	recurringExpenses: many(recurringExpenses),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
	paidByUser: one(users, {
		fields: [expenses.paidBy],
		references: [users.telegramId],
	}),
	group: one(groups, {
		fields: [expenses.groupId],
		references: [groups.telegramId],
	}),
	trip: one(trips, {
		fields: [expenses.tripId],
		references: [trips.id],
	}),
	splits: many(expenseSplits),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
	expense: one(expenses, {
		fields: [expenseSplits.expenseId],
		references: [expenses.id],
	}),
	user: one(users, {
		fields: [expenseSplits.userId],
		references: [users.telegramId],
	}),
}));
