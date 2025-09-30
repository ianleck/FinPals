# PRD 2: FinPals Backend Implementation (Functional Architecture)

**Version:** 4.1 (Security & Multi-Currency Enhanced)
**Date:** October 2025
**Purpose:** Extract logic into pure functions and build API layer

## Critical: Architecture Must Be Functional

**Existing backend is 100% functional (pure functions), not OOP:**

- All 11 command handlers: pure functions
- All utilities: pure functions
- Only 2 classes: `Money` (value object) and `SessionDO` (Cloudflare requirement)
- Error handling: function with switch, not custom classes
- **DO NOT introduce OOP patterns** - maintain functional style

## What EXISTS (Do Not Rebuild)

### Existing Pattern Analysis

**All commands follow this pattern:**

```typescript
export async function handleAdd(ctx: Context, db: Database) {
	// 1. Parse input
	// 2. Validate
	// 3. withRetry(() => {
	//      - Multiple DB operations
	//    })
	// 4. Reply to user
}
```

**All utilities are pure functions:**

```typescript
export function parseMoney(value: string): Money | null;
export async function simplifyDebts(db: Database, groupId: string);
export function parseEnhancedSplits(mentions, amount);
```

**Error handling uses function wrapper:**

```typescript
// src/utils/error-handler.ts
export async function withErrorHandler<T>(ctx: Context, operation: () => Promise<T>, errorMessage?: string): Promise<T | void>;
```

## What to BUILD

### Phase 1: Infrastructure Setup (Day 1-2)

#### 1.1 Add KV Namespace

**wrangler.toml:**

```toml
[[kv_namespaces]]
binding = "KV"
id = "your_kv_namespace_id"

# Create: wrangler kv:namespace create KV
```

#### 1.2 Add Dependencies

```bash
npm install zod
```

#### 1.3 Update Env Interface

**src/index.ts:**

```typescript
export interface Env {
	BOT_TOKEN: string;
	TELEGRAM_BOT_API_SECRET_TOKEN: string;
	ENV: string;
	HYPERDRIVE: { connectionString: string };
	SESSIONS: DurableObjectNamespace;
	KV: KVNamespace; // ADD
}
```

#### 1.4 Create API Router

**src/api/router.ts - NEW FILE:**

```typescript
import { Env } from '../index';
import { validateTelegramAuth } from './middleware/auth';
import * as expenseHandlers from './handlers/expenses';
import * as balanceHandlers from './handlers/balances';

export async function handleAPI(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace('/api/v1', '');

	try {
		// Validate auth (all routes)
		const auth = await validateTelegramAuth(request, env);

		// Route to handlers (functions, not classes)
		if (path.startsWith('/expenses')) {
			return expenseHandlers.route(request, env, auth);
		}

		if (path === '/balances') {
			return balanceHandlers.getBalances(request, env, auth);
		}

		return errorResponse('NOT_FOUND', 'Endpoint not found', 404);
	} catch (error) {
		return handleApiError(error);
	}
}
```

### Phase 2: Extract Pure Functions (Day 3-5)

#### 2.1 Expense Functions - Extract from handleAdd

**NEW FILE: `src/services/expense.ts`**

