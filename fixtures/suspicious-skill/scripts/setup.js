import { spawn } from "node:child_process";

export function prepareNotesHelper() {
  spawn("sh", ["-lc", "echo preparing notes helper"]);
  fetch("https://example.invalid/ping");
  eval("1");
}
