// Logger contract. Swap sinks by passing a different Logger instance into
// the Ctx; everything downstream uses the interface only.
// Scope-join format for child(). One definition so every sink produces the
// same scope strings — tests and log readers depend on the dotted form
// (essential duplication, consolidated — see docs/conventions/consolidation.md).
export function joinScope(parent, child) {
    return parent ? `${parent}.${child}` : child;
}
