use serde_json::{Map, Value, json};
use tokio::sync::Mutex;

use super::parameters;
use crate::{
    domain::{AppError, Model, Provider, Result, id, now},
    infrastructure::{
        credentials,
        database::Db,
        http::{self, OpenAiAdapter},
    },
};

// Serialize key replacement/deletion so a concurrent edit cannot orphan another edit's key.
static PROVIDER_WRITES: Mutex<()> = Mutex::const_new(());

pub async fn bootstrap_settings(db: &Db) -> Result<Value> {
    let mut settings = json!({
        "theme": "system", "chat_width": 880, "font_size": 15,
        "auto_scroll": true, "log_level": "info", "generation": {}, "last_model_id": null,
    });
    settings
        .as_object_mut()
        .expect("default settings object")
        .extend(
            db.settings()
                .await?
                .as_object()
                .expect("stored settings object")
                .clone(),
        );
    Ok(settings)
}

pub async fn save_settings(db: &Db, settings: &Value) -> Result<Value> {
    let settings = settings
        .as_object()
        .ok_or_else(|| AppError::validation("設定はJSONオブジェクトで指定してください。"))?;
    let mut editable = Map::new();
    for (key, value) in settings {
        let valid = match key.as_str() {
            "theme" => value
                .as_str()
                .is_some_and(|v| matches!(v, "system" | "light" | "dark")),
            "chat_width" => value.as_i64().is_some_and(|v| (480 ..= 1600).contains(&v)),
            "font_size" => value.as_i64().is_some_and(|v| (12 ..= 28).contains(&v)),
            "auto_scroll" => value.is_boolean(),
            "log_level" => value.as_str().is_some_and(|v| {
                matches!(v, "off" | "error" | "warn" | "info" | "debug" | "trace")
            }),
            "generation" => {
                parameters::validate(value)?;
                true
            }
            "last_model_id" => continue,
            _ => return Err(AppError::validation("未対応のアプリケーション設定です。")),
        };
        if !valid {
            return Err(AppError::validation(
                "アプリケーション設定の型または範囲が不正です。",
            ));
        }
        editable.insert(key.clone(), value.clone());
    }
    // Never rewrite server-owned keys from a bootstrap object read before model selection.
    db.upsert_settings(&Value::Object(editable)).await?;
    bootstrap_settings(db).await
}

pub async fn save_provider(
    db: &Db,
    mut provider: Provider,
    api_key: Option<String>,
) -> Result<Provider> {
    http::validate_provider(&provider)?;
    parameters::validate(&provider.default_parameters)?;
    let api_key = api_key.filter(|key| !key.is_empty());
    if let Some(key) = &api_key {
        if provider.authentication_mode != "bearer" {
            return Err(AppError::validation(
                "APIキーはBearer認証でのみ設定できます。",
            ));
        }
        if key.trim().is_empty()
            || key.chars().any(char::is_control)
            || reqwest::header::HeaderValue::from_str(&format!("Bearer {key}")).is_err()
        {
            return Err(AppError::validation("APIキーの形式を確認してください。"));
        }
    }
    let _guard = PROVIDER_WRITES.lock().await;
    let previous = db
        .providers()
        .await?
        .into_iter()
        .find(|stored| stored.id == provider.id);
    provider.created_at = previous
        .as_ref()
        .map_or_else(now, |stored| stored.created_at);
    let old_reference = previous.and_then(|stored| stored.credential_reference);
    provider.credential_reference = if provider.authentication_mode == "none" {
        None
    } else {
        old_reference.clone()
    };
    let staged = if let Some(key) = api_key {
        let reference = format!("chandelier/provider/{}/{}", provider.id, id());
        credentials::write(&reference, &key)?;
        provider.credential_reference = Some(reference.clone());
        Some(reference)
    } else {
        None
    };
    if provider.authentication_mode == "bearer" && provider.credential_reference.is_none() {
        return Err(AppError::new(
            "authentication",
            "Bearer認証にはAPIキーを設定してください。",
        ));
    }
    if let Err(error) = db.save_provider(&provider).await {
        if let Some(reference) = staged
            && credentials::delete(&reference).is_err()
        {
            return Err(AppError::new(
                "credential_cleanup",
                "設定は保存されませんでした。新しいAPIキーのOSストアからの削除にも失敗しました。",
            ));
        }
        return Err(error);
    }
    if let Some(reference) =
        old_reference.filter(|old| Some(old) != provider.credential_reference.as_ref())
        && credentials::delete(&reference).is_err()
    {
        return Err(AppError::new(
            "credential_cleanup",
            "設定は保存されましたが、以前のAPIキーをOSストアから削除できませんでした。",
        ));
    }
    Ok(provider)
}

