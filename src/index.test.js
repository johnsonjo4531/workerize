import workerize from './index.js';

describe('workerize', () => {
	it('should return an async function', () => {
		const w = workerize(`
			export function f(url) {
				return 'one'
			}
		`);


		expect(w.f).toEqual(jasmine.any(Function));
		expect(w.f()).toEqual(jasmine.any(Promise));
	});

	it('should be able to return multiple exported functions', () => {
		const w = workerize(`
			export function f(url) {
				return 'one'
			}

			export function g(url) {
				return 'two'
			}
		`);


		expect(w.f).toEqual(jasmine.any(Function));
		expect(w.g).toEqual(jasmine.any(Function));
	});

	it('should not expose non exported functions', () => {
		const w = workerize(`
			function f () {

			}
		`);


		expect(w.f).toEqual(undefined);
	});

	it('should return an async generator function', async () => {
		const w = workerize(`
		export function * g(url) {
			return 'one'
		}
	`);
		// expect that it has an iterator
		const p =  w.g();
		expect(p).toEqual(jasmine.any(Promise));
		expect((await p)[Symbol.asyncIterator]).toEqual(jasmine.any(Function));
	});

	it('should invoke sync functions', async () => {
		const w = workerize(`
		export function foo (a) {
			return 'foo: '+a;
		};
		`);

		let ret = await w.foo('test');
		expect(ret).toEqual('foo: test');
	});

	it('should forward arguments', async () => {
		const w = workerize(`
		export function foo() {
			return {
				args: [].slice.call(arguments)
			};
		}
		`);

		let ret = await w.foo('a', 'b', 'c', { position: 4 });
		expect(ret).toEqual({
			args: ['a', 'b', 'c', { position: 4 }]
		});
	});

	it('should invoke async functions', async () => {
		let w = workerize(`
		export function bar (a) {
			return new Promise(resolve => {
				resolve('bar: ' + a);
			})
		};
		`);

		let ret = await w.bar('test');
		expect(ret).toEqual('bar: test');
	});

	it('should take values from next', async () => {
		let w = workerize(`
		export function* g () {
			const num2 = yield 1;
			yield 2 + num2;
		}
		`);

		const it = await w.g();
		expect((await it.next()).value).toEqual(1);
		expect((await it.next(2)).value).toEqual(4);
	});

	it('should return both done as true and the value', async () => {
		// eslint-disable-next-line require-yield
		function* f (num1) {
			return num1;
		}
		let w = workerize(`export ${Function.prototype.toString.call(f)}`);

		const it = await w.f(3);
		const it2 = f(3);
		const { done, value } = (await it.next());
		const { done: done2, value: value2 } = (await it2.next());

		expect(value).toEqual(value2);
		expect(done).toEqual(done2);
	});

	it('should only iterate yielded values with for await of', async () => {
		let w = workerize(`
		export function* g() {
			yield 3;
			yield 1;
			yield 4;
			return 1;
		}
		`);

		const arr = [];
		for await (const item of await w.g()) {
			arr.push(item);
		}

		expect(arr[0]).toEqual(3);
		expect(arr[1]).toEqual(1);
		expect(arr[2]).toEqual(4);
		expect(arr[3]).toEqual(undefined);
	});

	it('should return early with return method of async iterator', async () => {
		let w = workerize(`
		export function* g() {
			yield 1;
			yield 2;
			yield 3;
			return 4;
		}
		`);


		const it = await w.g();
		expect([
			await it.next(),
			await it.next(),
			await it.return(7),
			await it.next(),
			await it.next()
		]).toEqual([
			{ value: 1, done: false },
			{ value: 2, done: false },
			{ value: 7, done: true },
			{ value: undefined, done: true },
			{ value: undefined, done: true }
		]);
	});

	it('should throw early with return method of async iterator', async () => {
		let w = workerize(`
		export function* g() {
			yield 1;
			yield 2;
			yield 3;
			return 4;
		}
		`);


		const it = await w.g();
		// expect this to reject!
		await (async () => ([
			await it.next(),
			await it.return(),
			await it.throw('foo'),
			await it.next(),
			await it.next()
		]))().then(() => {
			throw new Error('Promise should not have resolved');
		}, () => { /** since it should error, we recover and ignore the error */});
	});

	it('should act like an equivalent async iterator', async () => {
		async function* g () {
			const num2 = yield 1;
			yield 2 + num2;
			yield 3;
			return 4;
		}

		let w = workerize(`export ${Function.prototype.toString.call(g)}`);


		const it = await w.g();
		const it2 = g();
		expect([
			await it.next(),
			await it.next(2),
			await it.next(),
			await it.next(),
			await it.next()
		]).toEqual([
			await it2.next(),
			await it2.next(2),
			await it2.next(),
			await it2.next(),
			await it2.next()
		]);
	});

	it('should throw like an equivalent async iterator', async () => {
		async function* g () {
			const num2 = yield 1;
			yield 2 + num2;
			yield 3;
			return 4;
		}

		let w = workerize(`export ${Function.prototype.toString.call(g)}`);


		const it = await w.g();
		const it2 = g();
		expect([
			await it.next(),
			await it.next(2),
			await it.throw().catch(e => 2),
			await it.return(),
			await it.throw().catch(e => 3)
		]).toEqual([
			await it2.next(),
			await it2.next(2),
			await it2.throw().catch(e => 2),
			await it2.return(),
			await it2.throw().catch(e => 3)
		]);
	});

	it('should return like an equivalent async iterator', async () => {
		async function* g () {
			const num2 = yield 1;
			yield 2 + num2;
			yield 3;
			return 4;
		}

		let w = workerize(`export ${Function.prototype.toString.call(g)}`);


		const it = await w.g();
		const it2 = g();
		expect([
			await it.next(),
			await it.next(2),
			await it.return(),
			await it.return()
		]).toEqual([
			await it2.next(),
			await it2.next(2),
			await it2.return(),
			await it2.return()
		]);
	});
});
