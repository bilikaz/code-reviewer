# ADR-0014: LLM tools are read-only and shell-free

Status: Accepted (2026-06-10)

## Context

The review and reconcile stages hand the LLM a tool loop against the working
tree. Until now that included a `Bash` tool (`bash -lc <command>`), justified by
the container being a throwaway sandbox.

The threat model says otherwise. The model's input is **untrusted PR content** —
diffs, commit messages, prior comments — exactly the place a prompt injection
lives. And the container is not empty: it holds a live VCS token and an LLM API
key. A shell turns an injected instruction into command execution; container
isolation limits the blast radius to precisely the things the container must
contain to do its job — the credentials and the checkout.

Three options were on the table:

1. **Keep `Bash`, rely on the container.** Rejected: the sandbox boundary is in
   the wrong place — the secrets are inside it.
2. **Keep `Bash` behind a command allowlist.** Rejected: deciding what a shell
   string does requires parsing shell, and `git -c core.pager=…`-style flag
   smuggling means even an "obviously safe" binary allowlist leaks back to
   arbitrary execution.
3. **Replace the shell with structured read-only tools.** Chosen.

## Decision

The LLM's tool set is `Read`, `Grep`, `Ls`, `Glob`, `Tail` — structured
arguments, read-only, and **never a shell**:

- `Read`/`Tail`/`Ls`/`Glob` are pure `node:fs` operations. `Read` pages via
  `start_line`/`lines`, so long files no longer need a shell escape hatch.
- `Grep` spawns the `grep` binary with an **argv array** (and `-e` so a pattern
  starting with `-` is data, not a flag). No `exec`, no command string, no
  `{ shell: true }` — model-supplied text is never tokenized by a shell, so
  `|`, `;`, `$()` stay inert data.

The invariant for future tools: a tool may read; if it must spawn, it spawns a
binary with an argv array and model input only ever appears as an argument.
Nothing the model sends is interpreted by a shell.

## Consequences

- Injected instructions in PR content can no longer execute commands or write
  anything; the worst case is reading files the process can already read. The
  container gate for `local://` review (`inContainer()` in `ctx.ts`) remains,
  now guarding read access rather than shell access.
- The review loses `git log` / `git blame` / `git show` as evidence sources.
  Accepted for now; if history matters later, the path is a dedicated
  structured `GitLog`-style tool obeying the invariant — not a shell.
- Each navigation primitive is a separate tool file in the registry, written
  for the model (explicit errors, next-call hints in footers), per the
  existing tool conventions.
