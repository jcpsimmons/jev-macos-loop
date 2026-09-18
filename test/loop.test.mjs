import { test } from "node:test";
import assert from "node:assert/strict";
import { questions, stateFor } from "../src/decide.mjs";
import { run } from "../src/loop.mjs";
const screen = {
  frame: 7,
  text: ["Settings"],
  elements: [
    {
      id: "e0",
      label: "Settings",
      role: "AXButton",
      enabled: true,
      value: "",
      box: [1, 2, 3, 4],
      pixels: Buffer.from("private"),
    },
    {
      id: "e1",
      label: "Disabled",
      role: "AXButton",
      enabled: false,
      value: "",
    },
  ],
  image: "data:image/png;private",
  nativeHandle: "private",
};
test("the remote payload contains only allowlisted text, never pixels or native handles", () => {
  const state = stateFor("Open settings", screen, []);
  assert.deepEqual(state, {
    goal: "Open settings",
    screen: { accessibility: [], ocr: ["Settings"] },
    elements: [{ id: "e0", label: "Settings", role: "AXButton" }],
    recentActions: [],
  });
  assert.equal(JSON.stringify(state).includes("private"), false);
  assert.equal(Object.hasOwn(questions(screen).next.criteria, "e1"), false);
});
test("a low-confidence click stops before any mutation", async () => {
  const calls = [];
  const native = {
    send: async (cmd) => {
      calls.push(cmd);
      return screen;
    },
  };
  const result = await run({
    native,
    goal: "Open settings",
    decideFn: async () => ({ choice: "e0", probability: 0.3 }),
  });
  assert.equal(result.status, "uncertain");
  assert.deepEqual(
    calls.map((c) => c.op),
    ["observe"],
  );
});
test("an uncertain input delivery is never retried", async () => {
  let clicks = 0;
  const native = {
    send: async (cmd) => {
      if (cmd.op === "click") {
        clicks++;
        throw new Error("transport lost after input");
      }
      return screen;
    },
  };
  await assert.rejects(
    run({
      native,
      goal: "Open settings",
      decideFn: async () => ({ choice: "e0", probability: 1 }),
    }),
    /transport lost/,
  );
  assert.equal(clicks, 1);
});
test("a fresh frame is required on every subsequent decision and click", async () => {
  let frame = 0;
  let choices = 0;
  const calls = [];
  const native = {
    send: async (cmd) => {
      calls.push(cmd);
      return cmd.op === "observe"
        ? { ...screen, frame: ++frame, text: [String(frame)] }
        : { clicked: cmd.target };
    },
  };
  const result = await run({
    native,
    goal: "Open settings",
    decideFn: async () => ({
      choice: ++choices < 3 ? "e0" : "DONE",
      probability: 1,
    }),
  });
  assert.equal(result.status, "done");
  assert.deepEqual(
    calls.map((c) => c.op),
    ["observe", "click", "observe", "click", "observe"],
  );
  assert.deepEqual(
    calls.filter((c) => c.op === "click").map((c) => c.frame),
    [1, 2],
  );
});
test("unchanged repeated actions terminate rather than clicking forever", async () => {
  let clicks = 0;
  const native = {
    send: async (cmd) => {
      if (cmd.op === "click") clicks++;
      return screen;
    },
  };
  const result = await run({
    native,
    goal: "Open settings",
    decideFn: async () => ({ choice: "e0", probability: 1 }),
  });
  assert.equal(result.status, "stuck");
  assert.equal(clicks, 2);
});
test("weak completion confidence does not report done", async () => {
  const result = await run({
    native: { send: async () => screen },
    goal: "Open settings",
    decideFn: async () => ({ choice: "DONE", probability: 0.65 }),
  });
  assert.equal(result.status, "uncertain");
});

test("a low-confidence WAIT safely observes again instead of aborting a loading screen", async () => {
  let decisions = 0;
  const calls = [];
  const result = await run({
    native: {
      send: async (command) => {
        calls.push(command.op);
        return screen;
      },
    },
    goal: "Open settings",
    decideFn: async () =>
      ++decisions === 1
        ? { choice: "WAIT", probability: 0.53 }
        : { choice: "DONE", probability: 1 },
  });
  assert.equal(result.status, "done");
  assert.deepEqual(calls, ["observe", "observe"]);
});
