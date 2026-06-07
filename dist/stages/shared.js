// Helpers shared between LLM-using stages (reconcile, review).
// Renders a RenderingContext into the body of a <rendering_context> slot.
// Each sub-bucket becomes its own block; empty buckets are skipped. The LLM
// sees structured sections it can scan by type and walk by file.
export function renderRenderingContext(rc) {
    const blocks = [];
    if (rc.diffs.length > 0) {
        const items = rc.diffs.map((d) => `<diff file="${d.path}" type="${d.type}" lines="${d.lineCount}" bytes="${d.size}">\n${d.content}\n</diff>`);
        blocks.push(`<diffs>\n${items.join("\n\n")}\n</diffs>`);
    }
    if (rc.binary_files.length > 0) {
        const items = rc.binary_files.map((b) => {
            const tag = b.suspicious ? ` suspicious="true"` : "";
            return `<binary_file file="${b.path}" bytes="${b.size}" old_bytes="${b.oldSize}"${tag} />`;
        });
        blocks.push(`<binary_files>\n${items.join("\n")}\n</binary_files>`);
    }
    if (rc.conventions.length > 0) {
        const items = rc.conventions.map((c) => `<convention>\n  <context>${c.context}</context>\n  <example>${c.example}</example>\n</convention>`);
        blocks.push(`<conventions>\n${items.join("\n")}\n</conventions>`);
    }
    return blocks.join("\n\n");
}
export function hasRendering(rc) {
    return rc.diffs.length + rc.binary_files.length + rc.conventions.length > 0;
}
