//! Integration tests for SVG OS.
//!
//! These tests exercise the full pipeline: parse SVG → manipulate document →
//! serialize SVG → verify output.

use svg_doc::*;
use svg_render::DiffEngine;
use svg_layout::{ConstraintStore, Constraint, Anchor};
use svg_runtime::{BindingEngine, Binding, DataSource, FieldMapping, Theme};
use forge_math::Rect;

#[test]
fn round_trip_fixture_svg() {
    let svg = include_str!("../../../fixtures/test-basic.svg");
    let doc = doc_from_svg_string(svg).unwrap();

    // Should have: svg, defs, linearGradient, 2 stops, rect, circle, g, rect, text, path = 11
    assert!(doc.node_count() >= 10, "Expected at least 10 nodes, got {}", doc.node_count());

    // Re-serialize
    let output = doc_to_svg_string(&doc);
    assert!(output.contains("<rect"));
    assert!(output.contains("<circle"));
    assert!(output.contains("<path"));
    assert!(output.contains("linearGradient"));

    // Round-trip: re-parse and verify same node count
    let doc2 = doc_from_svg_string(&output).unwrap();
    assert_eq!(doc.node_count(), doc2.node_count());
}

#[test]
fn diff_engine_produces_ops() {
    let mut doc = Document::new();
    let mut engine = DiffEngine::new();

    // Full render should create svg + defs
    let ops = engine.full_render(&doc);
    assert!(ops.len() >= 2);

    // Add a rect
    let root = doc.root;
    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::X, AttrValue::F32(10.0));
    rect.set_attr(AttrKey::Width, AttrValue::F32(100.0));
    doc.insert_node(root, 1, rect);

    // Diff should detect the new rect
    let diff_ops = engine.diff(&mut doc);
    assert!(!diff_ops.is_empty());
}

#[test]
fn undo_redo_integrity() {
    let mut doc = Document::new();
    let root = doc.root;

    // Insert a rect via command
    let node = Node::new(SvgTag::Rect);
    let rect_id = node.id;
    let cmd = SvgCommand::InsertNode {
        node,
        parent: root,
        index: 1,
    };

    let undo_cmd = cmd.execute(&mut doc).unwrap();
    assert_eq!(doc.node_count(), 3); // svg + defs + rect

    // Set an attr
    let set_cmd = SvgCommand::SetAttr {
        id: rect_id,
        key: AttrKey::Fill,
        value: AttrValue::Str("#ff0000".to_string()),
        old_value: None,
    };
    let undo_set = set_cmd.execute(&mut doc).unwrap();

    // Undo the set
    undo_set.execute(&mut doc).unwrap();
    assert!(doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill).is_none());

    // Undo the insert
    undo_cmd.execute(&mut doc).unwrap();
    assert_eq!(doc.node_count(), 2); // svg + defs
}

#[test]
fn constraint_solver_pin() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut r1 = Node::new(SvgTag::Rect);
    r1.set_attr(AttrKey::X, AttrValue::F32(50.0));
    r1.set_attr(AttrKey::Y, AttrValue::F32(50.0));
    r1.set_attr(AttrKey::Width, AttrValue::F32(100.0));
    r1.set_attr(AttrKey::Height, AttrValue::F32(60.0));
    let r1_id = r1.id;
    doc.insert_node(root, 1, r1);

    let mut r2 = Node::new(SvgTag::Rect);
    r2.set_attr(AttrKey::Width, AttrValue::F32(80.0));
    r2.set_attr(AttrKey::Height, AttrValue::F32(40.0));
    let r2_id = r2.id;
    doc.insert_node(root, 2, r2);

    let mut store = ConstraintStore::new();
    store.add(Constraint::Pin {
        node: r2_id,
        to: r1_id,
        anchor: Anchor::TopLeft,
        target_anchor: Anchor::BottomCenter,
        offset: (0.0, 10.0),
    });

    store.solve(&mut doc, Rect::new(0.0, 0.0, 800.0, 600.0), None);

    // r1 bottom center = (50 + 50, 50 + 60) = (100, 110)
    // r2 top left should be at (100, 110 + 10) = (100, 120)
    let r2_x = doc.get(r2_id).unwrap().get_f32(&AttrKey::X);
    let r2_y = doc.get(r2_id).unwrap().get_f32(&AttrKey::Y);
    assert!((r2_x - 100.0).abs() < 0.01, "Expected x=100, got {}", r2_x);
    assert!((r2_y - 120.0).abs() < 0.01, "Expected y=120, got {}", r2_y);
}

