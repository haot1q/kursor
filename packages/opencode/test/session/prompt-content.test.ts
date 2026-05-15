import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "fs"
import path from "path"

const PROMPT_DIR = path.resolve(import.meta.dir, "../../src/session/prompt")
const TOOL_DIR = path.resolve(import.meta.dir, "../../src/tool")
const AGENT_PROMPT_DIR = path.resolve(import.meta.dir, "../../src/agent/prompt")
const COMMAND_TEMPLATE_DIR = path.resolve(import.meta.dir, "../../src/command/template")
const SKILL_BUNDLED_DIR = path.resolve(import.meta.dir, "../../src/skill/bundled")
const SKILL_PROMPT_DIR = path.resolve(import.meta.dir, "../../src/skill/prompt")

// Source files we cross-reference in coupling tests. These are READ AS TEXT
// (not imported) so the tests still catch drift even if a refactor reshapes
// the module's exported surface.
const SKILL_INDEX_TS = path.resolve(import.meta.dir, "../../src/skill/index.ts")
const INSTRUCTION_TS = path.resolve(import.meta.dir, "../../src/session/instruction.ts")

const readPrompt = (filename: string, dir: string = PROMPT_DIR): string =>
  readFileSync(path.join(dir, filename), "utf8")

/** List all *.txt or *.md files in a directory (non-recursive). Returns absolute paths. */
const listTextFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".txt") || name.endsWith(".md"))
      .map((name) => path.join(dir, name))
      .filter((p) => statSync(p).isFile())
  } catch {
    return []
  }
}

// All model-specific system prompts. Keep this list in sync with the directory.
// Synthetic prompts (compaction/title) live elsewhere.
const MODEL_PROMPTS = [
  "anthropic.txt",
  "codex.txt",
  "gpt.txt",
  "kimi.txt",
  "gemini.txt",
  "default.txt",
  "copilot-gpt-5.txt",
  "beast.txt",
  "trinity.txt",
] as const

