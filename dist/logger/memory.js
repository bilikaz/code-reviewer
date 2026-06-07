// In-memory sink. Records every event for test assertions. `stream` chunks
// are concatenated into a single field per scope.
export class MemoryLogger {
    scope;
    entries;
    streamBuffer;
    constructor(scope, sharedEntries, sharedStreamRef) {
        this.scope = scope;
        this.entries = sharedEntries ?? [];
        this._streamRef = sharedStreamRef ?? { value: "" };
        this.streamBuffer = "";
    }
    _streamRef;
    record(level, event, data) {
        this.entries.push({
            level,
            ts: new Date().toISOString(),
            scope: this.scope,
            event,
            ...(data ? { data } : {}),
        });
    }
    debug(event, data) { this.record("debug", event, data); }
    info(event, data) { this.record("info", event, data); }
    warn(event, data) { this.record("warn", event, data); }
    error(event, data) { this.record("error", event, data); }
    stream(chunk) {
        this._streamRef.value += chunk;
    }
    get streamedText() {
        return this._streamRef.value;
    }
    child(scope) {
        const next = this.scope ? `${this.scope}.${scope}` : scope;
        return new MemoryLogger(next, this.entries, this._streamRef);
    }
}
