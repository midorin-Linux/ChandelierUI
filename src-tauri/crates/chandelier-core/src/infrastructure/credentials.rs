use keyring::Entry;

use crate::domain::{AppError, Provider, Result};

const SERVICE: &str = "me.suwako.chandelier-ui";

fn entry(reference: &str) -> Result<Entry> {
    if reference.is_empty() || reference.chars().any(char::is_control) {
        return Err(AppError::validation("資格情報の参照が不正です。"));
    }
    Entry::new(SERVICE, reference).map_err(|_| unavailable())
}

pub fn read(reference: &str) -> Result<String> {
    entry(reference)?.get_password().map_err(|_| unavailable())
}

pub fn write(reference: &str, key: &str) -> Result<()> {
    if key.is_empty() || key.chars().any(char::is_whitespace) || key.chars().any(char::is_control) {
        return Err(AppError::validation(
            "APIキーは空白や制御文字を含まない値で指定してください。",
        ));
    }
    entry(reference)?
        .set_password(key)
        .map_err(|_| unavailable())
}

pub fn delete(reference: &str) -> Result<()> {
    match entry(reference)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(unavailable()),
    }
}

pub fn read_provider(provider: &Provider) -> Result<Option<String>> {
    match provider.authentication_mode.as_str() {
        "none" => Ok(None),
        "bearer" => {
            let reference = provider
                .credential_reference
                .as_deref()
                .ok_or_else(unavailable)?;
            read(reference).map(Some)
        }
        _ => Err(AppError::validation("認証方式が不正です。")),
    }
}

fn unavailable() -> AppError {
    AppError::new(
        "credentials",
        "OS資格情報ストアにアクセスできないか、APIキーが未登録です。平文保存は行いません。",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_keys_are_rejected_before_opening_native_store() {
        for key in [
            "",
            "key\r\nAuthorization: evil",
            " leading",
            "two words",
            "key\0",
        ] {
            assert_eq!(
                write("validation-only", key).unwrap_err().code,
                "validation"
            );
        }
    }
    #[test]
    #[ignore = "Writes a unique temporary OS credential; run explicitly on a desktop user account"]
    fn native_store_roundtrip_and_deletion() {
        let reference = format!("smoke-{}", crate::domain::id());
        let key = format!("test-{}", crate::domain::id());
        write(&reference, &key).unwrap();
        assert_eq!(read(&reference).unwrap(), key);
        delete(&reference).unwrap();
        assert!(read(&reference).is_err());
        delete(&reference).unwrap();
    }
}