#[test]
fn data_binding_evaluation() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::Width, AttrValue::F32(50.0));
    let rect_id = rect.id;
    doc.insert_node(root, 1, rect);

    let mut engine = BindingEngine::new();
    engine.bind(Binding {
        source: DataSource::Static {
            value: serde_json::json!({ "w": 200, "color": "#ff0000" }),
        },
        target: rect_id,
        mappings: vec![
            FieldMapping {
                field: "w".to_string(),
                attr: "width".to_string(),
                transform: None,
                expr: None,
            },
            FieldMapping {
                field: "color".to_string(),
                attr: "fill".to_string(),
                transform: None,
                expr: None,
            },
        ],
        fallback: None,
    });

    engine.evaluate(&mut doc, &serde_json::json!({}));

    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Width), 200.0);
}

#[test]
fn theme_application() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::Fill, AttrValue::Str("{{color.primary}}".to_string()));
    let rect_id = rect.id;
    doc.insert_node(root, 1, rect);

    let theme_json = include_str!("../../../fixtures/test-theme.json");
    let theme = Theme::from_json(theme_json).unwrap();
    theme.apply(&mut doc);

    // Fill should now be #818cf8
    let fill = doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill);
    match fill {
        Some(AttrValue::Color(c)) => {
            let bytes = c.to_u8();
            assert_eq!(bytes[0], 0x81);
        }
        Some(AttrValue::Str(s)) => {
            assert_eq!(s, "#818cf8");
        }
        other => panic!("Expected color, got {:?}", other),
    }
}

#[test]
fn template_repeat_with_data() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut tmpl = Node::new(SvgTag::Rect);
    tmpl.set_attr(AttrKey::X, AttrValue::F32(0.0));
    tmpl.set_attr(AttrKey::Y, AttrValue::F32(0.0));
    tmpl.set_attr(AttrKey::Width, AttrValue::F32(80.0));
    tmpl.set_attr(AttrKey::Height, AttrValue::F32(40.0));
    let tmpl_id = tmpl.id;
    doc.insert_node(root, 1, tmpl);

    let rows: Vec<serde_json::Value> = serde_json::from_str(include_str!("../../../fixtures/test-data.json")).unwrap();
    let created = svg_runtime::template::repeat_template(&mut doc, tmpl_id, &rows, 2, (10.0, 10.0));

    assert_eq!(created.len(), 4);

    // Verify grid positioning
    let c1 = doc.get(created[1]).unwrap();
    assert_eq!(c1.get_f32(&AttrKey::X), 90.0); // 80 + 10 gap

    let c2 = doc.get(created[2]).unwrap();
    assert_eq!(c2.get_f32(&AttrKey::Y), 50.0); // 40 + 10 gap, second row
}

// ── Phase 3 integration tests ──────────────────────────────────────────────

#[test]
fn effect_add_remove_round_trip() {
    use svg_effects::{EffectStore, Effect};

    let mut doc = Document::new();
    let root = doc.root;
    let rect = Node::new(SvgTag::Rect);
    let rect_id = rect.id;
    doc.insert_node(root, 1, rect);

    let mut effects = EffectStore::new();
    effects.add_effect(rect_id, Effect::GaussianBlur { std_dev: 5.0 });
    effects.add_effect(rect_id, Effect::GaussianBlur { std_dev: 10.0 });
    assert_eq!(effects.get(rect_id).unwrap().len(), 2);

    effects.remove_effect(rect_id, 0);
    let remaining = effects.get(rect_id).unwrap();
    assert_eq!(remaining.len(), 1);

    // The remaining effect should be the one with std_dev 10
    match &remaining.effects[0] {
        Effect::GaussianBlur { std_dev } => assert_eq!(*std_dev, 10.0),
        _ => panic!("Expected GaussianBlur"),
    }

    effects.clear_node(rect_id);
    assert!(effects.get(rect_id).is_none());
}