describe("session prompt files — structural contract (regression guard)", () => {
  test("every documented prompt file actually exists on disk", () => {
    const onDisk = new Set(readdirSync(PROMPT_DIR))
    for (const name of MODEL_PROMPTS) {
      expect(onDisk.has(name), `missing prompt file: ${name}`).toBe(true)
    }
  })

  test("every model prompt has a self-identity opening line", () => {
    for (const name of MODEL_PROMPTS) {
      const text = readPrompt(name)
      const firstLine = text.split("\n")[0] ?? ""
      // Self-identity lines start with "You are ..." — the convention across all models.
      expect(firstLine, `${name} should open with a self-identity line`).toMatch(/^You are /i)
    }
  })

  test("every model prompt has non-trivial length (basic completeness)", () => {
    for (const name of MODEL_PROMPTS) {
      const text = readPrompt(name)
      expect(text.length, `${name} is suspiciously short`).toBeGreaterThan(500)
    }
  })

  test("anthropic.txt retains parallel tool calling guidance", () => {
    const text = readPrompt("anthropic.txt")
    // The guidance is critical for codebase exploration latency. Lock it in.
    expect(text).toMatch(/parallel/i)
    expect(text).toMatch(/multiple tools? .* (in parallel|single response|single message)/i)
  })

  test("anthropic.txt retains TodoWrite + Task tool guidance", () => {
    const text = readPrompt("anthropic.txt")
    expect(text).toMatch(/TodoWrite/i)
    expect(text).toMatch(/\bTask\b/)
  })

  test("anthropic.txt retains Code References (file_path:line_number) guidance", () => {
    const text = readPrompt("anthropic.txt")
    expect(text).toMatch(/file_path:line_number/i)
  })

  test("anthropic.txt makes the model aware of the kursor desktop GUI surface", () => {
    const text = readPrompt("anthropic.txt")
    // Tight regex: require a specific kursor-GUI phrase, NOT a substring match
    // (the bare word "GUI" would also hit "guidance" via the /i flag).
    expect(text).toMatch(/four.?column|kursor (GUI|desktop)|code viewer column/)
  })

  test("anthropic.txt encourages clickable file_path:line_number citations in the GUI", () => {
    const text = readPrompt("anthropic.txt")
    expect(text).toMatch(/clickable|click.* to (jump|navigate)|jump.?to/i)
  })

  test("anthropic.txt warns about concurrent agents / shared worktree (parity with gpt.txt + codex.txt)", () => {
    const text = readPrompt("anthropic.txt")
    // Tight regex: must explicitly link concurrency to a worktree / codebase,
    // not just match the unrelated "multiple agents in parallel" tool-call line.
    expect(text).toMatch(/(concurrent|multiple).*(worktree|codebase)|worktree.*(concurrent|shared)|do NOT revert/i)
  })

  test("anthropic.txt references the <available_skills> anchor that Skill.fmt injects", () => {
    const text = readPrompt("anthropic.txt")
    // Skill.fmt(list, { verbose: true }) wraps the list in <available_skills>...</available_skills>.
    // The prompt should give the model a precise XML anchor to find it.
    expect(text).toMatch(/<available_skills>|available_skills section|<available_skills/)
  })

  test("anthropic.txt directs the model to scan Skills before non-trivial work", () => {
    const text = readPrompt("anthropic.txt")
    // Must teach the proactive habit: glance at Skills BEFORE diving in,
    // not just "use the skill tool when a task matches" which is already in
    // the dynamic injection.
    expect(text).toMatch(/before (starting|diving|launching).*(task|plan|work)|scan.*Skill|check.*available.*Skill/i)
  })

  test("anthropic.txt names the `skill` tool by ID for loading a Skill's playbook", () => {
    const text = readPrompt("anthropic.txt")
    // The tool ID is `skill` (lowercase). Reference it inline so the model
    // knows the literal tool name to invoke.
    expect(text).toMatch(/`skill`|the skill tool/i)
  })

  test("anthropic.txt forbids speculative `skill` calls when no Skill matches", () => {
    const text = readPrompt("anthropic.txt")
    // Guard rail: loading an irrelevant Skill wastes context tokens. Anti-pattern
    // must be explicitly forbidden so eager models don't reflexively call `skill`.
    expect(text).toMatch(/do NOT call.*skill.*speculat|speculatively|no.*Skill.*(matches|fits)/i)
  })

  test("anthropic.txt # Doing tasks does not contain an orphan empty bullet ('- \\n')", () => {
    const text = readPrompt("anthropic.txt")
    // Earlier file had `- ` on its own line — a cosmetic bug AND a dead bullet
    // that signals to the model that the workflow list is incomplete or malformed.
    // Detect any line that is just a dash with optional whitespace (space OR tab).
    const lines = text.split("\n")
    const orphanIdx = lines.findIndex((line) => /^-\s*$/.test(line))
    expect(orphanIdx, `found orphan empty bullet at line ${orphanIdx + 1}`).toBe(-1)
  })

  test("anthropic.txt # Doing tasks instructs the model to verify the solution with tests", () => {
    const text = readPrompt("anthropic.txt")
    // Parity with default.txt / trinity.txt: verify step must be present so the
    // model does not declare done without test validation.
    expect(text).toMatch(/[Vv]erify the solution.*tests?|verify.*with tests/)
  })

  test("anthropic.txt # Doing tasks requires running lint + typecheck after task completion", () => {
    const text = readPrompt("anthropic.txt")
    // Parity with default.txt / trinity.txt: the "VERY IMPORTANT" lint/typecheck
    // reminder is the strongest quality gate in the canonical Anthropic-style
    // workflow. Its absence in anthropic.txt is a real regression vs. peer prompts.
    expect(text).toMatch(/lint.*typecheck|typecheck.*lint/i)
  })

  test("anthropic.txt # Doing tasks forbids committing without explicit user request", () => {
    const text = readPrompt("anthropic.txt")
    // Critical safety nudge: stops the model from auto-committing after a task.
    // Parity with default.txt / trinity.txt.
    expect(text).toMatch(/NEVER commit.*unless.*(user|explicit|ask)/i)
  })

  // ---------------------------------------------------------------------------
  // Defensive contracts: lock the existing "do not revert other changes" +
  // concurrent-worktree wording in gpt.txt and codex.txt. These prompts ALREADY
  // contain the correct guidance — these tests exist purely so a future edit
  // (sweep rewrite, accidental delete, prompt minification) cannot silently
  // remove the safety nudge.
  //
  // gpt.txt: single concise paragraph mentioning concurrent agents.
  // codex.txt: richer "Git and workspace hygiene" section with extra guard rails
  //            (no amend, no destructive git commands).
  // ---------------------------------------------------------------------------

  test("gpt.txt forbids reverting changes the model did not make (safety contract)", () => {
    const text = readPrompt("gpt.txt")
    // Locks the exact safety phrasing — model must NEVER revert/undo/modify
    // changes it did not make without explicit user request.
    expect(text).toMatch(/NEVER revert.*did not make|did not make.*unless.*explicit/i)
  })

  test("gpt.txt makes the model aware of concurrent agents on the same codebase", () => {
    const text = readPrompt("gpt.txt")
    // Locks the concurrency-awareness phrase that frames unexpected changes
    // as legitimate (from user / other agents), not as drift to be cleaned up.
    expect(text).toMatch(/multiple agents.*(working|codebase|worktree).*concurrent|concurrent.*(agents|user|sessions?)/i)
  })

  test("gpt.txt instructs the model to continue past unexpected changes instead of halting", () => {
    const text = readPrompt("gpt.txt")
    // Positive complement to the negative "do not revert" rule.
    expect(text).toMatch(/continue with your task|continue.*work.*around|proceed (with|around)/i)
  })

  test("codex.txt acknowledges the model may be in a dirty git worktree", () => {
    const text = readPrompt("codex.txt")
    // Situational priming — without this the model treats any local diff as
    // suspect and may try to clean it up.
    expect(text).toMatch(/dirty git worktree|dirty.*worktree|worktree.*dirty/i)
  })

  test("codex.txt forbids reverting changes the model did not make (safety contract)", () => {
    const text = readPrompt("codex.txt")
    expect(text).toMatch(/NEVER revert.*did not make|did not make.*unless.*explicit/i)
  })

  test("codex.txt forbids amending commits without explicit request", () => {
    const text = readPrompt("codex.txt")
    // The "Do not amend commits" rule prevents the model from rewriting git
    // history when asked for a follow-up commit.
    expect(text).toMatch(/Do not amend.*unless.*(explicit|request)|NEVER amend.*unless/i)
  })

  test("codex.txt forbids destructive git commands (git reset --hard, git checkout --)", () => {
    const text = readPrompt("codex.txt")
    // The destructive-commands ban is the strongest single guard rail against
    // accidental data loss. Lock the literal command examples — drift in the
    // examples themselves should fail this contract.
    expect(text).toMatch(/destructive commands.*git reset|git reset --hard|git checkout --/)
  })

  test("codex.txt retains apply_patch + parallel + git safety guidance", () => {
    const text = readPrompt("codex.txt")
    expect(text).toMatch(/apply_patch/i)
    expect(text).toMatch(/parallel/i)
    expect(text).toMatch(/git reset --hard|git checkout --|destructive/i)
  })

  test("gpt.txt retains parallel + ASCII-default + autonomy guidance", () => {
    const text = readPrompt("gpt.txt")
    expect(text).toMatch(/parallel/i)
    expect(text).toMatch(/ASCII/)
    expect(text).toMatch(/persist|autonomy/i)
  })

  test("kimi.txt retains parallel + task tool delegation guidance", () => {
    const text = readPrompt("kimi.txt")
    expect(text).toMatch(/parallel/i)
    expect(text).toMatch(/`task`|task tool|subagent/i)
  })
})

