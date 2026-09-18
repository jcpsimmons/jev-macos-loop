import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
export class Native {
  constructor() {
    this.child = spawn(
      fileURLToPath(new URL("../.build/jev-native", import.meta.url)),
      [],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    this.pending = null;
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const pending = this.pending;
      this.pending = null;
      if (!pending) return;
      clearTimeout(pending.timer);
      try {
        const value = JSON.parse(line);
        value.error
          ? pending.reject(new Error(value.error))
          : pending.resolve(value);
      } catch (error) {
        pending.reject(error);
      }
    });
    this.child.on("exit", () => {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(new Error("Native worker exited"));
      }
      this.pending = null;
    });
    this.child.on("error", (error) => {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(error);
      }
      this.pending = null;
    });
  }
  send(command, timeout = 30000) {
    if (this.pending)
      throw new Error("Only one native operation can be in flight");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.child.kill();
        reject(new Error(`Native ${command.op} timed out`));
        this.pending = null;
      }, timeout);
      this.pending = { resolve, reject, timer };
      this.child.stdin.write(JSON.stringify(command) + "\n");
    });
  }
  close() {
    if (!this.child.stdin.destroyed)
      this.child.stdin.end(JSON.stringify({ op: "quit" }) + "\n");
  }
}
