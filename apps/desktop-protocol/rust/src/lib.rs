//! Shared wire contracts for Onless desktop servers and clients.

pub mod connection_code;
pub mod discovery;
pub mod heartbeat;
pub mod messages;
mod uuid_wire;

pub use connection_code::{ConnectionCode, ConnectionCodeError, generate_connection_code};
pub use discovery::{DEFAULT_WS_PORT, SERVICE_TYPE, ServerInfo};
pub use messages::{
    ClientStatus, ClientToServer, ExamAnswerPayload, ExamQuestionPayload, PowerAction,
    ServerToClient,
};
