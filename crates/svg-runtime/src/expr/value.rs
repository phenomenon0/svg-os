//! Runtime value type for expression evaluation.

use serde_json::Value as JsonValue;

/// Runtime value during expression evaluation.
#[derive(Debug, Clone)]
pub enum ExprValue {
    Num(f64),
    Str(String),
    Bool(bool),
    Null,
    Array(Vec<ExprValue>),
}

impl ExprValue {
    /// Convert from serde_json::Value.
    pub fn from_json(v: &JsonValue) -> Self {
        match v {
            JsonValue::Number(n) => Self::Num(n.as_f64().unwrap_or(0.0)),
            JsonValue::String(s) => Self::Str(s.clone()),
            JsonValue::Bool(b) => Self::Bool(*b),
            JsonValue::Null => Self::Null,
            JsonValue::Array(arr) => {
                Self::Array(arr.iter().map(Self::from_json).collect())
            }
            JsonValue::Object(_) => {
                // Objects become their JSON string representation
                Self::Str(v.to_string())
            }
        }
    }

    /// Truthiness: false, null, 0, "" are falsy.
    pub fn is_truthy(&self) -> bool {
        match self {
            Self::Bool(b) => *b,
            Self::Null => false,
            Self::Num(n) => *n != 0.0,
            Self::Str(s) => !s.is_empty(),
            Self::Array(a) => !a.is_empty(),
        }
    }

    /// Coerce to f64 for arithmetic.
    pub fn as_num(&self) -> Option<f64> {
        match self {
            Self::Num(n) => Some(*n),
            Self::Str(s) => s.parse::<f64>().ok(),
            Self::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            Self::Null => Some(0.0),
            Self::Array(_) => None,
        }
    }

    /// Coerce to string.
    pub fn as_str_coerce(&self) -> String {
        match self {
            Self::Str(s) => s.clone(),
            Self::Num(n) => format_f64(*n),
            Self::Bool(b) => b.to_string(),
            Self::Null => String::new(),
            Self::Array(_) => self.to_attr_string(),
        }
    }

    /// Convert to string for final output to AttrValue::parse.
    pub fn to_attr_string(&self) -> String {
        match self {
            Self::Str(s) => s.clone(),
            Self::Num(n) => format_f64(*n),
            Self::Bool(b) => b.to_string(),
            Self::Null => String::new(),
            Self::Array(items) => {
                let parts: Vec<String> = items.iter().map(|v| v.to_attr_string()).collect();
                parts.join(",")
            }
        }
    }

    /// Check if this is a string variant.
    pub fn is_string(&self) -> bool {
        matches!(self, Self::Str(_))
    }

    /// Check if this is null.
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }
}

impl PartialEq for ExprValue {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Num(a), Self::Num(b)) => a == b,
            (Self::Str(a), Self::Str(b)) => a == b,
            (Self::Bool(a), Self::Bool(b)) => a == b,
            (Self::Null, Self::Null) => true,
            _ => false,
        }
    }
}

fn format_f64(v: f64) -> String {
    if v == v.floor() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.6}", v);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}
