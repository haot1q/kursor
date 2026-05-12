# Write tests

Add tests for a target function, module, or behavior — and follow the **project's existing conventions** rather than your own preferences.

## Procedure

### 1. Find the framework and the test command

Look for evidence in this order; stop at the first solid hit:

- `package.json` → `scripts.test`, or `devDependencies` mentioning `vitest`, `jest`, `mocha`, `bun:test`, `playwright`, `cypress`
- `pyproject.toml` / `setup.cfg` / `tox.ini` → `pytest`, `unittest`
- `Cargo.toml` → Rust uses `cargo test` by default
- `go.mod` → Go uses `go test ./...`
- Existing test files: `__tests__/`, `test/`, `tests/`, `*_test.go`, `*.test.ts`, `*.spec.ts`

If nothing matches, **don't guess**. Ask the user one question listing two or three plausible options.

By the end of this step you should be able to say, in one sentence:
> The framework is X, the test command is Y, and tests live under Z.

### 2. Anchor on an existing test

Open one or two existing tests that are *close to what you're about to write* (same module, same domain, same kind of logic). Imitate, in this order:

1. File location and naming pattern
2. Import / setup / teardown idioms
3. Assertion style and helpers
4. Naming convention for test cases

Matching the codebase matters more than producing "clean" tests in your favorite style. A test that doesn't fit will be the first one the next contributor deletes.

### 3. Decide what to cover, *before* writing anything

For the unit under test, list the cases that actually matter:

- **The happy path.** Usually one test.
- **Boundaries.** Empty input, single-element input, max-size input, off-by-one inputs.
- **Failures.** What should raise loudly? What should fail gracefully? Don't test that exceptions exist — test that the *right* exception fires for the *right* reason.
- **Regression cases.** If you're fixing a bug, write the failing test *first*, then fix.

Aim for 3-7 cases. If you're past 10, you are testing every code path, not every behavior — cut.

A test that simply re-executes the implementation and asserts it equals itself has zero value.

### 4. Implement, run, iterate

- Write the planned tests in one pass.
- Run them. Some will pass, some may fail because your mental model of the code was wrong.
- Fix the failures by **reading the code more carefully first**. Don't move the goalposts on a test just to make it pass.
- Once green, run the whole test suite (or the nearest meaningful sub-target) to make sure you didn't regress something else.

If a test exposes a real bug in the production code, **stop and tell the user**. Show the failing test, then ask: fix the code, fix the test, or both?

### 5. Hand back

A short report:

- The files that grew (or were added)
- How many cases were added, and the rough categories
- Any real bugs the tests uncovered
- Anything that was unexpectedly hard to test — that is usually a signal of missing seams, and worth flagging

## Hard rules

- No mocks just to make a test compile. If a unit is so tangled it can't be tested without mocking half its dependencies, surface that as a design issue.
- Do not edit production code "to help with tests" without telling the user.
- Tests must not duplicate the implementation. `expect(sum(2,3)).toBe(2+3)` is theater.
- Match the codebase's test style even if you prefer a different one.
