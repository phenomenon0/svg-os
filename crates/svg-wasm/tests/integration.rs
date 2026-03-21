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

    let undo_cmd = cmd.execute(&mut doc);
    assert_eq!(doc.node_count(), 3); // svg + defs + rect

    // Set an attr
    let set_cmd = SvgCommand::SetAttr {
        id: rect_id,
        key: AttrKey::Fill,
        value: AttrValue::Str("#ff0000".to_string()),
        old_value: None,
    };
    let undo_set = set_cmd.execute(&mut doc);

    // Undo the set
    undo_set.execute(&mut doc);
    assert!(doc.get(rect_id).unwrap().get_attr(&AttrKey::Fill).is_none());

    // Undo the insert
    undo_cmd.execute(&mut doc);
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

    store.solve(&mut doc, Rect::new(0.0, 0.0, 800.0, 600.0));

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
            },
            FieldMapping {
                field: "color".to_string(),
                attr: "fill".to_string(),
                transform: None,
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