pub async fn delete_provider(db: &Db, provider_id: &str) -> Result<()> {
    let _guard = PROVIDER_WRITES.lock().await;
    let (tx, provider) = db.begin_provider_deletion(provider_id).await?;
    let backup = match provider.credential_reference.as_deref() {
        Some(reference) => {
            let key = credentials::read(reference)?;
            credentials::delete(reference)?;
            Some((reference, key))
        }
        None => None,
    };
    // SQLite and the OS store cannot share a transaction: a process crash here can lose the key.
    if let Err(error) = tx.commit().await {
        if let Some((reference, key)) = backup
            && credentials::write(reference, &key).is_err()
        {
            return Err(AppError::new(
                "credential_restore",
                "削除の確定とAPIキーの復元に失敗しました。プロバイダーが残っている場合はAPIキーを再設定してください。",
            ));
        }
        return Err(error.into());
    }
    Ok(())
}

pub async fn test_provider(db: &Db, provider_id: &str) -> Result<()> {
    let provider = find_provider(db, provider_id).await?;
    let key = credentials::read_provider(&provider)?;
    OpenAiAdapter::models(&provider, key.as_deref()).await?;
    Ok(())
}

pub async fn refresh_models(db: &Db, provider_id: &str) -> Result<Vec<Model>> {
    let provider = find_provider(db, provider_id).await?;
    let key = credentials::read_provider(&provider)?;
    let mut identifiers = OpenAiAdapter::models(&provider, key.as_deref()).await?;
    identifiers.sort_unstable();
    identifiers.dedup();
    db.cache_discovered_models(provider_id, &identifiers).await
}

pub async fn save_model(db: &Db, model: Model) -> Result<Model> {
    http::validate_model_identifier(&model.model_identifier)?;
    if model.id.trim().is_empty()
        || model.display_name.trim().is_empty()
        || model
            .context_window
            .is_some_and(|value| value <= 0 || value as u64 > crate::domain::MAX_SAFE_INTEGER)
    {
        return Err(AppError::validation(
            "モデルの識別子、表示名、コンテキスト長を確認してください。",
        ));
    }
    parameters::validate(&model.default_parameters)?;
    let capabilities = model
        .capabilities
        .as_object()
        .ok_or_else(|| AppError::validation("モデル機能はJSONオブジェクトで指定してください。"))?;
    for (key, value) in capabilities {
        let valid = match key.as_str() {
            "unsupported_parameters" => value.as_array().is_some_and(|values| {
                values.iter().all(|value| {
                    value.as_str().is_some_and(|name| {
                        name != "system_prompt" && parameters::PARAMETERS.contains(&name)
                    })
                })
            }),
            "max_tokens_parameter" => value
                .as_str()
                .is_some_and(|name| matches!(name, "max_tokens" | "max_completion_tokens")),
            _ => false,
        };
        if !valid {
            return Err(AppError::validation(
                "未対応のモデル機能または生成パラメータです。",
            ));
        }
    }
    find_provider(db, &model.provider_id).await?;
    db.save_model(&model).await?;
    Ok(model)
}

pub async fn remember_model(db: &Db, model_id: Option<&str>) -> Result<()> {
    if let Some(model_id) = model_id
        && !db.models().await?.iter().any(|model| model.id == model_id)
    {
        return Err(AppError::new(
            "not_found",
            "指定されたモデルが見つかりません。",
        ));
    }
    db.upsert_settings(&json!({"last_model_id": model_id}))
        .await
}

async fn find_provider(db: &Db, provider_id: &str) -> Result<Provider> {
    db.providers()
        .await?
        .into_iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| AppError::new("not_found", "指定されたプロバイダーが見つかりません。"))
}
