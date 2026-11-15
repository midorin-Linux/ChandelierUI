const fencePattern =
  /^(?:[ \t]*(?:>[ \t]?|(?:[-+*]|\d+[.)])[ \t]+))*[ \t]*(`{3,}|~{3,})(.*)$/

function fenceAt(content: string, start: number): RegExpExecArray | null {
  const end = content.indexOf("\n", start)
  const match = fencePattern.exec(
    content.slice(start, end < 0 ? undefined : end)
  )
  return match && !(match[1][0] === "`" && match[2].includes("`"))
    ? match
    : null
}

function runEnd(content: string, start: number): number {
  let end = start + 1
  while (content[end] === content[start]) end++
  return end
}

function fenceEnd(content: string, start: number, marker: string): number {
  let line = content.indexOf("\n", start)
  while (line >= 0) {
    const match = fenceAt(content, line + 1)
    const end = content.indexOf("\n", line + 1)
    if (
      match &&
      match[1][0] === marker[0] &&
      match[1].length >= marker.length &&
      !match[2].trim()
    ) {
      return end < 0 ? content.length : end + 1
    }
    line = end
  }
  return content.length
}

function codeSpanEnd(content: string, start: number, length: number): number {
  let cursor = start + length
  while (cursor < content.length) {
    if (content[cursor] === "\n") {
      if (
        /^[ \t]*\r?\n/.test(content.slice(cursor + 1)) ||
        fenceAt(content, cursor + 1)
      )
        return -1
    } else if (content[cursor] === "`") {
      const end = runEnd(content, cursor)
      if (end - cursor === length) return end
      cursor = end
      continue
    }
    cursor++
  }
  return -1
}

function closingDelimiter(
  content: string,
  start: number,
  delimiter: string
): number {
  for (let cursor = start; cursor < content.length; cursor++) {
    if (
      (cursor === 0 || content[cursor - 1] === "\n") &&
      fenceAt(content, cursor)
    )
      return -1
    if (content.startsWith(delimiter, cursor)) {
      if (
        delimiter[0] !== "$" ||
        runEnd(content, cursor) - cursor === delimiter.length
      )
        return cursor
    }
    if (content[cursor] === "\\") cursor++
    else if (content[cursor] === "$") cursor = runEnd(content, cursor) - 1
  }
  return -1
}

function mathFence(payload: string, minimum: number): string {
  let length = minimum
  for (let cursor = 0; cursor < payload.length; cursor++) {
    if (payload[cursor] !== "$") continue
    const end = runEnd(payload, cursor)
    length = Math.max(length, end - cursor + 1)
    cursor = end - 1
  }
  return "$".repeat(length)
}

/** Normalize model-style TeX delimiters without rewriting Markdown code or TeX payloads. */
export function normalizeMathDelimiters(content: string): string {
  let result = ""
  let cursor = 0
  while (cursor < content.length) {
    if (cursor === 0 || content[cursor - 1] === "\n") {
      // shortcut: four-space/tab-indented lines stay literal; extend container parsing if indented list math is needed.
      if (/^(?: {4}|\t)/.test(content.slice(cursor, cursor + 4))) {
        const newline = content.indexOf("\n", cursor)
        const end = newline < 0 ? content.length : newline + 1
        result += content.slice(cursor, end)
        cursor = end
        continue
      }
      const fence = fenceAt(content, cursor)
      if (fence) {
        const end = fenceEnd(content, cursor, fence[1])
        result += content.slice(cursor, end)
        cursor = end
        continue
      }
    }

    if (content[cursor] === "`") {
      const end = runEnd(content, cursor)
      const close = codeSpanEnd(content, cursor, end - cursor)
      result += content.slice(cursor, close < 0 ? end : close)
      cursor = close < 0 ? end : close
      continue
    }

    const slashMath =
      content[cursor] === "\\" &&
      (content[cursor + 1] === "(" || content[cursor + 1] === "[")
    if (slashMath || content[cursor] === "$") {
      const end = slashMath ? cursor + 2 : runEnd(content, cursor)
      const delimiter = slashMath
        ? content[cursor + 1] === "("
          ? "\\)"
          : "\\]"
        : content.slice(cursor, end)
      const display = slashMath ? content[cursor + 1] === "[" : end - cursor > 1
      const close = closingDelimiter(content, end, delimiter)
      const payload = close < 0 ? "" : content.slice(end, close)

      // shortcut: numeric-leading prose is currency unless it has math syntax; use \(...\) for ambiguous numeric prose math.
      const currency =
        !slashMath &&
        !display &&
        /\d/.test(content[end] ?? "") &&
        (close < 0 ||
          /\d/.test(content[close + 1] ?? "") ||
          (/\s/.test(payload) && !/[\\^_{}=+*/<>-]/.test(payload)))
      if (currency || (display && close < 0 && !slashMath)) {
        result += "\\$".repeat(end - cursor)
        cursor = end
        continue
      }
      if (close >= 0) {
        if (display) {
          const marker = mathFence(payload, 2)
          result += `\n\n${marker}\n${payload}\n${marker}\n\n`
        } else if (slashMath) {
          const marker = mathFence(payload, 1)
          result += `${marker}${payload}${marker}`
        } else {
          result += content.slice(cursor, close + delimiter.length)
        }
        cursor = close + delimiter.length
        continue
      }
    }

    // Keep Markdown escapes, including escaped backslashes, exactly as written.
    if (content[cursor] === "\\" && cursor + 1 < content.length) {
      result += content.slice(cursor, cursor + 2)
      cursor += 2
    } else {
      result += content[cursor]
      cursor++
    }
  }
  return result
}
