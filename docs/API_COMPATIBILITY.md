# OpenAI-compatible API boundary

The backend targets Chat Completions, not Responses, tool calling or multimodal APIs:

- `GET {base_url}/models`
- `POST {base_url}/chat/completions`, `stream: true`

`base_url` is the **API root**, including its version prefix when needed: `https://api.openai.com/v1` or `http://localhost:1234/v1`. It is not a complete `/chat/completions` URL. Authentication is either none (local servers) or Bearer using the OS credential store. Timeout is per request, including the response stream.

Only HTTP/HTTPS roots without URL credentials, query or fragment are accepted. Redirect following is disabled so authentication cannot be forwarded to a different endpoint. HTTP permits local development; remote HTTP exposes credentials and conversation data to the network, so use HTTPS for remote providers.

## Provider variation

`supports_usage` controls `stream_options.include_usage`; disable it for servers that reject this field. A successful answer without usage remains successful and retains timing measurements. Model context lengths are manually configured or unknown; model discovery must not guess them from names.

Generation defaults merge in increasing precedence: application → provider → model → session → request. `system_prompt` becomes a system message, not an API parameter. Model unsupported-parameter configuration removes non-supported fields before dispatch. The final request body and endpoint metadata are persisted for each attempt, excluding credentials.

An absent parameter inherits; explicit JSON `null` removes an inherited value. Model capabilities use `unsupported_parameters` (the unsupported numeric parameter names) and `max_tokens_parameter` (`max_completion_tokens` or legacy `max_tokens`). The six editable settings are system prompt, temperature, top P, maximum completion tokens, frequency penalty and presence penalty. Request-specific overrides are exposed through `GenerateInput.parameters`; the initial UI edits app/provider/model/session defaults.

## Streaming contract

Rust performs HTTP and SSE parsing; the frontend receives typed Tauri Channel events containing a generation ID and sequence: `started`, `delta`, `usage`, `completed`, `cancelled`, `error`. Role-only and usage-only events must not become visible text. Text is plain text, with newlines preserved; Markdown/HTML is never rendered.

Parser boundaries are network-independent: a received network chunk need not be a complete SSE event, UTF-8 character or token. A complete `[DONE]` marks success. EOF before it is an interrupted stream and preserves partial text as failed. User cancellation aborts the in-flight HTTP operation and preserves its checkpointed/final partial text.

SSE framing supports LF/CRLF/CR, comments, multiple data lines, fragmented UTF-8 and an initial UTF-8 BOM. Resource limits are 1 MiB per frame, 16 MiB accumulated answer text and 4 MiB for model discovery; exceeding them is a format error with partial output retained. Only one completion choice is supported (the request does not ask for `n > 1`), so multiple choices are rejected instead of concatenated.

Errors distinguish network, timeout, authentication, rate limit, missing model, malformed response, interrupted stream and cancellation. Provider response bodies and raw network errors are not displayed because they can contain secrets. There is no automatic request replay/retry, which could duplicate a billable generation.

## Scope

No automatic token estimator, tokenizer, API fallback, credential plaintext fallback, model-name context heuristic or protocol-switching layer is added. A new API family should be implemented behind a new adapter, leaving conversation persistence and UI display unchanged.
