#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectSkillPackage } from "./classifier.js";
import { renderHumanReport } from "./report.js";
import { TOOL_VERSION } from "./types.js";

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  cwd: string;
}

interface ParsedArgs {
  command: "inspect";
  inspectPath: string;
  jsonOut?: string;
}

const USAGE = `Usage:
  skillgate inspect --path <skill-package-dir> [--json-out <path>]
`;

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIo = { stdout: process.stdout, stderr: process.stderr, cwd: process.cwd() }
): Promise<number> {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      io.stdout.write(USAGE);
      return 0;
    }

    if (argv.includes("--version") || argv.includes("-v")) {
      io.stdout.write(`${TOOL_VERSION}\n`);
      return 0;
    }

    const parsed = parseArgs(argv);
    const report = await inspectSkillPackage(path.resolve(io.cwd, parsed.inspectPath));
    io.stdout.write(renderHumanReport(report));

    if (parsed.jsonOut) {
      const jsonPath = path.resolve(io.cwd, parsed.jsonOut);
      await fs.mkdir(path.dirname(jsonPath), { recursive: true });
      await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`${message}\n\n${USAGE}`);
    return 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command !== "inspect") {
    throw new Error("Invalid command.");
  }

  let inspectPath: string | undefined;
  let jsonOut: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--path") {
      inspectPath = readValue(rest, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--json-out") {
      jsonOut = readValue(rest, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!inspectPath) {
    throw new Error("Missing required --path.");
  }

  return {
    command: "inspect",
    inspectPath,
    jsonOut
  };
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
