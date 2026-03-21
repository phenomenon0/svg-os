//! svg-runtime: Data binding engine, themes, and template automation.
//!
//! The "brain" of SVG OS — binds external data to document nodes,
//! applies themes, runs batch operations like template instantiation.

mod binding;
mod theme;
pub mod template;

pub use binding::{DataSource, FieldMapping, Binding, BindingEngine};
pub use theme::Theme;
pub use template::instantiate_template;
