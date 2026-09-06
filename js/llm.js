// llm.js — OpenRouter chat-completions helper.
// Docs: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
// Used to generate the executive summary of the portfolio construction /
// optimization results. Only the chat-completions endpoint is used.
(function (global) {
  "use strict";

  const BASE = "https://openrouter.ai/api/v1";
  // A small, cheap default model. The user can override via the model input.
  const DEFAULT_MODEL = "openai/gpt-4o-mini";

  // Send a chat-completion request. Returns the assistant's text content.
  // Throws on HTTP error or unexpected response shape.
  function chat(messages, apiKey, model) {
    if (!apiKey) return Promise.reject(new Error("No OpenRouter API key provided."));
    const m = model || DEFAULT_MODEL;
    const body = JSON.stringify({
      model: m,
      messages: messages,
      // Keep the summary short — the prompt also asks for <=200 words, but
      // this is a hard cap so a verbose model can't blow past it.
      max_tokens: 400,
      temperature: 0.4,
    });
    return fetch(BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: body,
    }).then((res) => {
      return res.json().then((data) => {
        if (!res.ok || (data && data.error)) {
          const msg = (data && data.error && (data.error.message || data.error)) ||
                      (data && data.message) ||
                      ("HTTP " + res.status);
          const err = new Error(String(msg));
          err.status = res.status;
          throw err;
        }
        const content = data && data.choices &&
                        data.choices[0] && data.choices[0].message &&
                        data.choices[0].message.content;
        if (typeof content !== "string") {
          throw new Error("Unexpected response from OpenRouter.");
        }
        return content.trim();
      });
    });
  }

  global.VINLlm = { BASE, DEFAULT_MODEL, chat };
})(window);
