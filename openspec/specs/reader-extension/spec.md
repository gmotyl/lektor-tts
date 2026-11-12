# reader-extension

### Requirement: Read the page's article
Starting a reading session without a selection reads the article container that Readability identifies, from its first sentence.

#### Scenario: Article page
- **WHEN** the user clicks the toolbar icon on a page with an article and nothing selected
- **THEN** the player bar appears and the first sentence of the article container is spoken and highlighted

#### Scenario: No article found
- **WHEN** Readability finds no article container
- **THEN** the session reads the page body, skipping `nav`, `header`, `footer`, `aside` and `aria-hidden` elements

### Requirement: Read the selection
Starting a session while text is selected reads only the selected text.

#### Scenario: Context menu on a selection
- **WHEN** the user selects two sentences and chooses "Read selection" from the context menu
- **THEN** exactly those two sentences are spoken and the session ends after the second

#### Scenario: Selection cuts a sentence
- **WHEN** the selection starts in the middle of a sentence
- **THEN** reading starts at the first selected character, not at the start of that sentence

### Requirement: Start from a clicked paragraph
Alt+click on a paragraph of the reading source starts reading at that paragraph's first sentence.

#### Scenario: Alt+click during a session
- **WHEN** a session is playing sentence 3 and the user Alt+clicks paragraph 7
- **THEN** pending audio is discarded and the first sentence of paragraph 7 is spoken next

#### Scenario: Alt+click with no session
- **WHEN** no session is running and the user Alt+clicks a paragraph inside the article container after starting the extension on the tab
- **THEN** a session starts at that paragraph


#### Scenario: Alt+click narrows a whole-page session
- **WHEN** a session reads a whole app page and the user Alt+clicks a message in one of its panes
- **THEN** a session starts at that message reading only that pane

### Requirement: Sentence and paragraph navigation
The player bar's previous/next controls move by one sentence; with Shift they move to the start of the previous/next paragraph.

#### Scenario: Next sentence
- **WHEN** sentence 4 is playing and the user presses Next
- **THEN** sentence 5 starts playing and is highlighted

#### Scenario: Previous paragraph
- **WHEN** a sentence in the middle of paragraph 3 is playing and the user presses Shift+Previous
- **THEN** the first sentence of paragraph 3 starts playing

#### Scenario: Shift+Previous at a paragraph start
- **WHEN** the first sentence of paragraph 3 is playing and the user presses Shift+Previous
- **THEN** the first sentence of paragraph 2 starts playing

#### Scenario: Bounds
- **WHEN** the first sentence is playing and the user presses Previous
- **THEN** the first sentence restarts

### Requirement: Highlight the current sentence
The sentence being spoken is highlighted on the original page without changing the page's DOM, and scrolled into view when off-screen.

#### Scenario: Next sentence below the fold
- **WHEN** the next sentence starts and lies below the visible viewport
- **THEN** the page scrolls so the sentence is visible and only that sentence carries the highlight

#### Scenario: Page DOM untouched
- **WHEN** a session highlights sentences
- **THEN** no element is added to, removed from or modified in the article container


#### Scenario: Autoscroll off
- **WHEN** autoscroll is switched off on the player bar and the next sentence lies outside the viewport
- **THEN** the sentence is highlighted and the page does not scroll

### Requirement: Speak through an OpenAI-compatible engine
Each sentence is synthesised with `POST {baseUrl}/audio/speech` carrying `model`, `input` and `voice`, with a Bearer `Authorization` header only when an API key is set.

#### Scenario: Prefetch
- **WHEN** sentence i starts playing
- **THEN** requests for sentences i+1 to i+3 are in flight or done

#### Scenario: Seek aborts pending requests
- **WHEN** the user jumps from sentence 2 to sentence 20
- **THEN** in-flight requests for sentences 3 to 5 are aborted and requests for 20 to 23 are started

#### Scenario: Long sentence
- **WHEN** a sentence is longer than 400 characters
- **THEN** it is sent as pieces of at most 400 characters cut at spaces, played in order under one highlight

#### Scenario: Engine error
- **WHEN** the engine answers with an HTTP error or is unreachable
- **THEN** playback stops and the player bar shows the error, an "Open options" link and a Retry button


#### Scenario: Resume after a long pause
- **WHEN** a session has been paused longer than Chrome keeps the idle audio document alive and the user resumes
- **THEN** playback continues from the start of the current sentence

### Requirement: Player bar controls
The player bar offers play/pause, previous, next, voice, speed, autoscroll and close.

#### Scenario: Speed change
- **WHEN** the user sets speed to 1.3 during playback
- **THEN** the current and following sentences play at 1.3× without a new request

#### Scenario: Voice change
- **WHEN** the user picks another voice during playback
- **THEN** prefetched audio is discarded, the current sentence restarts in the new voice and the voice is saved as the default

#### Scenario: Close
- **WHEN** the user closes the player bar
- **THEN** playback stops, pending requests are aborted and the highlight is cleared

### Requirement: Session lifecycle
A session belongs to one tab and ends when that tab navigates, reloads or closes.

#### Scenario: Tab reload
- **WHEN** the tab of a playing session reloads
- **THEN** audio stops within one second

#### Scenario: Second tab
- **WHEN** a session plays in tab A and the user starts reading in tab B
- **THEN** the session in tab A stops and tab A's bar and highlight are removed

### Requirement: Options
The options page is the setup screen — preset cards, the fields of the selected preset, one "Save and test" button, speed, autoscroll and model folded under "More settings", and a "Buy me a coffee" footer link.

