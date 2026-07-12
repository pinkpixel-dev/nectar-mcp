import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerCheckBalanceTool } from "./tools/check-balance.js";
import { registerEditImageTool } from "./tools/edit-image.js";
import { registerGenerateImageTool } from "./tools/generate-image.js";
import { registerGenerateVideoTool } from "./tools/generate-video.js";
import { registerGetModelDetailsTool } from "./tools/get-model-details.js";
import { registerListModelsTool } from "./tools/list-models.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "nectar-mcp",
    version: "0.1.0"
  });

  registerListModelsTool(server);
  registerGetModelDetailsTool(server);
  registerGenerateImageTool(server);
  registerEditImageTool(server);
  registerGenerateVideoTool(server);
  registerCheckBalanceTool(server);

  return server;
}
