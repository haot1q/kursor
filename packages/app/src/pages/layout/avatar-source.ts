// Pure helper for resolving the avatar URL of a project. Extracted from
// sidebar-items.tsx into its own module so it can be unit-tested without
// pulling in the full Solid + Kobalte UI dependency chain.
//
// Previously this function hard-recognized the upstream opencode repo by
// its first-commit SHA and substituted https://opencode.ai/favicon.svg as
// the project avatar. That branch (a) phoned home to opencode.ai every
// time the upstream repo happened to be opened in kursor, and (b)
// misbranded an unrelated third-party project with another product's
// logo. The recognition is removed entirely — kursor projects fall
// through to their configured icon. See
// packages/app/src/pages/layout/sidebar-items.test.ts for the unit-level
// privacy assertions and packages/opencode/test/repo/no-phone-home.test.ts
// for the repo-wide invariant.
export function getProjectAvatarSource(_id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (icon?.override) return icon?.override
  if (icon?.color) return undefined
  return icon?.url
}
