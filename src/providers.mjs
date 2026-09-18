import { createGateway, experimental_evaluate as evaluate } from "ai";
import { config } from "dotenv";

config({ path: process.env.JEV_ENV_FILE || ".env.local", quiet: true });

const routes = {
  vercel: { model: "typesafe-ai/jev", key: "AI_GATEWAY_API_KEY" },
  openrouter: {
    model: "~typesafe/jev-latest",
    key: "OPENROUTER_API_KEY",
    // The alpha Decisions endpoint is at the origin, NOT under /api/v1.
    endpoint: "https://openrouter.ai/api/alpha/decisions",
  },
  typesafe: {
    model: "jev-latest",
    key: "TYPESAFE_API_KEY",
    endpoint: "https://api.typesafe.ai/v1/systemone",
  },
};

// Safe to log: this descriptor deliberately contains no credential values.
export function routeInfo(env = process.env) {
  const provider = env.JEV_PROVIDER || "vercel";
  if (!Object.hasOwn(routes, provider))
    throw new Error("JEV_PROVIDER must be vercel, openrouter, or typesafe");
  const route = routes[provider];
  return { provider, ...route, model: env.JEV_MODEL || route.model };
}

export function requireCredential(env = process.env) {
  const route = routeInfo(env);
  if (
    !env[route.key]?.trim() &&
    !(route.provider === "vercel" && env.VERCEL_OIDC_TOKEN)
  )
    throw new Error(
      `Set ${route.key} for ${route.provider} in your environment or JEV_ENV_FILE`,
    );
  return route;
}

function nativeEvaluationModel(route, token, fetchFn) {
  return {
    specificationVersion: "v4",
    provider: route.provider,
    modelId: route.model,
    supportedQuestionTypes: ["choice"],
    async doEvaluate({ state, questions, abortSignal }) {
      const response = await fetchFn(route.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: route.model,
          state,
          questions,
          ...(route.provider === "openrouter"
            ? {
                provider: {
                  data_collection: "deny",
                  zdr: true,
                  allow_fallbacks: false,
                },
              }
            : {}),
        }),
        signal: abortSignal,
      });
      if (!response.ok) {
        // Do not dump server bodies, which could echo a token or private screen text.
        await response.body?.cancel();
        const failure = new Error("Provider HTTP error");
        failure.statusCode = response.status;
        throw failure;
      }
      const body = await response.json();
      return {
        answers: body.answers,
        usage: {
          inputTokens: body.usage?.input_tokens,
          outputTokens: body.usage?.output_tokens,
        },
        warnings: [],
        response: { modelId: body.model || route.model },
      };
    },
  };
}

export async function evaluateQuestions(
  { state, questions },
  { env = process.env, fetchFn = globalThis.fetch } = {},
) {
  const route = requireCredential(env);
  const model =
    route.provider === "vercel"
      ? createGateway({
          apiKey: env.AI_GATEWAY_API_KEY,
          fetch: fetchFn,
        }).evaluationModel(route.model)
      : nativeEvaluationModel(route, env[route.key], fetchFn);
  try {
    const result = await evaluate({
      model,
      state,
      questions,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(10000),
      ...(route.provider === "vercel"
        ? {
            providerOptions: {
              gateway: {
                zeroDataRetention: true,
                disallowPromptTraining: true,
              },
            },
          }
        : {}),
    });
    return { ...result, provider: route.provider };
  } catch (error) {
    const status = error?.statusCode;
    const reason = Number.isInteger(status)
      ? `HTTP ${status}`
      : ["TimeoutError", "AbortError"].includes(error?.name)
        ? "request timed out"
        : "request failed or returned an invalid decision";
    // Omit the original SDK error/cause: it may contain the request body or headers.
    throw new Error(
      `${route.provider} Jev ${reason}. No other provider was tried.`,
    );
  }
}
