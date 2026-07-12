import { CHARACTER_LIMIT } from "./constants.js";

export type ResponseFormat = "markdown" | "json";

export function textResponse(text: string): { content: [{ type: "text"; text: string }] } {
  return {
    content: [{ type: "text", text: limitText(text) }]
  };
}

export function jsonResponse(value: unknown): { content: [{ type: "text"; text: string }] } {
  return textResponse(JSON.stringify(value, null, 2));
}

export function limitText(text: string): string {
  if (text.length <= CHARACTER_LIMIT) {
    return text;
  }

  return `${text.slice(0, CHARACTER_LIMIT)}\n\n[Response truncated at ${CHARACTER_LIMIT} characters. Use filters or a lower limit to reduce output.]`;
}

export function formatBoolean(value: unknown): string {
  if (typeof value !== "boolean") {
    return "unknown";
  }

  return value ? "yes" : "no";
}
