# React components

**Rule.** Components are plain named functions over typed props, reading state
through hooks. The component layer renders; it does not own engine state or
reach into store internals.

## Rules

1. **Named function declarations, exported by name** — `export function
   SessionView(...)`. No `React.FC`, no default exports: named exports keep
   imports greppable and rename-safe; `React.FC` adds nothing but an implicit
   `children`.
2. **Props are typed inline or via a local interface.** Destructure in the
   parameter list for small prop sets; destructure in the body (or use
   `props.x`) when the list is long enough that the signature stops being
   readable.
3. **State access is hooks-only.** Components call `use<Thing>()` hooks; they
   never import a store object or call its getters directly. The hook is the
   subscription; direct reads silently skip re-renders.
4. **List keys use a stable identity when items have one** (an id, a unique
   url). Index keys are acceptable only for immutable render-only lists —
   content that is appended and re-rendered but never reordered or removed
   item-by-item. An editable list with index keys is a reorder bug waiting.
5. **Event handlers are `on<Event>`** (`onPickFiles`, `onScroll`) — both the
   prop name and the local function.
6. **Async handlers never leak rejections.** Wrap awaited work in try/catch or
   call APIs that return result objects; deliberate fire-and-forget is an
   explicit `void fn()`, so every floating promise is visibly intentional.
7. **Inline `style` only for values computed at runtime** (a percent width, a
   measured height). Static styling belongs in classes — a hardcoded inline
   style is a class that escaped review.
8. **Components stay small and extractable.** A page component that grows
   nested function components (a card, a row, a block with its own state) ships
   them as their own files — nested definitions can't be reused or tested and
   re-create on every render of the parent.

## Why

These rules make the component layer boring on purpose: every component looks
the same shape, state flows one way through hooks, and nothing in the render
tree holds engine logic hostage. Boring components are the ones you can move,
split, and test without archaeology.
