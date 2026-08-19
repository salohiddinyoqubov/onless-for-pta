use serde::{Deserialize, Deserializer, Serialize, de};
use uuid::Uuid;

use crate::ConnectionCode;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "PascalCase", deny_unknown_fields)]
pub enum ServerToClient {
    ExamStart {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        duration_minutes: u32,
        total_questions: u32,
    },
    ExamQuestion {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        index: u32,
        total: u32,
        question: ExamQuestionPayload,
    },
    ExamStop {
        reason: String,
    },
    /// Acknowledges server-side grading after the client commits an answer.
    AnswerAck {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        #[serde(with = "crate::uuid_wire")]
        question_id: Uuid,
        #[serde(default, with = "crate::uuid_wire::option")]
        selected_answer_id: Option<Uuid>,
        is_correct: bool,
        #[serde(with = "crate::uuid_wire")]
        correct_answer_id: Uuid,
        error_count: u32,
        auto_failed: bool,
    },
    AnswerError {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        #[serde(with = "crate::uuid_wire")]
        question_id: Uuid,
        message: String,
    },
    Ping,
    ConfigUpdate {
        school_name: Option<String>,
        language: Option<String>,
    },
    PowerCommand {
        action: PowerAction,
        delay_secs: u32,
    },
    ServerShutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "PascalCase", deny_unknown_fields)]
pub enum ClientToServer {
    Register {
        client_id: String,
        client_name: String,
        version: String,
        mac_address: Option<String>,
        connection_code: ConnectionCode,
    },
    Pong {
        client_id: String,
    },
    AnswerSubmit {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        #[serde(with = "crate::uuid_wire")]
        question_id: Uuid,
        #[serde(default, with = "crate::uuid_wire::option")]
        answer_id: Option<Uuid>,
        time_spent_seconds: u32,
    },
    ExamComplete {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        total_time_seconds: u32,
    },
    Heartbeat {
        client_id: String,
        status: ClientStatus,
    },
    /// Binds a student name to one exam rather than to a reusable kiosk.
    SubmitStudentInfo {
        #[serde(with = "crate::uuid_wire")]
        session_id: Uuid,
        student_name: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExamQuestionPayload {
    #[serde(with = "crate::uuid_wire")]
    pub id: Uuid,
    pub ticket_id: Option<String>,
    pub ticket_position: Option<i32>,
    pub text_uz: String,
    pub text_ru: Option<String>,
    pub text_kaa: Option<String>,
    pub difficulty: i32,
    pub answers: Vec<ExamAnswerPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_mime: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_data_base64: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExamQuestionPayloadWire {
    #[serde(with = "crate::uuid_wire")]
    id: Uuid,
    ticket_id: Option<String>,
    ticket_position: Option<i32>,
    text_uz: String,
    text_ru: Option<String>,
    text_kaa: Option<String>,
    difficulty: i32,
    answers: Vec<ExamAnswerPayload>,
    #[serde(default)]
    image_mime: Option<String>,
    #[serde(default)]
    image_data_base64: Option<String>,
}

impl TryFrom<ExamQuestionPayloadWire> for ExamQuestionPayload {
    type Error = &'static str;

    fn try_from(wire: ExamQuestionPayloadWire) -> Result<Self, Self::Error> {
        if wire.image_mime.is_some() != wire.image_data_base64.is_some() {
            return Err("image_mime and image_data_base64 must be provided together");
        }

        Ok(Self {
            id: wire.id,
            ticket_id: wire.ticket_id,
            ticket_position: wire.ticket_position,
            text_uz: wire.text_uz,
            text_ru: wire.text_ru,
            text_kaa: wire.text_kaa,
            difficulty: wire.difficulty,
            answers: wire.answers,
            image_mime: wire.image_mime,
            image_data_base64: wire.image_data_base64,
        })
    }
}

impl<'de> Deserialize<'de> for ExamQuestionPayload {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        ExamQuestionPayloadWire::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

/// Student-visible answer data intentionally excludes the grading key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExamAnswerPayload {
    #[serde(with = "crate::uuid_wire")]
    pub id: Uuid,
    pub text_uz: String,
    pub text_ru: Option<String>,
    pub text_kaa: Option<String>,
    pub display_order: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum PowerAction {
    Shutdown,
    Restart,
    Lock,
    ForceClose,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum ClientStatus {
    Idle,
    InExam,
    Updating,
    ShuttingDown,
}
