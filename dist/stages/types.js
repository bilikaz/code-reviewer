// Pipeline state — uniform shape passed through every stage. Each stage
// takes StageState, returns StageState. Stages mutate `comments` and
// `context.preloadedFiles`; everything else is additive (set once by its
// producing stage).
export function emptyRenderingContext() {
    return { diffs: [], binary_files: [], conventions: [] };
}
