//! Hyphenation support using TeX patterns.
//!
//! Feature-gated behind `hyphenation` feature (default on).
//! Falls back to empty break list when feature is disabled.

/// Find hyphenation break points in a word.
/// Returns character indices where the word can be split (a hyphen would be inserted).
pub fn find_hyphen_breaks(word: &str, _lang: &str) -> Vec<usize> {
    #[cfg(feature = "hyphenation")]
    {
        use hyphenation::{Hyphenator, Language, Load, Standard};

        let language = match _lang {
            "en" | "en-US" | "en-GB" | "" => Language::EnglishUS,
            _ => return vec![], // Only English embedded by default
        };

        match Standard::from_embedded(language) {
            Ok(dict) => {
                let hyphenated = dict.hyphenate(word);
                hyphenated.breaks.iter().copied().collect()
            }
            Err(_) => vec![],
        }
    }

    #[cfg(not(feature = "hyphenation"))]
    {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(feature = "hyphenation")]
    fn hyphenate_english_word() {
        let breaks = find_hyphen_breaks("internationalization", "en-US");
        // Should have multiple break points
        assert!(!breaks.is_empty(), "Expected hyphenation breaks for 'internationalization'");
        // All break points should be within word length
        for b in &breaks {
            assert!(*b > 0 && *b < "internationalization".len());
        }
    }

    #[test]
    fn unknown_language_returns_empty() {
        let breaks = find_hyphen_breaks("hello", "xx-XX");
        assert!(breaks.is_empty());
    }
}
