import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchPayload,
  classifyBatch,
  runFinderBatch,
} from "../src/finder-batch.mjs";
import { finderChoices } from "../src/finder.mjs";

const root = "/private/tmp/batch";
const folderNames = ["Invoices", "Receipts", "Reports"];
const names = [
  "invoice_a.txt",
  "invoice_b.txt",
  "invoice_c.txt",
  "receipt_a.txt",
  "receipt_b.txt",
  "receipt_c.txt",
  "report_a.txt",
  "report_b.txt",
  "report_c.txt",
];
const item = (name, id, folder = false) => ({
  id,
  value: name,
  role: "AXTextField",
  enabled: true,
  itemURL: `file://${root}/${name}${folder ? "/" : ""}`,
  box: [1, 2, 3, 4],
  pixels: "private",
});

function fixture({
  failSelection,
  failDrag,
  unchanged,
  changedSelection,
} = {}) {
  let remaining = [...names],
    frame = 0,
    elements = [],
    selected = false;
  const calls = [],
    requests = [];
  const native = {
    send: async (command) => {
      calls.push(command);
      if (command.op === "observe") {
        frame++;
        elements = [
          ...remaining.map((name, i) => item(name, `${frame}f${i}`)),
          ...folderNames.map((name, i) => item(name, `${frame}d${i}`, true)),
        ];
        if (selected && changedSelection)
          elements.push(item("unexpected.txt", "unexpected"));
        return { frame, freshFrame: true, elements };
      }
      if (command.op === "select-files") {
        if (failSelection) throw new Error("selection delivery uncertain");
        selected = true;
        return { count: command.sources.length };
      }
      if (command.op === "drag") {
        if (failDrag) throw new Error("drag delivery uncertain");
        assert.equal(command.frame, frame);
        const moved = command.sources.map(
          (id) => elements.find((element) => element.id === id)?.value,
        );
        assert.ok(moved.every(Boolean), "must rebind IDs after selection");
        if (!unchanged)
          remaining = remaining.filter((name) => !moved.includes(name));
      }
      return {};
    },
  };
  const evaluateFn = async (payload) => {
    requests.push(payload);
    const answers = Object.fromEntries(
      Object.keys(payload.questions).map((key, i) => {
        const choice =
          key === "done" ? "DONE" : payload.state.folders[Math.floor(i / 3)].id;
        return [key, { choice, probabilities: { [choice]: 1 } }];
      }),
    );
    return { answers, provider: "test", response: { modelId: "test" } };
  };
  return { native, evaluateFn, calls, requests };
}
const run = (f) =>
  runFinderBatch({
    root,
    folderNames,
    goal: "Sort filenames",
    settleMs: 0,
    ...f,
  });

test("nine classifications share one request and produce only three exact group drags", async () => {
  const f = fixture();
  const result = await run(f);
  assert.equal(result.status, "done");
  assert.equal(f.requests.length, 2);
  assert.equal(Object.keys(f.requests[0].questions).length, 9);
  const drags = f.calls.filter((c) => c.op === "drag");
  assert.equal(drags.length, 3);
  assert.deepEqual(
    drags.map((c) => c.sources.length),
    [3, 3, 3],
  );
  assert.equal(f.calls.filter((c) => c.op === "select-files").length, 3);
  assert.equal(JSON.stringify(f.requests).includes("private"), false);
  assert.deepEqual(
    result.trace
      .filter((step) => step.phase === "move-group")
      .map((step) => step.files),
    [names.slice(0, 3), names.slice(3, 6), names.slice(6)],
  );
});

test("batch grouping follows every model answer, including noncontiguous custom groups", async () => {
  const f = fixture();
  const choices = finderChoices(
    await f.native.send({ op: "observe" }),
    root,
    folderNames,
  );
  const plan = await classifyBatch("Custom rule", choices, async (payload) => ({
    answers: Object.fromEntries(
      Object.keys(payload.questions).map((key, i) => {
        const choice = choices.folders[i % 3].id;
        return [key, { choice, probabilities: { [choice]: 1 } }];
      }),
    ),
  }));
  assert.deepEqual(plan.groups[0].files, [names[0], names[3], names[6]]);
  assert.deepEqual(plan.groups[2].files, [names[2], names[5], names[8]]);
  assert.equal(
    JSON.stringify(batchPayload("Sort", choices)).includes("itemURL"),
    false,
  );
});

test("one uncertain file blocks the entire batch before any selection", async () => {
  const f = fixture(),
    evaluate = f.evaluateFn;
  f.evaluateFn = async (payload) => {
    const result = await evaluate(payload);
    const answer = result.answers.file8;
    answer.probabilities[answer.choice] = 0.79;
    return result;
  };
  assert.equal((await run(f)).status, "uncertain");
  assert.deepEqual(
    f.calls.map((c) => c.op),
    ["observe"],
  );
});

test("unknown destinations and malformed probabilities cannot create a batch", async () => {
  for (const answer of [
    { choice: "outside", probabilities: { outside: 1 } },
    { choice: "1d0", probabilities: { "1d0": NaN } },
  ]) {
    const f = fixture(),
      evaluate = f.evaluateFn;
    f.evaluateFn = async (payload) => {
      const result = await evaluate(payload);
      result.answers.file0 = answer;
      return result;
    };
    await assert.rejects(run(f), /Unknown|Invalid/);
    assert.deepEqual(
      f.calls.map((c) => c.op),
      ["observe"],
    );
  }
});

test("selection and drag delivery failures are never replayed", async () => {
  for (const phase of ["Selection", "Drag"]) {
    const f = fixture({ [`fail${phase}`]: true });
    await assert.rejects(run(f), /delivery uncertain/);
    assert.equal(f.calls.filter((c) => c.op === "select-files").length, 1);
    assert.equal(
      f.calls.filter((c) => c.op === "drag").length,
      phase === "Drag" ? 1 : 0,
    );
  }
});

test("an extra file or a missed group move stops before further input", async () => {
  for (const fault of ["unchanged", "changedSelection"]) {
    const f = fixture({ [fault]: true });
    await assert.rejects(run(f), /contents changed/);
    assert.equal(
      f.calls.filter((c) => c.op === "drag").length,
      fault === "unchanged" ? 1 : 0,
    );
    assert.equal(f.requests.length, 1);
  }
});
