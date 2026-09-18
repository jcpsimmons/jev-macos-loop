import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateQuestions, routeInfo } from "../src/providers.mjs";

const request = {
  state: { screen: "Saved successfully" },
  questions: {
    next: {
      type: "choice",
      instructions: "Is it done?",
      criteria: { DONE: "Saved", WAIT: "Loading" },
    },
  },
};
const answers = {
  next: { type: "choice", choice: "DONE", probabilities: { DONE: 1, WAIT: 0 } },
};

for (const [provider, key, endpoint, model] of [
  [
    "vercel",
    "AI_GATEWAY_API_KEY",
    "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
    "typesafe-ai/jev",
  ],
  [
    "openrouter",
    "OPENROUTER_API_KEY",
    "https://openrouter.ai/api/alpha/decisions",
    "~typesafe/jev-latest",
  ],
  [
    "typesafe",
    "TYPESAFE_API_KEY",
    "https://api.typesafe.ai/v1/systemone",
    "jev-latest",
  ],
]) {
  test(`${provider} sends the correct endpoint, token, model and choice request`, async () => {
    const env = { JEV_PROVIDER: provider, [key]: "test-only-token" };
    let calls = 0;
    const result = await evaluateQuestions(request, {
      env,
      fetchFn: async (url, options) => {
        calls++;
        assert.equal(String(url), endpoint);
        const headers = new Headers(options.headers);
        assert.equal(headers.get("authorization"), "Bearer test-only-token");
        const body = JSON.parse(options.body);
        assert.deepEqual(body.state, request.state);
        assert.deepEqual(body.questions, request.questions);
        assert.equal(
          provider === "vercel" ? headers.get("ai-model-id") : body.model,
          model,
        );
        assert.ok(options.signal instanceof AbortSignal);
        if (provider !== "vercel") assert.equal(options.redirect, "error");
        if (provider === "openrouter")
          assert.deepEqual(body.provider, {
            data_collection: "deny",
            zdr: true,
            allow_fallbacks: false,
          });
        return Response.json({
          answers,
          model,
          usage:
            provider === "vercel"
              ? { inputTokens: 77, outputTokens: 12 }
              : { input_tokens: 77, output_tokens: 12 },
        });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.answers, answers);
    assert.equal(result.usage.inputTokens, 77);
    assert.equal(result.provider, provider);
    assert.equal(
      JSON.stringify(routeInfo(env)).includes("test-only-token"),
      false,
    );
  });
}

test("a missing selected-provider token never falls back to another available token", async () => {
  let calls = 0;
  await assert.rejects(
    evaluateQuestions(request, {
      env: { JEV_PROVIDER: "typesafe", AI_GATEWAY_API_KEY: "unrelated-token" },
      fetchFn: async () => {
        calls++;
      },
    }),
    /Set TYPESAFE_API_KEY/,
  );
  assert.equal(calls, 0);
  assert.throws(() => routeInfo({ JEV_PROVIDER: "typo" }), /JEV_PROVIDER must/);
});

test("HTTP failures are not retried and do not expose echoed secrets or screen text", async () => {
  let calls = 0;
  await assert.rejects(
    evaluateQuestions(request, {
      env: { JEV_PROVIDER: "openrouter", OPENROUTER_API_KEY: "private-token" },
      fetchFn: async () => {
        calls++;
        return Response.json(
          { error: "private-token private-screen" },
          { status: 401 },
        );
      },
    }),
    (error) => {
      assert.equal(
        error.message,
        "openrouter Jev HTTP 401. No other provider was tried.",
      );
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("native provider decisions reject unknown choices and invalid probability distributions", async () => {
  for (const answer of [
    { type: "choice", choice: "invented", probabilities: { DONE: 1, WAIT: 0 } },
    { type: "choice", choice: "DONE", probabilities: { DONE: 0.5, WAIT: 0 } },
    { type: "choice", choice: "WAIT", probabilities: { DONE: 0.9, WAIT: 0.1 } },
  ]) {
    await assert.rejects(
      evaluateQuestions(request, {
        env: { JEV_PROVIDER: "typesafe", TYPESAFE_API_KEY: "test-only-token" },
        fetchFn: async () => Response.json({ answers: { next: answer } }),
      }),
      /invalid decision/,
    );
  }
});
