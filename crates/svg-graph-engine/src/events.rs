use crate::types::GraphEvent;
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

pub struct EventBus {
    sender: broadcast::Sender<GraphEvent>,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self { sender }
    }

    pub fn emit(&self, event: GraphEvent) {
        // Ignore error (no receivers) — events are fire-and-forget
        let _ = self.sender.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GraphEvent> {
        self.sender.subscribe()
    }

    pub fn sender(&self) -> broadcast::Sender<GraphEvent> {
        self.sender.clone()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}
