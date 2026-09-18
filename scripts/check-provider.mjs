import { evaluateQuestions, routeInfo } from "../src/providers.mjs";

const route = routeInfo();
for (let attempt = 1; attempt <= 3; attempt++) {
  const start = performance.now();
  const result = await evaluateQuestions({
    state: "The indicator is green.",
    questions: {
      color: {
        type: "choice",
        instructions: "Choose the indicator color.",
        criteria: { green: "Green", red: "Red" },
      },
    },
  });
  const answer = result.answers.color;
  const passed =
    answer.choice === "green" && answer.probabilities?.green >= 0.9;
  console.log(
    JSON.stringify({
      provider: route.provider,
      model: result.response.modelId,
      attempt,
      passed,
      decisionMs: Math.round(performance.now() - start),
      answer,
    }),
  );
  if (!passed) process.exitCode = 1;
}
