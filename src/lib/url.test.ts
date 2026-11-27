import assert from "node:assert/strict"
import { test } from "node:test"
import { host, isHttpUrl } from "./url.ts"

test("host shows the host, or the raw text for non-URLs", () => {
  assert.equal(host("http://localhost:1234/v1"), "localhost:1234")
  assert.equal(host(" not a url "), "not a url")
})

test("only absolute http(s) URLs are accepted", () => {
  assert(isHttpUrl("https://openrouter.ai/api/v1"))
  assert(isHttpUrl("http://127.0.0.1:11434/v1"))
  assert(!isHttpUrl("localhost:1234/v1"), "No scheme")
  assert(!isHttpUrl("ftp://example.com"), "Not http")
  assert(!isHttpUrl(""), "Empty")
})
