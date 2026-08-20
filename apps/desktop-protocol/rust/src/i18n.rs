use serde::{Deserialize, Serialize};

use crate::{ExamMode, SessionStatus};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    Uz,
    Ru,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RussianPluralCategory {
    One,
    Few,
    Many,
}

#[must_use]
pub fn russian_plural_category(value: i64) -> RussianPluralCategory {
    let absolute = value.unsigned_abs();
    let modulo10 = absolute % 10;
    let modulo100 = absolute % 100;
    if (11..=19).contains(&modulo100) {
        RussianPluralCategory::Many
    } else if modulo10 == 1 {
        RussianPluralCategory::One
    } else if (2..=4).contains(&modulo10) {
        RussianPluralCategory::Few
    } else {
        RussianPluralCategory::Many
    }
}

#[must_use]
pub const fn mode_label(locale: Locale, mode: ExamMode) -> &'static str {
    match (locale, mode) {
        (Locale::Uz, ExamMode::Exam) => "Imtihon",
        (Locale::Uz, ExamMode::Training) => "Mashq",
        (Locale::Uz, ExamMode::Category) => "Kategoriya",
        (Locale::Uz, ExamMode::Ticket) => "Bilet",
        (Locale::Uz, ExamMode::GrandMock) => "Katta sinov",
        (Locale::Ru, ExamMode::Exam) => "Экзамен",
        (Locale::Ru, ExamMode::Training) => "Тренировка",
        (Locale::Ru, ExamMode::Category) => "Категория",
        (Locale::Ru, ExamMode::Ticket) => "Билет",
        (Locale::Ru, ExamMode::GrandMock) => "Большая проверка",
    }
}

#[must_use]
pub const fn status_label(locale: Locale, status: SessionStatus) -> &'static str {
    match (locale, status) {
        (Locale::Uz, SessionStatus::Draft) => "Tayyorlanmoqda",
        (Locale::Uz, SessionStatus::Active) => "Davom etmoqda",
        (Locale::Uz, SessionStatus::Paused) => "To‘xtatilgan",
        (Locale::Uz, SessionStatus::Completed) => "Yakunlangan",
        (Locale::Uz, SessionStatus::Cancelled) => "Bekor qilingan",
        (Locale::Ru, SessionStatus::Draft) => "Подготовка",
        (Locale::Ru, SessionStatus::Active) => "В процессе",
        (Locale::Ru, SessionStatus::Paused) => "Приостановлено",
        (Locale::Ru, SessionStatus::Completed) => "Завершено",
        (Locale::Ru, SessionStatus::Cancelled) => "Отменено",
    }
}

#[must_use]
pub fn format_question_count(locale: Locale, count: u16) -> String {
    match locale {
        Locale::Uz => format!("{count} ta savol"),
        Locale::Ru => {
            let noun = match russian_plural_category(i64::from(count)) {
                RussianPluralCategory::One => "вопрос",
                RussianPluralCategory::Few => "вопроса",
                RussianPluralCategory::Many => "вопросов",
            };
            format!("{count} {noun}")
        }
    }
}

#[must_use]
pub fn format_duration(locale: Locale, minutes: u16) -> String {
    match locale {
        Locale::Uz => format!("{minutes} daqiqa"),
        Locale::Ru => {
            let noun = match russian_plural_category(i64::from(minutes)) {
                RussianPluralCategory::One => "минута",
                RussianPluralCategory::Few => "минуты",
                RussianPluralCategory::Many => "минут",
            };
            format!("{minutes} {noun}")
        }
    }
}

#[must_use]
pub fn format_exam_summary(locale: Locale, question_count: u16, duration_minutes: u16) -> String {
    format!(
        "{}, {}",
        format_question_count(locale, question_count),
        format_duration(locale, duration_minutes)
    )
}
