import { InvalidArgumentError, type Command } from "commander";
import { computerIdSchema } from "./schemas.js";
import { plain } from "./http.js";

const relativeTime = new Intl.RelativeTimeFormat("en");
const timeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

export function timeAgo(timestamp: string): string {
  const seconds = (Date.now() - Date.parse(timestamp)) / 1000;
  if (seconds >= 5) {
    for (const [unit, length] of timeUnits) {
      if (seconds >= length) {
        return relativeTime.format(-Math.floor(seconds / length), unit);
      }
    }
  }
  return "just now";
}

export function usesJson(command: Command): boolean {
  return command.optsWithGlobals<{ json?: boolean }>().json === true;
}

export function output(command: Command, data: unknown, text: string): void {
  process.stdout.write(`${usesJson(command) ? JSON.stringify(data) : text}\n`);
}

export function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) {
    return empty;
  }
  const lines = [headers, ...rows.map((row) => row.map((cell) => plain(cell)))];
  const widths = headers.map((_, i) => Math.max(...lines.map((line) => line[i]?.length ?? 0)));
  return lines
    .map((line) =>
      line
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export function computerId(value: string): string {
  if (!computerIdSchema.safeParse(value).success) {
    throw new InvalidArgumentError("Use the full ID from roy computers list.");
  }
  return value;
}

export function containerName(value: string): string {
  if (!/^[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?![\s\S])/u.test(value)) {
    throw new InvalidArgumentError(
      "Use 1–63 ASCII letters, digits or hyphens. Start with a letter and end with a letter or digit.",
    );
  }
  return value;
}

export function example(command: Command, invocation: string): Command {
  return command.addHelpText("after", `\nExample:\n  roy ${invocation}`);
}
