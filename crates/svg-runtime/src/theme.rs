//! Theme: color/font/spacing token system applied to documents.

use svg_doc::{Document, NodeId, AttrKey, AttrValue};
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

/// A theme: named tokens for colors, fonts, and spacing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub name: String,
    pub colors: HashMap<String, String>,
    pub fonts: HashMap<String, String>,
    pub spacing: HashMap<String, f32>,
}

impl Theme {
    /// Parse a theme from a JSON string.
    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("Invalid theme JSON: {}", e))
    }

    /// Apply this theme to a document.
    ///
    /// Scans all nodes for token references (values like `{{color.primary}}`)
    /// and replaces them with the theme's actual values.
    pub fn apply(&self, doc: &mut Document) {
        let node_ids: Vec<NodeId> = doc.nodes.keys().copied().collect();

        for id in node_ids {
            let attrs: Vec<(AttrKey, AttrValue)> = {
                let node = match doc.get(id) {
                    Some(n) => n,
                    None => continue,
                };
                node.attrs.iter().map(|(k, v)| (*k, v.clone())).collect()
            };

            for (key, value) in attrs {
                if let AttrValue::Str(ref s) = value {
                    if let Some(resolved) = self.resolve_token(s) {
                        let new_value = AttrValue::parse(&key, &resolved);
                        doc.set_attr(id, key, new_value);
                    }
                }
            }
        }
    }

    /// Resolve a token reference like `{{color.primary}}` or `{{font.body}}`.
    fn resolve_token(&self, value: &str) -> Option<String> {
        if !value.contains("{{") {
            return None;
        }

        let mut result = value.to_string();
        let mut changed = false;

        // Find and replace all {{...}} tokens
        while let Some(start) = result.find("{{") {
            if let Some(end) = result[start..].find("}}") {
                let token = &result[start + 2..start + end].trim().to_string();

                let replacement = if let Some(color_key) = token.strip_prefix("color.") {
                    self.colors.get(color_key).cloned()
                } else if let Some(font_key) = token.strip_prefix("font.") {
                    self.fonts.get(font_key).cloned()
                } else if let Some(spacing_key) = token.strip_prefix("spacing.") {
                    self.spacing.get(spacing_key).map(|v| format!("{}", v))
                } else {
                    None
                };

                if let Some(rep) = replacement {
                    result = format!("{}{}{}", &result[..start], rep, &result[start + end + 2..]);
                    changed = true;
                } else {
                    // Unknown token — leave it and move past
                    break;
                }
            } else {
                break;
            }
        }

        if changed { Some(result) } else { None }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            name: "default".to_string(),
            colors: HashMap::from([
                ("primary".to_string(), "#2563eb".to_string()),
                ("secondary".to_string(), "#64748b".to_string()),
                ("background".to_string(), "#ffffff".to_string()),
                ("foreground".to_string(), "#0f172a".to_string()),
                ("accent".to_string(), "#f59e0b".to_string()),
                ("error".to_string(), "#ef4444".to_string()),
                ("success".to_string(), "#22c55e".to_string()),
            ]),
            fonts: HashMap::from([
                ("heading".to_string(), "Inter, system-ui, sans-serif".to_string()),
                ("body".to_string(), "Inter, system-ui, sans-serif".to_string()),
                ("mono".to_string(), "JetBrains Mono, monospace".to_string()),
            ]),
            spacing: HashMap::from([
                ("xs".to_string(), 4.0),
                ("sm".to_string(), 8.0),
                ("md".to_string(), 16.0),
                ("lg".to_string(), 24.0),
                ("xl".to_string(), 32.0),
            ]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use svg_doc::{Node, SvgTag};

    #[test]
    fn resolve_color_token() {
        let theme = Theme::default();
        let resolved = theme.resolve_token("{{color.primary}}");
        assert_eq!(resolved, Some("#2563eb".to_string()));
    }

    #[test]
    fn resolve_font_token() {
        let theme = Theme::default();
        let resolved = theme.resolve_token("{{font.mono}}");
        assert_eq!(resolved, Some("JetBrains Mono, monospace".to_string()));
    }

    #[test]
    fn no_token_returns_none() {
        let theme = Theme::default();
        assert!(theme.resolve_token("#ff0000").is_none());
    }

    #[test]
    fn apply_theme_to_doc() {
        let mut doc = Document::new();
        let root = doc.root;

        let mut rect = Node::new(SvgTag::Rect);
        rect.set_attr(AttrKey::Fill, AttrValue::Str("{{color.primary}}".to_string()));
        let rect_id = rect.id;
        doc.insert_node(root, 1, rect);

        let theme = Theme::default();
        theme.apply(&mut doc);

        let node = doc.get(rect_id).unwrap();
        // After theme application, fill should be the resolved hex color
        match node.get_attr(&AttrKey::Fill) {
            Some(AttrValue::Color(c)) => {
                let bytes = c.to_u8();
                assert_eq!(bytes[0], 0x25); // #2563eb
            }
            Some(AttrValue::Str(s)) => {
                assert_eq!(s, "#2563eb");
            }
            other => panic!("Expected color, got {:?}", other),
        }
    }

    #[test]
    fn parse_theme_json() {
        let json = r##"{
            "name": "dark",
            "colors": { "primary": "#818cf8", "background": "#1e1e2e" },
            "fonts": { "body": "Fira Sans" },
            "spacing": { "md": 20.0 }
        }"##;

        let theme = Theme::from_json(json).unwrap();
        assert_eq!(theme.name, "dark");
        assert_eq!(theme.colors.get("primary"), Some(&"#818cf8".to_string()));
    }
}
