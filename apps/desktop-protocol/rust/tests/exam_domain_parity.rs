use onless_desktop_protocol::{
    ExamMode, ExamResult, ExamResultWire, ExamSession, ExamSessionWire, Locale, MODE_CONFIGS,
    ModeConfig, RussianPluralCategory, SessionStatus, format_duration, format_exam_summary,
    format_question_count, mode_label, russian_plural_category, status_label,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

const FIXTURE_JSON: &str = include_str!("../../fixtures/exam-modes.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixturePair {
    domain: Value,
    wire: Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Mutation {
    name: String,
    field: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PluralCase {
    value: i64,
    category: String,
    questions: String,
    minutes: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SummaryCase {
    locale: Locale,
    questions: u16,
    minutes: u16,
    expected: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NullableNormalization {
    domain_input: Value,
    wire_input: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevisionBoundaries {
    maximum: u64,
    above_maximum: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixtures {
    mode_configs: Vec<ModeConfig>,
    valid_sessions: Vec<FixturePair>,
    invalid_session_mutations: Vec<Mutation>,
    nullable_normalization: NullableNormalization,
    revision_boundaries: RevisionBoundaries,
    valid_results: Vec<FixturePair>,
    invalid_result_mutations: Vec<Mutation>,
    plural_cases: Vec<PluralCase>,
    summary_cases: Vec<SummaryCase>,
}

fn fixtures() -> Fixtures {
    serde_json::from_str(FIXTURE_JSON).expect("shared exam fixture is valid JSON")
}

fn object_with_mutation(base: &Value, mutation: &Mutation) -> Value {
    let mut object = base
        .as_object()
        .expect("fixture domain value is an object")
        .clone();
    object.insert(mutation.field.clone(), mutation.value.clone());
    Value::Object(object)
}

fn active_session() -> Value {
    json!({
        "sessionId": "00000000-0000-4000-8000-000000000010",
        "mode": "training",
        "locale": "uz",
        "questionCount": 20,
        "durationMinutes": 25,
        "currentQuestionIndex": 4,
        "answeredQuestionCount": 4,
        "elapsedSeconds": 300,
        "status": "active",
        "startedAt": "2026-02-01T08:00:00.000Z",
        "completedAt": null,
        "revision": 5
    })
}

fn completed_result() -> Value {
    json!({
        "sessionId": "00000000-0000-4000-8000-000000000010",
        "mode": "training",
        "locale": "uz",
        "totalQuestions": 20,
        "answeredQuestions": 18,
        "correctCount": 15,
        "incorrectCount": 3,
        "elapsedSeconds": 1200,
        "completedAt": "2026-02-01T08:20:00.000Z"
    })
}

fn with_field(base: &Value, field: &str, value: Value) -> Value {
    let mut object: Map<String, Value> =
        base.as_object().expect("test builder is an object").clone();
    object.insert(field.to_owned(), value);
    Value::Object(object)
}

#[test]
fn mode_configuration_matches_the_shared_fixture() {
    let expected = fixtures().mode_configs;
    assert_eq!(MODE_CONFIGS.as_slice(), expected.as_slice());

    for config in MODE_CONFIGS {
        assert!(config.questions.min <= config.questions.default);
        assert!(config.questions.default <= config.questions.max);
        assert!(config.duration_minutes.min <= config.duration_minutes.default);
        assert!(config.duration_minutes.default <= config.duration_minutes.max);
        assert_eq!(config.mode.config(), &config);
    }
}

#[test]
fn valid_sessions_round_trip_through_domain_and_wire_contracts() {
    for pair in fixtures().valid_sessions {
        let session: ExamSession =
            serde_json::from_value(pair.domain.clone()).expect("valid domain session");
        session.validate().expect("session invariant validation");

        let wire = ExamSessionWire::try_from(&session).expect("session maps to wire");
        assert_eq!(
            serde_json::to_value(&wire).expect("wire serializes"),
            pair.wire
        );

        let parsed_wire: ExamSessionWire =
            serde_json::from_value(pair.wire).expect("valid wire session");
        let round_trip = ExamSession::try_from(parsed_wire).expect("wire maps to domain");
        assert_eq!(round_trip, session);
        assert_eq!(
            serde_json::to_value(round_trip).expect("domain serializes"),
            pair.domain
        );
    }
}

#[test]
fn shared_invalid_session_mutations_are_rejected() {
    let fixtures = fixtures();
    let base = &fixtures.valid_sessions[0].domain;
    for mutation in &fixtures.invalid_session_mutations {
        let candidate = object_with_mutation(base, mutation);
        assert!(
            serde_json::from_value::<ExamSession>(candidate).is_err(),
            "accepted invalid session: {}",
            mutation.name
        );
    }
}

#[test]
fn omitted_nullable_timestamps_normalize_to_explicit_null_in_both_contracts() {
    let fixtures = fixtures();
    let domain: ExamSession = serde_json::from_value(fixtures.nullable_normalization.domain_input)
        .expect("omitted domain timestamps normalize");
    let wire: ExamSessionWire = serde_json::from_value(fixtures.nullable_normalization.wire_input)
        .expect("omitted wire timestamps normalize");
    let from_wire = ExamSession::try_from(wire).expect("normalized wire maps to domain");

    assert_eq!(from_wire, domain);
    let normalized = serde_json::to_value(
        ExamSessionWire::try_from(&from_wire).expect("normalized session maps to wire"),
    )
    .expect("normalized wire serializes");
    assert_eq!(normalized["started_at"], Value::Null);
    assert_eq!(normalized["completed_at"], Value::Null);
}

#[test]
fn revision_uses_the_shared_uint32_boundaries() {
    let fixtures = fixtures();
    let base = &fixtures.valid_sessions[1].domain;
    let maximum = with_field(
        base,
        "revision",
        json!(fixtures.revision_boundaries.maximum),
    );
    let session: ExamSession = serde_json::from_value(maximum).expect("uint32 maximum is valid");
    assert_eq!(session.revision, u32::MAX);

    let above = with_field(
        base,
        "revision",
        json!(fixtures.revision_boundaries.above_maximum),
    );
    assert!(serde_json::from_value::<ExamSession>(above).is_err());
}

#[test]
fn valid_results_round_trip_through_domain_and_wire_contracts() {
    for pair in fixtures().valid_results {
        let result: ExamResult =
            serde_json::from_value(pair.domain.clone()).expect("valid domain result");
        result.validate().expect("result invariant validation");

        let wire = ExamResultWire::try_from(&result).expect("result maps to wire");
        assert_eq!(
            serde_json::to_value(&wire).expect("wire serializes"),
            pair.wire
        );

        let parsed_wire: ExamResultWire =
            serde_json::from_value(pair.wire).expect("valid wire result");
        let round_trip = ExamResult::try_from(parsed_wire).expect("wire maps to domain");
        assert_eq!(round_trip, result);
        assert_eq!(
            serde_json::to_value(round_trip).expect("domain serializes"),
            pair.domain
        );
    }
}

#[test]
fn shared_invalid_result_mutations_are_rejected() {
    let fixtures = fixtures();
    let base = &fixtures.valid_results[0].domain;
    for mutation in &fixtures.invalid_result_mutations {
        let candidate = object_with_mutation(base, mutation);
        assert!(
            serde_json::from_value::<ExamResult>(candidate).is_err(),
            "accepted invalid result: {}",
            mutation.name
        );
    }
}

#[test]
fn started_and_terminal_states_require_coherent_timestamps() {
    assert!(serde_json::from_value::<ExamSession>(active_session()).is_ok());
    assert!(
        serde_json::from_value::<ExamSession>(with_field(
            &active_session(),
            "startedAt",
            Value::Null
        ))
        .is_err()
    );
    assert!(
        serde_json::from_value::<ExamSession>(with_field(
            &active_session(),
            "completedAt",
            json!("2026-02-01T08:10:00.000Z")
        ))
        .is_err()
    );

    let completed = with_field(&active_session(), "status", json!("completed"));
    assert!(serde_json::from_value::<ExamSession>(completed.clone()).is_err());
    let completed = with_field(&completed, "completedAt", json!("2026-02-01T08:20:00.000Z"));
    assert!(serde_json::from_value::<ExamSession>(completed).is_ok());
}

#[test]
fn completion_cannot_precede_start() {
    let completed = with_field(&active_session(), "status", json!("completed"));
    let completed = with_field(&completed, "completedAt", json!("2026-02-01T07:59:59.999Z"));
    let error = serde_json::from_value::<ExamSession>(completed)
        .expect_err("reverse chronology must fail")
        .to_string();
    assert!(error.contains("cannot precede"));
}

#[test]
fn timestamp_validation_handles_leap_years_and_calendar_bounds() {
    let leap_day = with_field(
        &active_session(),
        "startedAt",
        json!("2028-02-29T08:00:00.000Z"),
    );
    assert!(serde_json::from_value::<ExamSession>(leap_day).is_ok());

    for invalid in [
        "2026-02-29T08:00:00.000Z",
        "2026-13-01T08:00:00.000Z",
        "2026-01-01T24:00:00.000Z",
        "2026-01-01T08:60:00.000Z",
        "2026-01-01T08:00:60.000Z",
        "2026-01-01T08:00:00Z",
        "2026-01-01t08:00:00.000z",
    ] {
        let candidate = with_field(&active_session(), "startedAt", json!(invalid));
        assert!(
            serde_json::from_value::<ExamSession>(candidate).is_err(),
            "accepted invalid instant: {invalid}"
        );
    }
}

#[test]
fn active_progress_cannot_advance_beyond_the_current_question() {
    let invalid = with_field(&active_session(), "answeredQuestionCount", json!(6));
    assert!(serde_json::from_value::<ExamSession>(invalid).is_err());

    let boundary = with_field(&active_session(), "answeredQuestionCount", json!(5));
    let session: ExamSession =
        serde_json::from_value(boundary).expect("current question may be answered");
    assert_eq!(session.answered_question_count, 5);
}

#[test]
fn numeric_boundaries_reject_overflow_fractional_and_negative_json() {
    for (field, value) in [
        ("questionCount", json!(1.5)),
        ("durationMinutes", json!(-1)),
        ("currentQuestionIndex", json!(-1)),
        ("answeredQuestionCount", json!(65_536)),
        ("elapsedSeconds", json!("300")),
        ("revision", json!(-1)),
    ] {
        let candidate = with_field(&active_session(), field, value);
        assert!(
            serde_json::from_value::<ExamSession>(candidate).is_err(),
            "accepted unsafe numeric field: {field}"
        );
    }

    let overflow = with_field(&completed_result(), "correctCount", json!(65_535));
    let overflow = with_field(&overflow, "incorrectCount", json!(65_535));
    assert!(serde_json::from_value::<ExamResult>(overflow).is_err());
}

#[test]
fn result_counts_reconcile_without_deriving_a_pass_decision() {
    let result: ExamResult =
        serde_json::from_value(completed_result()).expect("valid partial training result");
    assert_eq!(result.correct_count + result.incorrect_count, 18);

    let mapped = ExamResultWire::try_from(&result).expect("result maps to wire");
    let wire = serde_json::to_value(mapped).expect("wire serializes");
    assert!(wire.get("passed").is_none());
    assert!(wire.get("pass_threshold").is_none());
    assert!(wire.get("answers").is_none());
}

#[test]
fn wire_contracts_reject_unknown_and_wrongly_typed_fields() {
    let fixtures = fixtures();
    let mut session = fixtures.valid_sessions[0].wire.clone();
    session["private_data"] = json!(true);
    assert!(serde_json::from_value::<ExamSessionWire>(session).is_err());

    let mut result = fixtures.valid_results[0].wire.clone();
    result["correct_count"] = json!("17");
    assert!(serde_json::from_value::<ExamResultWire>(result).is_err());
}

#[test]
fn unsupported_modes_locales_and_statuses_fail_during_deserialization() {
    for (field, value) in [
        ("mode", json!("practice")),
        ("locale", json!("en")),
        ("status", json!("unknown")),
    ] {
        let candidate = with_field(&active_session(), field, value);
        assert!(
            serde_json::from_value::<ExamSession>(candidate).is_err(),
            "accepted unsupported {field}"
        );
    }
}

#[test]
fn russian_plural_rules_match_the_shared_fixture() {
    for test_case in fixtures().plural_cases {
        let expected = match test_case.category.as_str() {
            "one" => RussianPluralCategory::One,
            "few" => RussianPluralCategory::Few,
            "many" => RussianPluralCategory::Many,
            category => panic!("unexpected plural fixture category: {category}"),
        };
        assert_eq!(russian_plural_category(test_case.value), expected);
        let count = u16::try_from(test_case.value).expect("fixture count fits u16");
        assert_eq!(
            format_question_count(Locale::Ru, count),
            test_case.questions
        );
        assert_eq!(format_duration(Locale::Ru, count), test_case.minutes);
    }
}

#[test]
fn russian_plural_rules_handle_negative_boundaries() {
    assert_eq!(russian_plural_category(-1), RussianPluralCategory::One);
    assert_eq!(russian_plural_category(-2), RussianPluralCategory::Few);
    assert_eq!(russian_plural_category(-11), RussianPluralCategory::Many);
    assert_eq!(
        russian_plural_category(i64::MIN),
        RussianPluralCategory::Many
    );
}

#[test]
fn localized_summaries_match_the_shared_fixture() {
    for test_case in fixtures().summary_cases {
        assert_eq!(
            format_exam_summary(test_case.locale, test_case.questions, test_case.minutes),
            test_case.expected
        );
    }
}

#[test]
fn labels_are_exhaustive_for_every_supported_locale_mode_and_status() {
    let locales = [Locale::Uz, Locale::Ru];
    let modes = [
        ExamMode::Exam,
        ExamMode::Training,
        ExamMode::Category,
        ExamMode::Ticket,
        ExamMode::GrandMock,
    ];
    let statuses = [
        SessionStatus::Draft,
        SessionStatus::Active,
        SessionStatus::Paused,
        SessionStatus::Completed,
        SessionStatus::Cancelled,
    ];

    for locale in locales {
        for mode in modes {
            assert!(!mode_label(locale, mode).trim().is_empty());
        }
        for status in statuses {
            assert!(!status_label(locale, status).trim().is_empty());
        }
    }
}

#[test]
fn uzbek_count_labels_are_intentionally_invariant() {
    for count in [0, 1, 2, 5, 11, 21, 100] {
        assert_eq!(
            format_question_count(Locale::Uz, count),
            format!("{count} ta savol")
        );
        assert_eq!(
            format_duration(Locale::Uz, count),
            format!("{count} daqiqa")
        );
    }
}
