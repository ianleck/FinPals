import { vi } from 'vitest';

// Mock SessionDO class
export class MockSessionDO {
	private storage = new Map<string, any>();

	constructor() {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		switch (pathname) {
			case '/read':
				const data = this.storage.get('data');
				if (!data) {
					return new Response('Not found', { status: 404 });
				}
				return new Response(JSON.stringify(data), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			
			case '/write':
				try {
					const body = await request.json();
					this.storage.set('data', body);
					return new Response('OK', { status: 200 });
				} catch {
					return new Response('Invalid JSON', { status: 400 });
				}
			
			case '/delete':
				this.storage.delete('data');
				return new Response('OK', { status: 200 });
			
			default:
				return new Response('Not found', { status: 404 });
		}
	}
}

// Mock DurableObjectNamespace
export function createMockDurableObjectNamespace(): DurableObjectNamespace {
	const instances = new Map<string, MockSessionDO>();

	return {
		idFromName: vi.fn((name: string) => ({ toString: () => name })),
		get: vi.fn((id: any) => {
			const key = id.toString();
			if (!instances.has(key)) {
				instances.set(key, new MockSessionDO());
			}
			return instances.get(key);
		}),
		newUniqueId: vi.fn(() => ({ toString: () => 'test-id' })),
		idFromString: vi.fn((str: string) => ({ toString: () => str })),
		jurisdiction: vi.fn(),
	} as unknown as DurableObjectNamespace;
}