#### Scenario: Save and test succeeds
- **WHEN** the user selects OpenAI, enters a valid key and clicks "Save and test"
- **THEN** the extension requests host permission for `https://api.openai.com`, saves the settings, calls `GET https://api.openai.com/v1/models` with the key, and shows "✓ Connected to OpenAI · 11 voices" with a hint how to start reading

#### Scenario: Wrong key
- **WHEN** the engine answers the test with HTTP 401
- **THEN** the engine's error message is shown under the button and the settings stay saved

#### Scenario: Permission denied
- **WHEN** the user declines the host permission request for a non-localhost origin
- **THEN** nothing is saved and the page shows "Lektor needs permission to reach <origin>"

#### Scenario: Voice list
- **WHEN** the omnivoice-server or Other preset is tested against an engine that answers `GET /audio/voices`
- **THEN** the voice select lists those ids

#### Scenario: Voice list fallback
- **WHEN** `GET {baseUrl}/audio/voices` fails but `GET {baseUrl}/models` succeeds for the Other preset
- **THEN** the connection is reported OK and the voice field becomes free text

#### Scenario: More settings collapsed
- **WHEN** the options page opens
- **THEN** speed, autoscroll and model are inside a collapsed "More settings" section

### Requirement: Start triggers and narrow permissions
Reading starts from the toolbar icon, the `Alt+Shift+R` shortcut, or the context menu ("Read selection", "Read from here"); the extension holds no all-sites host permission.

#### Scenario: Shortcut toggles
- **WHEN** a session is playing and the user presses Alt+Shift+R
- **THEN** playback pauses, and pressing it again resumes

#### Scenario: Manifest permissions
- **WHEN** the manifest is inspected
- **THEN** `host_permissions` contains only localhost and 127.0.0.1 origins and no `<all_urls>`, and no script is loaded from a remote URL

### Requirement: Read the clicked pane on app pages
On pages without an article (web apps such as Slack or Gmail), "Read from here" and Alt+click read only the pane that holds the clicked element — its nearest scroll container or landmark region — starting at the clicked paragraph.

#### Scenario: Slack thread
- **WHEN** the user chooses "Read from here" on a message in a Slack thread pane
- **THEN** the thread is read from that message and no channel names from the sidebar are spoken

#### Scenario: Gmail conversation
- **WHEN** the user chooses "Read from here" on a message in an open Gmail conversation
- **THEN** the conversation is read from that message and the label navigation is not spoken

### Requirement: Lektor TTS identity
The extension is named "Lektor TTS", is versioned 1.0.0 for its first store release, and uses one icon rendered from a single SVG source.

#### Scenario: Name in the browser
- **WHEN** the extension is installed and the user hovers the toolbar icon or opens the extensions page
- **THEN** it shows the name "Lektor TTS" and the "L" monogram icon, and no text says "OmniVoice Reader"

#### Scenario: Icons from one source
- **WHEN** `node scripts/render-icons.mjs` runs
- **THEN** `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` and `store/logo-300.png` are written from `icons/icon.svg` at those exact pixel sizes

### Requirement: Engine presets
The extension offers three engine presets: OpenAI, own omnivoice-server, and other OpenAI-compatible server.

#### Scenario: OpenAI preset fills the engine
- **WHEN** the user selects the OpenAI preset
- **THEN** the base URL becomes `https://api.openai.com/v1`, the model `gpt-4o-mini-tts`, no URL field is shown, and the voice select lists the 11 voices of `gpt-4o-mini-tts`

#### Scenario: Voices follow the OpenAI model
- **WHEN** the OpenAI preset is selected and the user changes the model under "More settings" to `tts-1`
- **THEN** the voice select lists the 9 voices of `tts-1`, keeping the current voice if it is among them, else the first one

#### Scenario: omnivoice-server preset
- **WHEN** the user selects the omnivoice-server preset
- **THEN** the address is `http://localhost:8892/v1` and a "Quick start" link opens `https://github.com/gmotyl/omnivoice-server#quick-start-read-web-pages-aloud` in a new tab

#### Scenario: Other server preset
- **WHEN** the user selects the Other server preset
- **THEN** a base URL field, an optional API key field and a voice field are shown, the voice being a select when the engine lists voices and free text otherwise

### Requirement: Setup screen on install
A fresh install opens the options page as the setup screen; an update opens nothing.

#### Scenario: Fresh install
- **WHEN** the extension is installed (`onInstalled` reason `install`)
- **THEN** the options page opens in a new tab with no preset selected yet

#### Scenario: Update
- **WHEN** the extension is updated (`onInstalled` reason `update`)
- **THEN** no tab is opened

### Requirement: Setup prompt while unconfigured
Before any engine preset was saved, starting a reading session shows a setup prompt instead of calling an engine.

#### Scenario: Icon click while unconfigured
- **WHEN** no preset is saved and the user clicks the toolbar icon, presses Alt+Shift+R or uses a context menu item
- **THEN** the player bar shows "Lektor needs a speech engine before it can read." with a "Set up a speech engine" button and a close button, and no `/audio/speech` request is made

#### Scenario: Open setup from the prompt
- **WHEN** the user clicks "Set up a speech engine"
- **THEN** the options page opens

### Requirement: Settings migration
Settings saved before presets existed keep working without the setup prompt.

#### Scenario: Existing omnivoice-server setup
- **WHEN** stored settings have no `preset` and `baseUrl` `http://localhost:8892/v1` with a saved voice
- **THEN** `preset` is set to `omnivoice` and reading starts without a setup prompt

#### Scenario: Existing other server
- **WHEN** stored settings have no `preset` and `baseUrl` `https://spock-wsl.example.ts.net:8444/v1`
- **THEN** `preset` is set to `other`

#### Scenario: Untouched defaults
- **WHEN** stored settings have no `preset` and every engine key equals the old defaults
- **THEN** the extension is unconfigured
