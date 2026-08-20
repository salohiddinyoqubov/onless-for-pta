//! Public-safe exam and session contracts shared by desktop clients.

pub mod exam_domain;
pub mod i18n;
pub mod mode_config;

pub use exam_domain::{
    DomainError, ExamResult, ExamResultWire, ExamSession, ExamSessionWire, SessionStatus,
};
pub use i18n::{
    Locale, RussianPluralCategory, format_duration, format_exam_summary, format_question_count,
    mode_label, russian_plural_category, status_label,
};
pub use mode_config::{EXAM_LIMITS, ExamLimits, ExamMode, MODE_CONFIGS, ModeConfig, NumericRange};
