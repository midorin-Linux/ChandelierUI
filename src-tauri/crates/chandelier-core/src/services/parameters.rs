use serde_json::{Map, Value};

use crate::domain::{AppError, Result};

pub const PARAMETERS: &[&str] = &[
    "system_prompt",
    "temperature",
    "top_p",
    "max_completion_tokens",
    "frequency_penalty",
    "presence_penalty",
];

pub fn validate(parameters: &Value) -> Result<()> {
    let values = parameters
        .as_object()
        .ok_or_else(|| AppError::validation("生成設定はJSONオブジェクトで指定してください。"))?;
    for (key, value) in values {
        if !PARAMETERS.contains(&key.as_str()) {
            return Err(AppError::validation("未対応の生成パラメータです。"));
        }
        if value.is_null() {
            continue;
        }
        let valid = match key.as_str() {
            "system_prompt" => value.is_string(),
            "max_completion_tokens" => value
                .as_u64()
                .is_some_and(|n| n > 0 && n <= i32::MAX as u64),
            "temperature" => value.as_f64().is_some_and(|n| (0.0 ..= 2.0).contains(&n)),
            "top_p" => value.as_f64().is_some_and(|n| (0.0 ..= 1.0).contains(&n)),
            _ => value.as_f64().is_some_and(|n| (-2.0 ..= 2.0).contains(&n)),
        };
        if !valid {
            return Err(AppError::validation(
                "生成パラメータの型または範囲が不正です。",
            ));
        }
    }
    Ok(())
}

pub fn merge(layers: &[&Value]) -> Result<Map<String, Value>> {
    let mut merged = Map::new();
    for layer in layers {
        validate(layer)?;
        for (key, value) in layer.as_object().expect("validated object") {
            if value.is_null() {
                merged.remove(key);
            } else {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    #[test]
    fn layers_override_and_null_removes_inherited_values() {
        let result = merge(&[
            &json!({"temperature":1,"system_prompt":"base"}),
            &json!({"temperature":0,"system_prompt":null}),
            &json!({"top_p":0.5}),
        ])
        .unwrap();
        assert_eq!(Value::Object(result), json!({"temperature":0,"top_p":0.5}));
        for invalid in [
            json!({"api_key":"secret"}),
            json!({"temperature":2.1}),
            json!({"max_completion_tokens":0}),
            json!({"max_completion_tokens":1.5}),
            json!({"top_p":-1}),
            json!({"presence_penalty":3}),
        ] {
            assert!(validate(&invalid).is_err());
        }
    }
}
