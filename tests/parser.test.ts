import { beforeEach, describe, expect, it } from "vitest";
import {
  detectCheckpoint,
  isSupportedConnectionsPage,
  parseConnectionCards,
} from "../src/content/parser";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isSupportedConnectionsPage", () => {
  it("accepts the LinkedIn Connections route", () => {
    expect(
      isSupportedConnectionsPage({
        hostname: "www.linkedin.com",
        pathname: "/mynetwork/invite-connect/connections/",
      }),
    ).toBe(true);
  });

  it("rejects other LinkedIn and lookalike routes", () => {
    expect(
      isSupportedConnectionsPage({
        hostname: "www.linkedin.com",
        pathname: "/feed/",
      }),
    ).toBe(false);
    expect(
      isSupportedConnectionsPage({
        hostname: "linkedin.example.com",
        pathname: "/mynetwork/invite-connect/connections/",
      }),
    ).toBe(false);
  });
});

describe("parseConnectionCards", () => {
  it("parses a card from its member link and nearby visible text", () => {
    document.body.innerHTML = [
      "<main><ul><li>",
      '<a href="/in/ada/?trk=connections"><span aria-hidden="true">Ada Lovelace</span></a>',
      '<p data-field="headline">Analytical Engine Builder</p>',
      "<time>Connected August 2026</time>",
      "</li></ul></main>",
    ].join("");

    expect(parseConnectionCards(document)).toEqual({
      candidates: [
        {
          name: "Ada Lovelace",
          headline: "Analytical Engine Builder",
          profileUrl:
            "https://www.linkedin.com/in/ada/?trk=connections",
          connectedOn: "Connected August 2026",
        },
      ],
      failures: 0,
      examined: 1,
    });
  });

  it("deduplicates repeated links to the same member card", () => {
    document.body.innerHTML = [
      "<main><ul><li>",
      '<a href="/in/ada/"><span>Ada Lovelace</span></a>',
      '<a aria-label="View Ada Lovelace profile" href="/in/ada/">View profile</a>',
      "<p>Engineer</p>",
      "</li></ul></main>",
    ].join("");

    const result = parseConnectionCards(document);
    expect(result.examined).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("ignores profile links outside the main connections content", () => {
    document.body.innerHTML = [
      '<nav><a href="/in/owner/">Owner</a></nav>',
      '<main><li><a href="/in/ada/"><span aria-hidden="true">Ada</span></a></li></main>',
    ].join("");

    expect(parseConnectionCards(document).candidates.map((item) => item.name)).toEqual([
      "Ada",
    ]);
  });

  it("counts a member card without a usable name as a failure", () => {
    document.body.innerHTML =
      '<main><li><a href="/in/unknown/"><span aria-hidden="true"></span></a></li></main>';

    expect(parseConnectionCards(document)).toEqual({
      candidates: [],
      failures: 1,
      examined: 1,
    });
  });
});

describe("detectCheckpoint", () => {
  it("reports verification and login interruption text", () => {
    document.body.innerHTML =
      "<main><h1>Let’s do a quick verification</h1></main>";
    expect(detectCheckpoint(document)).toBe("Verification checkpoint detected");

    document.body.innerHTML = "<main><h1>Sign in to LinkedIn</h1></main>";
    expect(detectCheckpoint(document)).toBe("Sign-in prompt detected");
  });

  it("does not flag an ordinary connections page", () => {
    document.body.innerHTML = "<main><h1>Connections</h1></main>";
    expect(detectCheckpoint(document)).toBeNull();
  });
});
