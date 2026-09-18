import {
  mkdir,
  appendFile,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  lstat,
  realpath,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import os from "node:os";
import { Native } from "../src/native.mjs";
import { requireCredential } from "../src/providers.mjs";
import { runFinder } from "../src/finder.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const folders = ["Invoices", "Receipts", "Reports"];
const filenames = [
  "report_quarterly.txt",
  "invoice_orion.txt",
  "receipt_coffee.txt",
  "invoice_atlas.txt",
  "report_inventory.txt",
  "receipt_train.txt",
  "report_weekly.txt",
  "receipt_supplies.txt",
  "invoice_borealis.txt",
];
const entries = async (directory) =>
  (await readdir(directory)).filter((name) => name !== ".DS_Store");
const digest = (data) => createHash("sha256").update(data).digest("hex");
if (process.argv.includes("--prepare")) {
  const parent = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "jev-finder-")),
  );
  const root = path.join(parent, "Jev Finder Demo");
  await mkdir(root);
  for (const folder of folders) await mkdir(path.join(root, folder));
  const files = [];
  for (const name of filenames) {
    const content = `Jev Finder Demo: fictional test document.\n${name}\nNo real customer or financial data.\n`;
    await writeFile(path.join(root, name), content);
    files.push({
      name,
      sha256: digest(content),
      folder:
        folders[["invoice", "receipt", "report"].indexOf(name.split("_")[0])],
    });
  }
  const manifest = path.join(parent, "manifest.json");
  await writeFile(manifest, JSON.stringify({ root, files, folders }, null, 2));
  console.log(JSON.stringify({ root, manifest }));
} else {
  const manifestPath = process.argv[process.argv.indexOf("--manifest") + 1];
  if (!process.argv.includes("--manifest"))
    throw new Error(
      "Run --prepare, open its root in Finder list view, then pass --manifest /path/to/manifest.json",
    );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const root = await realpath(manifest.root);
  const temp = await realpath(os.tmpdir());
  if (
    !root.startsWith(temp + "/jev-finder-") ||
    path.basename(root) !== "Jev Finder Demo" ||
    root !== manifest.root
  )
    throw new Error("Only the disposable --prepare folder is accepted");
  if (
    JSON.stringify(manifest.folders) !== JSON.stringify(folders) ||
    JSON.stringify(manifest.files.map((f) => f.name)) !==
      JSON.stringify(filenames)
  )
    throw new Error("Unexpected demo manifest");
  const expectedNames = [...folders, ...filenames].sort();
  if (
    JSON.stringify((await entries(root)).sort()) !==
    JSON.stringify(expectedNames)
  )
    throw new Error("Demo folder is not a fresh nine-file setup");
  for (const folder of folders) {
    if (
      !(await lstat(path.join(root, folder))).isDirectory() ||
      (await entries(path.join(root, folder))).length
    )
      throw new Error("Destination must be an empty real directory");
  }
  for (const file of manifest.files) {
    if (
      !(await lstat(path.join(root, file.name))).isFile() ||
      digest(await readFile(path.join(root, file.name))) !== file.sha256
    )
      throw new Error("Dummy file differs from preparation");
  }
  const route = requireCredential();
  const artifact = path.join(repo, "artifacts", `finder-${Date.now()}`);
  await mkdir(artifact, { recursive: true });
  const native = new Native();
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort());
  try {
    const permissions = await native.send({ op: "hello" });
    if (!permissions.screenRecording || !permissions.accessibility)
      throw new Error("Desktop permissions are missing");
    await native.send(
      { op: "load", path: path.join(repo, "models/omniparser.mlpackage") },
      120000,
    );
    const windows = (await native.send({ op: "windows" })).windows.filter(
      (w) => w.app === "Finder" && w.title === "Jev Finder Demo",
    );
    if (windows.length !== 1)
      throw new Error("Open exactly one Finder window named Jev Finder Demo");
    await native.send({
      op: "select",
      id: windows[0].id,
      ax: true,
      fastOCR: true,
    });
    await native.send({ op: "focus" });
    await native.send({ op: "observe" });
    console.log(
      JSON.stringify({
        window: windows[0].id,
        root,
        artifact,
        provider: route.provider,
      }),
    );
    if (!process.argv.includes("--now"))
      await input.question(
        "Start the window-only recorder, then press Enter. ",
      );
    await native.send({ op: "focus" });
    const startedAt = Date.now(),
      start = performance.now();
    const outcome = await runFinder({
      native,
      root,
      folderNames: folders,
      signal: abort.signal,
      goal: "Move every invoice_ file into Invoices, every receipt_ file into Receipts, and every report_ file into Reports. Finish when there are no loose files.",
      onStep: async (step) => {
        await appendFile(
          path.join(artifact, "steps.jsonl"),
          JSON.stringify(step) + "\n",
        );
        console.log(JSON.stringify(step));
      },
    });
    // Independent filesystem oracle, unavailable to the decision policy.
    const actual = [];
    for (const file of manifest.files) {
      const destination = path.join(root, file.folder, file.name);
      try {
        actual.push({
          name: file.name,
          folder: file.folder,
          passed:
            (await lstat(destination)).isFile() &&
            digest(await readFile(destination)) === file.sha256,
        });
      } catch {
        actual.push({ name: file.name, folder: file.folder, passed: false });
      }
    }
    const rootOnlyFolders =
      JSON.stringify((await entries(root)).sort()) ===
      JSON.stringify([...folders].sort());
    const totalFiles = (
      await Promise.all(
        folders.map((folder) => entries(path.join(root, folder))),
      )
    ).flat().length;
    const passed =
      outcome.status === "done" &&
      rootOnlyFolders &&
      totalFiles === 9 &&
      actual.every((file) => file.passed);
    const result = {
      passed,
      startedAt,
      verifiedElapsedMs: performance.now() - start,
      provider: route.provider,
      actual,
      rootOnlyFolders,
      totalFiles,
      ...outcome,
    };
    await writeFile(
      path.join(artifact, "trace.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        passed,
        verifiedElapsedMs: result.verifiedElapsedMs,
        artifact,
      }),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    input.close();
    native.close();
  }
}
