// Error-message normalization (see docs/conventions/error-handling.md). `catch (e)` binds unknown;
// `(e as Error).message` lies when a non-Error was thrown (yields
// undefined and the log line loses its cause). Every catch site that
// needs the message goes through this helper instead.
export function errorMessage(e) {
    if (e instanceof Error)
        return e.message;
    if (typeof e === "string")
        return e;
    try {
        return JSON.stringify(e);
    }
    catch {
        return String(e);
    }
}
