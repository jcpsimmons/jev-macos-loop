import { test } from "node:test";
import assert from "node:assert/strict";
import { finderChoices, finderPayload, runFinder } from "../src/finder.mjs";

const root = "/private/tmp/disposable";
const folders = ["Invoices", "Receipts", "Reports"];
const item = (id, name, folder = false) => ({
  id,
  value: name,
  role: "AXTextField",
  enabled: true,
  itemURL: `file://${root}/${name}${folder ? "/" : ""}`,
  box: [1, 2, 3, 4],
  pixels: "private",
});
const screen = {
  frame: 1,
  freshFrame: true,
  elements: [
    item("file", "receipt_test.txt"),
    ...folders.map((name, i) => item(`folder${i}`, name, true)),
  ],
};

test("Finder reobserves a rejected read-only preflight but never repeats input", async () => {
  let frame = 0,
    validations = 0,
    drags = 0;
  const result = await runFinder({
    root,
    folderNames: folders,
    goal: "Sort",
    native: {
      send: async (command) => {
        if (command.op === "observe")
          return {
            ...screen,
            frame: ++frame,
            elements: drags ? screen.elements.slice(1) : screen.elements,
          };
        if (command.op === "validate-drag" && ++validations === 1)
          throw new Error("Element moved since observation");
        if (command.op === "drag") {
          drags++;
          assert.equal(command.frame, 2);
        }
        return {};
      },
    },
    decideFn: async (payload) => ({
      choice: payload.state.nextFile ? "folder1" : "DONE",
      probability: 1,
    }),
  });
  assert.equal(result.status, "done");
  assert.equal(result.trace[0].status, "reobserve");
  assert.equal(drags, 1);
});

test("Finder choices use UI names, expose every destination, and keep local paths out of requests", () => {
  const choices = finderChoices(screen, root, folders);
  const payload = finderPayload("Sort by prefix", choices, []);
  assert.deepEqual(Object.keys(payload.questions.next.criteria), [
    "folder0",
    "folder1",
    "folder2",
    "DONE",
    "BLOCKED",
  ]);
  assert.equal(payload.state.nextFile, "receipt_test.txt");
  assert.equal(JSON.stringify(payload).includes("private"), false);
  const unsafe = structuredClone(screen);
  unsafe.elements[0].itemURL = "file:///outside/receipt_test.txt";
  assert.equal(finderChoices(unsafe, root, folders).source, undefined);
  unsafe.elements[1].itemURL = "file:///outside/Invoices/";
  assert.throws(
    () => finderChoices(unsafe, root, folders),
    /Every destination/,
  );
});

test("Finder refuses mismatched labels and duplicate detections", () => {
  const observation = structuredClone(screen);
  observation.elements.push({ ...observation.elements[0], id: "duplicate" });
  assert.equal(finderChoices(observation, root, folders).files.length, 1);
  observation.elements[1].value = "Misleading";
  assert.throws(
    () => finderChoices(observation, root, folders),
    /Every destination/,
  );
});

test("Finder executes the model-selected destination, not a hardcoded prefix mapping", async () => {
  const calls = [];
  const result = await runFinder({
    root,
    folderNames: folders,
    goal: "Custom rule",
    native: {
      send: async (command) => {
        calls.push(command);
        return command.op === "observe"
          ? {
              ...screen,
              elements: calls.some((c) => c.op === "drag")
                ? screen.elements.slice(1)
                : screen.elements,
            }
          : {};
      },
    },
    decideFn: async (payload) => ({
      choice: payload.state.nextFile ? "folder2" : "DONE",
      probability: 1,
    }),
  });
  assert.equal(result.status, "done");
  assert.equal(calls.find((c) => c.op === "drag").destination, "folder2");
});

test("Finder rejects premature DONE, low confidence, stale frames, and invalid probability before input", async () => {
  for (const decision of [
    { choice: "DONE", probability: 1 },
    { choice: "folder1", probability: 0.7 },
  ]) {
    const calls = [];
    const result = await runFinder({
      root,
      folderNames: folders,
      goal: "Sort",
      native: {
        send: async (command) => {
          calls.push(command);
          return screen;
        },
      },
      decideFn: async () => decision,
    });
    assert.equal(result.status, "uncertain");
    assert.equal(calls.length, 1);
  }
  await assert.rejects(
    runFinder({
      root,
      folderNames: folders,
      goal: "Sort",
      native: { send: async () => ({ ...screen, freshFrame: false }) },
    }),
    /stale/,
  );
  await assert.rejects(
    runFinder({
      root,
      folderNames: folders,
      goal: "Sort",
      native: { send: async () => screen },
      decideFn: async () => ({ choice: "folder1", probability: NaN }),
    }),
    /probability/,
  );
});

test("Finder never retries a drag after uncertain delivery or an unchanged screen", async () => {
  for (const fail of [true, false]) {
    let drags = 0;
    const task = runFinder({
      root,
      folderNames: folders,
      goal: "Sort",
      native: {
        send: async (command) => {
          if (command.op === "drag") {
            drags++;
            if (fail) throw new Error("lost transport");
          }
          return screen;
        },
      },
      decideFn: async () => ({ choice: "folder1", probability: 1 }),
    });
    if (fail) await assert.rejects(task, /lost transport/);
    else assert.equal((await task).status, "stuck");
    assert.equal(drags, 1);
  }
});
