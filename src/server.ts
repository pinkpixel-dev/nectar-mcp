import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { APP_VERSION } from "./lib/app-info.js";
import { registerCheckBalanceTool } from "./tools/check-balance.js";
import { registerEditImageTool } from "./tools/edit-image.js";
import { registerGenerateAudioTool } from "./tools/generate-audio.js";
import { registerGenerateImageTool } from "./tools/generate-image.js";
import { registerGenerateVideoTool } from "./tools/generate-video.js";
import { registerGetModelDetailsTool } from "./tools/get-model-details.js";
import { registerListModelsTool } from "./tools/list-models.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "nectar-mcp",
    version: APP_VERSION
  });

  registerListModelsTool(server);
  registerGetModelDetailsTool(server);
  registerGenerateImageTool(server);
  registerEditImageTool(server);
  registerGenerateVideoTool(server);
  registerGenerateAudioTool(server);
  registerCheckBalanceTool(server);

  return server;
}
