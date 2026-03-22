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
