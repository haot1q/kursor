# Stuck

The user thinks a process on this machine is frozen, hung, or unusually slow. Investigate and produce a clear diagnosis. **This skill is diagnostic only — do not kill, signal, or restart anything unless the user explicitly asks.**

## Symptom map

A quick reference for what different signals usually mean:

| Observation | Common cause |
|---|---|
| CPU pinned at ≥ 90% across multiple samples 1-2s apart | Busy loop or spin |
| Process state `D` (uninterruptible sleep) | Blocked on I/O — slow disk, NFS, FUSE |
| Process state `T` (stopped) | Got `Ctrl-Z`'d at some point |
| Process state `Z` (zombie) | Parent isn't reaping its children |
| RSS very high (≥ 4 GB) and climbing | Memory leak |
| Parent waiting on a long-lived child | Hung `git`, `node`, shell, etc. — investigate the child |

A single reading can lie. **Always take two samples spaced ~1-2 seconds apart** before concluding "stuck".

## Procedure

### 1. Identify the target

If the user named a specific PID, app, or command — start there.

Otherwise, list candidates and filter:

```sh
ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | head -50
```

Pick the rows that match the user's description ("the terminal", "VS Code", "my dev server", etc.).

### 2. Collect context

For every suspicious process:

- List its children: `pgrep -lP <pid>`
- If CPU looks high, sample a second time and compare — a transient spike is not "stuck"
- If a child looks hung, capture its full command: `ps -p <child_pid> -o command=`
- Tail recent log output if you can find it (look in `~/.<app>/logs/`, `/tmp/`, anywhere the user mentioned)

### 3. Optional — capture a stack

Only do this when the process really does look hung *and* a stack trace would meaningfully narrow the cause. Sampling produces a lot of output — summarize, don't dump.

macOS:
```sh
sample <pid> 3
```

Linux:
```sh
sudo gdb -p <pid> -batch -ex 'thread apply all bt'
```

### 4. Write the diagnosis

A clean report has four parts, in this order:

- **Subject** — one short sentence: which process, what symptom, how long it has been going.
- **Evidence** — PID, CPU%, RSS, state, uptime, command line, child PIDs. The raw facts.
- **Diagnosis** — what you think is wrong and why each piece of evidence supports that.
- **Suggested next step** — what the user could try (typically: restart, attach a debugger, file a bug, change a config). **Never** include "kill" unless the user already asked you to.

If everything you looked at is actually healthy, say so clearly. Do not invent a problem to justify the investigation.

## Hard rules

- Never send a signal or terminate a process unless the user explicitly asks for it.
- Take at least two CPU / state samples before declaring something stuck.
- If the user gave a specific PID or symptom, stay focused there. Don't expand scope without a reason.
- Stack sampling output is large — summarize the top frames; don't paste the whole dump.
