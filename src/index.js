
/** TODO:
 *	- pooling (+ load balancing by tracking # of open calls)
 *  - queueing (worth it? sortof free via postMessage already)
 *
 *	@example
 *	let worker = workerize(`
 *		export function add(a, b) {
 *			// block for a quarter of a second to demonstrate asynchronicity
 *			let start = Date.now();
 *			while (Date.now()-start < 250);
 *			return a + b;
 *		}
 *	`);
 *	(async () => {
 *		console.log('3 + 9 = ', await worker.add(3, 9));
 *		console.log('1 + 2 = ', await worker.add(1, 2));
 *	})();
 */
export default function workerize(code, options) {
	let exports = {};
	let exportsObjName = `__xpo${Math.random().toString().substring(2)}__`;
	if (typeof code==='function') code = `(${Function.prototype.toString.call(code)})(${exportsObjName})`;
	code = toCjs(code, exportsObjName, exports) + `\n(${Function.prototype.toString.call(setup)})(self,${exportsObjName},{})`;
	let url = URL.createObjectURL(new Blob([code],{ type: 'text/javascript' })),
		worker = new Worker(url, options),
		term = worker.terminate,
		callbacks = {},
		counter = 0,
		i;
	worker.kill = signal => {
		worker.postMessage({ type: 'KILL', signal });
		setTimeout(worker.terminate);
	};
	worker.terminate = () => {
		URL.revokeObjectURL(url);
		term.call(worker);
	};
	worker.call = (method, params, genStatus=0, genId=undefined) => new Promise( (resolve, reject) => {
		let id = `rpc${++counter}`;
		callbacks[id] = [resolve, reject];
		worker.postMessage({ type: 'RPC', id, genId, method, genStatus, params });
	}).then((d) => {
		if (!d.hasOwnProperty('genId')) {
			return d;
		}
		return (() => {
			const genId = d.genId;
			return {
				done: false,
				async next (value) {
					if (this.done) { return { value: undefined, done: true }; }
					const result = await worker.call(method, [value], 0, genId);
					if (result.done) { return this.return(result.value); }
					return result;
				},
				async return (value) {
					await worker.call(method, [value], 1, genId);
					this.done = true;
					return { value, done: true };
				},
				async throw (err) {
					await worker.call(method, [err], 0, genId);
					throw err;
				},
				[Symbol.asyncIterator] () {
					return this;
				}
			};
		})();
	});
	worker.rpcMethods = {};
	setup(worker, worker.rpcMethods, callbacks);
	worker.expose = methodName => {
		worker[methodName] = function() {
			return worker.call(methodName, [].slice.call(arguments));
		};
	};
	for (i in exports) if (!(i in worker)) worker.expose(i);
	return worker;
}
function setup(ctx, rpcMethods, callbacks) {
	let gencounter = 0;
	let GENS = {};
	ctx.addEventListener('message', ({ data }) => {
		let id = data.id;
		let genId = data.genId;
		let genStatus = data.genStatus;
		if (data.type!=='RPC' || id==null) return;
		if (data.method) {
			let method = rpcMethods[data.method];
			if (method==null) {
				ctx.postMessage({ type: 'RPC', id, error: 'NO_SUCH_METHOD' });
			}
			else {
				Promise.resolve()
					// Either use a generator or call a method.
					.then( () => !GENS[genId] ? method.apply(null, data.params) :  GENS[genId][genStatus](data.params[0]))
					.then( result => {
						if (method.constructor.name === 'AsyncGeneratorFunction' || method.constructor.name === 'GeneratorFunction') {
							if (!GENS[genId]) {
								GENS[++gencounter] = [result.next.bind(result), result.return.bind(result), result.throw.bind(result)];
								// return an initial message of success.
								// genId should only be sent to the main thread when initializing the generator
								return ctx.postMessage({ type: 'RPC', id, genId: gencounter, result:  { value: undefined, done: false } });
							}
						}
						ctx.postMessage({ type: 'RPC', id, result });
						if (result.done) {
							GENS[genId] = null;
						}
					})
					.catch( err => { ctx.postMessage({ type: 'RPC', id, error: ''+err }); });
			}
		}
		else {
			let callback = callbacks[id];
			if (callback==null) throw Error(`Unknown callback ${id}`);
			delete callbacks[id];
			// genId should only be sent to the main thread when initializing the generator
			if(data.genId) { data.result.genId = data.genId; }
			if (data.error) callback[1](Error(data.error));
			// genId should only be sent to the main thread when initializing the generator
			else callback[0](data.result);
		}
	});
}

function toCjs(code, exportsObjName, exports) {
	code = code.replace(/^(\s*)export\s+default\s+/m, (s, before) => {
		exports.default = true;
		return `${before}${exportsObjName}.default=`;
	});
	code = code.replace(/^(\s*)export\s+((?:async\s*)?function(?:\s*\*)?|const|let|var)(\s+)([a-zA-Z$_][a-zA-Z0-9$_]*)/mg, (s, before, type, ws, name) => {
		exports[name] = true;
		return `${before}${exportsObjName}.${name}=${type}${ws}${name}`;
	});
	return `var ${exportsObjName}={};\n${code}\n${exportsObjName};`;
}
