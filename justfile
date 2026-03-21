wasm:
    wasm-pack build crates/svg-wasm --target web --out-dir ../../packages/bridge/wasm

dev:
    just wasm && cd packages/editor && pnpm dev

build:
    just wasm && cd packages/editor && pnpm build

test:
    cargo test --workspace

test-all:
    cargo test --workspace && cd packages/bridge && pnpm test && cd ../editor && pnpm test

check:
    cargo check --workspace

clippy:
    cargo clippy --workspace -- -D warnings
