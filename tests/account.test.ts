import { beforeEach, describe, expect, it } from "vitest";
import { detectSignedInAccount } from "../src/content/account";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectSignedInAccount", () => {
  it("reads the signed-in profile from the global navigation", () => {
    document.body.innerHTML = [
      '<header><nav aria-label="Primary Navigation">',
      '<div aria-label="Me">',
      '<a href="/in/amina-khan/?trk=global-nav">',
      '<img alt="Amina Khan" src="avatar.jpg"><span>Me</span>',
      "</a></div></nav></header>",
      '<main><a href="/in/some-connection/">Some Connection</a></main>',
    ].join("");

    expect(detectSignedInAccount(document)).toEqual({
      identity: {
        accountKey: "https://www.linkedin.com/in/amina-khan",
        displayName: "Amina Khan",
      },
      reason: null,
    });
  });

  it("does not mistake a connection card for the signed-in account", () => {
    document.body.innerHTML =
      '<main><a href="/in/some-connection/">Some Connection</a></main>';

    expect(detectSignedInAccount(document)).toEqual({
      identity: null,
      reason: "Signed-in LinkedIn profile was not found in the navigation",
    });
  });

  it("rejects ambiguous navigation identities", () => {
    document.body.innerHTML = [
      '<nav aria-label="Primary Navigation">',
      '<div aria-label="Me"><a href="/in/amina/"><img alt="Amina"></a></div>',
      '<div aria-label="Me"><a href="/in/bilal/"><img alt="Bilal"></a></div>',
      "</nav>",
    ].join("");

    expect(detectSignedInAccount(document)).toEqual({
      identity: null,
      reason: "Multiple signed-in LinkedIn profiles were found in the navigation",
    });
  });

  it("reads the profile link from an opened account menu", () => {
    document.body.innerHTML = [
      '<nav><button aria-label="Muhammad Mohsin Zafar Me">Me</button></nav>',
      '<div role="menu"><a href="/in/muhammad-mohsin-zafar/"><span>View profile</span></a></div>',
    ].join("");
    expect(detectSignedInAccount(document).identity).toEqual({
      accountKey: "https://www.linkedin.com/in/muhammad-mohsin-zafar",
      displayName: null,
    });
  });
});
