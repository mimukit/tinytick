import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake /usr/bin/security over an in-memory keychain. It reads `security -i`
// lines the way the real tool does: split on spaces, with "…", \" and \\.
const store = new Map<string, string>();
const calls: string[][] = [];
let failWrites = false;

function words(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]);
  return out;
}

function option(args: string[], flag: string): string {
  return args[args.indexOf(flag) + 1];
}

function fakeSecurity(args: string[], input?: string) {
  const key = `${option(args, "-s")}/${option(args, "-a")}`;
  switch (args[0]) {
    case "-i": {
      const line = words(input ?? "");
      if (!failWrites) store.set(`${option(line, "-s")}/${option(line, "-a")}`, option(line, "-w"));
      return { status: 0, stdout: "", stderr: "" };
    }
    case "find-generic-password":
      return store.has(key) ? { status: 0, stdout: `${store.get(key)}\n`, stderr: "" } : { status: 44, stdout: "", stderr: "not found" };
    case "delete-generic-password":
      return store.delete(key) ? { status: 0, stdout: "", stderr: "" } : { status: 44, stdout: "", stderr: "not found" };
    default:
      return { status: 1, stdout: "", stderr: "unknown" };
  }
}

vi.mock("node:child_process", () => ({
  spawnSync: (file: string, args: string[], options: { input?: string }) => {
    expect(file).toBe("/usr/bin/security");
    calls.push(args);
    return fakeSecurity(args, options.input);
  },
}));

const { addCommand, getAuth, saveApiToken, saveV2Cookie, signOut } = await import("../src/auth/secrets");

beforeEach(() => {
  store.clear();
  calls.length = 0;
  failWrites = false;
});

describe("secrets", () => {
  it("reports no sign-in when the keychain is empty", async () => {
    expect(await getAuth()).toEqual({ token: undefined, v2Cookie: undefined });
  });

  it("stores the token and the cookie as two items", async () => {
    await saveApiToken("  tok-123  ");
    await saveV2Cookie("t=abc");
    expect(await getAuth()).toEqual({ token: "tok-123", v2Cookie: "t=abc" });
    expect([...store.keys()].sort()).toEqual(["tinytick/api-token", "tinytick/v2-cookie"]);
  });

  it("sends the secret on stdin, never as an argument", async () => {
    await saveApiToken("tok-123");
    expect(calls.flat().join(" ")).not.toContain("tok-123");
  });

  it("quotes spaces, quotes and backslashes", async () => {
    const secret = 'a b"c\\d$e';
    expect(addCommand("api-token", secret)).toBe('add-generic-password -U -s "tinytick" -a "api-token" -w "a b\\"c\\\\d$e"\n');
    await saveApiToken(secret);
    expect((await getAuth()).token).toBe(secret);
  });

  it("rejects a control character", async () => {
    await expect(saveApiToken("a\nb")).rejects.toThrow(/control character/);
  });

  it("fails when the item does not read back", async () => {
    failWrites = true;
    await expect(saveApiToken("tok")).rejects.toThrow(/Could not save/);
  });

  it("removes the cookie on an empty value and everything on sign-out", async () => {
    await saveApiToken("tok");
    await saveV2Cookie("t=abc");
    await saveV2Cookie(" ");
    expect(await getAuth()).toEqual({ token: "tok", v2Cookie: undefined });
    await signOut();
    await signOut();
    expect(store.size).toBe(0);
  });
});
