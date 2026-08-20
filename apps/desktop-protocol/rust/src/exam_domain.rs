use std::{error::Error, fmt};

use serde::{Deserialize, Deserializer, Serialize, de};
use uuid::{Uuid, Variant, Version};

use crate::{ExamMode, Locale};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainError {
    pub field: &'static str,
    pub message: String,
}

impl DomainError {
    fn new(field: &'static str, message: impl Into<String>) -> Self {
        Self {
            field,
            message: message.into(),
        }
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.field, self.message)
    }
}

impl Error for DomainError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Draft,
    Active,
    Paused,
    Completed,
    Cancelled,
}

fn parse_canonical_uuid(value: &str) -> Result<Uuid, DomainError> {
    let parsed = Uuid::parse_str(value)
        .map_err(|_| DomainError::new("sessionId", "must be a canonical UUIDv4"))?;
    let standard_v4 =
        parsed.get_version() == Some(Version::Random) && parsed.get_variant() == Variant::RFC4122;
    if !standard_v4 || parsed.to_string() != value {
        let error = DomainError::new("sessionId", "must be a lowercase canonical UUIDv4");
        return Err(error);
    }
    Ok(parsed)
}

fn is_leap_year(year: u16) -> bool {
    year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400))
}

fn parse_digits(value: &str, start: usize, end: usize) -> Option<u16> {
    value.get(start..end)?.parse::<u16>().ok()
}

fn is_canonical_utc_instant(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return false;
    }

    let Some(year) = parse_digits(value, 0, 4) else {
        return false;
    };
    let Some(month) = parse_digits(value, 5, 7) else {
        return false;
    };
    let Some(day) = parse_digits(value, 8, 10) else {
        return false;
    };
    let Some(hour) = parse_digits(value, 11, 13) else {
        return false;
    };
    let Some(minute) = parse_digits(value, 14, 16) else {
        return false;
    };
    let Some(second) = parse_digits(value, 17, 19) else {
        return false;
    };
    let Some(_millisecond) = parse_digits(value, 20, 23) else {
        return false;
    };

    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return false,
    };
    day > 0 && day <= days_in_month && hour < 24 && minute < 60 && second < 60
}