describe("brand contract — model prompts identify the agent as kursor", () => {
  test.each([...MODEL_PROMPTS])("%s self-identity block mentions kursor", (name) => {
    const text = readPrompt(name)
    // Identity is typically "You are kursor, ..." on line 1, but some prompts
    // split it across two lines (e.g. "You are an expert assistant\nYour name is kursor").
    // Either form must mention kursor within the first 5 lines.
    const head = text.split("\n").slice(0, 5).join("\n")
    expect(head, `${name} identity block should mention kursor`).toMatch(/\bkursor\b/i)
  })

  test.each([...MODEL_PROMPTS])("%s does not self-identify as 'You are OpenCode/opencode' agent", (name) => {
    const text = readPrompt(name)
    // The exact regression we're fixing: "You are OpenCode" / "You are opencode" as identity.
    // Allow casual references to the upstream project name elsewhere (e.g. in docs URLs) by
    // only catching the agent-identity construction.
    expect(text).not.toMatch(/\bYou are (OpenCode|opencode)\b/)
  })

  test("anthropic.txt does not refer users to the anomalyco/opencode repo for kursor feedback", () => {
    const text = readPrompt("anthropic.txt")
    // The upstream URL would mislead kursor users about where to report bugs.
    expect(text).not.toMatch(/github\.com\/anomalyco\/opencode/)
  })

  test("default.txt does not refer users to the anomalyco/opencode repo for kursor feedback", () => {
    const text = readPrompt("default.txt")
    expect(text).not.toMatch(/github\.com\/anomalyco\/opencode/)
  })
})

