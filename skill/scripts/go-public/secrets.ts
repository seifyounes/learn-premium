// Secrets: files that are secrets by their name, and credential-shaped text. A token with a known
// format blocks; an assignment that only looks like one is a Checkpoint item for the Owner.

export type Severity = "block" | "checkpoint";

export interface SecretMatch {
  rule: string;
  severity: Severity;
  /** 1-based. */
  line: number;
  /** The first characters and the length: enough to find it, never the value. */
  preview: string;
}

interface TextRule {
  rule: string;
  pattern: RegExp;
}

/** Credentials with a recognisable format. Each pattern is global so every hit on a line is seen. */
const TOKEN_RULES: TextRule[] = [
  { rule: "private-key", pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { rule: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { rule: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { rule: "anthropic-api-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { rule: "openai-api-key", pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { rule: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { rule: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { rule: "stripe-live-key", pattern: /\b[rs]k_live_[0-9a-zA-Z]{20,}/g },
  { rule: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { rule: "huggingface-token", pattern: /\bhf_[A-Za-z0-9]{34,}\b/g },
  { rule: "npmrc-auth", pattern: /_auth(?:Token)?\s*=\s*[^\s$"'][^\s"']*/g },
  { rule: "url-credentials", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"'<>]+:[^\s:@/"'<>$]{3,}@[\w.-]+/g },
];

/**
 * `name = "value"` where the name says it's a secret and the value looks random (letters and digits,
 * 16 or more). Seen only on a line no token rule matched.
 */
const ASSIGNMENT =
  /\b[A-Za-z0-9_]*(?:secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([A-Za-z0-9_\-+/=.]{16,})/gi;

export function findSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  text.split("\n").forEach((line, index) => {
    const tokens = TOKEN_RULES.flatMap(({ rule, pattern }) =>
      [...line.matchAll(pattern)].map((hit) => match(rule, "block", index, hit[0])),
    );
    if (tokens.length > 0) {
      found.push(...tokens);
      return;
    }
    for (const hit of line.matchAll(ASSIGNMENT)) {
      const value = hit[1] ?? "";
      if (/[0-9]/.test(value) && /[A-Za-z]/.test(value) && new Set(value).size > 4) {
        found.push(match("secret-assignment", "checkpoint", index, value));
      }
    }
  });
  return found;
}

function match(rule: string, severity: Severity, index: number, value: string): SecretMatch {
  return { rule, severity, line: index + 1, preview: `${value.slice(0, 4)}… (${value.length} characters)` };
}

export interface SecretPathMatch {
  rule: string;
  reason: string;
}

const SAMPLE_ENV = new Set([".env.example", ".env.sample", ".env.template"]);

/** A file that is a secret by its name alone, whatever it holds. */
export function secretPath(path: string): SecretPathMatch | null {
  const file = (path.split("/").pop() ?? "").toLowerCase();
  if (/^\.env(\..+)?$/.test(file) && !SAMPLE_ENV.has(file)) return { rule: "env-file", reason: "an environment file" };
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(file)) return { rule: "ssh-key", reason: "an SSH private key" };
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(file)) return { rule: "key-file", reason: "a key or certificate store" };
  return null;
}
