import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeMathDelimiters } from "./normalizeMathDelimiters.ts"

function equal(content: string, expected: string, message: string): void {
  assert.equal(normalizeMathDelimiters(content), expected, message)
}

const display = (payload: string, marker = "$$") =>
  `\n\n${marker}\n${payload}\n${marker}\n\n`

test("delimiters are normalized and escapes kept", () => {
  equal("", "", "empty content")
  equal("ordinary **Markdown**", "ordinary **Markdown**", "ordinary Markdown")
  equal("$E = mc^2$", "$E = mc^2$", "dollar inline math")
  equal("$5$ and $5+x$", "$5$ and $5+x$", "numeric inline math is retained")
  equal(String.raw`\(E = mc^2\)`, "$E = mc^2$", "parenthesized inline math")
  equal(
    String.raw`Before \(\frac{a}{b}\) after`,
    String.raw`Before $\frac{a}{b}$ after`,
    "inline surroundings and TeX backslashes"
  )
  equal(
    String.raw`$$\int_0^1 x^2 dx$$`,
    display(String.raw`\int_0^1 x^2 dx`),
    "single-line dollar display"
  )
  equal(
    String.raw`Before \[x^2\] after`,
    `Before ${display("x^2")} after`,
    "bracket display interrupts surrounding prose"
  )
  equal(
    "$$\nx + y\n= z\n$$",
    display("\nx + y\n= z\n"),
    "multiline dollar display"
  )
  equal(
    "\\[\nx + y\n= z\n\\]",
    display("\nx + y\n= z\n"),
    "multiline bracket display"
  )
  equal(
    String.raw`\(\frac{1}{\)`,
    String.raw`$\frac{1}{$`,
    "malformed TeX is passed to the renderer"
  )
  equal(
    String.raw`\(a $ b \$ c\)`,
    String.raw`$$a $ b \$ c$$`,
    "inline payload dollars stay unchanged"
  )
  equal(
    String.raw`\[a $$ b $ c\]`,
    display("a $$ b $ c", "$$$"),
    "display fence exceeds payload dollar runs"
  )
  equal(
    String.raw`$x + \$$`,
    String.raw`$x + \$$`,
    "escaped dollar in existing inline math"
  )
  equal(
    String.raw`\(a \\) + b\)`,
    String.raw`$a \\) + b$`,
    "escaped closing backslash does not end math"
  )
  equal(
    String.raw`\\(x\\) and \\[y\\]`,
    String.raw`\\(x\\) and \\[y\\]`,
    "escaped backslash delimiters"
  )
  equal(
    String.raw`\*stars\* \_under\_ \[ordinary bracket \$5 \\ path`,
    String.raw`\*stars\* \_under\_ \[ordinary bracket \$5 \\ path`,
    "ordinary Markdown escapes"
  )
})

test("code stays unchanged", () => {
  for (const code of [
    "    \\(x\\) $$y$$ $5 and $10",
    "\t\\[x\\] $y$",
    "    \\(x\\)\n\n    $$y$$\n",
    "```tex\n\\(x\\) $$y$$ $5 and $10\n```\n",
    "~~~~tex\n\\[x\\] $y$\n~~~~\n",
    "````\n```\n\\(x\\) $$y$$\n```\n````\n",
    "~~~\n\\[x\\]\n~~~~~\n",
    "> ```tex\n> \\(x\\) $$y$$\n> ```\n",
    "- ~~~tex\n  \\(x\\) $$y$$\n  ~~~\n",
    "> - ````tex\n>   \\(x\\) $$y$$\n>   ````\n",
    "```tex\n\\(unfinished\\) $$x$$",
    "    \\(x\\) $$y$$ $5 and $10\n",
    "\t\\[x\\] $y$\n",
    "`\\(x\\) $$y$$ $5 and $10`",
    "``a ` \\(x\\) $$y$$ ` b``",
    "```a `` \\[x\\] $5 and $10 `` b```",
    "`a\n\\(x\\) $$y$$`",
  ]) {
    equal(
      code,
      code,
      `code stays byte-for-byte unchanged: ${JSON.stringify(code)}`
    )
  }
})

test("unmatched code markers do not suppress math", () => {
  equal(
    "`unmatched \\(x\\)",
    "`unmatched $x$",
    "unmatched inline-code marker does not suppress math"
  )
  equal(
    "``unmatched ` \\(x\\)",
    "``unmatched ` $x$",
    "unmatched variable backtick runs"
  )
  equal(
    "`unmatched\n\n\\(x\\) `",
    "`unmatched\n\n$x$ `",
    "code spans cannot cross paragraphs"
  )
  equal(
    "`unmatched\n```\n\\(x\\)\n```\n\\(y\\)",
    "`unmatched\n```\n\\(x\\)\n```\n$y$",
    "unmatched code marker cannot consume a fence"
  )
  equal(
    "```\n\\(code\\)\n```\n\\(math\\)",
    "```\n\\(code\\)\n```\n$math$",
    "math resumes after a closed code fence"
  )
})

test("currency stays literal", () => {
  for (const currency of [
    "$5 と $10",
    "$5 and $10",
    "$5.00 and $10.50",
    "cost $5",
    "$5 apples and $x$",
  ]) {
    const expected =
      currency === "$5 apples and $x$"
        ? String.raw`\$5 apples and $x$`
        : currency.replace(/\$/g, String.raw`\$`)
    equal(currency, expected, `currency stays literal: ${currency}`)
  }
})

test("unfinished delimiters stay literal", () => {
  for (const unfinished of [
    "$$",
    "$$x",
    "$$\n\\int_0^1",
    "Before $$x\n\nordinary paragraph",
    "$$x and $y$",
  ]) {
    equal(
      unfinished,
      unfinished.replace("$$", String.raw`\$\$`),
      "unfinished dollar display stays literal without swallowing prose"
    )
  }
  for (const unfinished of [
    String.raw`\[`,
    String.raw`\[x`,
    "\\[\nx\n\nordinary paragraph",
    String.raw`\(`,
    String.raw`\(x`,
  ]) {
    equal(
      unfinished,
      unfinished,
      "unfinished backslash delimiters retain ordinary Markdown semantics"
    )
  }
  equal(
    "$$unfinished\n```\n$$\n```",
    "\\$\\$unfinished\n```\n$$\n```",
    "display matching never consumes a code fence"
  )
})

test("streamed formulas never invent a closing display fence", () => {
  // Streamed formulas never invent a closing display fence.
  for (const formula of [
    String.raw`\(\frac{a}{b}\)`,
    String.raw`\[\int_0^1 x^2 dx\]`,
    String.raw`$$\int_0^1 x^2 dx$$`,
  ]) {
    for (let length = 0; length <= formula.length; length++) {
      const prefix = formula.slice(0, length)
      const normalized = normalizeMathDelimiters(prefix)
      if (length < formula.length) {
        assert(
          !normalized.includes("\n\n$$\n"),
          `unfinished prefix is not a display block: ${JSON.stringify(prefix)}`
        )
      }
    }
  }
})
