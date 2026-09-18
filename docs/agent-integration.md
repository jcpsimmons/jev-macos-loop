# Integrate Jev with your coding agent

Give your agent this prompt:

```text
Read https://raw.githubusercontent.com/jcpsimmons/jev-macos-loop/master/AGENTS.md.
Set up Jev macOS Loop on this Mac, verify the provider and a disposable GUI task,
and integrate it into this project's agent instructions. Reuse an existing install
or token file when available. Ask only for missing credentials, OS permissions,
or a choice you cannot infer. Report each verified stage and any blocker.
```

The agent can fetch the file, clone the repository, and follow it. If URL fetching is unavailable, clone the repo and point the agent to the local `AGENTS.md`. Reading a document grants no additional tool permissions: this integration needs a local terminal tool on the logged-in Apple silicon Mac. Cloud coding sessions and chat-only clients cannot drive your Mac through this CLI.

## Instruction loading by agent

The integration is a shared instruction file plus shell commands, not a vendor-specific plugin or MCP server. These entry points use the hosts' documented instruction mechanisms; full desktop operation still depends on the local environment and permissions.

| Agent                               | Entry point in this repository                                                                     | Check that it loaded                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Codex CLI / local Codex app         | Root `AGENTS.md`                                                                                   | Ask it to identify the active setup instructions and absolute checkout.                            |
| Claude Code                         | Root `CLAUDE.md` imports `AGENTS.md`                                                               | Inspect `/context` memory files.                                                                   |
| Grok CLI / TUI                      | Root `AGENTS.md`                                                                                   | `grok inspect --json` lists the project rules; folder trust is required for startup loading.       |
| Cursor Agent / CLI                  | Root `AGENTS.md`                                                                                   | Open this repository as the workspace and ask it to identify the instructions.                     |
| Gemini CLI                          | Root `GEMINI.md` imports `AGENTS.md`                                                               | `/memory reload`, then `/memory show`.                                                             |
| GitHub Copilot                      | `.github/copilot-instructions.md` points to `AGENTS.md`; CLI also supports root agent instructions | Ask it to read the shared guide; use local agent mode for desktop execution.                       |
| Windsurf / Devin Desktop            | Root `AGENTS.md`                                                                                   | Open the repo in the local desktop workspace and inspect its rules.                                |
| OpenCode                            | Root `AGENTS.md`                                                                                   | Start from this repository and ask it to identify the instructions.                                |
| Aider                               | `aider --read AGENTS.md`                                                                           | Confirm it is in the read-only file list; use its command workflow or a local shell for execution. |
| Other local agents, including Cline | Explicitly ask the agent to read `AGENTS.md`                                                       | Confirm local file access and terminal execution before claiming integration.                      |

Grok already discovers `AGENTS.md`; a separate `GROK.md` is unnecessary. If a host loads both the shared guide and an import file, treat them as one workflow, not two setup requests. Agent instruction support does not change which operating systems the native worker supports.

## Use one installation from another project

