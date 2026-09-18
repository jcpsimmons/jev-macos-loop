# Native macOS computer-use architecture

Jev macOS Loop combines local screen perception with remote finite-choice decisions. A persistent Swift worker owns screen capture and input. A Node.js runner builds a text-only observation, asks Jev to choose an element, and applies the validated action.

## Capture, perceive, decide, act

| Stage                        | Implementation                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Capture one selected window  | A persistent ScreenCaptureKit stream supplies fresh local frames.                                 |
| Detect controls              | OmniParser v2's icon detector runs locally through CoreML.                                        |
| Read visible text            | Apple Vision `VNRecognizeTextRequest` runs alongside detection.                                   |
| Resolve native control state | macOS accessibility supplies labels, values, enabled state, and live bounds.                      |
| Ask Jev for a decision       | Observed text and element IDs become a finite-choice question through the selected provider.      |
| Guard the action             | Check confidence, fresh frames, window focus, bounds, occlusion, and current accessibility state. |
| Apply and observe            | Click the locally resolved coordinates, wait for a fresh frame, then observe again.               |

The native worker keeps CoreML loaded between actions. Detector boxes use the image coordinate space; local transformations map them to screen coordinates. Overlapping OCR and accessibility regions are resolved locally before building the remote payload. Accessibility can be disabled for vision-only tests.

## Data boundaries

Screenshots, pixels, coordinates, and native handles remain on the Mac. The remote request uses an explicit text allowlist: the goal, observed labels and state, recent actions, and element choices. Tokens go only to the configured provider and are omitted from traces. See [provider configuration](providers.md).

The agent can choose an observed element, WAIT, DONE, or BLOCKED. It cannot invent coordinates or executable code. Missing credentials, malformed choices, invalid probabilities, and provider errors stop execution; they do not trigger a cross-provider fallback.

## Verification and scope

The fixture app writes a separate result file that the decision policy cannot read. The benchmark checks the final state and fresh process ID after the loop stops. Calculator checks use an independent accessibility reader. [Performance results](performance.md) include measured timings, raw traces, and unsuccessful iterations.

The current runner supports native clicks inside one selected window. It does not implement free-form typing, complex drags, or general multi-window planning. Icon-only controls and OCR-only state remain less dependable than controls with accessibility labels.

The separate `demo:finder` harness supports file-to-folder drags inside a disposable directory. Local accessibility URLs bind both endpoints to that root; URLs and coordinates never enter its remote payload. Jev chooses among all three visible folders for the next filename. The native worker rechecks focus, occlusion, live bounds, names, URLs, and selection count before emitting a drag. Subsequent observations must agree on row positions, and uncertain drags are never repeated. A separate filesystem verifier checks all nine expected destinations and content hashes after completion. Setup creates the dummy files and empty folders; actual routing uses Finder input, not filesystem moves.

## Models and dependencies

- [Microsoft OmniParser](https://github.com/microsoft/OmniParser)
- [Pinned official detector weights](https://huggingface.co/microsoft/OmniParser-v2.0/blob/8d0c5ee/icon_detect/model.pt), SHA-256 `dab3d4351ad00b035db829909a4db98354d5a90f6990e4ac00222a9a95d4bf57`
- [Ultralytics CoreML export](https://docs.ultralytics.com/integrations/coreml/)
- [Jev through Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev)
- [OpenRouter and TypesafeAI adapter references](providers.md#primary-references)

The project uses AGPL-3.0. The OmniParser detector's upstream license remains applicable. Weights are downloaded and verified during setup rather than stored in this repository.
