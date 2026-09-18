import { Native } from "./native.mjs";
import { run } from "./loop.mjs";
import { routeInfo, requireCredential } from "./providers.mjs";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
const native = new Native();
try {
  const permissions = await native.send({ op: "hello" });
  if (args.includes("--doctor")) {
    console.log(JSON.stringify(permissions, null, 2));
  } else if (args.includes("--windows"))
    console.log(JSON.stringify(await native.send({ op: "windows" }), null, 2));
  else {
    const value = (flag) => {
      const index = args.indexOf(flag);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const id = Number(value("--window"));
    const goal = value("--goal");
    if (!id || !goal)
      throw new Error(
        'Usage: npm start -- --windows | --doctor | --window ID --goal "your goal" [--no-ax]',
      );
    requireCredential();
    console.log(JSON.stringify({ route: routeInfo() }));
    if (!permissions.screenRecording || !permissions.accessibility)
      throw new Error(
        "Enable Screen Recording and Accessibility for your terminal application",
      );
    await native.send(
      {
        op: "load",
        path: fileURLToPath(
          new URL("../models/omniparser.mlpackage", import.meta.url),
        ),
      },
      120000,
    );
    await native.send({
      op: "select",
      id,
      ax: !args.includes("--no-ax"),
      fastOCR: args.includes("--fast-ocr"),
    });
    await native.send({ op: "focus" });
    const outcome = await run({
      native,
      goal,
      onStep: (r) =>
        console.log(
          JSON.stringify({
            step: r.step,
            status: r.status,
            choice: r.decision.choice,
            label: r.action?.label,
            confidence: r.decision.probability,
            decisionMs: Math.round(r.decision.decisionMs),
            cycleMs: Math.round(r.cycleMs),
            ...r.observation.metrics,
          }),
        ),
    });
    console.log(
      JSON.stringify({
        status: outcome.status,
        elapsedMs: outcome.elapsedMs,
        note: "DONE is the model decision. Verify the application outcome independently.",
      }),
    );
    if (outcome.status !== "done") process.exitCode = 1;
  }
} finally {
  native.close();
}
