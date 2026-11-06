// Minimal JSON-lines logger. Never pass request bodies, headers, identity codes,
// hashes or speech text here (事实格式 §3.2, §13).

type Level = "info" | "warn" | "error";

let quiet = false;

export function setQuiet(q: boolean): void {
  quiet = q;
}

function write(level: Level, msg: string, fields: Record<string, string | number | boolean | null>): void {
  if (quiet && level === "info") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === "info") process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields: Record<string, string | number | boolean | null> = {}) => write("info", msg, fields),
  warn: (msg: string, fields: Record<string, string | number | boolean | null> = {}) => write("warn", msg, fields),
  error: (msg: string, fields: Record<string, string | number | boolean | null> = {}) => write("error", msg, fields),
};

/** Error name + message only (no stack, no SQL parameters). */
export function errText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 300);
  return "non-error thrown";
}