describe("tool description contract (regression guard)", () => {
  test("task.txt documents run_in_background opt-in", () => {
    const text = readPrompt("task.txt", TOOL_DIR)
    expect(text).toMatch(/run_in_background/)
    expect(text).toMatch(/status: started/i)
  })

  test("task.txt documents output_file disk spill", () => {
    const text = readPrompt("task.txt", TOOL_DIR)
    expect(text).toMatch(/output_file/)
    expect(text).toMatch(/truncat/i)
  })

  test("task.txt documents <task_notification> delivery semantics", () => {
    const text = readPrompt("task.txt", TOOL_DIR)
    expect(text).toMatch(/<task_notification/)
  })

  test("task.txt documents task_stop for cancellation", () => {
    const text = readPrompt("task.txt", TOOL_DIR)
    expect(text).toMatch(/task_stop/)
  })

  test("edit.txt retains uniqueness + replaceAll guidance", () => {
    const text = readPrompt("edit.txt", TOOL_DIR)
    expect(text).toMatch(/multiple matches|unique|replaceAll/i)
  })

  test("edit.txt teaches uniqueness as an upfront best practice (not only on error)", () => {
    const text = readPrompt("edit.txt", TOOL_DIR)
    // Distinct from the FAIL-condition mention; require an explicit "include
    // surrounding context up front" directive so the model gets it right on first
    // try instead of learning via failure round-trips.
    expect(text).toMatch(/include .* (surrounding|context|lines).* (before|around|to make|so that)/i)
  })

  test("edit.txt warns about the LINE_NUMBER prefix anti-pattern explicitly", () => {
    const text = readPrompt("edit.txt", TOOL_DIR)
    expect(text).toMatch(/line.?number.*prefix|`\d+: ?`/i)
  })

  test("edit.txt clarifies CRLF / line-ending handling so model does not pre-normalize", () => {
    const text = readPrompt("edit.txt", TOOL_DIR)
    expect(text).toMatch(/CRLF|line ending|line-ending|\\r\\n/i)
  })

  test("grep.txt mentions regex + include filter", () => {
    const text = readPrompt("grep.txt", TOOL_DIR)
    expect(text).toMatch(/regular expression|regex/i)
    expect(text).toMatch(/include|file.*pattern/i)
  })

  test("grep.txt encourages parallel issuance for independent searches", () => {
    const text = readPrompt("grep.txt", TOOL_DIR)
    expect(text).toMatch(/parallel|multiple .* (calls|searches) .* (single|same) (turn|message)/i)
  })

  test("grep.txt documents the 100-match truncation cap so the model expects it", () => {
    const text = readPrompt("grep.txt", TOOL_DIR)
    expect(text).toMatch(/\b100\b|\bcap\b|truncat/i)
  })
})

