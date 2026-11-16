# reader-extension — delta

## ADDED Requirements

### Requirement: Player frame
Audio plays in an extension-origin player frame injected into the reading tab, on every platform; no offscreen document is used.

#### Scenario: Start injects the frame
- **WHEN** a reading session starts in a tab
- **THEN** the content script's shadow host contains one iframe whose `src` is the extension's `src/player.html`, and the first sentence's audio plays from that frame

#### Scenario: Screen locked
- **WHEN** a session plays on Android and the user locks the screen
- **THEN** following sentences keep being fetched and played until the article ends or the user pauses

#### Scenario: Commands over a private port
- **WHEN** a page script posts a message shaped like a `play` command to the player frame window
- **THEN** the frame ignores it; only commands arriving over the `player` runtime Port from its own tab's content script are acted on

#### Scenario: Frame removed by the page
- **WHEN** the page removes the player frame while sentence 5 is playing
- **THEN** the content script injects a new frame once and playback continues from sentence 5

#### Scenario: Frame lost twice
- **WHEN** the re-injected frame also disconnects
- **THEN** playback stops and the player bar shows an error with a Retry button

### Requirement: Media Session controls
While a session plays, the player frame exposes Media Session metadata and play, pause, next-track and previous-track actions.

#### Scenario: Metadata
- **WHEN** sentence 3 starts playing on a page titled "Spider's Web" with voice "krystyna1"
- **THEN** `navigator.mediaSession.metadata` has title "Spider's Web", artist "Lektor TTS" and album "krystyna1"

#### Scenario: Next track from the lock screen
- **WHEN** the user presses "next" in the lock-screen media controls while sentence 3 plays
- **THEN** sentence 4 is spoken and highlighted, and the player bar shows the playing state

#### Scenario: Pause from a headset
- **WHEN** the pause action fires
- **THEN** audio pauses and the player bar's toggle shows ▶

### Requirement: Selection actions
While a session exists and text outside the player bar is selected, the player bar shows "▶ From here" and "▶ Selection".

#### Scenario: Strip appears and disappears
- **WHEN** during a session the user selects a word in paragraph 7
- **THEN** within 300 ms the bar shows the selection strip above the transport row, and when the selection collapses the strip is removed

#### Scenario: From here
- **WHEN** the user selects text in paragraph 7 and taps "▶ From here"
- **THEN** pending audio is discarded, reading continues from the first sentence of paragraph 7, and the selection is collapsed

#### Scenario: Selection
- **WHEN** the user selects two sentences and taps "▶ Selection"
- **THEN** exactly those two sentences are spoken and the session ends after the second

#### Scenario: No session
- **WHEN** no session runs in the tab and the user selects text
- **THEN** no selection strip is shown

### Requirement: Compact player bar
The player bar fits in one row at a 390px viewport: prev, play/pause, next, speed chip, ⋯ and close, with voice, the speed slider and autoscroll in a ⋯ fold-out.

#### Scenario: One row on a phone
- **WHEN** the bar renders in a 390px-wide viewport during playback
- **THEN** all transport controls sit on one row, each at least 44×44 px, and nothing wraps

#### Scenario: Speed chip cycle
- **WHEN** the speed is 1.0 and the user taps the speed chip three times
- **THEN** the speed becomes 1.2, then 1.5, then 2.0, the chip shows the current value each time, and 2.0 is saved as the default speed

#### Scenario: Chip from an off-preset speed
- **WHEN** the slider set the speed to 1.3 and the user taps the speed chip
- **THEN** the speed becomes 1.5

#### Scenario: Fold-out
- **WHEN** the user taps ⋯
- **THEN** a fold-out under the row shows the Voice select, the Speed slider with its value and the Autoscroll toggle, and ⋯ becomes a collapse control

## MODIFIED Requirements

### Requirement: Speak through an OpenAI-compatible engine
Was: the "Resume after a long pause" scenario recreated Chrome's idle audio document. Is: the player frame lives as long as the tab, so resume needs no recreation.

#### Scenario: Resume after a long pause
- **WHEN** a session has been paused for 10 minutes and the user resumes
- **THEN** playback continues from the start of the current sentence without a new frame being injected

### Requirement: Player bar controls
Was: play/pause, previous, next, voice, speed and autoscroll in one flat toolbar. Is: play/pause, previous, next, a speed chip, ⋯ and close in the row; voice, the speed slider and autoscroll in the ⋯ fold-out (see Compact player bar). Speed and voice behaviour is unchanged.

#### Scenario: Voice change from the fold-out
- **WHEN** the user opens ⋯ and picks another voice during playback
- **THEN** prefetched audio is discarded, the current sentence restarts in the new voice and the voice is saved as the default

### Requirement: Start triggers and narrow permissions
Was: toolbar icon, `Alt+Shift+R` or the context menu. Is: those, plus the selection actions while a session runs; the manifest no longer requests `offscreen`.

#### Scenario: Manifest permissions
- **WHEN** the manifest is inspected
- **THEN** `permissions` does not contain `offscreen`, `web_accessible_resources` lists `src/player.html`, `host_permissions` contains only localhost and 127.0.0.1 origins, and no script is loaded from a remote URL

### Requirement: Session lifecycle
Was: the service worker stopped the offscreen document when the owner tab closed. Is: the player frame ends with its tab; the service worker only stops the previous owner tab when another tab starts.

#### Scenario: Tab close
- **WHEN** the tab of a playing session closes
- **THEN** audio stops at once and no extension document keeps playing