Follow [AGENTS.md, step 6](../AGENTS.md#6-make-the-capability-available-to-the-agent) to add the shared snippet to the target project's existing instructions. It contains the installation path, when to use Jev, and the absolute-prefix invocation. Preserve other rules and avoid duplicate blocks.

Use the snippet's ordinary file-reading pointer rather than assuming every host expands cross-repository `@` imports. External-file reads may require the host's approval. For an agent without persistent project instructions, include the pointer in the task prompt. If the installation moves, update the pointer and rerun the doctor from the agent's actual host.

## CLI contract

Run commands with the installation as their npm prefix. `--silent` removes npm's script banner. Keep stderr separate from stdout.

| Command                                                                         | Stdout                                               | Success criterion                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm --prefix "$JEV_REPO" --silent start -- --doctor`                           | One JSON object, formatted across lines              | Both `screenRecording` and `accessibility` are `true`; exit 0 alone is insufficient.            |
| `npm --prefix "$JEV_REPO" --silent start -- --windows`                          | One JSON object with a `windows` array               | Find the intended app/title/PID and use its fresh ID.                                           |
| `npm --prefix "$JEV_REPO" --silent run check:provider`                          | Three JSON lines                                     | Every line has `passed: true`, and exit 0.                                                      |
| `npm --prefix "$JEV_REPO" --silent start -- --window ID --goal GOAL --fast-ocr` | JSON lines: route, steps, then final result          | Final `status: "done"`, exit 0, **and independent app verification**.                           |
| `npm --prefix "$JEV_REPO" --silent run benchmark -- --fast-ocr`                 | Progress JSON lines and final `{summary, artifacts}` | `summary.passed === 1`, `summary.trials === 1`, exit 0, and the separate fixture result agrees. |

A window entry has `id`, `app`, `title`, `pid`, and `box`. List the windows again if the target app closes or is replaced. The live task's final object contains `status`, `elapsedMs`, and a verification reminder. Step lines include timing and confidence, but are not completion evidence.

Final statuses:

- `done`: Jev chose DONE with sufficient confidence. Verify the actual app outcome.
- `uncertain`: confidence was insufficient; inspect before acting again.
- `blocked`: Jev reported a blocker.
- `stuck`: repeated unchanged actions triggered the guard.
- `step-limit`: the 30-step limit was reached.

Every final status except `done` exits nonzero. Native/provider errors can exit nonzero with stderr **without a final JSON object**. Treat missing/malformed final output, cancellation, and transport failures as unconfirmed results. An uncertain click may already have happened; do not automatically retry it. The CLI has no `--json`, `--max-steps`, or `--min-confidence` flags; use the documented flags and preserve the built-in guards.

For a custom agent tool adapter, pass arguments as an array instead of interpolating a goal into a shell command. For example, this starts the existing CLI without shell interpretation:

```js
import { spawn } from "node:child_process";

const child = spawn(
  "npm",
  [
    "--prefix",
    repoPath,
    "--silent",
    "start",
    "--",
    "--window",
    String(windowId),
    "--goal",
    goal,
    "--fast-ocr",
  ],
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
```

`repoPath`, `windowId`, and `goal` come from the verified installation and authorized task. Collect stdout and stderr separately, wait for process exit, parse the final JSON line, and apply the criteria above. This snippet illustrates invocation; it is not a complete result-verifying adapter. Host terminal tools can run the same command directly. Allow time for CoreML startup and live requests; a tool timeout does not prove that no click occurred.

## Troubleshooting

| Symptom                                          | Next step                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Cloud/container or wrong OS/architecture         | Use a local Apple silicon Mac session. Offline tests do not verify desktop control.                                               |
| Doctor reports a false permission                | Grant the required macOS access to the actual launching host, restart it if requested, then rerun the doctor there.               |
| Model package missing or fails to load           | Run the pinned export/build steps; verify the resulting package and a disposable trial.                                           |
| Token missing, HTTP 401/403, or invalid decision | Check the selected route and credential configuration without printing secrets. Run the provider check before touching a window.  |
| Rate limit or insufficient credit                | Report the selected provider's blocker; do not switch accounts, purchase credit, or silently choose another provider.             |
| Focus/occlusion/stale-frame rejection            | Resolve the foreground window or overlay, rediscover the target, inspect its state, and then decide whether a new task is needed. |
| Host instructions not loaded                     | Explicitly read the local `AGENTS.md`; fix that host's project entry file without overwriting unrelated rules.                    |

## Compatibility evidence

The CLI, provider transports, and native GUI checks are tested independently of host branding. The entry-file conventions below were checked against vendor documentation; this is **not** a claim that every listed agent completed a live desktop trial. Confirm loading and run the setup checks in your actual host.

- [Codex: AGENTS.md](https://developers.openai.com/codex/guides/agents-md/)
- [Claude Code: shared AGENTS.md imports](https://code.claude.com/docs/en/memory#agentsmd)
- [Cursor: project rules and AGENTS.md](https://cursor.com/help/customization/rules)
- [Gemini CLI: context files and imports](https://geminicli.com/docs/cli/gemini-md/)
- [GitHub Copilot: customization entry files](https://docs.github.com/en/copilot/reference/customization-cheat-sheet)
- [Windsurf / Devin Desktop: AGENTS.md](https://docs.devin.ai/desktop/cascade/agents-md)
- [OpenCode: rules](https://opencode.ai/docs/rules/)
- [Aider: read-only conventions](https://aider.chat/docs/usage/conventions.html)

Grok's installed CLI guide, `~/.grok/docs/user-guide/12-project-rules.md`, documents AGENTS.md discovery and `grok inspect` provides local readback. Check your installed version's equivalent guide if that path differs.
