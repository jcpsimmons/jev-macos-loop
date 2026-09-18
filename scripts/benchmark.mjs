import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Native } from "../src/native.mjs";
import { run } from "../src/loop.mjs";
import { requireCredential } from "../src/providers.mjs";
import path from "node:path";
import { randomUUID } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const session = path.join(root, "artifacts", `suite-${Date.now()}`);
await mkdir(session, { recursive: true });
const route = requireCredential();
const native = new Native();
let app;
const cases = [
  {
    name: "dark-notifications",
    goal: "Change the appearance to Dark, enable notifications, and save the settings. Stop when saved successfully.",
    check: (s) =>
      s.saved && s.theme === "Dark" && s.notifications && s.page === "saved",
  },
  {
    name: "project-borealis",
    goal: "Open the overview for Project Borealis.",
    check: (s) => s.page === "project" && s.project === "Project Borealis",
  },
  {
    name: "light-no-notifications",
    goal: "Save settings with the Light appearance and notifications disabled.",
    check: (s) =>
      s.saved && s.theme === "Light" && !s.notifications && s.page === "saved",
  },
];
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const stats = (values) => ({
  samples: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  min: Math.min(...values),
  max: Math.max(...values),
});
const reports = [];
const started = performance.now();
try {
  const permissions = await native.send({ op: "hello" });
  if (!permissions.accessibility || !permissions.screenRecording)
    throw new Error("Required native permissions are missing");
  const load = performance.now();
  await native.send(
    { op: "load", path: path.join(root, "models/omniparser.mlpackage") },
    120000,
  );
  const modelLoadMs = performance.now() - load;
  const trials = args.includes("--suite") ? 6 : 1;
  for (let trial = 0; trial < trials; trial++) {
    const testCase = cases[trial % cases.length];
    const noAX =
      args.includes("--no-ax") || (args.includes("--suite") && trial >= 3);
    const dir = path.join(
      session,
      `${trial}-${testCase.name}-${noAX ? "vision" : "ax"}`,
    );
    await mkdir(dir);
    const resultPath = path.join(dir, `result-${randomUUID()}.json`);
    app = spawn(path.join(root, ".build/jev-fixture"), [], {
      env: {
        ...process.env,
        JEV_FIXTURE_RESULT: resultPath,
        JEV_FIXTURE_VARIANT: String(trial),
      },
      stdio: "ignore",
    });
    let window;
    for (let i = 0; i < 30; i++) {
      const result = await native.send({ op: "windows" });
      window = result.windows.find((w) => w.pid === app.pid);
      if (window) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!window) throw new Error("Fixture window did not appear");
    await native.send({
      op: "select",
      id: window.id,
      ax: !noAX,
      fastOCR: args.includes("--fast-ocr") && !noAX,
    });
    await native.send({ op: "focus" });
    const warmup = await native.send({ op: "observe" });
    await native.send({ op: "save", path: path.join(dir, "before.png") });
    const outcome = await run({
      native,
      goal: testCase.goal,
      onStep: (r) =>
        console.log(
          JSON.stringify({
            trial,
            step: r.step,
            status: r.status,
            choice: r.decision.choice,
            p: r.decision.probability,
            label: r.action?.label,
            decisionMs: Math.round(r.decision.decisionMs),
            cycleMs: Math.round(r.cycleMs),
            settle: r.settleObservations,
          }),
        ),
    });
    const actual = JSON.parse(await readFile(resultPath, "utf8"));
    const taskSucceeded = actual.pid === app.pid && testCase.check(actual);
    const passed = taskSucceeded && outcome.status === "done";
    await native.send({ op: "save", path: path.join(dir, "after.png") });
    const report = {
      timestamp: new Date().toISOString(),
      name: testCase.name,
      ax: !noAX,
      fastOCR: args.includes("--fast-ocr") && !noAX,
      goal: testCase.goal,
      passed,
      taskSucceeded,
      actual,
      warmupMs: warmup.metrics.observeMs,
      ...outcome,
    };
    await writeFile(
      path.join(dir, "trace.json"),
      JSON.stringify(report, null, 2),
    );
    reports.push(report);
    console.log(
      JSON.stringify({
        trial,
        name: testCase.name,
        ax: !noAX,
        passed,
        status: outcome.status,
        elapsedMs: Math.round(outcome.elapsedMs),
      }),
    );
    if (!passed) process.exitCode = 1;
    app.kill();
    await new Promise((resolve) => app.once("exit", resolve));
    app = null;
  }
  const steps = reports.flatMap((r) => r.trace);
  const summary = {
    timestamp: new Date().toISOString(),
    provider: route.provider,
    model: route.model,
    modelLoadMs,
    totalMs: performance.now() - started,
    passed: reports.filter((r) => r.passed).length,
    trials: reports.length,
    decisionMs: stats(steps.map((s) => s.decision.decisionMs)),
    cycleMs: stats(steps.map((s) => s.cycleMs)),
    perceptionMs: stats(steps.map((s) => s.observation.metrics.observeMs)),
    detectorMs: stats(steps.map((s) => s.observation.metrics.detectorMs)),
    taskMs: stats(reports.map((r) => r.elapsedMs)),
    reports: reports.map(({ trace, warmupMs, actual, ...r }) => ({
      ...r,
      actions: actual.clicks,
    })),
  };
  await writeFile(
    path.join(session, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify({ summary: summary, artifacts: session }));
} finally {
  native.close();
  app?.kill();
}
