import type { EngineCtx, TransitionFn } from './ctx.js';
export declare function onRequest(engine: EngineCtx, fire: TransitionFn, payload: any, next: () => Promise<any>): Promise<any>;
export declare function onRequestError(engine: EngineCtx, fire: TransitionFn, payload: any, next: () => Promise<unknown>): Promise<unknown>;
//# sourceMappingURL=request.d.ts.map