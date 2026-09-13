# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: a Chrome Manifest V3 extension using strict TypeScript, vanilla HTML/CSS, esbuild, Vitest, and jsdom. This keeps the installed extension small and the data logic testable.

## Users

The primary user is a LinkedIn member collecting a portable record of their own connections while viewing LinkedIn's Connections page.

## Product Purpose

Connections Collector captures coarse connection data already rendered in the browser and exports it as CSV and JSON. Success means the user can scan once or run a bounded scroll, stop safely, retain unique records locally, and export both formats.

## Positioning

The product is an explicit, on-device collection tool. It combines visible-page parsing, durable deduplication, bounded scrolling, and transparent stop conditions without undocumented APIs or automatic profile visits.

## Operating Context

The extension runs from a compact Chrome popup while the user keeps LinkedIn's Connections page visible. Collection may be a single visible scan or a bounded scrolling session.

## Capabilities and Constraints

- Collect name, headline, profile URL, connection date when visible, and collection timestamp.
- Store records locally and export matching CSV and JSON datasets.
- Exclude profile photos and profile-page enrichment from the MVP.
- Stop on hidden tabs, unsupported navigation, checkpoints, limits, repeated no-growth cycles, or broad parsing failures.
- Do not imitate human behavior, randomize timing to evade detection, call undocumented LinkedIn APIs, or bypass checkpoints and access controls.

## Evidence on Hand

The approved product design is at docs/superpowers/specs/2026-09-13-linkedin-connections-collector-design.md. No real LinkedIn connection data, brand assets, claims, testimonials, or benchmarks are part of the project.

## Product Principles

- Keep the user in control of every collection run.
- Preserve useful data before stopping safely.
- Keep personal data on the device.
- Prefer inspectable page semantics over brittle generated class names.
- Make limits, progress, and failures visible.

## Accessibility & Inclusion

The popup uses semantic controls, explicit labels, visible focus states, non-color status text, an aria-live status message, and accessible contrast.
