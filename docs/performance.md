# Measured results

Tested September 17, 2026 (Arizona; September 18 UTC) on an Apple M4 Max, macOS 26.5.2, arm64, Node 26.4.0. Jev was called through Vercel AI Gateway using the pinned AI SDK. No generative LLM was used.

## Vercel six-case live suite

**6/6 passed.** Each trial launched a fresh native app and changed the ordering of controls. Only the user goal, locally observed screen text/labels, and recent clicks reached Jev. The independent verifier read a separate app-owned result file with the fresh process ID. The policy cannot read that file.

| Task                                              | AX + fast OCR | CoreML + accurate OCR, AX disabled |
| ------------------------------------------------- | ------------: | ---------------------------------: |
| Dark appearance, enable notifications, save       |       2.260 s |                            2.080 s |
| Open Project Borealis                             |       1.592 s |                            1.498 s |
| Save Light appearance with notifications disabled |       1.017 s |                            1.374 s |

Across all **22 decisions**, including WAIT and DONE:

| Measured stage                            |   Median |      p95 |
| ----------------------------------------- | -------: | -------: |
| Jev gateway round-trip                    | 301.9 ms | 547.2 ms |
| Full observation–decision–action cycle    | 394.6 ms | 653.5 ms |
| Local perception in the final observation |  63.3 ms | 320.8 ms |
| OmniParser CoreML inference               |  10.8 ms |  11.1 ms |

Model compilation/load was **1.330 s**, excluded from task times. Task timing starts after one untimed warmup observation, and includes subsequent observations, native click guards, Jev calls, local settling and WAIT. The full six-trial harness took **16.103 s**, including loading the model, app launches, warmup observations, verification, and artifact writes. The native process and network connection remain alive between trials. This is a small functional benchmark, not broad reliability evidence.

Raw [summary](evidence/suite-summary.json) and [per-trial traces](evidence/) include all decisions, probabilities, observations and outcomes. The trace logs contain only the disposable app's screen data.

## Routing follow-up

After adding provider selection, OpenRouter passed **6/6** tasks: **293.5 ms median decisions**, **367.2 ms median cycles**, and **0.90–2.49 s** task times. This run recorded response bodies locally for diagnosis, so it includes that small instrumentation cost. See [summary and traces](evidence/openrouter/summary.json). A fresh Vercel settings task passed in **1.668 s** after the routing refactor.

The full Vercel suite and Calculator results below predate the provider-selection refactor; perception and the decision policy are unchanged. [Baseline source hashes](evidence/baseline-source-hashes.json) identify that build; [routing build hashes](evidence/source-hashes.json) identify the tested routing implementation. The later [timed README recording](recording.md) has its own trace and source hashes. These small samples do not establish that one provider is faster. Direct TypesafeAI has contract tests but no live-token measurement. See [routing verification status](providers.md) for the first OpenRouter attempt's unconfirmed request/validation failure.

## A real application

Apple Calculator successfully computed **17 × 23 = 391**. The first run reached the correct display but returned an uncertain DONE probability because numeric AX display text had not been included in the observation. That was fixed.

The final build cleared the previous calculation and computed **32 × 14 = 448 in 2.940 s** and **17 × 23 = 391 in 3.268 s**, without giving Jev either answer. Each run entered the seven required button actions and stopped. A separate native AX reader (`VerifyCalculator.swift`) checked the actual Calculator display. The arithmetic oracle runs only after the agent stops; it cannot guide decisions. See [448 trace](evidence/calculator-448.json) and [391 trace](evidence/calculator-391.json).

## Iterations and failures

- Initial settings task: **2.969 s**, with a new screenshot request per observation.
- Persistent ScreenCaptureKit stream: **2.335 s** on the same task in a later run. Network variation prevents interpreting this single pair as a controlled speedup estimate.
- AX with fast OCR: **1.787 s** in an early run; the final suite measured **2.260 s**.
- Initial native worker needed AppKit initialization before ScreenCaptureKit access.
- A cached foreground-app check was replaced with a live AX query. The loop now focuses the explicitly selected window once, then stops if another app takes focus.
- OCR initially split a checkbox icon from its adjacent label, diluting choice probabilities. Small overlapping icon/text regions are now merged.
- An early mixed suite passed **5/6**. The remaining case exposed ambiguity between an action label and current checkbox state. The general policy now interprets selection marks, preserves already-correct settings, and requires visible confirmation for requested saves. The unchanged six-case suite then passed **6/6**.
- Low-confidence WAIT was incorrectly treated like a low-confidence mutation. WAIT now safely observes again under the same bounded loop.
- Closing one test app stopped its capture stream. Selecting another window now tolerates an already-stopped old stream.

- A later Calculator regression entered an extra digit and produced 3,968 instead of 448. OCR sometimes disagreed with native labels or lagged a UI transition. The observation now resolves overlapping OCR/AX regions locally, uses native control bounds when available, and keeps text sources distinct. Both arithmetic cases passed after the fix, alongside the six-case suite. The failed run was caught by the independent verifier and is not counted as a pass.
- The final input guard rejects a capture that did not produce a frame past the post-click freshness deadline. Source hashes for the tested routing build are in [source-hashes.json](evidence/source-hashes.json).

## Interpreting latency

The final Vercel suite's fastest decision was 222.8 ms and its median was 301.9 ms. These are client-observed round-trips, not isolated server inference measurements. No server inference timing was exposed in the inspected response headers.

The loop reaches verified outcomes at several decisions per second in these examples. These results do not establish general autonomy or reliability on arbitrary websites and apps. OCR-only interpretation of icons and checkbox state remains less dependable than using accessibility labels and state.
