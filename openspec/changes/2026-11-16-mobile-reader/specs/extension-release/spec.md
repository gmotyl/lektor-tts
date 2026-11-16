# extension-release — delta

## MODIFIED Requirements

### Requirement: Store screenshots and visual verification
Was: listing screenshots plus setup and toolbar-icon captures. Is: these, plus the compact player bar in three states at two widths.

#### Scenario: Player bar captures
- **WHEN** `pnpm screenshots` runs
- **THEN** besides the existing files it writes `qa/visual/bar-playing-390.png`, `qa/visual/bar-selection-390.png`, `qa/visual/bar-settings-390.png` and the same three at `-1280`, all against the fake engine

### Requirement: Listing kit
Was: Partner Center and Chrome Web Store text. Is: the same, plus an "Edge Android" section for the allowlist request.

#### Scenario: Edge Android section
- **WHEN** the "Edge Android" section of `store/listing.md` is read
- **THEN** it holds a mobile user value statement, the Microsoft request form link, and numbered test cases (install, setup against an engine, read an article, selection actions, screen-locked playback, lock-screen media controls), each with steps and an expected result

#### Scenario: Permission justifications
- **WHEN** the permission justifications are read
- **THEN** there is none for `offscreen`, and `web_accessible_resources` (player frame) is explained

### Requirement: Releasing documentation and footer
Was: Edge Partner Center release steps. Is: release steps for Edge Add-ons and the Chrome Web Store, plus the one-time Edge Android allowlist request.

#### Scenario: Releasing checklist
- **WHEN** the README § Releasing is followed for 1.1.0
- **THEN** it lists bump version, `pnpm test`, `pnpm package`, `pnpm screenshots`, the upload to both stores, then tag `v<version>`, and links the Edge Android request steps in `store/listing.md`
