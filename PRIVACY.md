# Privacy policy: Lektor TTS

Last updated: 2026-11-10

Lektor TTS is a browser extension that reads web pages aloud through a text-to-speech engine
you choose. This policy covers the extension published as "Lektor TTS" on Microsoft Edge
Add-ons and built from https://github.com/gmotyl/lektor-tts.

## No data collected

Lektor collects no personal data and no usage data. The developer runs no server that the
extension talks to and receives nothing from it.

## Page text goes only to your speech engine

When you start reading, the text of the article or of your selection is sent to the speech
engine you configured, and only there:

- OpenAI (`https://api.openai.com/v1`), under OpenAI's own terms and privacy policy;
- omnivoice-server on your own computer (`http://localhost:8892/v1` by default);
- or another OpenAI-compatible server whose address you entered.

Text is read only from a tab where you started reading (toolbar icon, keyboard shortcut or
context menu). Nothing is sent before you choose an engine and start reading.

## Settings stay in your browser

Your settings (engine preset, server address, API key, model, voice, speed and autoscroll) are
stored in your browser's sync storage (`chrome.storage.sync`). If browser sync is on, your
browser syncs them between your own devices. The API key is sent only to the engine it was
entered for, as an `Authorization` header.

While a page is being read, the current reading session (the sentences being read and the
engine settings) is also kept in `chrome.storage.session`, so playback survives a restart of the
extension's background worker. Session storage lives in memory on your device only, is never
synced, and is cleared when the browser closes.

## No analytics, no remote code

Lektor contains no analytics, tracking, advertising or crash reporting, and it loads no remote
code: everything it runs ships inside the extension package.

## Contact

Questions or concerns: https://github.com/gmotyl/lektor-tts/issues
