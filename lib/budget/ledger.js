import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export class BudgetLedger {
    dataDir;
    pricing;
    limits;
    state = { daily: {}, tasks: {}, ledger: [] };
    dirty = false;
    constructor(dataDir, pricing, limits) {
        this.dataDir = dataDir;
        this.pricing = pricing;
        this.limits = limits;
        mkdirSync(this.dataDir, { recursive: true });
        this.load();
    }
    get file() {
        return join(this.dataDir, 'budget.json');
    }
    load() {
        try {
            if (existsSync(this.file)) {
                this.state = JSON.parse(readFileSync(this.file, 'utf8'));
            }
        }
        catch {
            this.state = { daily: {}, tasks: {}, ledger: [] };
        }
    }
    flush() {
        if (!this.dirty)
            return;
        try {
            mkdirSync(dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
            renameSync(tmp, this.file); // atomic swap: readers never see a half-written file
            this.dirty = false;
        }
        catch {
            // flush failure is non-fatal; in-memory state remains authoritative
        }
    }
    dayKey(at = Date.now()) {
        return new Date(at).toISOString().slice(0, 10);
    }
    daily(at = Date.now()) {
        const key = this.dayKey(at);
        if (!this.state.daily[key])
            this.state.daily[key] = { day: key, orchestrated: 0, passthrough: 0 };
        return this.state.daily[key];
    }
    taskSpent(taskId) {
        return this.state.tasks[taskId] ?? 0;
    }
    /**
     * Drop per-task spend entries no longer tracked in memory (bounded budget
     * file growth on long-lived hosts). Daily totals are the authoritative
     * limit; per-task records are diagnostic.
     */
    pruneTasks(keep) {
        for (const id of Object.keys(this.state.tasks)) {
            if (!keep.has(id)) {
                delete this.state.tasks[id];
                this.dirty = true;
            }
        }
        if (this.dirty)
            this.flush();
    }
    passthroughToday(at = Date.now()) {
        return this.daily(at).passthrough;
    }
    estimatedToday(at = Date.now()) {
        return this.daily(at).orchestrated;
    }
    /** Record passthrough observation (report only; not against hard limits by default). */
    observePassthrough(model, inputTokens, outputTokens) {
        const rate = this.pricing.rate(undefined, model);
        const cost = rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : 0;
        this.daily().passthrough += cost;
        this.dirty = true;
        this.flush();
    }
    debit(taskId, stage, provider, model, inputTokens, outputTokens) {
        const rate = this.pricing.rate(provider, model);
        const cost = rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : 0;
        const { dailyLimitCny, taskLimitCny, countPassthrough } = this.limits();
        const day = this.daily();
        const againstDaily = stage === 'passthrough' ? countPassthrough : true;
        if (stage !== 'passthrough') {
            const taskSpent = (this.state.tasks[taskId ?? '_global'] ?? 0) + cost;
            if (taskId && taskSpent > taskLimitCny) {
                return { ok: false, reason: 'task_exhausted', dailySpent: day.orchestrated, taskSpent: this.taskSpent(taskId), utilization: day.orchestrated / dailyLimitCny };
            }
            if (day.orchestrated + cost > dailyLimitCny) {
                return { ok: false, reason: 'daily_exhausted', dailySpent: day.orchestrated, taskSpent: this.taskSpent(taskId ?? '_global'), utilization: day.orchestrated / dailyLimitCny };
            }
            day.orchestrated += cost;
            if (taskId)
                this.state.tasks[taskId] = taskSpent;
        }
        else {
            day.passthrough += cost;
            void againstDaily;
        }
        this.state.ledger.push({ taskId, stage, provider, model, inputTokens, outputTokens, costCny: cost, at: Date.now() });
        if (this.state.ledger.length > 5000)
            this.state.ledger = this.state.ledger.slice(-4000);
        this.dirty = true;
        this.flush();
        return { ok: true, dailySpent: day.orchestrated, taskSpent: taskId ? this.taskSpent(taskId) : 0, utilization: day.orchestrated / dailyLimitCny };
    }
}
//# sourceMappingURL=ledger.js.map