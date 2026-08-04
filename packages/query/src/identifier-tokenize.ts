/**
 * Splits a source identifier into its lowercase constituent words —
 * camelCase, PascalCase, snake_case, kebab-case, and mixed forms.
 *
 * `getUserById` -> ["get", "user", "by", "id"]
 * `user_account_id` -> ["user", "account", "id"]
 * `user-account-id` -> ["user", "account", "id"]
 *
 * Shared utility for spec 068 (identifier-aware keyword scoring, this spec)
 * and spec 067 (embedding-text splitting) — whichever lands first owns this
 * file, the other imports it. No coordination needed beyond that; this is
 * a pure function with no dependency on either spec's other machinery.
 *
 * Acronym-boundary rule (the one genuinely open design decision the spec
 * left undefined): a run of uppercase letters is split right before its
 * LAST letter when that letter starts a new capitalized word, i.e. the last
 * uppercase letter of the run "belongs" to the following word, not the
 * acronym. `XMLHttpRequest` -> `XML` | `Http` | `Request` (not `XMLH` |
 * `ttp...`), because `HttpRequest` reads as two real words and `XML` is the
 * acronym that precedes them. `parseHTMLString` -> `parse` | `HTML` |
 * `String` for the same reason. A trailing all-caps run with nothing
 * capitalized after it (e.g. `fetchJSON`) is left intact as one word
 * (`JSON`), since there's no following capitalized word to hand the last
 * letter to.
 */
export function tokenizeIdentifier(name: string): string[] {
  if (!name) return [];

  return name
    // 1. Split on anything that isn't a letter or digit — snake_case,
    // kebab-case, dots, spaces, and any other punctuation all become word
    // boundaries.
    .split(/[^a-zA-Z0-9]+/)
    // 2. Within each punctuation-delimited chunk, split camelCase/PascalCase
    // boundaries:
    //    - lower/digit -> Upper (e.g. "get|User", "id2|Value")
    //    - Upper -> Upper immediately followed by lower (the acronym
    //      boundary above: "XML|Http", "HTML|String")
    .flatMap((chunk) =>
      chunk.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    )
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}