describe("tool description structural completeness — every tool .txt is valid", () => {
  // Tools whose .txt is loaded as the description shown to the model.
  // If any of these accidentally truncates to 0 bytes, the model loses guidance silently.
  const REQUIRED_TOOL_TXT = [
    "apply_patch.txt",
    "codesearch.txt",
    "edit.txt",
    "glob.txt",
    "grep.txt",
    "lsp.txt",
    "plan-enter.txt",
    "plan-exit.txt",
    "question.txt",
    "read.txt",
    "repo_clone.txt",
    "repo_overview.txt",
    "skill.txt",
    "task.txt",
    "task_stop.txt",
    "todowrite.txt",
  ] as const

  test.each([...REQUIRED_TOOL_TXT])("%s exists and has reasonable content length", (name) => {
    const filePath = path.join(TOOL_DIR, name)
    const content = readFileSync(filePath, "utf8")
    expect(content.length, `${name} suspiciously short`).toBeGreaterThan(50)
  })

  test("read.txt mentions offset/limit semantics", () => {
    const text = readPrompt("read.txt", TOOL_DIR)
    expect(text).toMatch(/offset|limit|line/i)
  })

  test("read.txt documents both offset AND limit parameters explicitly", () => {
    const text = readPrompt("read.txt", TOOL_DIR)
    // The current desc only mentions offset by name; limit is the override knob for
    // the default 2000-line window and the model needs to know it exists.
    expect(text).toMatch(/\boffset\b/)
    expect(text).toMatch(/\blimit\b/)
  })

  test("read.txt retains parallel-read encouragement", () => {
    const text = readPrompt("read.txt", TOOL_DIR)
    expect(text).toMatch(/parallel|multiple files/i)
  })

  test("glob.txt mentions pattern matching", () => {
    const text = readPrompt("glob.txt", TOOL_DIR)
    expect(text).toMatch(/pattern|glob/i)
  })

  test("glob.txt retains parallel batching guidance", () => {
    const text = readPrompt("glob.txt", TOOL_DIR)
    expect(text).toMatch(/multiple tools? in a single response|parallel|batch/i)
  })

  test("glob.txt documents the 100-result truncation cap", () => {
    const text = readPrompt("glob.txt", TOOL_DIR)
    // Use word-boundary "cap" to avoid matching "capability" / "captured".
    expect(text).toMatch(/\b100\b|\bcap\b|truncat/i)
  })

  test("todowrite.txt mentions tracking / planning role", () => {
    const text = readPrompt("todowrite.txt", TOOL_DIR)
    expect(text).toMatch(/todo|task|plan|track/i)
  })

  test("plan-enter.txt + plan-exit.txt describe plan mode transitions", () => {
    const enter = readPrompt("plan-enter.txt", TOOL_DIR)
    const exit = readPrompt("plan-exit.txt", TOOL_DIR)
    expect(enter).toMatch(/plan/i)
    expect(exit).toMatch(/plan|implement|exit/i)
  })

  test("task_stop.txt documents the cancellation flow", () => {
    const text = readPrompt("task_stop.txt", TOOL_DIR)
    expect(text).toMatch(/task_id|cancel|stop|abort/i)
  })
})

describe("agent prompt completeness — coordinator + subagents", () => {
  const REQUIRED_AGENT_PROMPTS = [
    "coordinator.txt",
    "explore.txt",
    "scout.txt",
    "summary.txt",
    "title.txt",
    "compaction.txt",
  ] as const

  test.each([...REQUIRED_AGENT_PROMPTS])("%s exists and has reasonable content length", (name) => {
    const filePath = path.join(AGENT_PROMPT_DIR, name)
    const content = readFileSync(filePath, "utf8")
    expect(content.length, `${name} suspiciously short`).toBeGreaterThan(50)
  })

  test("coordinator.txt mentions task tool + sub-agents", () => {
    const text = readPrompt("coordinator.txt", AGENT_PROMPT_DIR)
    expect(text).toMatch(/task/i)
    expect(text).toMatch(/sub.?agent|worker/i)
  })
})

