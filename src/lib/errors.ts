interface PollinationsErrorBody {
  status?: number;
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
}

export class PollinationsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "PollinationsApiError";
  }
}

export async function parsePollinationsError(response: Response): Promise<PollinationsApiError> {
  const fallbackMessage = `Pollinations request failed with HTTP ${response.status}.`;

  try {
    const body = (await response.json()) as PollinationsErrorBody;
    const code = body.error?.code;
    const message = body.error?.message ?? body.message ?? fallbackMessage;
    return new PollinationsApiError(message, response.status, code);
  } catch {
    return new PollinationsApiError(fallbackMessage, response.status);
  }
}

export function missingApiKeyMessage(): string {
  return [
    "POLLINATIONS_API_KEY is not set.",
    "Add it to your MCP client config under the server env block, for example:",
    '"env": { "POLLINATIONS_API_KEY": "sk_your_key_here" }'
  ].join("\n");
}

export function toToolError(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  if (error instanceof PollinationsApiError) {
    const code = error.code ? ` (${error.code})` : "";
    return {
      content: [
        {
          type: "text",
          text: `Pollinations API error ${error.status}${code}: ${error.message}`
        }
      ],
      isError: true
    };
  }

  if (error instanceof Error) {
    return {
      content: [{ type: "text", text: error.message }],
      isError: true
    };
  }

  return {
    content: [{ type: "text", text: String(error) }],
    isError: true
  };
}
