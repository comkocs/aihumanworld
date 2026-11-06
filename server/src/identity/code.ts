// [S11 final] Identity code (附录 A v1 A7):
//   display    AIHW-XXXX-XXXX-XXXX-XXXX-XXXX-CC   (20 Crockford base32 + 2 check)
//   normalized AIHWXXXXXXXXXXXXXXXXXXXXCC         (upper case, group dashes removed)
// The server stores only SHA-256(normalized) as 64 lowercase hex.
// Final check algorithm (S11, 事实格式 §3.2 「校验位算法由 S11 明确」): the
// 20-character body is read as one Crockford base32 integer; the check is
// (body mod 1021) written as two base32 digits, high digit first. 1021 is the
// largest prime below 1024 (= 32²), so it always fits two digits, and any
// single-character substitution changes the value by d·32^k with 0 < d < 32,
// which is never ≡ 0 (mod 1021) — always caught. The check is a transcription
// aid only: authentication hashes the whole normalized code and never depends
// on the check digits, and a wrong check is not an extra identity signal.

import { createHash, randomInt } from "node:crypto";

export const CODE_PREFIX = "AIHW";
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LEN = 20;

export function checkSymbols(body: string): string {
  let v = 0n;
  for (const ch of body) {
    const d = CROCKFORD.indexOf(ch);
    if (d < 0) throw new Error("not a Crockford base32 body");
    v = v * 32n + BigInt(d);
  }
  const m = Number(v % 1021n);
  return `${CROCKFORD[Math.floor(m / 32)]}${CROCKFORD[m % 32]}`;
}

export interface NewCode {
  /** Shown once in the enter create response, never stored. */
  display: string;
  normalized: string;
}

export function generateCode(): NewCode {
  let body = "";
  for (let i = 0; i < BODY_LEN; i += 1) body += CROCKFORD[randomInt(32)];
  const check = checkSymbols(body);
  const groups = body.match(/.{4}/g) ?? [];
  return {
    display: [CODE_PREFIX, ...groups, check].join("-"),
    normalized: `${CODE_PREFIX}${body}${check}`,
  };
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replaceAll("-", "");
}

export function hashCode(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