describe("global brand sweep — no 'OpenCode' brand spelling in any model-consumed file", () => {
  // Scan every text file the model can see: system prompts, tool descriptions,
  // agent prompts, command templates, skills. The literal "OpenCode" (capital O+C)
  // is the canonical brand spelling and must not appear anywhere the model reads.
  //
  // Lowercase "opencode" remains allowed because it serves functional purposes:
  //   - "opencode.json" (config filename, kept for backward compat)
  //   - "~/.opencode/" (default data directory)
  //   - "opencode-ai" (npm package scope)
  // Those are technical identifiers, not brand strings.
  const SCAN_DIRS = [
    PROMPT_DIR,
    TOOL_DIR,
    AGENT_PROMPT_DIR,
    COMMAND_TEMPLATE_DIR,
    SKILL_BUNDLED_DIR,
    SKILL_PROMPT_DIR,
  ]

  const allFiles = SCAN_DIRS.flatMap(listTextFiles)

  test("scan discovers a meaningful set of model-consumed files", () => {
    // Guard against silently scanning zero files (which would make the sweep vacuous).
    expect(allFiles.length).toBeGreaterThan(20)
  })

  test.each(allFiles.map((f) => [path.relative(path.resolve(import.meta.dir, "../.."), f), f]))(
    "%s does not contain the 'OpenCode' brand spelling",
    (_label, filePath) => {
      const content = readFileSync(filePath, "utf8")
      expect(content).not.toMatch(/\bOpenCode\b/)
    },
  )
})

// =============================================================================
// Gap 1: cross-prompt # Doing tasks workflow parity.
//
// anthropic.txt was missing 4 of 5 canonical workflow steps (silently — caught
// only when audited against default.txt / trinity.txt). The same regression
// could just as easily hit default.txt or trinity.txt without these contracts.
// Pure defensive: locks the existing-canonical wording across the 3 prompts
// that share the "# Doing tasks" 5-step format.
// =============================================================================
describe("cross-prompt # Doing tasks workflow parity (anthropic / default / trinity)", () => {
  const WORKFLOW_PROMPTS = ["anthropic.txt", "default.txt", "trinity.txt"] as const

  test.each([...WORKFLOW_PROMPTS])("%s instructs the model to verify the solution with tests", (name) => {
    const text = readPrompt(name)
    expect(text).toMatch(/[Vv]erify the solution.*tests?|verify.*with tests/)
  })

  test.each([...WORKFLOW_PROMPTS])("%s requires running lint + typecheck after task completion", (name) => {
    const text = readPrompt(name)
    expect(text).toMatch(/lint.*typecheck|typecheck.*lint/i)
  })

  test.each([...WORKFLOW_PROMPTS])("%s forbids committing without an explicit user request", (name) => {
    const text = readPrompt(name)
    expect(text).toMatch(/NEVER commit.*unless.*(user|explicit|ask)/i)
  })

  test.each([...WORKFLOW_PROMPTS])(
    "%s recommends using search tools to understand the codebase first",
    (name) => {
      const text = readPrompt(name)
      // The first canonical step. Wording is consistent across the 3 prompts.
      expect(text).toMatch(/[Uu]se the available search tools|search tools.*understand.*codebase/)
    },
  )
})