#[test]
fn constraint_solve_updates_positions() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut r1 = Node::new(SvgTag::Rect);
    r1.set_attr(AttrKey::X, AttrValue::F32(100.0));
    r1.set_attr(AttrKey::Y, AttrValue::F32(100.0));
    r1.set_attr(AttrKey::Width, AttrValue::F32(50.0));
    r1.set_attr(AttrKey::Height, AttrValue::F32(50.0));
    let r1_id = r1.id;
    doc.insert_node(root, 1, r1);

    let mut r2 = Node::new(SvgTag::Rect);
    r2.set_attr(AttrKey::X, AttrValue::F32(0.0));
    r2.set_attr(AttrKey::Y, AttrValue::F32(0.0));
    r2.set_attr(AttrKey::Width, AttrValue::F32(30.0));
    r2.set_attr(AttrKey::Height, AttrValue::F32(30.0));
    let r2_id = r2.id;
    doc.insert_node(root, 2, r2);

    let mut store = ConstraintStore::new();
    store.add(Constraint::Pin {
        node: r2_id,
        to: r1_id,
        anchor: Anchor::TopLeft,
        target_anchor: Anchor::TopRight,
        offset: (20.0, 0.0),
    });

    store.solve(&mut doc, Rect::new(0.0, 0.0, 800.0, 600.0), None);

    // r1 right edge = 100 + 50 = 150; r2 should be at 150 + 20 = 170
    let r2_x = doc.get(r2_id).unwrap().get_f32(&AttrKey::X);
    let r2_y = doc.get(r2_id).unwrap().get_f32(&AttrKey::Y);
    assert!((r2_x - 170.0).abs() < 0.01, "r2_x={}", r2_x);
    assert!((r2_y - 100.0).abs() < 0.01, "r2_y={}", r2_y);

    // Verify the constraint changed positions from original (0,0)
    assert!(r2_x > 100.0, "Constraint should have moved r2");
}

#[test]
fn theme_token_resolution_e2e() {
    let mut doc = Document::new();
    let root = doc.root;

    // Create nodes with multiple theme tokens
    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::Fill, AttrValue::Str("{{color.primary}}".to_string()));
    rect.set_attr(AttrKey::Stroke, AttrValue::Str("{{color.accent}}".to_string()));
    let rect_id = rect.id;
    doc.insert_node(root, 1, rect);

    let mut text = Node::new(SvgTag::Text);
    text.set_attr(AttrKey::FontFamily, AttrValue::Str("{{font.heading}}".to_string()));
    let text_id = text.id;
    doc.insert_node(root, 2, text);

    // Apply default theme
    let theme = Theme::default();
    theme.apply(&mut doc);

    // Verify all tokens resolved
    let rect_node = doc.get(rect_id).unwrap();
    let fill = rect_node.get_attr(&AttrKey::Fill);
    assert!(fill.is_some(), "Fill should be resolved");
    // Should not contain {{ anymore
    match fill {
        Some(AttrValue::Str(s)) => assert!(!s.contains("{{"), "Fill still contains token: {}", s),
        Some(AttrValue::Color(_)) => {} // Good — parsed as color
        other => panic!("Unexpected fill value: {:?}", other),
    }

    let text_node = doc.get(text_id).unwrap();
    let font = text_node.get_string(&AttrKey::FontFamily);
    assert!(font.is_some(), "Font should be resolved");
    assert!(!font.unwrap().contains("{{"), "Font still contains token");
}

#[test]
fn template_repeat_with_data_binding() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut tmpl = Node::new(SvgTag::Rect);
    tmpl.set_attr(AttrKey::X, AttrValue::F32(0.0));
    tmpl.set_attr(AttrKey::Y, AttrValue::F32(0.0));
    tmpl.set_attr(AttrKey::Width, AttrValue::F32(60.0));
    tmpl.set_attr(AttrKey::Height, AttrValue::F32(40.0));
    let tmpl_id = tmpl.id;
    doc.insert_node(root, 1, tmpl);

    let rows = vec![
        serde_json::json!({"fill": "#ff0000", "width": "100"}),
        serde_json::json!({"fill": "#00ff00", "width": "120"}),
        serde_json::json!({"fill": "#0000ff", "width": "80"}),
    ];

    let created = svg_runtime::template::repeat_template(
        &mut doc, tmpl_id, &rows, 2, (10.0, 10.0),
    );

    assert_eq!(created.len(), 3);

    // Each clone should have data applied
    let c0 = doc.get(created[0]).unwrap();
    assert_eq!(c0.get_f32(&AttrKey::Width), 100.0);

    let c1 = doc.get(created[1]).unwrap();
    assert_eq!(c1.get_f32(&AttrKey::Width), 120.0);
    // c1 is in column 1: x = 0 + 1*(60+10) = 70
    assert_eq!(c1.get_f32(&AttrKey::X), 70.0);
}

