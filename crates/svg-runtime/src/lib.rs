//! svg-runtime: Data binding engine, themes, and template automation.
//!
//! The "brain" of SVG OS — binds external data to document nodes,
//! applies themes, runs batch operations like template instantiation.

mod binding;
mod theme;
pub mod template;
pub mod diagram;
pub mod expr;

pub use binding::{DataSource, FieldMapping, Binding, BindingEngine};
pub use theme::Theme;
pub use template::instantiate_template;
pub use diagram::{generate_diagram, DiagramResult};
pub use expr::{CompiledExpr, EvalContext, ExprError, ExprValue};
