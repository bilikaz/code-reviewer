// Default sink: pretty indented output to stderr. Each event on its own
// line, structured `data` rendered as indented JSON below it.
import { joinScope } from "./types.js";
const LEVEL_TAG = {
    debug: "DBG",
    info: "INF",
    warn: "WRN",
    error: "ERR",
};
function render(level, scope, event, data) {
    const tag = LEVEL_TAG[level];
    const prefix = scope ? `[${tag} ${scope}]` : `[${tag}]`;
    if (!data || Object.keys(data).length === 0) {
        return `${prefix} ${event}\n`;
    }
    const body = JSON.stringify(data, null, 2)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n");
    return `${prefix} ${event}\n${body}\n`;
}
export class ConsoleLogger {
    scope;
    constructor(scope) {
        this.scope = scope;
    }
    debug(event, data) {
        process.stderr.write(render("debug", this.scope, event, data));
    }
    info(event, data) {
        process.stderr.write(render("info", this.scope, event, data));
    }
    warn(event, data) {
        process.stderr.write(render("warn", this.scope, event, data));
    }
    error(event, data) {
        process.stderr.write(render("error", this.scope, event, data));
    }
    stream(chunk) {
        process.stderr.write(chunk);
    }
    child(scope) {
        return new ConsoleLogger(joinScope(this.scope, scope));
    }
}