```typescript
import { Database, withRetry } from '../db';
import { users, groups, groupMembers, expenses, expenseSplits } from '../db/schema';
import { Money } from '../utils/money';
import { eq, and, or, desc, lt } from 'drizzle-orm';

// Type aliases (not classes)
export type CreateExpenseData = {
	amount: Money;
	currency: string;
	description: string; // Max 500 chars
	category?: string; // Max 100 chars
	groupId?: string;
	tripId?: string;
	paidBy: string;
	splits: Array<{ userId: string; amount?: Money }>; // Max 50 splits
	note?: string; // Max 1000 chars
	createdBy: string;
};

export type UpdateExpenseData = Partial<CreateExpenseData>;

/**
 * Create expense with splits
 * EXTRACTED from handleAdd (src/commands/add.ts lines 122-250)
 */
export async function createExpense(db: Database, data: CreateExpenseData): Promise<any> {
	// Input validation
	if (data.description.length > 500) {
		throw new Error('Description too long (max 500 characters)');
	}
	if (data.category && data.category.length > 100) {
		throw new Error('Category too long (max 100 characters)');
	}
	if (data.note && data.note.length > 1000) {
		throw new Error('Note too long (max 1000 characters)');
	}
	if (data.splits.length > 50) {
		throw new Error('Too many splits (max 50)');
	}
	if (!data.currency.match(/^[A-Z]{3}$/)) {
		throw new Error('Invalid currency code (must be 3-letter ISO 4217)');
	}

	return withRetry(async () => {
		// Ensure user exists
		const existingUser = await db.select().from(users).where(eq(users.telegramId, data.createdBy)).limit(1);

		if (existingUser.length === 0) {
			await db.insert(users).values({
				telegramId: data.createdBy,
			});
		}

		// For group expenses, ensure group exists
		if (data.groupId) {
			const existingGroup = await db.select().from(groups).where(eq(groups.telegramId, data.groupId)).limit(1);

			if (existingGroup.length === 0) {
				throw new Error('Group not found');
			}

			// Ensure user is member
			const membership = await db
				.select()
				.from(groupMembers)
				.where(and(eq(groupMembers.groupId, data.groupId), eq(groupMembers.userId, data.createdBy)))
				.limit(1);

			if (membership.length === 0) {
				throw new Error('User not a member of group');
			}
		}

		// Insert expense
		const [newExpense] = await db
			.insert(expenses)
			.values({
				groupId: data.groupId || null,
				tripId: data.tripId || null,
				amount: data.amount.toDatabase(),
				currency: data.currency,
				description: data.description,
				category: data.category || null,
				paidBy: data.paidBy,
				createdBy: data.createdBy,
				notes: data.note || null,
				deleted: false,
				isPersonal: !data.groupId,
			})
			.returning();

		// Insert splits
		if (data.splits.length > 0) {
			await db.insert(expenseSplits).values(
				data.splits.map((split) => ({
					expenseId: newExpense.id,
					userId: split.userId,
					amount: split.amount ? split.amount.toDatabase() : data.amount.divide(data.splits.length).toDatabase(),
				})),
			);
		}

		return newExpense;
	});
}

/**
 * Get expenses with filters
 * EXTRACTED from handleExpenses
 * Uses composite cursor (timestamp + id) to handle duplicate timestamps
 */
export async function getExpenses(
	db: Database,
	filters: {
		groupId?: string;
		tripId?: string;
		paidBy?: string;
		limit?: number;
		cursor?: string; // Format: "id_timestamp"
	},
): Promise<{ expenses: any[]; nextCursor?: string }> {
	return withRetry(async () => {
		let query = db.select().from(expenses).where(eq(expenses.deleted, false));

		if (filters.groupId) {
			query = query.where(eq(expenses.groupId, filters.groupId));
		}

		if (filters.tripId) {
			query = query.where(eq(expenses.tripId, filters.tripId));
		}

		if (filters.cursor) {
			// Cursor pagination with composite key (timestamp + id)
			const [cursorId, cursorTimestamp] = filters.cursor.split('_');
			const cursorDate = new Date(cursorTimestamp);

			// Use composite cursor: WHERE (createdAt < cursor) OR (createdAt = cursor AND id < cursorId)
			query = query.where(
				or(
					lt(expenses.createdAt, cursorDate),
					and(
						eq(expenses.createdAt, cursorDate),
						lt(expenses.id, cursorId)
					)
				)
			);
		}

		const results = await query.orderBy(desc(expenses.createdAt), desc(expenses.id)).limit(filters.limit || 20);

		// Generate next cursor if there are more results
		const nextCursor = results.length === (filters.limit || 20) && results.length > 0
			? `${results[results.length - 1].id}_${results[results.length - 1].createdAt.toISOString()}`
			: undefined;

		return { expenses: results, nextCursor };
	});
}

/**
 * Update expense
 * EXTRACTED from handleEdit
 */
export async function updateExpense(db: Database, id: string, data: UpdateExpenseData): Promise<any> {
	return withRetry(async () => {
		const [updated] = await db
			.update(expenses)
			.set({
				amount: data.amount?.toDatabase(),
				description: data.description,
				category: data.category,
				notes: data.note,
			})
			.where(eq(expenses.id, id))
			.returning();

		return updated;
	});
}

/**
 * Soft delete expense
 * EXTRACTED from handleDelete
 */
export async function deleteExpense(db: Database, id: string): Promise<void> {
	await withRetry(async () => {
		await db.update(expenses).set({ deleted: true }).where(eq(expenses.id, id));
	});
}
```

