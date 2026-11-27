/** The host to tell providers apart; the raw text if it is not a URL. */
export function host(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url.trim()
  }
}

/** True for absolute http(s) URLs, the only kind an endpoint can have. */
export function isHttpUrl(url: string) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
