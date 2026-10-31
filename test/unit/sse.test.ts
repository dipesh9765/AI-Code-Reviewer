import { describe, expect, it } from "vitest";
import { parseSse } from "../../src/core/sse";
import { bytes, chunksOf, drain } from "./helpers";

describe("parseSse", () => {
  it("parses simple events", async () => {
    const events = await drain(parseSse(chunksOf("data: one\n\ndata: two\n\n")));
    expect(events).toEqual([
      { event: undefined, data: "one" },
      { event: undefined, data: "two" },
    ]);
  });

  it("reassembles a frame split across chunks, even mid-field", async () => {
    const events = await drain(parseSse(chunksOf("da", "ta: hel", "lo\n", "\n")));
    expect(events).toEqual([{ event: undefined, data: "hello" }]);
  });

  it("joins multi-line data with newlines and keeps the event name", async () => {
    const events = await drain(parseSse(chunksOf("event: msg\ndata: a\ndata: b\n\n")));
    expect(events).toEqual([{ event: "msg", data: "a\nb" }]);
  });

  it("handles CRLF and bare CR line endings", async () => {
    const events = await drain(parseSse(chunksOf("data: a\r\n\r\ndata: b\r\r")));
    expect(events.map((e) => e.data)).toEqual(["a", "b"]);
  });

  it("does not split CRLF when CR and LF arrive in different chunks", async () => {
    const events = await drain(parseSse(chunksOf("data: a\r", "\n\r", "\n")));
    expect(events.map((e) => e.data)).toEqual(["a"]);
  });

  it("ignores comments and unknown fields", async () => {
    const events = await drain(parseSse(chunksOf(": keep-alive\nid: 7\nretry: 5\ndata: x\n\n")));
    expect(events).toEqual([{ event: undefined, data: "x" }]);
  });

  it("strips exactly one leading space from a value", async () => {
    const events = await drain(parseSse(chunksOf("data:  two spaces\n\ndata:none\n\n")));
    expect(events.map((e) => e.data)).toEqual([" two spaces", "none"]);
  });

  it("decodes a multi-byte character split across chunks", async () => {
    const euro = bytes("data: €\n\n");
    const cut = euro.indexOf(0xe2) + 1; // inside the 3-byte sequence
    const events = await drain(parseSse(chunksOf(euro.slice(0, cut), euro.slice(cut))));
    expect(events).toEqual([{ event: undefined, data: "€" }]);
  });

  it("delivers a final event that lacks the trailing blank line", async () => {
    const events = await drain(parseSse(chunksOf("data: tail")));
    expect(events).toEqual([{ event: undefined, data: "tail" }]);
  });

  it("emits nothing for empty events", async () => {
    expect(await drain(parseSse(chunksOf("\n\n\nevent: x\n\n")))).toEqual([]);
  });

  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(drain(parseSse(chunksOf("data: a\n\n"), controller.signal))).rejects.toThrow();
  });
});
