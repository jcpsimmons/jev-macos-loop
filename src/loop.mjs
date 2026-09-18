import { decide } from "./decide.mjs";
export async function run({
  native,
  goal,
  maxSteps = 30,
  minConfidence = 0.55,
  onStep = () => {},
  signal,
  decideFn = decide,
}) {
  const history = [],
    trace = [];
  const started = performance.now();
  let repeats = 0,
    last = "",
    previousScreen = "";
  const semantic = (o) =>
    JSON.stringify([
      o.text,
      o.elements.map((e) => [e.label, e.role, e.value, e.enabled]),
    ]);
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) throw new Error("Run cancelled");
    const cycle = performance.now();
    let observation = await native.send({ op: "observe" });
    let settleObservations = 0;
    while (
      history.length &&
      semantic(observation) === previousScreen &&
      settleObservations < 2
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      observation = await native.send({ op: "observe" });
      settleObservations++;
    }
    previousScreen = semantic(observation);
    const decision = await decideFn(goal, observation, history);
    let action = null,
      status = "running";
    if (decision.choice === "DONE")
      status = decision.probability >= 0.9 ? "done" : "uncertain";
    else if (decision.choice === "BLOCKED") status = "blocked";
    else if (decision.choice === "WAIT")
      await new Promise((resolve) => setTimeout(resolve, 80));
    else if (decision.probability < minConfidence) status = "uncertain";
    else {
      const selected = observation.elements.find(
        (e) => e.id === decision.choice,
      );
      if (!selected?.enabled)
        throw new Error("Unknown or disabled action target");
      const signature = JSON.stringify([
        selected.label,
        selected.value,
        selected.box,
        observation.text,
      ]);
      repeats = signature === last ? repeats + 1 : 0;
      last = signature;
      if (repeats >= 2) status = "stuck";
      else {
        // Never retry an uncertain mutation. A transport failure terminates the run.
        action = await native.send({
          op: "click",
          frame: observation.frame,
          target: decision.choice,
        });
        history.push({
          label: selected.label,
          value: selected.value,
          action: "click",
        });
      }
    }
    const record = {
      step,
      observation,
      decision,
      action,
      status,
      settleObservations,
      cycleMs: performance.now() - cycle,
      elapsedMs: performance.now() - started,
    };
    trace.push(record);
    await onStep(record);
    if (status !== "running")
      return { status, trace, elapsedMs: performance.now() - started };
  }
  return {
    status: "step-limit",
    trace,
    elapsedMs: performance.now() - started,
  };
}
