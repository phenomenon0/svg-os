//! Tree-walk evaluator with safety bounds.

use super::ast::{Expr, BinOp, UnaryOp};
use super::value::ExprValue;
use super::builtins::call_builtin;
use super::{EvalContext, ExprError};

/// Maximum recursion depth.
const MAX_DEPTH: usize = 64;
/// Maximum evaluation steps.
const MAX_STEPS: usize = 10_000;

pub fn evaluate(expr: &Expr, ctx: &EvalContext) -> Result<ExprValue, ExprError> {
    let mut evaluator = Evaluator { ctx, depth: 0, steps: 0 };
    evaluator.eval(expr)
}

struct Evaluator<'a> {
    ctx: &'a EvalContext<'a>,
    depth: usize,
    steps: usize,
}

impl<'a> Evaluator<'a> {
    fn eval(&mut self, expr: &Expr) -> Result<ExprValue, ExprError> {
        self.steps += 1;
        if self.steps > MAX_STEPS {
            return Err(ExprError {
                message: "Expression exceeded step limit".into(),
                span: None,
            });
        }
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            self.depth -= 1;
            return Err(ExprError {
                message: "Expression too deeply nested".into(),
                span: None,
            });
        }
        let result = self.eval_inner(expr);
        self.depth -= 1;
        result
    }

    fn eval_inner(&mut self, expr: &Expr) -> Result<ExprValue, ExprError> {
        match expr {
            Expr::Num(n) => Ok(ExprValue::Num(*n)),
            Expr::Str(s) => Ok(ExprValue::Str(s.clone())),
            Expr::Bool(b) => Ok(ExprValue::Bool(*b)),
            Expr::Null => Ok(ExprValue::Null),

            Expr::Value => match self.ctx.value {
                Some(v) => Ok(ExprValue::from_json(v)),
                None => Ok(ExprValue::Null),
            },

            Expr::Field(path) => self.resolve_field(path),

            Expr::BinOp { op, left, right } => {
                // Short-circuit for && and ||
                if *op == BinOp::And {
                    let l = self.eval(left)?;
                    if !l.is_truthy() { return Ok(l); }
                    return self.eval(right);
                }
                if *op == BinOp::Or {
                    let l = self.eval(left)?;
                    if l.is_truthy() { return Ok(l); }
                    return self.eval(right);
                }

                let l = self.eval(left)?;
                let r = self.eval(right)?;
                self.eval_binop(*op, l, r)
            }

            Expr::UnaryOp { op, operand } => {
                let val = self.eval(operand)?;
                match op {
                    UnaryOp::Not => Ok(ExprValue::Bool(!val.is_truthy())),
                    UnaryOp::Neg => match val.as_num() {
                        Some(n) => Ok(ExprValue::Num(-n)),
                        None => Ok(ExprValue::Null),
                    },
                }
            }

            Expr::Ternary { cond, then_expr, else_expr } => {
                let c = self.eval(cond)?;
                if c.is_truthy() {
                    self.eval(then_expr)
                } else {
                    self.eval(else_expr)
                }
            }

            Expr::Call { name, args } => {
                // Context functions — zero-arg, read from ctx
                if name == "row_index" && args.is_empty() {
                    return Ok(ExprValue::Num(self.ctx.row_index.unwrap_or(0) as f64));
                }
                if name == "row_count" && args.is_empty() {
                    return Ok(ExprValue::Num(self.ctx.row_count.unwrap_or(0) as f64));
                }

                // Special case: if() is lazy — only evaluate the branch taken
                if name == "if" && args.len() == 3 {
                    let cond = self.eval(&args[0])?;
                    return if cond.is_truthy() {
                        self.eval(&args[1])
                    } else {
                        self.eval(&args[2])
                    };
                }

                let evaluated: Vec<ExprValue> = args
                    .iter()
                    .map(|a| self.eval(a))
                    .collect::<Result<_, _>>()?;
                call_builtin(name, evaluated)
            }
        }
    }

    fn resolve_field(&self, path: &[String]) -> Result<ExprValue, ExprError> {
        let mut current = self.ctx.data;
        for segment in path {
            match current {
                serde_json::Value::Object(map) => {
                    match map.get(segment.as_str()) {
                        Some(v) => current = v,
                        None => return Ok(ExprValue::Null),
                    }
                }
                serde_json::Value::Array(arr) => {
                    match segment.parse::<usize>() {
                        Ok(idx) => match arr.get(idx) {
                            Some(v) => current = v,
                            None => return Ok(ExprValue::Null),
                        },
                        Err(_) => return Ok(ExprValue::Null),
                    }
                }
                _ => return Ok(ExprValue::Null),
            }
        }
        Ok(ExprValue::from_json(current))
    }

    fn eval_binop(&self, op: BinOp, l: ExprValue, r: ExprValue) -> Result<ExprValue, ExprError> {
        match op {
            // Addition: string + anything = concat, number + number = add
            BinOp::Add => {
                if l.is_string() || r.is_string() {
                    Ok(ExprValue::Str(format!(
                        "{}{}",
                        l.as_str_coerce(),
                        r.as_str_coerce()
                    )))
                } else {
                    match (l.as_num(), r.as_num()) {
                        (Some(a), Some(b)) => Ok(ExprValue::Num(a + b)),
                        _ => Ok(ExprValue::Null),
                    }
                }
            }

            BinOp::Sub => num_op(l, r, |a, b| a - b),
            BinOp::Mul => num_op(l, r, |a, b| a * b),
            BinOp::Div => num_op(l, r, |a, b| if b != 0.0 { a / b } else { f64::NAN }),
            BinOp::Mod => num_op(l, r, |a, b| if b != 0.0 { a % b } else { f64::NAN }),

            // Comparison
            BinOp::Eq => Ok(ExprValue::Bool(l == r)),
            BinOp::Ne => Ok(ExprValue::Bool(l != r)),
            BinOp::Gt => cmp_op(l, r, |ord| ord == std::cmp::Ordering::Greater),
            BinOp::Ge => cmp_op(l, r, |ord| ord != std::cmp::Ordering::Less),
            BinOp::Lt => cmp_op(l, r, |ord| ord == std::cmp::Ordering::Less),
            BinOp::Le => cmp_op(l, r, |ord| ord != std::cmp::Ordering::Greater),

            // Logical (non-short-circuit path — shouldn't reach here)
            BinOp::And => Ok(if l.is_truthy() { r } else { l }),
            BinOp::Or => Ok(if l.is_truthy() { l } else { r }),
        }
    }
}

fn num_op(l: ExprValue, r: ExprValue, f: impl Fn(f64, f64) -> f64) -> Result<ExprValue, ExprError> {
    match (l.as_num(), r.as_num()) {
        (Some(a), Some(b)) => Ok(ExprValue::Num(f(a, b))),
        _ => Ok(ExprValue::Null),
    }
}

fn cmp_op(l: ExprValue, r: ExprValue, check: impl Fn(std::cmp::Ordering) -> bool) -> Result<ExprValue, ExprError> {
    // Try numeric comparison first
    if let (Some(a), Some(b)) = (l.as_num(), r.as_num()) {
        let ord = a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal);
        return Ok(ExprValue::Bool(check(ord)));
    }
    // Fall back to string comparison
    let a = l.as_str_coerce();
    let b = r.as_str_coerce();
    Ok(ExprValue::Bool(check(a.cmp(&b))))
}
