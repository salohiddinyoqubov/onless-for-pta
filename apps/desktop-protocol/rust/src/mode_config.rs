use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumericRange {
    pub min: u16,
    pub max: u16,
    pub default: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExamLimits {
    pub question_count: NumericRange,
    pub duration_minutes: NumericRange,
}

pub const EXAM_LIMITS: ExamLimits = ExamLimits {
    question_count: NumericRange {
        min: 1,
        max: 100,
        default: 20,
    },
    duration_minutes: NumericRange {
        min: 1,
        max: 180,
        default: 25,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExamMode {
    Exam,
    Training,
    Category,
    Ticket,
    GrandMock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeConfig {
    pub mode: ExamMode,
    pub questions: NumericRange,
    pub duration_minutes: NumericRange,
    pub timed: bool,
}

const FLEXIBLE_QUESTIONS: NumericRange = EXAM_LIMITS.question_count;
const FLEXIBLE_DURATION: NumericRange = EXAM_LIMITS.duration_minutes;

pub const MODE_CONFIGS: [ModeConfig; 5] = [
    ModeConfig {
        mode: ExamMode::Exam,
        questions: NumericRange {
            min: 20,
            max: 20,
            default: 20,
        },
        duration_minutes: NumericRange {
            min: 25,
            max: 25,
            default: 25,
        },
        timed: true,
    },
    ModeConfig {
        mode: ExamMode::Training,
        questions: FLEXIBLE_QUESTIONS,
        duration_minutes: FLEXIBLE_DURATION,
        timed: false,
    },
    ModeConfig {
        mode: ExamMode::Category,
        questions: FLEXIBLE_QUESTIONS,
        duration_minutes: FLEXIBLE_DURATION,
        timed: false,
    },
    ModeConfig {
        mode: ExamMode::Ticket,
        questions: FLEXIBLE_QUESTIONS,
        duration_minutes: FLEXIBLE_DURATION,
        timed: false,
    },
    ModeConfig {
        mode: ExamMode::GrandMock,
        questions: FLEXIBLE_QUESTIONS,
        duration_minutes: FLEXIBLE_DURATION,
        timed: true,
    },
];

impl ExamMode {
    #[must_use]
    pub fn config(self) -> &'static ModeConfig {
        &MODE_CONFIGS[match self {
            Self::Exam => 0,
            Self::Training => 1,
            Self::Category => 2,
            Self::Ticket => 3,
            Self::GrandMock => 4,
        }]
    }
}
