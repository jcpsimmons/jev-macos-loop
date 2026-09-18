// Screen Studio records this disposable window only. No desktop or account UI is needed.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { Native } from "../src/native.mjs";
import { run } from "../src/loop.mjs";
import { requireCredential } from "../src/providers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const route = requireCredential();
const directory = path.join(root, "artifacts", `recording-${Date.now()}`);
await mkdir(directory, { recursive: true });
const resultPath = path.join(directory, "result.json");
const statusPath = path.join(directory, "stopwatch.json");
const status = async (state) => {
  await writeFile(
    statusPath + ".tmp",
    JSON.stringify({ provider: route.provider, ...state }),
  );
  await rename(statusPath + ".tmp", statusPath);
};
await status({ phase: "READY", elapsedMs: 0 });
const native = new Native();
const input = createInterface({ input: process.stdin, output: process.stdout });
let app;
try {
  const permissions = await native.send({ op: "hello" });
  if (!permissions.accessibility || !permissions.screenRecording)
    throw new Error(
      "Screen Recording and Accessibility permissions are required",
    );
  await native.send(
    { op: "load", path: path.join(root, "models/omniparser.mlpackage") },
    120000,
  );
  app = spawn(
    path.join(root, ".build/Jev Loop Lab.app/Contents/MacOS/JevLoopLab"),
    [],
    {
      env: {
        ...process.env,
        JEV_FIXTURE_RESULT: resultPath,
        JEV_DEMO_STATUS_FILE: statusPath,
      },
      stdio: "ignore",
    },
  );
  let window;
  for (let i = 0; i < 30; i++) {
    const listing = await native.send({ op: "windows" });
    window = listing.windows.find((w) => w.pid === app.pid);
    if (window) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!window) throw new Error("Demo window did not appear");
  await native.send({ op: "select", id: window.id, ax: true, fastOCR: true });
  await native.send({ op: "focus" });
  await native.send({ op: "observe" });
  console.log(
    JSON.stringify({ directory, window: window.id, title: window.title }),
  );
  await input.question(
    "Select Jev Loop Lab in Screen Studio and begin recording. Press Enter to run. ",
  );
  await native.send({ op: "focus" });
  const startedAt = Date.now();
  const started = performance.now();
  await status({ phase: "RUNNING", startedAt });
  const goal =
    "Change the appearance to Dark, enable notifications, and save the settings. Stop when saved successfully.";
  const outcome = await run({ native, goal });
  const actual = JSON.parse(await readFile(resultPath, "utf8"));
  const passed =
    actual.pid === app.pid &&
    actual.saved &&
    actual.theme === "Dark" &&
    actual.notifications &&
    actual.page === "saved" &&
    outcome.status === "done";
  const elapsedMs = performance.now() - started;
  await status({ phase: passed ? "VERIFIED" : "STOPPED", elapsedMs });
  await writeFile(
    path.join(directory, "trace.json"),
    JSON.stringify(
      {
        goal,
        provider: route.provider,
        passed,
        actual,
        startedAt,
        verifiedElapsedMs: elapsedMs,
        ...outcome,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed,
      verifiedElapsedMs: elapsedMs,
      status: outcome.status,
    }),
  );
  if (!passed) process.exitCode = 1;
  await input.question(
    "Stop Screen Studio recording, then press Enter to close the disposable app. ",
  );
} finally {
  input.close();
  native.close();
  app?.kill();
}
