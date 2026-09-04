/**
 * Regression tests for the media byte-range parser: single-range support the
 * <video> element depends on, with malformed and multi-range requests
 * refused. Ported from the dsh wallpapers plugin's suite.
 */
import { describe, test, expect } from "bun:test"
import { parseByteRange } from "../src/server/file-stream.ts"

describe("parseByteRange", () => {
  const SIZE = 1000

  test("undefined when the header is absent", () => {
    expect(parseByteRange(undefined, SIZE)).toBeUndefined()
  })

  test("parses a full open range", () => {
    expect(parseByteRange("bytes=0-", SIZE)).toEqual({ start: 0, end: 999 })
  })

  test("parses a bounded range", () => {
    expect(parseByteRange("bytes=100-199", SIZE)).toEqual({ start: 100, end: 199 })
  })

  test("clamps an end past the resource", () => {
    expect(parseByteRange("bytes=900-2000", SIZE)).toEqual({ start: 900, end: 999 })
  })

  test("parses a suffix range", () => {
    expect(parseByteRange("bytes=-100", SIZE)).toEqual({ start: 900, end: 999 })
  })

  test("rejects multi-range requests", () => {
    expect(parseByteRange("bytes=0-1,5-10", SIZE)).toBeNull()
  })

  test("rejects a non-bytes unit", () => {
    expect(parseByteRange("items=0-1", SIZE)).toBeNull()
  })

  test("rejects an unsatisfiable start", () => {
    expect(parseByteRange("bytes=1000-", SIZE)).toBeNull()
  })

  test("rejects an inverted range", () => {
    expect(parseByteRange("bytes=500-100", SIZE)).toBeNull()
  })

  test("rejects a suffix larger than the resource's zero size", () => {
    expect(parseByteRange("bytes=-100", 0)).toBeNull()
  })

  test("rejects garbage", () => {
    expect(parseByteRange("not-a-range", SIZE)).toBeNull()
  })
})
