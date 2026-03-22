//! Built-in function implementations.

use super::value::ExprValue;
use super::ExprError;

/// Dispatch a built-in function call.
pub fn call_builtin(name: &str, args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    match name {
        "if" => builtin_if(args),
        "min" => builtin_min(args),
        "max" => builtin_max(args),
        "abs" => builtin_abs(args),
        "round" => builtin_round(args),
        "floor" => builtin_floor(args),
        "ceil" => builtin_ceil(args),
        "clamp" => builtin_clamp(args),
        "format" => builtin_format(args),
        "len" => builtin_len(args),
        "upper" => builtin_upper(args),
        "lower" => builtin_lower(args),
        "str" => builtin_str(args),
        "num" => builtin_num(args),
        "default" => builtin_default(args),
        // Text functions
        "truncate" => builtin_truncate(args),
        "pad_start" => builtin_pad_start(args),
        "replace" => builtin_replace(args),
        "split" => builtin_split(args),
        "join" => builtin_join(args),
        "trim" => builtin_trim(args),
        "substr" => builtin_substr(args),
        "contains" => builtin_contains(args),
        "starts_with" => builtin_starts_with(args),
        _ => Err(ExprError {
            message: format!("Unknown function: {}", name),
            span: None,
        }),
    }
}

fn expect_args(name: &str, args: &[ExprValue], expected: usize) -> Result<(), ExprError> {
    if args.len() != expected {
        Err(ExprError {
            message: format!("{}() expects {} args, got {}", name, expected, args.len()),
            span: None,
        })
    } else {
        Ok(())
    }
}

fn builtin_if(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("if", &args, 3)?;
    let mut it = args.into_iter();
    let cond = it.next().unwrap();
    let then_val = it.next().unwrap();
    let else_val = it.next().unwrap();
    Ok(if cond.is_truthy() { then_val } else { else_val })
}

fn builtin_min(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("min", &args, 2)?;
    let a = args[0].as_num().unwrap_or(f64::NAN);
    let b = args[1].as_num().unwrap_or(f64::NAN);
    Ok(ExprValue::Num(a.min(b)))
}

fn builtin_max(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("max", &args, 2)?;
    let a = args[0].as_num().unwrap_or(f64::NAN);
    let b = args[1].as_num().unwrap_or(f64::NAN);
    Ok(ExprValue::Num(a.max(b)))
}

fn builtin_abs(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("abs", &args, 1)?;
    let n = args[0].as_num().unwrap_or(0.0);
    Ok(ExprValue::Num(n.abs()))
}

fn builtin_round(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("round", &args, 1)?;
    let n = args[0].as_num().unwrap_or(0.0);
    Ok(ExprValue::Num(n.round()))
}

fn builtin_floor(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("floor", &args, 1)?;
    let n = args[0].as_num().unwrap_or(0.0);
    Ok(ExprValue::Num(n.floor()))
}

fn builtin_ceil(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("ceil", &args, 1)?;
    let n = args[0].as_num().unwrap_or(0.0);
    Ok(ExprValue::Num(n.ceil()))
}

fn builtin_clamp(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("clamp", &args, 3)?;
    let v = args[0].as_num().unwrap_or(0.0);
    let lo = args[1].as_num().unwrap_or(f64::NEG_INFINITY);
    let hi = args[2].as_num().unwrap_or(f64::INFINITY);
    Ok(ExprValue::Num(v.clamp(lo, hi)))
}

fn builtin_format(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    if args.is_empty() {
        return Err(ExprError {
            message: "format() requires at least 1 arg".into(),
            span: None,
        });
    }
    let fmt = args[0].as_str_coerce();
    let mut result = String::new();
    let mut arg_idx = 1;
    let mut chars = fmt.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '{' && chars.peek() == Some(&'}') {
            chars.next(); // consume '}'
            if arg_idx < args.len() {
                result.push_str(&args[arg_idx].as_str_coerce());
                arg_idx += 1;
            }
        } else {
            result.push(ch);
        }
    }
    Ok(ExprValue::Str(result))
}

