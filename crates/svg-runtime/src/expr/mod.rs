//! Reactive expression engine for SVG OS data bindings.
//!
//! Parses and evaluates expressions like:
//!   `if($.score > 90, '#gold', '#silver')`
//!   `$.pac * 0.15 + $.sho * 0.25`
//!   `format('{} / {}', $.goals, $.appearances)`
//!
//! Expressions are non-Turing-complete (no loops, no assignment)
//! and have bounded evaluation (depth + step limits).

pub mod ast;
pub mod value;
mod lexer;
mod parser;
mod eval;
mod builtins;

pub use value::ExprValue;

/// A compiled expression ready for repeated evaluation.
#[derive(Debug, Clone)]
pub struct CompiledExpr {
    ast: ast::Expr,
    source: String,
}

/// Context available during expression evaluation.
pub struct EvalContext<'a> {
    /// Root data object. Accessed via `$.field`.
    pub data: &'a serde_json::Value,
    /// The `value` keyword resolves to this (pre-resolved field from FieldMapping).
    pub value: Option<&'a serde_json::Value>,
    /// Row index in batch rendering.
    pub row_index: Option<usize>,
    /// Total rows in batch.
    pub row_count: Option<usize>,
}

/// Expression error with optional source position.
#[derive(Debug, Clone)]
pub struct ExprError {
    pub message: String,
    pub span: Option<(usize, usize)>,
}

impl std::fmt::Display for ExprError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some((start, _end)) = self.span {
            write!(f, "at position {}: {}", start, self.message)
        } else {
            write!(f, "{}", self.message)
        }
    }
}

impl std::error::Error for ExprError {}

impl CompiledExpr {
    /// Parse an expression string.
    pub fn parse(source: &str) -> Result<Self, ExprError> {
        let ast = parser::parse(source)?;
        Ok(Self {
            ast,
            source: source.to_string(),
        })
    }

    /// Evaluate against a context.
    pub fn eval(&self, ctx: &EvalContext) -> Result<ExprValue, ExprError> {
        eval::evaluate(&self.ast, ctx)
    }

    /// Evaluate and convert to string for attribute binding.
    pub fn eval_to_string(&self, ctx: &EvalContext) -> Result<String, ExprError> {
        let val = self.eval(ctx)?;
        Ok(val.to_attr_string())
    }

