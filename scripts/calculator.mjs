import { spawnSync } from "node:child_process";
import { Native } from "../src/native.mjs";
import { run } from "../src/loop.mjs";
import { requireCredential } from "../src/providers.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const operands = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const [left, right] = operands.length ? operands.map(Number) : [32, 14];
if (
  (operands.length && operands.length !== 2) ||
  ![left, right].every((n) => Number.isInteger(n) && n > 0 && n <= 99)
)
  throw new Error(
    "Usage: node scripts/calculator.mjs [integer 1..99] [integer 1..99] [--no-ax]",
  );
await mkdir(path.join(root, "artifacts"), { recursive: true });
requireCredential();
const native = new Native();
try {
  const { windows } = await native.send({ op: "windows" });
  const w = windows.find((w) => w.app === "Calculator");
  if (!w) throw new Error("Open Calculator in Basic mode first");
  await native.send(
    { op: "load", path: path.join(root, "models/omniparser.mlpackage") },
    120000,
  );
  await native.send({
    op: "select",
    id: w.id,
    ax: !process.argv.includes("--no-ax"),
  });
  await native.send({ op: "focus" });
  await native.send({ op: "observe" });
  const goal = `Clear the current calculation. Then calculate ${left} multiplied by ${right} using the buttons.`;
  const result = await run({
    native,
    goal,
    onStep: (r) =>
      console.log(
        JSON.stringify({
          step: r.step,
          choice: r.decision.choice,
          label: r.action?.label,
          p: r.decision.probability,
          ms: Math.round(r.cycleMs),
          decisionMs: Math.round(r.decision.decisionMs),
          screen: r.observation.text,
        }),
      ),
  });
  const verification = JSON.parse(
    spawnSync(
      path.join(root, ".build/verify-calculator"),
      [String(left * right)],
      {
        encoding: "utf8",
      },
    ).stdout,
  );
  if (!verification.passed || result.status !== "done") process.exitCode = 1;
  await writeFile(
    path.join(root, "artifacts", `calculator-${Date.now()}.json`),
    JSON.stringify({ goal, verification, ...result }, null, 2),
  );
  console.log(
    JSON.stringify({
      status: result.status,
      elapsedMs: result.elapsedMs,
      verification,
    }),
  );
} finally {
  native.close();
}