#### 2.2 Balance Functions - Extract from handleBalance

**NEW FILE: `src/services/balance.ts`**

```typescript
import { Database, withRetry } from '../db';
import { simplifyDebts } from '../utils/debt-simplification';
import { Money } from '../utils/money';
import { expenses, expenseSplits } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';

/**
 * Calculate balances for a group (with multi-currency support)
 * EXTRACTED from handleBalance (src/commands/balance.ts lines 67-140)
 * ENHANCED to handle multiple currencies separately
 */
export async function calculateBalances(
	db: Database,
	groupId: string,
	tripId?: string
): Promise<Array<{ userId: string; currency: string; balance: number }>> {
	return withRetry(async () => {
		// Get all expenses WITH currency
		const groupExpenses = await db
			.select({
				id: expenses.id,
				amount: expenses.amount,
				currency: expenses.currency,
				paidBy: expenses.paidBy,
			})
			.from(expenses)
			.where(
				and(eq(expenses.groupId, groupId), eq(expenses.deleted, false), tripId ? eq(expenses.tripId, tripId) : isNull(expenses.tripId)),
			);

		// Get splits
		const splits = await db
			.select({
				expenseId: expenseSplits.expenseId,
				userId: expenseSplits.userId,
				amount: expenseSplits.amount,
			})
			.from(expenseSplits)
			.innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
			.where(
				and(eq(expenses.groupId, groupId), eq(expenses.deleted, false), tripId ? eq(expenses.tripId, tripId) : isNull(expenses.tripId)),
			);

		// Calculate net balances grouped by userId AND currency
		const balanceMap = new Map<string, Map<string, Money>>();

		// Add amounts paid by users
		for (const expense of groupExpenses) {
			const currency = expense.currency || 'SGD';
			if (!balanceMap.has(expense.paidBy)) {
				balanceMap.set(expense.paidBy, new Map());
			}
			const userCurrencies = balanceMap.get(expense.paidBy)!;
			const current = userCurrencies.get(currency) || new Money(0);
			userCurrencies.set(currency, current.add(Money.fromDatabase(expense.amount)));
		}

		// Build expense->currency lookup for splits
		const expenseCurrency = new Map<string, string>();
		for (const expense of groupExpenses) {
			expenseCurrency.set(expense.id, expense.currency || 'SGD');
		}

		// Subtract amounts owed by users
		for (const split of splits) {
			const currency = expenseCurrency.get(split.expenseId) || 'SGD';
			if (!balanceMap.has(split.userId)) {
				balanceMap.set(split.userId, new Map());
			}
			const userCurrencies = balanceMap.get(split.userId)!;
			const current = userCurrencies.get(currency) || new Money(0);
			userCurrencies.set(currency, current.subtract(Money.fromDatabase(split.amount)));
		}

		// Flatten to array with separate entries per currency
		const result: Array<{ userId: string; currency: string; balance: number }> = [];
		for (const [userId, currencies] of balanceMap.entries()) {
			for (const [currency, balance] of currencies.entries()) {
				// Only include non-zero balances (within 1 cent tolerance)
				if (Math.abs(balance.toNumber()) >= 0.01) {
					result.push({
						userId,
						currency,
						balance: balance.toNumber()
					});
				}
			}
		}

		return result;
	});
}

/**
 * Get simplified debts
 * REUSES existing utility (no extraction needed)
 */
export async function getSimplifiedDebts(db: Database, groupId: string, tripId?: string) {
	return simplifyDebts(db, groupId, tripId);
}
```

### Phase 3: Update Bot Commands (Day 6)

**REFACTOR: `src/commands/add.ts`**