// =============================================================================
// Gap 4: formatting hygiene — sweep ALL model-consumed files for orphan empty
// bullets ("- " on its own line with nothing after). This bug already shipped
// in anthropic.txt and was only caught manually; this sweep makes the same
// class of bug fail loudly in CI for every other file too.
//
// The check rejects /^- *$/ — a line that is just a dash with optional
// trailing whitespace. Legitimate bullets always have content after the dash,
// so this is safe.
// =============================================================================
describe("formatting hygiene — no orphan empty bullets in any model-consumed file", () => {
  const SCAN_DIRS = [
    PROMPT_DIR,
    TOOL_DIR,
    AGENT_PROMPT_DIR,
    COMMAND_TEMPLATE_DIR,
    SKILL_BUNDLED_DIR,
    SKILL_PROMPT_DIR,
  ]
  const allFiles = SCAN_DIRS.flatMap(listTextFiles)

  test("scan discovers a meaningful set of model-consumed files", () => {
    expect(allFiles.length).toBeGreaterThan(20)
  })

  test.each(allFiles.map((f) => [path.relative(path.resolve(import.meta.dir, "../.."), f), f]))(
    "%s has no orphan empty bullet lines",
    (_label, filePath) => {
      const content = readFileSync(filePath, "utf8")
      const orphans: number[] = []
      // Allow space OR tab after the dash — both are legal-but-empty bullets.
      content.split("\n").forEach((line, i) => {
        if (/^-\s*$/.test(line)) orphans.push(i + 1)
      })
      expect(orphans, `${path.basename(filePath)} has orphan empty bullets at lines ${orphans.join(", ")}`).toEqual(
        [],
      )
    },
  )
})

// =============================================================================
// Gap 6 + 8: cross-file coupling — prompts make claims about the runtime
// behavior (Skill.fmt's <available_skills> XML output; the auto-loaded
// instruction filenames). If the runtime drifts away from those claims, the
// prompts lie to the model. These tests read the runtime source files as text
// and assert the literal strings the prompts reference are still emitted.
// =============================================================================
describe("system coupling — prompt claims match runtime source", () => {
  test("Skill.fmt source emits the <available_skills> tag that anthropic.txt references", () => {
    // anthropic.txt:80 says: 'Look at the `<available_skills>` section later in your system context'.
    // If Skill.fmt changes its wrapper tag, the prompt's anchor goes stale.
    const src = readFileSync(SKILL_INDEX_TS, "utf8")
    expect(src, "Skill.fmt should still emit the <available_skills> opening tag literally").toMatch(
      /<available_skills>/,
    )
    expect(src, "Skill.fmt should still emit the </available_skills> closing tag literally").toMatch(
      /<\/available_skills>/,
    )
  })

  test("Skill.fmt source uses verbose mode's <name>/<description> entries that anthropic.txt references", () => {
    // anthropic.txt:80 also says: 'Each entry has a <name> and a <description>'.
    // Lock that the per-skill XML structure stays <name>/<description>.
    const src = readFileSync(SKILL_INDEX_TS, "utf8")
    expect(src).toMatch(/<name>\$\{skill\.name\}<\/name>/)
    expect(src).toMatch(/<description>\$\{skill\.description\}<\/description>/)
  })

  test("session/instruction.ts auto-loads AGENTS.md", () => {
    // AGENTS.md is the always-on instruction file; this is the documented
    // convention that the rebrand commit also preserved. Lock the literal.
    const src = readFileSync(INSTRUCTION_TS, "utf8")
    expect(src).toMatch(/['"`]AGENTS\.md['"`]/)
  })

  test("session/instruction.ts conditionally auto-loads CLAUDE.md (gated by OPENCODE_DISABLE_CLAUDE_CODE_PROMPT)", () => {
    // CLAUDE.md loading is gated by a flag so users can opt out. Both pieces
    // (the filename literal AND the flag name) must be present together — if
    // either drifts, the auto-load behavior silently changes.
    const src = readFileSync(INSTRUCTION_TS, "utf8")
    expect(src).toMatch(/['"`]CLAUDE\.md['"`]/)
    expect(src).toMatch(/OPENCODE_DISABLE_CLAUDE_CODE_PROMPT/)
  })

  test("session/instruction.ts preserves CONTEXT.md (deprecated but still auto-loaded for backwards compat)", () => {
    // CONTEXT.md is marked deprecated but kept in the FILES allowlist for
    // backwards compat. If someone removes it, existing user repos that still
    // ship CONTEXT.md silently stop having their instructions loaded.
    const src = readFileSync(INSTRUCTION_TS, "utf8")
    expect(src).toMatch(/['"`]CONTEXT\.md['"`]/)
  })
})