fn validate_instant(field: &'static str, value: &str) -> Result<(), DomainError> {
    if is_canonical_utc_instant(value) {
        Ok(())
    } else {
        Err(DomainError::new(
            field,
            "must be a canonical UTC ISO-8601 instant",
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamSession {
    pub session_id: Uuid,
    pub mode: ExamMode,
    pub locale: Locale,
    pub question_count: u16,
    pub duration_minutes: u16,
    pub current_question_index: u16,
    pub answered_question_count: u16,
    pub elapsed_seconds: u32,
    pub status: SessionStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub revision: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawExamSession {
    session_id: String,
    mode: ExamMode,
    locale: Locale,
    question_count: u16,
    duration_minutes: u16,
    current_question_index: u16,
    answered_question_count: u16,
    elapsed_seconds: u32,
    status: SessionStatus,
    started_at: Option<String>,
    completed_at: Option<String>,
    revision: u32,
}

impl TryFrom<RawExamSession> for ExamSession {
    type Error = DomainError;

    fn try_from(raw: RawExamSession) -> Result<Self, Self::Error> {
        let session = Self {
            session_id: parse_canonical_uuid(&raw.session_id)?,
            mode: raw.mode,
            locale: raw.locale,
            question_count: raw.question_count,
            duration_minutes: raw.duration_minutes,
            current_question_index: raw.current_question_index,
            answered_question_count: raw.answered_question_count,
            elapsed_seconds: raw.elapsed_seconds,
            status: raw.status,
            started_at: raw.started_at,
            completed_at: raw.completed_at,
            revision: raw.revision,
        };
        session.validate()?;
        Ok(session)
    }
}

impl<'de> Deserialize<'de> for ExamSession {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawExamSession::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

impl ExamSession {
    /// Verifies mode bounds, progress ordering, and lifecycle timestamps.
    ///
    /// # Errors
    ///
    /// Returns the first invariant violation with its public field name.
    pub fn validate(&self) -> Result<(), DomainError> {
        let config = self.mode.config();
        if self.question_count < config.questions.min || self.question_count > config.questions.max
        {
            return Err(DomainError::new(
                "questionCount",
                format!(
                    "must be from {} to {} for {:?}",
                    config.questions.min, config.questions.max, self.mode
                ),
            ));
        }
        if self.duration_minutes < config.duration_minutes.min
            || self.duration_minutes > config.duration_minutes.max
        {
            return Err(DomainError::new(
                "durationMinutes",
                format!(
                    "must be from {} to {} for {:?}",
                    config.duration_minutes.min, config.duration_minutes.max, self.mode
                ),
            ));
        }
        if self.current_question_index >= self.question_count {
            return Err(DomainError::new(
                "currentQuestionIndex",
                "must reference the configured session",
            ));
        }
        if self.answered_question_count > self.question_count {
            return Err(DomainError::new(
                "answeredQuestionCount",
                "cannot exceed question count",
            ));
        }
        if matches!(self.status, SessionStatus::Active | SessionStatus::Paused)
            && self.answered_question_count > self.current_question_index + 1
        {
            return Err(DomainError::new(
                "answeredQuestionCount",
                "cannot advance beyond the current question",
            ));
        }
        if self.elapsed_seconds > u32::from(self.duration_minutes) * 60 {
            return Err(DomainError::new(
                "elapsedSeconds",
                "exceeds the session duration",
            ));
        }

        if let Some(started_at) = &self.started_at {
            validate_instant("startedAt", started_at)?;
        }
        if let Some(completed_at) = &self.completed_at {
            validate_instant("completedAt", completed_at)?;
        }

        if self.status == SessionStatus::Draft {
            if self.started_at.is_some() || self.completed_at.is_some() {
                return Err(DomainError::new(
                    "status",
                    "a draft session cannot have lifecycle timestamps",
                ));
            }
            if self.current_question_index != 0
                || self.answered_question_count != 0
                || self.elapsed_seconds != 0
                || self.revision != 0
            {
                return Err(DomainError::new(
                    "status",
                    "a draft session cannot contain progress",
                ));
            }
            return Ok(());
        }

        if self.started_at.is_none() {
            return Err(DomainError::new(
                "startedAt",
                "a started session requires startedAt",
            ));
        }
        let terminal = matches!(
            self.status,
            SessionStatus::Completed | SessionStatus::Cancelled
        );
        if terminal != self.completed_at.is_some() {
            return Err(DomainError::new(
                "completedAt",
                if terminal {
                    "a terminal session requires completedAt"
                } else {
                    "a non-terminal session cannot have completedAt"
                },
            ));
        }
        if let (Some(started_at), Some(completed_at)) = (&self.started_at, &self.completed_at)
            && completed_at < started_at
        {
            return Err(DomainError::new("completedAt", "cannot precede startedAt"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamResult {
    pub session_id: Uuid,
    pub mode: ExamMode,
    pub locale: Locale,
    pub total_questions: u16,
    pub answered_questions: u16,
    pub correct_count: u16,
    pub incorrect_count: u16,
    pub elapsed_seconds: u32,
    pub completed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawExamResult {
    session_id: String,
    mode: ExamMode,
    locale: Locale,
    total_questions: u16,
    answered_questions: u16,
    correct_count: u16,
    incorrect_count: u16,
    elapsed_seconds: u32,
    completed_at: String,
}

impl TryFrom<RawExamResult> for ExamResult {
    type Error = DomainError;

    fn try_from(raw: RawExamResult) -> Result<Self, Self::Error> {
        let result = Self {
            session_id: parse_canonical_uuid(&raw.session_id)?,
            mode: raw.mode,
            locale: raw.locale,
            total_questions: raw.total_questions,
            answered_questions: raw.answered_questions,
            correct_count: raw.correct_count,
            incorrect_count: raw.incorrect_count,
            elapsed_seconds: raw.elapsed_seconds,
            completed_at: raw.completed_at,
        };
        result.validate()?;
        Ok(result)
    }
}

impl<'de> Deserialize<'de> for ExamResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        RawExamResult::deserialize(deserializer)?
            .try_into()
            .map_err(de::Error::custom)
    }
}

impl ExamResult {
    /// Verifies result totals, mode bounds, duration, and completion time.
    ///
    /// # Errors
    ///
    /// Returns the first invariant violation with its public field name.
    pub fn validate(&self) -> Result<(), DomainError> {
        let config = self.mode.config();
        if self.total_questions < config.questions.min
            || self.total_questions > config.questions.max
        {
            return Err(DomainError::new("totalQuestions", "is outside mode bounds"));
        }
        if self.answered_questions > self.total_questions {
            let error = DomainError::new("answeredQuestions", "exceeds total questions");
            return Err(error);
        }
        if u32::from(self.correct_count) + u32::from(self.incorrect_count)
            != u32::from(self.answered_questions)
        {
            return Err(DomainError::new(
                "correctCount",
                "correct and incorrect counts must equal answered questions",
            ));
        }
        if self.elapsed_seconds > u32::from(config.duration_minutes.max) * 60 {
            return Err(DomainError::new("elapsedSeconds", "exceeds mode duration"));
        }
        validate_instant("completedAt", &self.completed_at)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExamSessionWire {
    pub session_id: String,
    pub mode: ExamMode,
    pub locale: Locale,
    pub question_count: u16,
    pub duration_minutes: u16,
    pub current_question_index: u16,
    pub answered_question_count: u16,
    pub elapsed_seconds: u32,
    pub status: SessionStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub revision: u32,
}

impl TryFrom<&ExamSession> for ExamSessionWire {
    type Error = DomainError;

    fn try_from(session: &ExamSession) -> Result<Self, Self::Error> {
        session.validate()?;
        Ok(Self {
            session_id: session.session_id.to_string(),
            mode: session.mode,
            locale: session.locale,
            question_count: session.question_count,
            duration_minutes: session.duration_minutes,
            current_question_index: session.current_question_index,
            answered_question_count: session.answered_question_count,
            elapsed_seconds: session.elapsed_seconds,
            status: session.status,
            started_at: session.started_at.clone(),
            completed_at: session.completed_at.clone(),
            revision: session.revision,
        })
    }
}

impl TryFrom<ExamSessionWire> for ExamSession {
    type Error = DomainError;

    fn try_from(wire: ExamSessionWire) -> Result<Self, Self::Error> {
        RawExamSession {
            session_id: wire.session_id,
            mode: wire.mode,
            locale: wire.locale,
            question_count: wire.question_count,
            duration_minutes: wire.duration_minutes,
            current_question_index: wire.current_question_index,
            answered_question_count: wire.answered_question_count,
            elapsed_seconds: wire.elapsed_seconds,
            status: wire.status,
            started_at: wire.started_at,
            completed_at: wire.completed_at,
            revision: wire.revision,
        }
        .try_into()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExamResultWire {
    pub session_id: String,
    pub mode: ExamMode,
    pub locale: Locale,
    pub total_questions: u16,
    pub answered_questions: u16,
    pub correct_count: u16,
    pub incorrect_count: u16,
    pub elapsed_seconds: u32,
    pub completed_at: String,
}

impl TryFrom<&ExamResult> for ExamResultWire {
    type Error = DomainError;

    fn try_from(result: &ExamResult) -> Result<Self, Self::Error> {
        result.validate()?;
        Ok(Self {
            session_id: result.session_id.to_string(),
            mode: result.mode,
            locale: result.locale,
            total_questions: result.total_questions,
            answered_questions: result.answered_questions,
            correct_count: result.correct_count,
            incorrect_count: result.incorrect_count,
            elapsed_seconds: result.elapsed_seconds,
            completed_at: result.completed_at.clone(),
        })
    }
}

impl TryFrom<ExamResultWire> for ExamResult {
    type Error = DomainError;

    fn try_from(wire: ExamResultWire) -> Result<Self, Self::Error> {
        RawExamResult {
            session_id: wire.session_id,
            mode: wire.mode,
            locale: wire.locale,
            total_questions: wire.total_questions,
            answered_questions: wire.answered_questions,
            correct_count: wire.correct_count,
            incorrect_count: wire.incorrect_count,
            elapsed_seconds: wire.elapsed_seconds,
            completed_at: wire.completed_at,
        }
        .try_into()
    }
}