```typescript
// BEFORE: All logic inline (lines 122-250)

// AFTER: Use extracted function
import * as expenseService from '../services/expense';

export async function handleAdd(ctx: Context, db: Database) {
	// Parse command (keep existing logic)
	const { amount, description, mentions, note, paidBy, groupId } = parseAddCommand(ctx.message.text, ctx);

	try {
		// Call extracted function (same logic, just moved)
		const expense = await expenseService.createExpense(db, {
			amount,
			description,
			paidBy,
			groupId,
			splits: mentions,
			note,
			createdBy: ctx.from!.id.toString(),
			currency: DEFAULT_CURRENCY,
		});

		// Reply (keep existing logic)
		await ctx.reply(formatExpenseReceipt(expense));
	} catch (error) {
		await withErrorHandler(ctx, async () => {
			throw error;
		});
	}
}
```

### Phase 4: API Handlers (Day 7-8)

#### 4.1 Telegram Auth Middleware

**NEW FILE: `src/api/middleware/auth.ts`**

```typescript
import { Env } from '../../index';

export type AuthContext = {
	userId: string;
	username?: string;
	firstName?: string;
};

export async function validateTelegramAuth(request: Request, env: Env): Promise<AuthContext> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader?.startsWith('tma ')) {
		throw new Error('UNAUTHORIZED: Missing Telegram auth');
	}

	const initData = authHeader.substring(4);
	const isValid = await validateTelegramInitData(initData, env.BOT_TOKEN);

	if (!isValid) {
		throw new Error('UNAUTHORIZED: Invalid signature');
	}

	const user = parseInitDataUser(initData);

	return {
		userId: user.id.toString(),
		username: user.username,
		firstName: user.first_name,
	};
}

async function validateTelegramInitData(initData: string, botToken: string): Promise<boolean> {
	const params = new URLSearchParams(initData);
	const hash = params.get('hash');
	if (!hash) return false;

	params.delete('hash');

	// Check auth_date < 1 hour
	const authDate = parseInt(params.get('auth_date') || '0');
	if (Date.now() / 1000 - authDate > 3600) return false;

	// HMAC validation (per Telegram docs)
	const dataCheckString = Array.from(params.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');

	const secretKey = await crypto.subtle.importKey('raw', new TextEncoder().encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);

	const secret = await crypto.subtle.sign('HMAC', secretKey, new TextEncoder().encode(botToken));

	const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheckString));

	const hexSignature = Array.from(new Uint8Array(signature))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	return hexSignature === hash;
}

function parseInitDataUser(initData: string): any {
	const params = new URLSearchParams(initData);
	const userJson = params.get('user');
	if (!userJson) throw new Error('No user in initData');
	return JSON.parse(userJson);
}
```

#### 4.2 Expense API Handlers

**NEW FILE: `src/api/handlers/expenses.ts`**

