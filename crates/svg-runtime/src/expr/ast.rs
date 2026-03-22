//! Expression AST types.

/// A parsed expression node.
#[derive(Debug, Clone)]
pub enum Expr {
    /// Numeric literal: 42, 3.14
    Num(f64),
    /// String literal: 'hello'
    Str(String),
    /// Boolean literal
    Bool(bool),
    /// Null literal
    Null,
    /// Field reference: $.stats.score → ["stats", "score"]
    /// Empty vec means bare `$` (the root data object).
    Field(Vec<String>),
    /// The `value` keyword (pre-resolved field from FieldMapping).
    Value,
    /// Binary operation.
    BinOp {
        op: BinOp,
        left: Box<Expr>,
        right: Box<Expr>,
    },
    /// Unary operation.
    UnaryOp {
        op: UnaryOp,
        operand: Box<Expr>,
    },
    /// Ternary: cond ? then : else
    Ternary {
        cond: Box<Expr>,
        then_expr: Box<Expr>,
        else_expr: Box<Expr>,
    },
    /// Function call: name(arg1, arg2, ...)
    Call {
        name: String,
        args: Vec<Expr>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
    And,
    Or,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UnaryOp {
    Not,
    Neg,
}