    /// Get the original source.
    pub fn source(&self) -> &str {
        &self.source
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn eval_expr(expr: &str, data: &serde_json::Value) -> ExprValue {
        let compiled = CompiledExpr::parse(expr).unwrap();
        let ctx = EvalContext { data, value: None, row_index: None, row_count: None };
        compiled.eval(&ctx).unwrap()
    }

    fn eval_str(expr: &str, data: &serde_json::Value) -> String {
        let compiled = CompiledExpr::parse(expr).unwrap();
        let ctx = EvalContext { data, value: None, row_index: None, row_count: None };
        compiled.eval_to_string(&ctx).unwrap()
    }

    fn eval_with_value(expr: &str, data: &serde_json::Value, value: &serde_json::Value) -> String {
        let compiled = CompiledExpr::parse(expr).unwrap();
        let ctx = EvalContext { data, value: Some(value), row_index: None, row_count: None };
        compiled.eval_to_string(&ctx).unwrap()
    }

    // ── Spec examples ────────────────────────────────────────────────

    #[test]
    fn spec_conditional_color() {
        let data = json!({"overall": 95});
        assert_eq!(
            eval_str("if($.overall > 90, '#d4a843', if($.overall > 80, '#c0c0c0', '#cd7f32'))", &data),
            "#d4a843"
        );

        let data = json!({"overall": 85});
        assert_eq!(
            eval_str("if($.overall > 90, '#d4a843', if($.overall > 80, '#c0c0c0', '#cd7f32'))", &data),
            "#c0c0c0"
        );

        let data = json!({"overall": 70});
        assert_eq!(
            eval_str("if($.overall > 90, '#d4a843', if($.overall > 80, '#c0c0c0', '#cd7f32'))", &data),
            "#cd7f32"
        );
    }

    #[test]
    fn spec_weighted_sum() {
        let data = json!({"pac": 90, "sho": 80, "pas": 85, "dri": 88, "def": 40, "phy": 70});
        let result = eval_str(
            "$.pac * 0.15 + $.sho * 0.25 + $.pas * 0.20 + $.dri * 0.20 + $.def * 0.10 + $.phy * 0.10",
            &data,
        );
        // 90*0.15 + 80*0.25 + 85*0.20 + 88*0.20 + 40*0.10 + 70*0.10 = 13.5+20+17+17.6+4+7 = 79.1
        assert_eq!(result, "79.1");
    }

    #[test]
    fn spec_format_string() {
        let data = json!({"goals": 15, "appearances": 32});
        assert_eq!(
            eval_str("format('{} / {}', $.goals, $.appearances)", &data),
            "15 / 32"
        );
    }

    #[test]
    fn spec_clamped_percentage() {
        let data = json!({"stat": 150, "league_avg": 100});
        assert_eq!(eval_str("min($.stat / $.league_avg * 100, 100)", &data), "100");

        let data = json!({"stat": 80, "league_avg": 100});
        assert_eq!(eval_str("min($.stat / $.league_avg * 100, 100)", &data), "80");
    }

    // ── Legacy backward compatibility ────────────────────────────────

    #[test]
    fn legacy_value_multiply() {
        let data = json!({});
        let value = json!(100);
        assert_eq!(eval_with_value("value * 2", &data, &value), "200");
    }

    #[test]
    fn legacy_value_concat() {
        let data = json!({});
        let value = json!(42);
        assert_eq!(eval_with_value("value + 'px'", &data, &value), "42px");
    }

    // ── Operator precedence ──────────────────────────────────────────

    #[test]
    fn precedence_mul_over_add() {
        let data = json!({});
        assert_eq!(eval_str("2 + 3 * 4", &data), "14");
    }

    #[test]
    fn precedence_parens() {
        let data = json!({});
        assert_eq!(eval_str("(2 + 3) * 4", &data), "20");
    }

    // ── Short-circuit ────────────────────────────────────────────────

    #[test]
    fn short_circuit_or() {
        let data = json!({});
        // true || anything should not eval the right side
        assert_eq!(eval_str("true || false", &data), "true");
    }

    #[test]
    fn short_circuit_and() {
        let data = json!({});
        assert_eq!(eval_str("false && true", &data), "false");
    }

    // ── Null propagation ─────────────────────────────────────────────

    #[test]
    fn null_field_access() {
        let data = json!({"a": 1});
        match eval_expr("$.missing", &data) {
            ExprValue::Null => {}
            other => panic!("Expected Null, got {:?}", other),
        }
    }

    #[test]
    fn null_arithmetic() {
        let data = json!({});
        // null (0) + 1 = 1 (null coerces to 0 for arithmetic)
        assert_eq!(eval_str("$.missing + 1", &data), "1");
    }

    // ── Type coercion ────────────────────────────────────────────────

    #[test]
    fn string_plus_number() {
        let data = json!({});
        assert_eq!(eval_str("'hello' + 42", &data), "hello42");
    }

    #[test]
    fn num_function() {
        let data = json!({});
        assert_eq!(eval_str("num('42')", &data), "42");
    }

    // ── Ternary ──────────────────────────────────────────────────────

    #[test]
    fn ternary_true() {
        let data = json!({});
        assert_eq!(eval_str("true ? 'yes' : 'no'", &data), "yes");
    }

    #[test]
    fn ternary_false() {
        let data = json!({});
        assert_eq!(eval_str("false ? 'yes' : 'no'", &data), "no");
    }

    // ── Built-in functions ───────────────────────────────────────────

    #[test]
    fn builtin_min_max() {
        let data = json!({});
        assert_eq!(eval_str("min(10, 20)", &data), "10");
        assert_eq!(eval_str("max(10, 20)", &data), "20");
    }

    #[test]
    fn builtin_abs() {
        let data = json!({});
        assert_eq!(eval_str("abs(-42)", &data), "42");
    }

    #[test]
    fn builtin_round_floor_ceil() {
        let data = json!({});
        assert_eq!(eval_str("round(3.7)", &data), "4");
        assert_eq!(eval_str("floor(3.7)", &data), "3");
        assert_eq!(eval_str("ceil(3.2)", &data), "4");
    }

    #[test]
    fn builtin_clamp() {
        let data = json!({});
        assert_eq!(eval_str("clamp(150, 0, 100)", &data), "100");
        assert_eq!(eval_str("clamp(-5, 0, 100)", &data), "0");
        assert_eq!(eval_str("clamp(50, 0, 100)", &data), "50");
    }

    #[test]
    fn builtin_len() {
        let data = json!({"items": [1, 2, 3]});
        assert_eq!(eval_str("len('hello')", &data), "5");
        assert_eq!(eval_str("len($.items)", &data), "3");
    }

    #[test]
    fn builtin_upper_lower() {
        let data = json!({});
        assert_eq!(eval_str("upper('hello')", &data), "HELLO");
        assert_eq!(eval_str("lower('WORLD')", &data), "world");
    }

    #[test]
    fn builtin_default() {
        let data = json!({"a": 42});
        assert_eq!(eval_str("default($.a, 0)", &data), "42");
        assert_eq!(eval_str("default($.missing, 0)", &data), "0");
    }

    // ── Comparison ───────────────────────────────────────────────────

    #[test]
    fn comparison_operators() {
        let data = json!({});
        assert_eq!(eval_str("5 == 5", &data), "true");
        assert_eq!(eval_str("5 != 3", &data), "true");
        assert_eq!(eval_str("5 > 3", &data), "true");
        assert_eq!(eval_str("5 >= 5", &data), "true");
        assert_eq!(eval_str("3 < 5", &data), "true");
        assert_eq!(eval_str("5 <= 5", &data), "true");
    }

    // ── Nested field access ──────────────────────────────────────────

    #[test]
    fn nested_field() {
        let data = json!({"player": {"stats": {"xg": 0.85}}});
        assert_eq!(eval_str("$.player.stats.xg", &data), "0.85");
    }

    // ── Unary operators ──────────────────────────────────────────────

    #[test]
    fn unary_neg() {
        let data = json!({});
        assert_eq!(eval_str("-5 + 3", &data), "-2");
    }

    #[test]
    fn unary_not() {
        let data = json!({});
        assert_eq!(eval_str("!true", &data), "false");
        assert_eq!(eval_str("!false", &data), "true");
    }

    // ── Division by zero ─────────────────────────────────────────────

    #[test]
    fn division_by_zero() {
        let data = json!({});
        let result = eval_str("10 / 0", &data);
        assert_eq!(result, "NaN");
    }

    // ── Modulo ───────────────────────────────────────────────────────

    #[test]
    fn modulo() {
        let data = json!({});
        assert_eq!(eval_str("10 % 3", &data), "1");
    }

    // ── Safety bounds ────────────────────────────────────────────────

    #[test]
    fn parse_error() {
        assert!(CompiledExpr::parse("1 +").is_err());
        assert!(CompiledExpr::parse("").is_err());
        assert!(CompiledExpr::parse("'unterminated").is_err());
    }

    #[test]
    fn unknown_function() {
        let data = json!({});
        let compiled = CompiledExpr::parse("bogus(1)").unwrap();
        let ctx = EvalContext { data: &data, value: None, row_index: None, row_count: None };
        assert!(compiled.eval(&ctx).is_err());
    }

    // ── Complex expressions ──────────────────────────────────────────

    #[test]
    fn complex_conditional_chain() {
        let data = json!({"pos": "GK"});
        let expr = "if($.pos == 'GK', '#1a1a2e', if($.pos == 'CB', '#16213e', '#0f3460'))";
        assert_eq!(eval_str(expr, &data), "#1a1a2e");

        let data = json!({"pos": "CB"});
        assert_eq!(eval_str(expr, &data), "#16213e");

        let data = json!({"pos": "ST"});
        assert_eq!(eval_str(expr, &data), "#0f3460");
    }

    #[test]
    fn string_equality() {
        let data = json!({"name": "Alice"});
        assert_eq!(eval_str("$.name == 'Alice'", &data), "true");
        assert_eq!(eval_str("$.name == 'Bob'", &data), "false");
    }

    #[test]
    fn boolean_logic() {
        let data = json!({"a": true, "b": false});
        assert_eq!(eval_str("$.a && !$.b", &data), "true");
        assert_eq!(eval_str("$.a || $.b", &data), "true");
        assert_eq!(eval_str("!$.a || $.b", &data), "false");
    }

    // ── Text functions ───────────────────────────────────────────────

    #[test]
    fn builtin_truncate() {
        let data = json!({});
        assert_eq!(eval_str("truncate('Hello World', 5, '...')", &data), "Hello...");
        assert_eq!(eval_str("truncate('Hi', 10, '...')", &data), "Hi");
    }

    #[test]
    fn builtin_pad_start() {
        let data = json!({});
        assert_eq!(eval_str("pad_start('42', 5, '0')", &data), "00042");
        assert_eq!(eval_str("pad_start('hello', 3, '0')", &data), "hello");
    }

    #[test]
    fn builtin_replace() {
        let data = json!({});
        assert_eq!(eval_str("replace('foo_bar_baz', '_', ' ')", &data), "foo bar baz");
    }

    #[test]
    fn builtin_split_join() {
        let data = json!({});
        assert_eq!(eval_str("len(split('a,b,c', ','))", &data), "3");
        assert_eq!(eval_str("join(split('a,b,c', ','), ' ')", &data), "a b c");
    }

    #[test]
    fn builtin_trim() {
        let data = json!({});
        assert_eq!(eval_str("trim('  hello  ')", &data), "hello");
    }

    #[test]
    fn builtin_substr() {
        let data = json!({});
        assert_eq!(eval_str("substr('Hello', 1, 3)", &data), "ell");
        assert_eq!(eval_str("substr('Hi', 0, 10)", &data), "Hi");
    }

    #[test]
    fn builtin_contains() {
        let data = json!({});
        assert_eq!(eval_str("contains('Hello World', 'World')", &data), "true");
        assert_eq!(eval_str("contains('Hello', 'xyz')", &data), "false");
    }

    #[test]
    fn builtin_starts_with() {
        let data = json!({});
        assert_eq!(eval_str("starts_with('Hello', 'Hel')", &data), "true");
        assert_eq!(eval_str("starts_with('Hello', 'xyz')", &data), "false");
    }

    // ── Context functions ────────────────────────────────────────────

    #[test]
    fn context_row_index() {
        let data = json!({});
        let compiled = CompiledExpr::parse("row_index()").unwrap();
        let ctx = EvalContext { data: &data, value: None, row_index: Some(5), row_count: Some(10) };
        assert_eq!(compiled.eval_to_string(&ctx).unwrap(), "5");
    }

    #[test]
    fn context_row_count() {
        let data = json!({});
        let compiled = CompiledExpr::parse("row_count()").unwrap();
        let ctx = EvalContext { data: &data, value: None, row_index: Some(5), row_count: Some(10) };
        assert_eq!(compiled.eval_to_string(&ctx).unwrap(), "10");
    }

    #[test]
    fn alternating_row_color() {
        let data = json!({});
        let compiled = CompiledExpr::parse("if(row_index() % 2 == 0, '#f8f8f8', '#ffffff')").unwrap();

        let ctx0 = EvalContext { data: &data, value: None, row_index: Some(0), row_count: Some(4) };
        assert_eq!(compiled.eval_to_string(&ctx0).unwrap(), "#f8f8f8");

        let ctx1 = EvalContext { data: &data, value: None, row_index: Some(1), row_count: Some(4) };
        assert_eq!(compiled.eval_to_string(&ctx1).unwrap(), "#ffffff");

        let ctx2 = EvalContext { data: &data, value: None, row_index: Some(2), row_count: Some(4) };
        assert_eq!(compiled.eval_to_string(&ctx2).unwrap(), "#f8f8f8");
    }
}
