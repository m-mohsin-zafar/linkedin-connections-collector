import { canonicalizeProfileUrl } from "../shared/records";
import type {
  AccountIdentity,
  AccountIdentityResult,
} from "../shared/types";

function compactText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function isMeContainer(element: Element): boolean {
  const ariaLabel = compactText(element.getAttribute("aria-label"));
  const title = compactText(element.getAttribute("title"));
  if (/^me$/i.test(ariaLabel) || /^me$/i.test(title)) {
    return true;
  }

  if (!element.matches("a, button, [role='button']")) {
    return false;
  }
  return /^me(?:\s+.*)?$/i.test(compactText(element.textContent));
}

function deriveDisplayName(container: Element, anchor: HTMLAnchorElement): string | null {
  const imageAlt = compactText(
    container.querySelector<HTMLImageElement>("img[alt]")?.alt,
  );
  if (imageAlt && !/^me$/i.test(imageAlt)) {
    return imageAlt;
  }

  const accessible = compactText(anchor.getAttribute("aria-label"))
    .replace(/\b(?:view\s+)?profile\b/gi, "")
    .replace(/\bme\b/gi, "")
    .trim();
  return accessible || null;
}

export function detectAccountIdentity(document: Document): AccountIdentityResult {
  const identities = new Map<string, AccountIdentity>();
  const regions = document.querySelectorAll("header, nav, [role='menu']");

  for (const region of regions) {
    const containers = [region, ...region.querySelectorAll("[aria-label], [title], a, button, [role='button']")]
      .filter(isMeContainer);

    for (const container of containers) {
      const anchors = container.matches("a[href]")
        ? [container as HTMLAnchorElement]
        : [...container.querySelectorAll<HTMLAnchorElement>("a[href]")];

      for (const anchor of anchors) {
        const accountKey = canonicalizeProfileUrl(
          anchor.getAttribute("href") ?? anchor.href,
        );
        if (!accountKey) {
          continue;
        }
        identities.set(accountKey, {
          accountKey,
          displayName: deriveDisplayName(container, anchor),
        });
      }
    }
  }

  if (identities.size === 1) {
    return { identity: [...identities.values()][0]!, reason: null };
  }
  if (identities.size > 1) {
    return {
      identity: null,
      reason: "Multiple signed-in LinkedIn profiles were found in the navigation",
    };
  }
  return {
    identity: null,
    reason: "Signed-in LinkedIn profile was not found in the navigation",
  };
}

export const detectSignedInAccount = detectAccountIdentity;
