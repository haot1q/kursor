import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "fs"
import path from "path"

const PROMPT_DIR = path.resolve(import.meta.dir, "../../src/session/prompt")
const TOOL_DIR = path.resolve(import.meta.dir, "../../src/tool")
const AGENT_PROMPT_DIR = path.resolve(import.meta.dir, "../../src/agent/prompt")
const COMMAND_TEMPLATE_DIR = path.resolve(import.meta.dir, "../../src/command/template")
const SKILL_BUNDLED_DIR = path.resolve(import.meta.dir, "../../src/skill/bundled")
const SKILL_PROMPT_DIR = path.resolve(import.meta.dir, "../../src/skill/prompt")

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
  test.each(MODEL_PROMPTS)("%s self-identity block mentions kursor", (name) => {
    const text = readPrompt(name)
    // Identity is typically "You are kursor, ..." on line 1, but some prompts
    // split it across two lines (e.g. "You are an expert assistant\nYour name is kursor").
    // Either form must mention kursor within the first 5 lines.
    const head = text.split("\n").slice(0, 5).join("\n")
    expect(head, `${name} identity block should mention kursor`).toMatch(/\bkursor\b/i)
  })

  test.each(MODEL_PROMPTS)("%s does not self-identify as 'You are OpenCode/opencode' agent", (name) => {
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

  test.each(REQUIRED_TOOL_TXT)("%s exists and has reasonable content length", (name) => {
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

  test.each(REQUIRED_AGENT_PROMPTS)("%s exists and has reasonable content length", (name) => {
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
