import assert from "node:assert/strict"
import { test } from "node:test"
import { errorHint } from "./errorHint.ts"

test("the HTTP status decides before the error kind", () => {
  assert.equal(errorHint("httpStatus", 401).settings, "provider")
  assert.match(errorHint("httpStatus", 401).hint, /API key/)
  assert.match(errorHint("httpStatus", 429).hint, /rate limiting/)
  assert.match(errorHint("httpStatus", 503).hint, /server error/)
  assert.match(errorHint("network", 400).hint, /effort/)
})

test("without a status the kind is used", () => {
  assert.match(errorHint("network", null).hint, /reach the provider/)
  assert.equal(errorHint("timeout", null).settings, "general")
  assert.equal(errorHint("cancelled", null).settings, null)
  assert.match(errorHint(null, null).hint, /Check the local server/)
})
