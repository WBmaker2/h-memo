pub(crate) fn configured_client_secret() -> Option<String> {
  resolve_client_secret(
    std::env::var("GOOGLE_OAUTH_CLIENT_SECRET").ok().as_deref(),
    option_env!("GOOGLE_OAUTH_CLIENT_SECRET"),
  )
}

fn resolve_client_secret(runtime_value: Option<&str>, build_value: Option<&str>) -> Option<String> {
  runtime_value
    .and_then(normalize_secret)
    .or_else(|| build_value.and_then(normalize_secret))
}

fn normalize_secret(value: &str) -> Option<String> {
  let trimmed = value.trim();
  (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
  use super::resolve_client_secret;

  #[test]
  fn prefers_runtime_secret_and_trims_whitespace() {
    assert_eq!(
      resolve_client_secret(Some(" runtime-secret "), Some("build-secret")),
      Some("runtime-secret".to_string())
    );
  }

  #[test]
  fn falls_back_to_build_secret_when_runtime_value_is_empty() {
    assert_eq!(
      resolve_client_secret(Some("  "), Some(" build-secret ")),
      Some("build-secret".to_string())
    );
  }

  #[test]
  fn returns_none_when_no_non_empty_secret_exists() {
    assert_eq!(resolve_client_secret(None, Some(" ")), None);
  }
}
