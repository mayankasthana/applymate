/**
 * Chat text → safe HTML with links. Everything is escaped first, then three
 * things become clickable:
 *
 *  - http(s) URLs            → anchors that open in a new tab;
 *  - `workspace/…` file paths → /api/artifact links, so a resume PDF, evidence
 *    screenshot or draft mentioned in chat opens in the sandboxed viewer;
 *  - application ids          → the same `button.applink` the actions rail
 *    uses, so a chat mention of app-1fei opens that application's sheet.
 *
 * Only ids passed in `appIds` (the ones the board actually knows) become
 * buttons; anything else stays plain text, so prose can never grow a dead
 * button. Unknown file extensions and directory-ish paths stay plain too — a
 * link that 404s is worse than text.
 *
 * The review UI has no build step: server-ui.ts embeds this function's source
 * via `linkifyChatHtml.toString()`. That constrains the body to plain ES with
 * string concatenation only — no backticks, no `${`, no `</script`, no `<!--` —
 * because the source lands inside a template literal and inside a `<script>`
 * element. test/linkify.test.ts enforces those constraints.
 */
export function linkifyChatHtml(text: string, appIds?: readonly string[]): string {
  const raw = String(text ?? "");
  const known: Record<string, boolean> = {};
  if (appIds) {
    for (let i = 0; i < appIds.length; i++) {
      const id = appIds[i];
      if (id) known[String(id).toLowerCase()] = true;
    }
  }
  const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
  const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ESC[c] ?? c);
  const parens = (s: string): number => s.split("(").length - s.split(")").length;
  let out = "";
  let last = 0;
  const re = /https?:\/\/[^\s<>"'`]+|workspace\/[^\s<>"'`]+|\bapp-[a-z0-9]{3,12}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const tok = m[0] ?? "";
    // How much of the token the link consumes: a URL or path may give back
    // trailing punctuation that belongs to the sentence.
    let end = m.index + tok.length;
    let html: string | null = null;
    if (/^https?:\/\//i.test(tok)) {
      // Trailing punctuation belongs to the sentence, not the URL — except a
      // closing paren that balances an open one inside the URL itself.
      let u = tok.replace(/[.,;:!?'"]+$/, "");
      while (/\)$/.test(u) && parens(u) < 0) u = u.slice(0, -1);
      if (u.length > "http://".length) {
        html = '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + "</a>";
        end = m.index + u.length;
      }
    } else if (/^workspace\//i.test(tok)) {
      const p = tok.replace(/[.,;:!?)]+$/, "");
      if (/\.(md|markdown|txt|pdf|png|jpe?g|webp|gif|html?|eml|json|csv)$/i.test(p)) {
        // The artifact route is workspace-root-relative; chat spells paths
        // repo-relative, so the leading `workspace/` comes off here.
        const rel = p.replace(/^workspace\//i, "");
        html = '<a target="_blank" rel="noopener" href="/api/artifact?path=' + encodeURIComponent(rel) + '">' + esc(p) + "</a>";
        end = m.index + p.length;
      }
    } else {
      const id = tok.toLowerCase();
      if (known[id]) {
        html = '<button class="applink" data-app="' + esc(id) + '">' + esc(id) + "</button>";
      }
    }
    if (html === null) continue; // stays plain text; the next slice carries it
    out += esc(raw.slice(last, m.index)) + html;
    last = end;
  }
  out += esc(raw.slice(last));
  return out;
}
