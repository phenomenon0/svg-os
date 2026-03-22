//! Single-pass lexer for expressions.

use super::ExprError;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Num(f64),
    Str(String),
    Ident(String),
    Dollar,
    Dot,
    LParen,
    RParen,
    Comma,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    EqEq,
    BangEq,
    Gt,
    GtEq,
    Lt,
    LtEq,
    AmpAmp,
    PipePipe,
    Bang,
    Question,
    Colon,
    Eof,
}

/// A token with its byte offset in the source.
#[derive(Debug, Clone)]
pub struct Spanned {
    pub token: Token,
    pub offset: usize,
}

/// Tokenize an expression string.
pub fn lex(input: &str) -> Result<Vec<Spanned>, ExprError> {
    let mut tokens = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Skip whitespace
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }

        let offset = i;

        match bytes[i] {
            b'$' => { tokens.push(Spanned { token: Token::Dollar, offset }); i += 1; }
            b'.' => { tokens.push(Spanned { token: Token::Dot, offset }); i += 1; }
            b'(' => { tokens.push(Spanned { token: Token::LParen, offset }); i += 1; }
            b')' => { tokens.push(Spanned { token: Token::RParen, offset }); i += 1; }
            b',' => { tokens.push(Spanned { token: Token::Comma, offset }); i += 1; }
            b'+' => { tokens.push(Spanned { token: Token::Plus, offset }); i += 1; }
            b'-' => { tokens.push(Spanned { token: Token::Minus, offset }); i += 1; }
            b'*' => { tokens.push(Spanned { token: Token::Star, offset }); i += 1; }
            b'/' => { tokens.push(Spanned { token: Token::Slash, offset }); i += 1; }
            b'%' => { tokens.push(Spanned { token: Token::Percent, offset }); i += 1; }
            b'?' => { tokens.push(Spanned { token: Token::Question, offset }); i += 1; }
            b':' => { tokens.push(Spanned { token: Token::Colon, offset }); i += 1; }

            b'=' if i + 1 < bytes.len() && bytes[i + 1] == b'=' => {
                tokens.push(Spanned { token: Token::EqEq, offset }); i += 2;
            }
            b'!' if i + 1 < bytes.len() && bytes[i + 1] == b'=' => {
                tokens.push(Spanned { token: Token::BangEq, offset }); i += 2;
            }
            b'!' => { tokens.push(Spanned { token: Token::Bang, offset }); i += 1; }
            b'>' if i + 1 < bytes.len() && bytes[i + 1] == b'=' => {
                tokens.push(Spanned { token: Token::GtEq, offset }); i += 2;
            }
            b'>' => { tokens.push(Spanned { token: Token::Gt, offset }); i += 1; }
            b'<' if i + 1 < bytes.len() && bytes[i + 1] == b'=' => {
                tokens.push(Spanned { token: Token::LtEq, offset }); i += 2;
            }
            b'<' => { tokens.push(Spanned { token: Token::Lt, offset }); i += 1; }
            b'&' if i + 1 < bytes.len() && bytes[i + 1] == b'&' => {
                tokens.push(Spanned { token: Token::AmpAmp, offset }); i += 2;
            }
            b'|' if i + 1 < bytes.len() && bytes[i + 1] == b'|' => {
                tokens.push(Spanned { token: Token::PipePipe, offset }); i += 2;
            }

            // String literal (single-quoted)
            b'\'' => {
                i += 1;
                let start = i;
                while i < bytes.len() && bytes[i] != b'\'' {
                    i += 1;
                }
                if i >= bytes.len() {
                    return Err(ExprError {
                        message: "Unterminated string literal".into(),
                        span: Some((offset, i)),
                    });
                }
                let s = String::from_utf8_lossy(&bytes[start..i]).into_owned();
                tokens.push(Spanned { token: Token::Str(s), offset });
                i += 1; // skip closing quote
            }

            // Number
            b'0'..=b'9' => {
                let start = i;
                while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                    i += 1;
                }
                let s = &input[start..i];
                let n: f64 = s.parse().map_err(|_| ExprError {
                    message: format!("Invalid number: {}", s),
                    span: Some((start, i)),
                })?;
                tokens.push(Spanned { token: Token::Num(n), offset });
            }

            // Identifier or keyword
            b'a'..=b'z' | b'A'..=b'Z' | b'_' => {
                let start = i;
                while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                    i += 1;
                }
                let s = &input[start..i];
                tokens.push(Spanned { token: Token::Ident(s.to_string()), offset });
            }

            ch => {
                return Err(ExprError {
                    message: format!("Unexpected character: '{}'", ch as char),
                    span: Some((offset, offset + 1)),
                });
            }
        }
    }

    tokens.push(Spanned { token: Token::Eof, offset: input.len() });
    Ok(tokens)
}
