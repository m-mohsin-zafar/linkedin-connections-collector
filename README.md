# LinkedIn Connections Collector

A local-first Chrome extension that collects coarse connection data already rendered on LinkedIn's Connections page. It supports a one-time visible scan or a bounded scrolling run, deduplicates by canonical profile URL, keeps separate data for each signed-in LinkedIn account, and exports both CSV and JSON.

## Collected fields

- Name
- Headline, when visible
- LinkedIn profile URL
- Connection date, when visible
- Collection timestamp

Profile photos and profile-page enrichment are intentionally excluded.

## Development

Requirements:

- Node.js 20 or newer
- Google Chrome or another Chromium browser that supports Manifest V3

Install and verify:

~~~bash
npm install
npm run check
~~~

The unpacked extension is built into dist.

## Load in Chrome

1. Open chrome://extensions.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose this project's dist directory.
5. Pin Connections Collector if you want it visible in the toolbar.

After editing source files, run npm run build and select Reload on the extension card.

## Use

1. Sign in to LinkedIn and open the Connections page.
2. Open the extension popup.
3. Use Scan visible for one pass without scrolling, or set record and duration limits and select Start collecting.
4. Keep the tab visible while collection runs.
5. Stop at any time, then export CSV or JSON.

On the first completed collection, the extension saves the newest connection as that account's refresh marker. Later refreshes begin from LinkedIn's newest-first list and stop after ingesting the batch containing that marker. If the saved marker cannot be found, the run is blocked and the old marker is retained so a partial traversal cannot silently become the new baseline.

The extension stops if the tab is hidden, the route changes, a verification or sign-in checkpoint appears, a configured limit is reached, the page stops growing, or the markup cannot be parsed reliably. It does not dismiss or work around checkpoints.

## Privacy and safety

Collected records stay in chrome.storage.local on your device. No data is sent to a server. Records, run state, and refresh markers are isolated by the signed-in member's canonical profile URL. The extension refuses to collect when it cannot identify that account unambiguously. Clear and export apply only to the currently detected account.

Data stored by version 0.1 under `connections.v1` and `run.v1` is intentionally left untouched and is not assigned to any account automatically.

The extension reads only information rendered on the Connections page. It does not use undocumented LinkedIn APIs, automatically visit profiles, schedule unattended collection, or randomize behavior to imitate a person.

LinkedIn can change its page markup at any time. Review your use against LinkedIn's current terms and any laws or obligations that apply to the data.

## Commands

- npm test: run the test suite once
- npm run test:watch: run tests in watch mode
- npm run typecheck: check strict TypeScript types
- npm run build: create dist
- npm run check: typecheck, test, and build
