// Detect shell commands that are likely destructive or irreversible so the
// permission UI can surface a clear warning. This is purely informational
// (the permission system stays the authority on what runs) — the warning is
// attached to the `ask()` metadata so the renderer can display it next to
// the Allow / Deny buttons.
//
// Patterns intentionally err on the side of *more* warnings rather than
// fewer. False positives cost the user a confirmation glance; false
// negatives can cost them their workday.

type DestructivePattern = {
  pattern: RegExp
  warning: string
}

const PATTERNS: DestructivePattern[] = [
  // Git — data loss / hard to reverse
  { pattern: /\bgit\s+reset\s+--hard\b/, warning: "may discard uncommitted changes" },
  {
    pattern: /\bgit\s+push\b[^;&|\n]*[ \t](--force|--force-with-lease|-f)\b/,
    warning: "may overwrite remote history (force push)",
  },
  {
    pattern: /\bgit\s+clean\b(?![^;&|\n]*(?:-[a-zA-Z]*n|--dry-run))[^;&|\n]*-[a-zA-Z]*f/,
    warning: "may permanently delete untracked files",
  },
  { pattern: /\bgit\s+checkout\s+(--\s+)?\.[ \t]*($|[;&|\n])/, warning: "may discard all working tree changes" },
  { pattern: /\bgit\s+restore\s+(--\s+)?\.[ \t]*($|[;&|\n])/, warning: "may discard all working tree changes" },
  { pattern: /\bgit\s+stash[ \t]+(drop|clear)\b/, warning: "may permanently remove stashed changes" },
  {
    pattern: /\bgit\s+branch\s+(-D[ \t]|--delete\s+--force|--force\s+--delete)\b/,
    warning: "may force-delete a branch",
  },

  // Git — safety bypass
  { pattern: /\bgit\s+(commit|push|merge)\b[^;&|\n]*--no-verify\b/, warning: "skips safety hooks (--no-verify)" },
  { pattern: /\bgit\s+commit\b[^;&|\n]*--amend\b/, warning: "rewrites the last commit (--amend)" },

  // Filesystem — recursive / force removal
  {
    pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/,
    warning: "recursive, force-removes files (rm -rf)",
  },
  { pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*[rR]/, warning: "recursively removes files (rm -r)" },
  { pattern: /(^|[;&|\n]\s*)rm\s+-[a-zA-Z]*f/, warning: "force-removes files (rm -f)" },

  // Filesystem — catastrophic targets
  {
    pattern: /\brm\b[^;&|\n]*\s(\/|\/\*|~|~\/\*|\$HOME|\$HOME\/\*)(\s|$|[;&|])/,
    warning: "TARGETS THE ROOT / HOME DIRECTORY",
  },
  {
    pattern: /\bdd\b[^;&|\n]*\bof=\/dev\/(sd[a-z]|nvme|disk|hd[a-z])/i,
    warning: "writes raw bytes to a block device (dd of=/dev/…)",
  },
  { pattern: /\bmkfs(\.\w+)?\b/, warning: "formats a filesystem (mkfs)" },
  { pattern: /\bchmod\s+-R\s+[0-7]*[0-7]?7[0-7]?\s+\//, warning: "world-writable chmod across the root tree" },

  // Fork bomb
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/, warning: "fork bomb (`:(){:|:&};:`)" },

  // Database
  { pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, warning: "may drop or truncate database objects" },
  { pattern: /\bDELETE\s+FROM\s+\w+[ \t]*(;|"|'|\n|$)/i, warning: "may delete all rows from a database table" },

  // Infrastructure / cloud
  { pattern: /\bkubectl\s+delete\b/, warning: "may delete Kubernetes resources" },
  { pattern: /\bterraform\s+destroy\b/, warning: "may destroy Terraform infrastructure" },
  { pattern: /\baws\s+s3\s+rm\b[^;&|\n]*--recursive\b/, warning: "recursively deletes S3 objects" },
  { pattern: /\bdocker\s+system\s+prune\b[^;&|\n]*-[a-zA-Z]*a/, warning: "removes all unused docker resources (-a)" },
  {
    pattern: /\bdocker\s+(container|image|volume)\s+prune\b[^;&|\n]*-[a-zA-Z]*f/,
    warning: "force-prunes docker resources",
  },

  // Networked code execution (piping arbitrary script into a shell)
  {
    pattern: /\b(curl|wget|fetch)\b[^;&|\n]*\|\s*(bash|sh|zsh|fish|powershell|pwsh|cmd|python)\b/i,
    warning: "pipes a downloaded script into a shell",
  },
]

export type DestructiveWarning = {
  warning: string
  severity: "high" | "medium" | "low"
}

const HIGH_SEVERITY_PATTERNS = new Set([
  "TARGETS THE ROOT / HOME DIRECTORY",
  "writes raw bytes to a block device (dd of=/dev/…)",
  "formats a filesystem (mkfs)",
  "world-writable chmod across the root tree",
  "fork bomb (`:(){:|:&};:`)",
  "may drop or truncate database objects",
  "may overwrite remote history (force push)",
  "pipes a downloaded script into a shell",
])

/**
 * Scan a shell command for known destructive patterns. Returns every matched
 * warning (a command can hit multiple), highest-severity ordered first.
 * Returns `null` if no destructive pattern was detected.
 */
export function detectDestructive(command: string): DestructiveWarning[] | null {
  const hits: DestructiveWarning[] = []
  for (const { pattern, warning } of PATTERNS) {
    if (pattern.test(command)) {
      hits.push({
        warning,
        severity: HIGH_SEVERITY_PATTERNS.has(warning) ? "high" : "medium",
      })
    }
  }
  if (hits.length === 0) return null
  return hits.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1))
}

/**
 * Convenience: return a single user-facing message summarizing all warnings.
 */
export function formatDestructive(warnings: DestructiveWarning[]): string {
  if (warnings.length === 1) return warnings[0]!.warning
  return warnings.map((w, i) => `${i + 1}. ${w.warning}`).join("\n")
}
