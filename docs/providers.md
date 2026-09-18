# Bring your own Jev token

Set `JEV_PROVIDER` to `vercel`, `openrouter`, or `typesafe`. Only the selected route's token is used. All routes receive the same locally constructed text state and choice question, and all pass through the same choice/probability validation before any click. No token is included in a trace or route descriptor.

| Route             | Transport                                                                      | Token                                 |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------- |
| Vercel AI Gateway | Pinned AI SDK `experimental_evaluate`, model `typesafe-ai/jev`                 | `AI_GATEWAY_API_KEY` (or Vercel OIDC) |
| OpenRouter        | `POST https://openrouter.ai/api/alpha/decisions`, model `~typesafe/jev-latest` | `OPENROUTER_API_KEY`                  |
| TypesafeAI direct | `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`                | `TYPESAFE_API_KEY` from the console   |

OpenRouter's alpha endpoint is at `/api/alpha/decisions`, **not** under `/api/v1`. The endpoint was confirmed with an authenticated request. Its current OpenAPI document combines an `/api/v1` server with this origin-relative path; blindly joining those values produces a 404.

The direct adapters use native choice requests, not generated JSON or a chat prompt. The selected option and full probability distribution are checked by the pinned AI SDK, then the loop applies its normal confidence threshold. Missing probabilities cannot authorize a click. Provider errors stop the run, with no retry or cross-provider fallback. Error output excludes raw request/response bodies and headers.

Vercel requests ZDR and no-training routing; OpenRouter requests ZDR, no data collection, and no provider fallback. The direct TypesafeAI route follows that account's service terms; it does not invent equivalent unsupported request fields. No pixels or coordinates are sent on any route.

## Configure and verify

Create `.env.local` using `.env.example`, set the provider and its token, then run:

```sh
npm run check:provider
npm run benchmark -- --suite --fast-ocr
```

For an existing env file:

```sh
JEV_ENV_FILE=/path/to/your/.env.local JEV_PROVIDER=openrouter npm run check:provider
```

Provider names are explicit: the presence of another provider's key cannot silently change the route. `JEV_MODEL` is optional; changing providers selects the appropriate default model automatically when it is unset.

## Verification status

Vercel and OpenRouter each passed three authenticated decision requests. OpenRouter also passed the full **6/6 GUI suite** ([summary](evidence/openrouter/summary.json)); Vercel passed a fresh settings task after the routing refactor ([summary](evidence/vercel-routing-smoke.json)). All three adapters pass offline transport tests for endpoint, authorization, model, payload and normalized answers. Tests also cover missing keys, HTTP failures without retries, secret-safe errors, and invalid choices/probabilities.

An initial OpenRouter suite stopped after three successful cases on a request/response-validation error. The raw response was not retained, so its cause is unconfirmed. The unchanged adapter then passed all six cases with diagnostic response capture. Validation remains strict and does not silently retry.

The direct TypesafeAI route has **not been verified with a live token**: no key was available, and the console was signed out. Its adapter follows the official API contract. Run `JEV_PROVIDER=typesafe npm run check:provider` with your console-issued key to verify account access before driving a window.

## Primary references

- [TypesafeAI API](https://docs.typesafe.ai/api) and [getting a console key](https://docs.typesafe.ai/introduction/quickstart)
- [OpenRouter OpenAPI](https://openrouter.ai/openapi.json), `DecisionsRequest` / `DecisionsResponse`, and [Jev model](https://openrouter.ai/~typesafe/jev-latest)
- [Vercel Jev evaluation example](https://vercel.com/ai-gateway/models/jev)

Verified September 17, 2026 (Arizona). OpenRouter's Decisions API is alpha and the AI SDK evaluation API is experimental; dependencies are pinned.
