import { describe, it, expect } from "vitest";
import { tokenizeIdentifier } from "./identifier-tokenize.js";

describe("tokenizeIdentifier", () => {
  it("splits camelCase", () => {
    expect(tokenizeIdentifier("getUserById")).toEqual(["get", "user", "by", "id"]);
  });

  it("splits PascalCase", () => {
    expect(tokenizeIdentifier("UserAccount")).toEqual(["user", "account"]);
  });

  it("splits snake_case", () => {
    expect(tokenizeIdentifier("user_account_id")).toEqual(["user", "account", "id"]);
  });

  it("splits kebab-case", () => {
    expect(tokenizeIdentifier("user-account-id")).toEqual(["user", "account", "id"]);
  });

  it("splits mixed snake_case + camelCase", () => {
    expect(tokenizeIdentifier("get_userAccount_byId")).toEqual([
      "get", "user", "account", "by", "id",
    ]);
  });

  it("splits an acronym run followed by a capitalized word before the run's last letter (XMLHttpRequest rule)", () => {
    expect(tokenizeIdentifier("XMLHttpRequest")).toEqual(["xml", "http", "request"]);
    expect(tokenizeIdentifier("parseHTMLString")).toEqual(["parse", "html", "string"]);
  });

  it("leaves a trailing all-caps run intact when nothing capitalized follows it", () => {
    expect(tokenizeIdentifier("fetchJSON")).toEqual(["fetch", "json"]);
  });

  it("treats a fully-uppercase identifier as one word (no internal capitalized-word boundary)", () => {
    expect(tokenizeIdentifier("ID")).toEqual(["id"]);
    expect(tokenizeIdentifier("URL")).toEqual(["url"]);
  });

  it("drops leading/trailing punctuation without emitting empty tokens", () => {
    expect(tokenizeIdentifier("_privateField")).toEqual(["private", "field"]);
    expect(tokenizeIdentifier("__proto__")).toEqual(["proto"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(tokenizeIdentifier("")).toEqual([]);
  });

  it("splits dotted/namespaced identifiers on the dot", () => {
    expect(tokenizeIdentifier("auth.service.login")).toEqual(["auth", "service", "login"]);
  });

  it("keeps digits attached to the word they're adjacent to", () => {
    expect(tokenizeIdentifier("base64Encode")).toEqual(["base64", "encode"]);
  });
});
