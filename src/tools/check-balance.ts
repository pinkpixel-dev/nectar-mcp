import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { jsonResponse, textResponse } from "../lib/format.js";
import { PollinationsClient } from "../lib/pollinations-client.js";
import { toToolError } from "../lib/errors.js";

const CHECK_BALANCE_DESCRIPTION = [
  "Check the authenticated Pollinations pollen balance or API key budget by calling /account/balance. Use this before expensive image/video generation when the user asks about available pollen, credits, budget, or why a generation may be failing with payment/balance errors. Requires POLLINATIONS_API_KEY in the MCP client's env block.",
  "Args:",
  "- response_format (string, optional, default markdown): markdown for readable balance output, json for raw account/budget response.",
  "Returns: The remaining pollen balance or API key budget fields returned by Pollinations.",
  "Error handling: 401 means the MCP server is missing POLLINATIONS_API_KEY or the key is invalid. 403 means the key lacks account:usage permission. 402 on generation tools means insufficient pollen, so use this tool to confirm the balance."
].join(" ");

const checkBalanceSchema = z.object({
  response_format: z
    .enum(["markdown", "json"])
    .default("markdown")
    .describe("MCP response format: markdown for readable balance output, json for raw Pollinations account response.")
});

export function registerCheckBalanceTool(server: McpServer): void {
  server.registerTool(
    "pollinations_check_balance",
    {
      title: "Check Pollinations Balance",
      description: CHECK_BALANCE_DESCRIPTION,
      inputSchema: checkBalanceSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ response_format }) => {
      try {
        const client = new PollinationsClient();
        const balance = await client.checkBalance();

        if (response_format === "json") {
          return jsonResponse(balance);
        }

        return textResponse(formatBalance(balance));
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}

function formatBalance(balance: unknown): string {
  if (!isRecord(balance)) {
    return `# Pollinations Balance\n\n${JSON.stringify(balance, null, 2)}`;
  }

  const lines = ["# Pollinations Balance", ""];

  for (const [key, value] of Object.entries(balance)) {
    lines.push(`- ${key}: ${typeof value === "object" ? `\`${JSON.stringify(value)}\`` : String(value)}`);
  }

  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
