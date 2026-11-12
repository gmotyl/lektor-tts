# lektor-tts glossary

- **Store listing** — the extension's public page on Microsoft Edge Add-ons, visible in store search.
- **Engine preset** — a named starting configuration on the setup screen (OpenAI, own omnivoice-server, other OpenAI-compatible) that fills base URL, model and voice list.
- **Setup screen** — the options page in its first-run state, opened on install, where the user picks an engine preset and tests the connection.
- **Unconfigured** — the state before any engine preset was saved; starting a reading session then shows a setup prompt instead of an engine error.
- **Fake engine** — a local test HTTP server speaking the OpenAI `/audio/speech` protocol with silent audio, used for screenshots and visual verification without a GPU or key.