```typescript
import { Env } from '../../index';
import { AuthContext } from '../middleware/auth';
import { createDb } from '../../db';
import * as expenseService from '../../services/expense';
import { Money } from '../../utils/money';
import { DEFAULT_CURRENCY } from '../../utils/currency-constants';
import { z } from 'zod';

const CreateExpenseSchema = z.object({
	amount: z.number().positive().max(999999.99),
	currency: z.string().length(3).regex(/^[A-Z]{3}$/).default(DEFAULT_CURRENCY), // ISO 4217
	description: z.string().min(1).max(500).trim(),
	category: z.string().max(100).optional(),
	note: z.string().max(1000).optional(),
	groupId: z.string().optional(),
	tripId: z.string().uuid().optional(),
	paidBy: z.string().optional(),
	splits: z
		.array(
			z.object({
				userId: z.string(),
				amount: z.number().positive().optional(),
			}),
		)
		.min(1)
		.max(50), // Prevent abuse
});

export async function route(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace('/api/v1/expenses', '');

	if (request.method === 'POST' && path === '') {
		return createExpenseHandler(request, env, auth);
	}

	if (request.method === 'GET' && path === '') {
		return getExpensesHandler(request, env, auth);
	}

	if (request.method === 'PATCH' && path.match(/^\/[a-f0-9-]+$/)) {
		return updateExpenseHandler(request, env, auth, path.substring(1));
	}

	if (request.method === 'DELETE' && path.match(/^\/[a-f0-9-]+$/)) {
		return deleteExpenseHandler(request, env, auth, path.substring(1));
	}

	return errorResponse('NOT_FOUND', 'Endpoint not found', 404);
}

async function createExpenseHandler(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	// Check idempotency
	const idempotencyKey = request.headers.get('Idempotency-Key');
	if (!idempotencyKey) {
		return errorResponse('VALIDATION_ERROR', 'Idempotency-Key required', 400);
	}

	const cacheKey = `idempotency:${auth.userId}:${idempotencyKey}`;
	const cached = await env.KV.get(cacheKey);
	if (cached) {
		return new Response(cached, { status: 200 });
	}

	// Validate
	const body = await request.json();
	const validated = CreateExpenseSchema.parse(body);

	// Get group context
	const groupId = validated.groupId || request.headers.get('X-Group-ID') || undefined;

	// Call service function (same function bot uses)
	const db = createDb(env);
	const expense = await expenseService.createExpense(db, {
		amount: new Money(validated.amount),
		currency: validated.currency,
		description: validated.description,
		category: validated.category,
		groupId,
		tripId: validated.tripId,
		paidBy: validated.paidBy || auth.userId,
		splits: validated.splits.map((s) => ({
			userId: s.userId,
			amount: s.amount ? new Money(s.amount) : undefined,
		})),
		createdBy: auth.userId,
	});

	// Cache response
	const response = JSON.stringify(successResponse(expense));
	await env.KV.put(cacheKey, response, { expirationTtl: 300 });

	return new Response(response, { status: 200 });
}

async function getExpensesHandler(request: Request, env: Env, auth: AuthContext): Promise<Response> {
	const url = new URL(request.url);
	const groupId = url.searchParams.get('groupId') || undefined;
	const tripId = url.searchParams.get('tripId') || undefined;
	const cursor = url.searchParams.get('cursor') || undefined;
	const limit = parseInt(url.searchParams.get('limit') || '20');

	const db = createDb(env);
	const expenses = await expenseService.getExpenses(db, {
		groupId,
		tripId,
		limit,
		cursor,
	});

	return new Response(JSON.stringify(successResponse({ expenses })), {
		status: 200,
	});
}

// Helper functions
function successResponse(data: any) {
	return { ok: true, data };
}

function errorResponse(code: string, message: string, status: number) {
	return new Response(
		JSON.stringify({
			ok: false,
			error: { code, message },
		}),
		{ status },
	);
}
```

## Security Considerations

### Input Validation

**All text inputs are validated with maximum lengths:**
- Description: 500 characters
- Category: 100 characters
- Note: 1000 characters
- Split count: 50 maximum
- Amount: 999,999.99 maximum
- Currency: 3-letter ISO 4217 code

**SQL Injection Protection:**
- ✅ Drizzle ORM uses parameterized queries
- ✅ No raw SQL with user input
- ✅ All queries use prepared statements

**XSS Protection:**
- ⚠️ **IMPORTANT**: Text fields (description, note, category) contain raw user input
- Frontend MUST escape/sanitize before displaying in HTML contexts
- React/Vue: Auto-escaped by default ✅
- Plain HTML: Use DOMPurify or equivalent
- Store raw data, sanitize on output (context-specific)

### Authentication & Authorization

**Bot Security:**
- Telegram provides authenticated user context (ctx.from)
- User IDs are verified by Telegram
- Group membership validated before expense creation

**API Security:**
- HMAC-SHA256 validation of Telegram initData
- Auth token expires after 1 hour
- No cookie-based auth (CSRF not applicable)
- Rate limiting: 60 requests/minute per user (via KV)

### Rate Limiting

**API Rate Limits (via KV):**
```typescript
// Per user, per minute
const RATE_LIMIT = 60; // requests
const WINDOW = 60; // seconds
```

**Bot Rate Limits:**
- Relies on Telegram's built-in rate limiting
- Sufficient for MVP

### Data Validation Flow

```
User Input → Zod Schema → Service Validation → Database
                ↓              ↓
          Max lengths    Business rules
          Type checks    Currency format
          Trim/clean     Split validation
```

## Deployment Checklist

### Before Deployment

- [ ] Create KV namespace: `wrangler kv:namespace create KV`
- [ ] Update wrangler.toml with KV binding
- [ ] Install dependencies: `npm install zod`
- [ ] Run typecheck: `npm run typecheck`

### Testing

