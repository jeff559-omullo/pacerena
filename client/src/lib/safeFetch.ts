export async function safeJsonFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    const hasJsonBody = contentType.includes("application/json");
    const isEmptyResponse = !text.trim();
    const looksLikeHtml = !hasJsonBody && text.trim().startsWith("<");

    if (isEmptyResponse || looksLikeHtml) {
      const fallbackMessage = response.status === 404
        ? "The backend API is unavailable. Start the server and try again."
        : "The server returned an empty or invalid response. Please try again.";

      return new Response(JSON.stringify({
        error: {
          message: fallbackMessage,
          code: response.status >= 500 ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
          status: response.status || 503,
        },
      }), {
        status: response.status || 503,
        statusText: response.statusText || "Service unavailable",
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const headers = new Headers(response.headers);
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return new Response(JSON.stringify({
      error: {
        message: "The app is temporarily unavailable. Please try again.",
        code: "SERVICE_UNAVAILABLE",
        status: 503,
      },
    }), {
      status: 503,
      statusText: "Service unavailable",
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