fn builtin_len(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("len", &args, 1)?;
    let n = match &args[0] {
        ExprValue::Str(s) => s.len() as f64,
        ExprValue::Array(a) => a.len() as f64,
        _ => 0.0,
    };
    Ok(ExprValue::Num(n))
}

fn builtin_upper(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("upper", &args, 1)?;
    Ok(ExprValue::Str(args[0].as_str_coerce().to_uppercase()))
}

fn builtin_lower(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("lower", &args, 1)?;
    Ok(ExprValue::Str(args[0].as_str_coerce().to_lowercase()))
}

fn builtin_str(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("str", &args, 1)?;
    Ok(ExprValue::Str(args[0].as_str_coerce()))
}

fn builtin_num(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("num", &args, 1)?;
    match args[0].as_num() {
        Some(n) => Ok(ExprValue::Num(n)),
        None => Ok(ExprValue::Null),
    }
}

fn builtin_default(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("default", &args, 2)?;
    let mut it = args.into_iter();
    let v = it.next().unwrap();
    let fallback = it.next().unwrap();
    Ok(if v.is_null() { fallback } else { v })
}

// ── Text functions ───────────────────────────────────────────────────────

fn builtin_truncate(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("truncate", &args, 3)?;
    let s = args[0].as_str_coerce();
    let max_len = args[1].as_num().unwrap_or(0.0) as usize;
    let suffix = args[2].as_str_coerce();
    if s.chars().count() <= max_len {
        Ok(ExprValue::Str(s))
    } else {
        let truncated: String = s.chars().take(max_len).collect();
        Ok(ExprValue::Str(format!("{}{}", truncated, suffix)))
    }
}

fn builtin_pad_start(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("pad_start", &args, 3)?;
    let s = args[0].as_str_coerce();
    let target_len = args[1].as_num().unwrap_or(0.0) as usize;
    let pad = args[2].as_str_coerce();
    let char_count = s.chars().count();
    if char_count >= target_len || pad.is_empty() {
        Ok(ExprValue::Str(s))
    } else {
        let needed = target_len - char_count;
        let pad_str: String = pad.chars().cycle().take(needed).collect();
        Ok(ExprValue::Str(format!("{}{}", pad_str, s)))
    }
}

fn builtin_replace(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("replace", &args, 3)?;
    let s = args[0].as_str_coerce();
    let from = args[1].as_str_coerce();
    let to = args[2].as_str_coerce();
    Ok(ExprValue::Str(s.replace(&from, &to)))
}

fn builtin_split(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("split", &args, 2)?;
    let s = args[0].as_str_coerce();
    let delim = args[1].as_str_coerce();
    let parts: Vec<ExprValue> = s.split(&delim).map(|p| ExprValue::Str(p.to_string())).collect();
    Ok(ExprValue::Array(parts))
}

fn builtin_join(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("join", &args, 2)?;
    let sep = args[1].as_str_coerce();
    match &args[0] {
        ExprValue::Array(items) => {
            let parts: Vec<String> = items.iter().map(|v| v.as_str_coerce()).collect();
            Ok(ExprValue::Str(parts.join(&sep)))
        }
        other => Ok(ExprValue::Str(other.as_str_coerce())),
    }
}

fn builtin_trim(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("trim", &args, 1)?;
    Ok(ExprValue::Str(args[0].as_str_coerce().trim().to_string()))
}

fn builtin_substr(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("substr", &args, 3)?;
    let s = args[0].as_str_coerce();
    let start = args[1].as_num().unwrap_or(0.0).max(0.0) as usize;
    let len = args[2].as_num().unwrap_or(0.0).max(0.0) as usize;
    let result: String = s.chars().skip(start).take(len).collect();
    Ok(ExprValue::Str(result))
}

fn builtin_contains(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("contains", &args, 2)?;
    let s = args[0].as_str_coerce();
    let needle = args[1].as_str_coerce();
    Ok(ExprValue::Bool(s.contains(&needle)))
}

fn builtin_starts_with(args: Vec<ExprValue>) -> Result<ExprValue, ExprError> {
    expect_args("starts_with", &args, 2)?;
    let s = args[0].as_str_coerce();
    let prefix = args[1].as_str_coerce();
    Ok(ExprValue::Bool(s.starts_with(&prefix)))
}