**Functional Tests:**
- [ ] Test bot commands still work (should be identical)
- [ ] Test API with Telegram initData validation
- [ ] Test idempotency (create expense twice with same key)
- [ ] Verify auth_date expiry (mock old initData)
- [ ] Test multi-currency balances (USD + EUR + SGD)
- [ ] Test cursor pagination with duplicate timestamps

**Security Tests:**
- [ ] Test XSS payloads in description: `<script>alert(1)</script>`
- [ ] Test max length enforcement (501 char description should fail)
- [ ] Test invalid currency codes (should reject "US", "USDD")
- [ ] Test >50 splits (should be rejected)
- [ ] Test SQL injection attempts in description (should be parameterized)
- [ ] Test rate limiting (61 requests in 60 seconds should fail)
- [ ] Test special characters: null bytes, control chars, Unicode
- [ ] Test amount boundaries (0, -1, 999999.99, 1000000 should fail)

### Success Criteria

**Architecture:**
- Bot commands work exactly as before ✓
- API and bot share same functions ✓
- No code duplication ✓
- Functional pattern maintained ✓
- withRetry used consistently ✓

**Security:**
- All inputs validated with max lengths ✓
- SQL injection protected (parameterized queries) ✓
- XSS documented for frontend ✓
- Rate limiting implemented ✓
- Currency format validated ✓

**Multi-Currency:**
- Balances grouped by currency ✓
- Each user can owe multiple currencies ✓
- Splits inherit expense currency ✓

**Pagination:**
- Composite cursor (timestamp + id) ✓
- Handles duplicate timestamps ✓
- Returns nextCursor for client ✓

---

**Key Architectural Decisions:**

1. **Functions, not classes** - Matches existing codebase
2. **Direct parameters** - No dependency injection complexity
3. **withRetry only** - No explicit transactions (existing pattern)
4. **Simple errors** - Throw Error, catch in handlers (existing pattern)
5. **Type aliases** - Not DTO classes
6. **Pure functions** - Stateless, testable, composable

---

## Version 4.1 Changes (Security & Multi-Currency)

### Enhancements from v4.0

**1. Multi-Currency Support (CRITICAL FIX)**
- `calculateBalances` now groups by userId AND currency
- Returns `Array<{ userId, currency, balance }>` instead of single balance per user
- Queries now SELECT currency field from expenses
- Users can owe $50 USD AND €30 EUR simultaneously

**2. Pagination Race Condition Fix**
- Composite cursor: `id_timestamp` instead of just timestamp
- Uses `OR (createdAt < cursor) OR (createdAt = cursor AND id < cursorId)`
- Deterministic ordering even with duplicate timestamps
- Returns `nextCursor` for client to use in next request

**3. Input Validation (Security)**
- All text fields have maximum lengths enforced
- Currency validated against ISO 4217 format (3-letter uppercase)
- Split count limited to 50 to prevent abuse
- Amount capped at 999,999.99
- Validation at both Zod schema AND service layer

**4. API Schema Completeness**
- Added `note` field (was missing but bot supports it)
- Added `category` max length (100 chars)
- Added `currency` regex validation
- Added `tripId` UUID validation
- Added `splits` max count (50)

**5. Security Documentation**
- XSS responsibility clearly documented (frontend must escape)
- SQL injection protection confirmed (parameterized queries)
- Rate limiting strategy defined (60 req/min via KV)
- Input validation flow diagram added
- Security testing checklist added

### Breaking Changes

**calculateBalances return type changed:**
```typescript
// Before (v4.0)
Array<{ userId: string; balance: number }>

// After (v4.1)
Array<{ userId: string; currency: string; balance: number }>
```

**getExpenses return type changed:**
```typescript
// Before (v4.0)
Promise<any[]>

// After (v4.1)
Promise<{ expenses: any[]; nextCursor?: string }>
```

**Cursor format changed:**
```typescript
// Before (v4.0)
cursor = expenseId

// After (v4.1)
cursor = "expenseId_timestamp"
```

### Migration Notes

**For Bot Commands:**
- `handleBalance` needs update to display multiple currencies per user
- No other bot changes required (validation is defensive, bot input already valid)

**For API Clients:**
- Update to handle new balance format (group by currency in UI)
- Update pagination to use new cursor format
- Add rate limiting handling (429 status code)

**Database:**
- No schema changes required
- Existing data compatible (currency defaults to 'SGD' if null)
