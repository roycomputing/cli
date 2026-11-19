import { get } from "./client.js";
import { accessToken, soleComputer } from "./credentials.js";
import { computers } from "./schemas.js";
import { computerId } from "./output.js";

export const computerHelp = "computer ID (needed if you have more than one assigned computer)";

export async function getComputers(token: string, all = false) {
  const data = await get(all ? "computers" : "computers?assigned=me", computers, token);
  return data.computers;
}

export async function computerTarget(explicit: string | undefined, argument = "--computer <id>") {
  const token = await accessToken();
  if (explicit !== undefined) {
    return { id: explicit, token };
  }
  const id = await soleComputer(token, async () => {
    const assigned = await getComputers(token);
    const first = assigned[0];
    if (!first) {
      throw new Error(
        "No active computer is assigned to you. Run roy computers list --all to see the organization's computers.",
      );
    }
    if (assigned.length > 1) {
      throw new Error(
        `More than one computer is assigned to you. Please specify ${argument}. Run roy computers list for your computer IDs.`,
      );
    }
    return computerId(first.id);
  });
  return { id, token };
}