#[test]
fn batch_set_attrs_undo_as_single_step() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::X, AttrValue::F32(10.0));
    rect.set_attr(AttrKey::Y, AttrValue::F32(20.0));
    rect.set_attr(AttrKey::Width, AttrValue::F32(100.0));
    let rect_id = rect.id;
    doc.insert_node(root, 1, rect);

    // Batch set via commands
    let batch = SvgCommand::Batch {
        commands: vec![
            SvgCommand::SetAttr { id: rect_id, key: AttrKey::X, value: AttrValue::F32(50.0), old_value: None },
            SvgCommand::SetAttr { id: rect_id, key: AttrKey::Y, value: AttrValue::F32(60.0), old_value: None },
            SvgCommand::SetAttr { id: rect_id, key: AttrKey::Width, value: AttrValue::F32(200.0), old_value: None },
        ],
    };

    let undo = batch.execute(&mut doc).unwrap();

    // Verify batch applied
    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::X), 50.0);
    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Y), 60.0);
    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Width), 200.0);

    // Undo entire batch as one step
    undo.execute(&mut doc).unwrap();
    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::X), 10.0);
    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Y), 20.0);
    assert_eq!(doc.get(rect_id).unwrap().get_f32(&AttrKey::Width), 100.0);
}

#[test]
fn export_after_modifications() {
    let mut doc = Document::new();
    let root = doc.root;

    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::X, AttrValue::F32(10.0));
    rect.set_attr(AttrKey::Y, AttrValue::F32(20.0));
    rect.set_attr(AttrKey::Width, AttrValue::F32(100.0));
    rect.set_attr(AttrKey::Height, AttrValue::F32(50.0));
    rect.set_attr(AttrKey::Fill, AttrValue::Str("#ff0000".to_string()));
    doc.insert_node(root, 1, rect);

    // Add an effect
    let mut effects = svg_effects::EffectStore::new();
    let rect_id = doc.children(root)[1]; // The rect we just added
    effects.add_effect(rect_id, svg_effects::Effect::GaussianBlur { std_dev: 5.0 });
    effects.apply_to_document(&mut doc);

    // Export
    let svg = doc_to_svg_string(&doc);
    assert!(svg.contains("<rect"));
    assert!(svg.contains("width=\"100\""));
    assert!(svg.contains("<filter"));

    // Re-import and verify
    let doc2 = doc_from_svg_string(&svg).unwrap();
    assert!(doc2.node_count() >= doc.node_count() - 1, "Re-import should preserve nodes");
}

#[test]
fn clone_subtree_preserves_attrs() {
    let mut doc = Document::new();
    let root = doc.root;

    let group = Node::new(SvgTag::G);
    let group_id = group.id;
    doc.insert_node(root, 1, group);

    let mut rect = Node::new(SvgTag::Rect);
    rect.set_attr(AttrKey::X, AttrValue::F32(10.0));
    rect.set_attr(AttrKey::Fill, AttrValue::Str("#ff0000".to_string()));
    rect.set_attr(AttrKey::Width, AttrValue::F32(100.0));
    rect.set_attr(AttrKey::Height, AttrValue::F32(50.0));
    doc.insert_node(group_id, 0, rect);

    let clone_id = doc.clone_subtree(group_id).unwrap();
    let clone = doc.get(clone_id).unwrap();

    // Clone should have one child
    assert_eq!(clone.children.len(), 1);
    assert_ne!(clone_id, group_id);

    // Child should have same attrs
    let child = doc.get(clone.children[0]).unwrap();
    assert_eq!(child.get_f32(&AttrKey::X), 10.0);
    assert_eq!(child.get_f32(&AttrKey::Width), 100.0);
}
