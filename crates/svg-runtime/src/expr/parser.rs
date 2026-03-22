//! Pratt parser: tokens → Expr AST.

use super::ast::{Expr, BinOp, UnaryOp};
use super::lexer::{Token, Spanned, lex};
use super::ExprError;

pub fn parse(input: &str) -> Result<Expr, ExprError> {
    let tokens = lex(input)?;
    let mut parser = Parser { tokens, pos: 0, source: input };
    let expr = parser.parse_expr(0)?;
    if !parser.at_eof() {
        let offset = parser.current_offset();
        return Err(ExprError {
            message: format!("Unexpected token after expression"),
            span: Some((offset, offset + 1)),
        });
    }
    Ok(expr)
}

struct Parser<'a> {
    tokens: Vec<Spanned>,
    pos: usize,
    source: &'a str,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> &Token {
        &self.tokens[self.pos].token
    }

    fn advance(&mut self) -> &Spanned {
        let t = &self.tokens[self.pos];
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        t
    }

    fn at_eof(&self) -> bool {
        matches!(self.peek(), Token::Eof)
    }

    fn current_offset(&self) -> usize {
        self.tokens[self.pos].offset
    }

    fn expect(&mut self, expected: &Token) -> Result<(), ExprError> {
        if self.peek() == expected {
            self.advance();
            Ok(())
        } else {
            let offset = self.current_offset();
            Err(ExprError {
                message: format!("Expected {:?}, got {:?}", expected, self.peek()),
                span: Some((offset, offset + 1)),
            })
        }
    }

    /// Parse an expression with minimum binding power.
    fn parse_expr(&mut self, min_bp: u8) -> Result<Expr, ExprError> {
        let mut lhs = self.parse_prefix()?;

        loop {
            // Check for ternary
            if min_bp <= 1 && matches!(self.peek(), Token::Question) {
                self.advance();
                let then_expr = self.parse_expr(0)?;
                self.expect(&Token::Colon)?;
                let else_expr = self.parse_expr(0)?;
                lhs = Expr::Ternary {
                    cond: Box::new(lhs),
                    then_expr: Box::new(then_expr),
                    else_expr: Box::new(else_expr),
                };
                continue;
            }

            let (op, bp) = match self.peek() {
                Token::PipePipe => (BinOp::Or, 2),
                Token::AmpAmp => (BinOp::And, 3),
                Token::EqEq => (BinOp::Eq, 4),
                Token::BangEq => (BinOp::Ne, 4),
                Token::Gt => (BinOp::Gt, 5),
                Token::GtEq => (BinOp::Ge, 5),
                Token::Lt => (BinOp::Lt, 5),
                Token::LtEq => (BinOp::Le, 5),
                Token::Plus => (BinOp::Add, 6),
                Token::Minus => (BinOp::Sub, 6),
                Token::Star => (BinOp::Mul, 7),
                Token::Slash => (BinOp::Div, 7),
                Token::Percent => (BinOp::Mod, 7),
                _ => break,
            };

            if bp <= min_bp {
                break;
            }

            self.advance();
            let rhs = self.parse_expr(bp)?;
            lhs = Expr::BinOp {
                op,
                left: Box::new(lhs),
                right: Box::new(rhs),
            };
        }

        Ok(lhs)
    }

    /// Parse a prefix expression (atom, unary, function call).
    fn parse_prefix(&mut self) -> Result<Expr, ExprError> {
        match self.peek().clone() {
            Token::Num(n) => {
                self.advance();
                Ok(Expr::Num(n))
            }
            Token::Str(s) => {
                let s = s.clone();
                self.advance();
                Ok(Expr::Str(s))
            }
            Token::Ident(ref name) => {
                let name = name.clone();
                self.advance();
                match name.as_str() {
                    "true" => Ok(Expr::Bool(true)),
                    "false" => Ok(Expr::Bool(false)),
                    "null" => Ok(Expr::Null),
                    "value" => Ok(Expr::Value),
                    _ => {
                        // Function call?
                        if matches!(self.peek(), Token::LParen) {
                            self.advance(); // consume (
                            let mut args = Vec::new();
                            if !matches!(self.peek(), Token::RParen) {
                                args.push(self.parse_expr(0)?);
                                while matches!(self.peek(), Token::Comma) {
                                    self.advance();
                                    args.push(self.parse_expr(0)?);
                                }
                            }
                            self.expect(&Token::RParen)?;
                            Ok(Expr::Call { name, args })
                        } else {
                            // Bare identifier — treat as field reference without $
                            // This allows `name` as shorthand for `$.name`
                            Ok(Expr::Field(vec![name]))
                        }
                    }
                }
            }
            Token::Dollar => {
                self.advance();
                let mut path = Vec::new();
                while matches!(self.peek(), Token::Dot) {
                    self.advance(); // consume .
                    match self.peek().clone() {
                        Token::Ident(name) => {
                            let name = name.clone();
                            self.advance();
                            path.push(name);
                        }
                        Token::Num(n) => {
                            // Array index: $.items.0
                            self.advance();
                            path.push(format!("{}", n as u64));
                        }
                        _ => {
                            let offset = self.current_offset();
                            return Err(ExprError {
                                message: "Expected field name after '.'".into(),
                                span: Some((offset, offset + 1)),
                            });
                        }
                    }
                }
                Ok(Expr::Field(path))
            }
            Token::Bang => {
                self.advance();
                let operand = self.parse_prefix()?;
                Ok(Expr::UnaryOp {
                    op: UnaryOp::Not,
                    operand: Box::new(operand),
                })
            }
            Token::Minus => {
                self.advance();
                let operand = self.parse_prefix()?;
                Ok(Expr::UnaryOp {
                    op: UnaryOp::Neg,
                    operand: Box::new(operand),
                })
            }
            Token::LParen => {
                self.advance();
                let expr = self.parse_expr(0)?;
                self.expect(&Token::RParen)?;
                Ok(expr)
            }
            _ => {
                let offset = self.current_offset();
                Err(ExprError {
                    message: format!("Unexpected token: {:?}", self.peek()),
                    span: Some((offset, offset + 1)),
                })
            }
        }
    }
}
