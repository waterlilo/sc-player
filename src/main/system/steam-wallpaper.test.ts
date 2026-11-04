import test from "node:test";
import assert from "node:assert/strict";
import { defaultSteamPath, parseLibraryFolders, workshopId } from "./steam-path.ts";

test("workshopId extracts valid id from steam url and raw numbers", () => {
  assert.equal(workshopId("1234567"), "1234567");
  assert.equal(workshopId("https://steamcommunity.com/sharedfiles/filedetails/?id=293847291"), "293847291");
  assert.equal(workshopId("invalid"), null);
});

test("defaultSteamPath resolves macOS Library path on darwin and Windows path on win32", () => {
  const macPath = defaultSteamPath("darwin", "/Users/tester");
  assert.equal(macPath, "/Users/tester/Library/Application Support/Steam");

  assert.equal(defaultSteamPath("linux", "/home/tester"), "/home/tester/.local/share/Steam");

  const winPath = defaultSteamPath("win32", "");
  assert.equal(winPath, "C:\\Program Files (x86)\\Steam");
});

test("parseLibraryFolders extracts paths from libraryfolders.vdf format", () => {
  const mockVdf = `
    "libraryfolders" {
      "0" {
        "path" "C:\\\\Program Files (x86)\\\\Steam"
      }
      "1" {
        "path" "D:\\\\SteamLibrary"
      }
    }
  `;
  const paths = parseLibraryFolders(mockVdf);
  assert.deepEqual(paths, ["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
});
