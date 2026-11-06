// [S32] Email continuation (设计者原话 2026-11-06 19): an email is an
// identity token, not a secret — no password, no verification mail. The
// server stores only sha256("aihw-email:" + normalized address);
// normalization trims surrounding whitespace and lower-cases. The raw
// address is never echoed, logged or stored, and a failed continuation
// answers the same AUTH_INVALID whether the handle exists, the email is
// unbound or the address does not match.

import { createHash } from "node:crypto";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function hashEmail(normalized: string): string {
  return createHash("sha256").update(`aihw-email:${normalized}`, "utf8").digest("hex");
}
