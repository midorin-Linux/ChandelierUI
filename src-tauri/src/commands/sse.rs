use crate::error::Error;

pub(super) const MAX_SSE_EVENT_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub(super) struct SseDecoder {
    pub(super) line: Vec<u8>,
    pub(super) data: Vec<u8>,
    pub(super) event_bytes: usize,
    pub(super) has_data: bool,
    pub(super) after_cr: bool,
}

impl SseDecoder {
    pub(super) fn feed(
        &mut self,
        bytes: &[u8],
        mut event: impl FnMut(&[u8]) -> Result<bool, Error>,
    ) -> Result<bool, Error> {
        for &byte in bytes {
            if self.after_cr {
                self.after_cr = false;
                if byte == b'\n' {
                    continue;
                }
            }
            self.event_bytes += 1;
            if self.event_bytes > MAX_SSE_EVENT_BYTES {
                return Err(Error::InvalidResponse(
                    "Chat provider returned an oversized SSE event.",
                ));
            }
            if byte == b'\n' || byte == b'\r' {
                self.after_cr = byte == b'\r';
                if self.line.is_empty() {
                    let done = if self.has_data {
                        event(&self.data)?
                    } else {
                        false
                    };
                    self.data.clear();
                    self.has_data = false;
                    self.event_bytes = 0;
                    if done {
                        return Ok(true);
                    }
                } else {
                    let line = std::str::from_utf8(&self.line).map_err(|_| {
                        Error::InvalidResponse(
                            "Chat provider returned invalid UTF-8 in its SSE stream.",
                        )
                    })?;
                    let (field, value) = line.split_once(':').unwrap_or((line, ""));
                    if field == "data" {
                        if self.has_data {
                            self.data.push(b'\n');
                        }
                        self.data
                            .extend_from_slice(value.strip_prefix(' ').unwrap_or(value).as_bytes());
                        self.has_data = true;
                    }
                    self.line.clear();
                }
            } else {
                self.line.push(byte);
            }
        }
        Ok(false)
    }

    pub(super) fn finish(&self) -> Result<(), Error> {
        if !self.line.is_empty() || self.has_data {
            return Err(Error::InvalidResponse(
                "Chat provider returned a truncated SSE event.",
            ));
        }
        Ok(())
    }
}
