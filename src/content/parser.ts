import type { ConnectionCandidate, ParseResult } from "../shared/types";

const CONNECTIONS_PATH = "/mynetwork/invite-connect/connections";

function compactText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function memberSlug(href: string): string | null {
  try {
    const url = new URL(href, "https://www.linkedin.com");
    if (!/^(www\.)?linkedin\.com$/i.test(url.hostname)) {
      return null;
    }
    return url.pathname.match(/^\/in\/([^/]+)\/?$/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isSupportedConnectionsPage(
  location: Pick<Location, "hostname" | "pathname">,
): boolean {
  return (
    /^(www\.)?linkedin\.com$/i.test(location.hostname) &&
    location.pathname.replace(/\/+$/, "") === CONNECTIONS_PATH
  );
}

export function detectCheckpoint(document: Document): string | null {
  const text = compactText(
    document.querySelector("main, [role='main'], [role='dialog']")?.textContent,
  ).toLowerCase();

  if (
    text.includes("quick verification") ||
    text.includes("security check") ||
    text.includes("unusual activity") ||
    text.includes("challenge")
  ) {
    return "Verification checkpoint detected";
  }
  if (text.includes("sign in to linkedin") || text.includes("join linkedin")) {
    return "Sign-in prompt detected";
  }
  return null;
}

function deriveName(anchor: HTMLAnchorElement): string {
  const ariaHiddenName = compactText(
    anchor.querySelector("[aria-hidden='true']")?.textContent,
  );
  if (ariaHiddenName) {
    return ariaHiddenName;
  }

  const label = compactText(anchor.getAttribute("aria-label"));
  const labelMatch = label.match(/^view\s+(.+?)\s+(?:profile|’s profile)$/i);
  if (labelMatch?.[1]) {
    return compactText(labelMatch[1]);
  }

  const anchorText = compactText(anchor.textContent);
  return /^view (?:profile|.+ profile)$/i.test(anchorText) ? "" : anchorText;
}

function deriveConnectedOn(container: Element): string | null {
  const timeText = compactText(container.querySelector("time")?.textContent);
  if (timeText) {
    return timeText;
  }

  const match = compactText(container.textContent).match(
    /\bConnected\s+(?:on\s+)?[A-Z][^\n|•]{2,40}/i,
  );
  return match?.[0] ? compactText(match[0]) : null;
}

function deriveHeadline(container: Element, name: string): string | null {
  const preferred = container.querySelector(
    "[data-field='headline'], .entity-result__primary-subtitle, .mn-connection-card__occupation",
  );
  const preferredText = compactText(preferred?.textContent);
  if (preferredText) {
    return preferredText;
  }

  for (const element of container.querySelectorAll("p")) {
    const text = compactText(element.textContent);
    if (text && text !== name && !/^connected\b/i.test(text)) {
      return text;
    }
  }
  return null;
}

export function parseConnectionCards(document: Document): ParseResult {
  const candidates: ConnectionCandidate[] = [];
  const seen = new Set<string>();
  let failures = 0;
  let examined = 0;
  const content = document.querySelector("main, [role='main']");
  if (!content) {
    return { candidates, failures, examined };
  }

  for (const node of content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = node.getAttribute("href") ?? "";
    const slug = memberSlug(href);
    if (!slug || seen.has(slug)) {
      continue;
    }

    examined += 1;
    const container =
      node.closest("li, [role='listitem']") ?? node.parentElement ?? node;
    let sourceAnchor = node;
    let name = deriveName(sourceAnchor);
    if (!name) {
      const duplicate = [...container.querySelectorAll<HTMLAnchorElement>("a[href]")]
        .find((candidate) => memberSlug(candidate.getAttribute("href") ?? "") === slug && deriveName(candidate));
      if (duplicate) {
        sourceAnchor = duplicate;
        name = deriveName(sourceAnchor);
      }
    }
    if (!name) {
      failures += 1;
      continue;
    }

    seen.add(slug);

    candidates.push({
      name,
      headline: deriveHeadline(container, name),
      profileUrl: new URL(sourceAnchor.getAttribute("href") ?? href, "https://www.linkedin.com").href,
      connectedOn: deriveConnectedOn(container),
    });
  }

  return { candidates, failures, examined };
}
