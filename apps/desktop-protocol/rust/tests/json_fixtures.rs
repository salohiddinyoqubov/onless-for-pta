use onless_desktop_protocol::{ClientToServer, ServerToClient};
use serde_json::Value;
use std::collections::BTreeSet;

const SERVER_FIXTURES: &str = include_str!("../../fixtures/server-to-client.json");
const CLIENT_FIXTURES: &str = include_str!("../../fixtures/client-to-server.json");
const MALFORMED_DISCRIMINANTS: &str = include_str!("../../fixtures/malformed-discriminants.json");
const PARTIAL_IMAGE_PAIRS: &str = include_str!("../../fixtures/partial-image-pairs.json");
const INVALID_UUIDS: &str = include_str!("../../fixtures/invalid-uuids.json");

#[test]
fn server_messages_match_canonical_json() {
    let fixtures: Vec<Value> = serde_json::from_str(SERVER_FIXTURES).expect("valid fixture JSON");
    let fixture_types = fixtures
        .iter()
        .filter_map(|fixture| fixture["type"].as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        fixture_types,
        BTreeSet::from([
            "AnswerAck",
            "AnswerError",
            "ConfigUpdate",
            "ExamQuestion",
            "ExamStart",
            "ExamStop",
            "Ping",
            "PowerCommand",
            "ServerShutdown",
        ])
    );

    for fixture in fixtures {
        let message: ServerToClient =
            serde_json::from_value(fixture.clone()).expect("fixture matches Rust schema");
        assert_eq!(
            serde_json::to_value(message).expect("message serializes"),
            fixture
        );
    }
}

#[test]
fn client_messages_match_canonical_json() {
    let fixtures: Vec<Value> = serde_json::from_str(CLIENT_FIXTURES).expect("valid fixture JSON");
    let fixture_types = fixtures
        .iter()
        .filter_map(|fixture| fixture["type"].as_str())
        .collect::<BTreeSet<_>>();
    assert_eq!(
        fixture_types,
        BTreeSet::from([
            "AnswerSubmit",
            "ExamComplete",
            "Heartbeat",
            "Pong",
            "Register",
            "SubmitStudentInfo",
        ])
    );

    for fixture in fixtures {
        let message: ClientToServer =
            serde_json::from_value(fixture.clone()).expect("fixture matches Rust schema");
        assert_eq!(
            serde_json::to_value(message).expect("message serializes"),
            fixture
        );
    }
}

#[test]
fn malformed_discriminants_are_rejected() {
    let fixtures: Vec<Value> =
        serde_json::from_str(MALFORMED_DISCRIMINANTS).expect("valid fixture JSON");

    for fixture in fixtures {
        assert!(serde_json::from_value::<ServerToClient>(fixture.clone()).is_err());
        assert!(serde_json::from_value::<ClientToServer>(fixture).is_err());
    }
}

#[test]
fn registration_requires_a_valid_connection_code() {
    let missing = serde_json::json!({
        "type": "Register",
        "client_id": "kiosk-01",
        "client_name": "Exam Kiosk 01",
        "version": "1.0.0",
        "mac_address": null
    });
    let invalid = serde_json::json!({
        "type": "Register",
        "client_id": "kiosk-01",
        "client_name": "Exam Kiosk 01",
        "version": "1.0.0",
        "mac_address": null,
        "connection_code": "NOT-A-CODE"
    });

    assert!(serde_json::from_value::<ClientToServer>(missing).is_err());
    assert!(serde_json::from_value::<ClientToServer>(invalid).is_err());
}

#[test]
fn omitted_option_fields_serialize_as_null() {
    let registration = serde_json::json!({
        "type": "Register",
        "client_id": "kiosk-01",
        "client_name": "Exam Kiosk 01",
        "version": "1.0.0",
        "connection_code": "7J8D-9MQS"
    });

    let message = serde_json::from_value::<ClientToServer>(registration)
        .expect("an omitted optional MAC address is valid");
    let serialized = serde_json::to_value(message).expect("message serializes");
    assert_eq!(serialized["mac_address"], Value::Null);
}

#[test]
fn question_image_fields_must_be_provided_together() {
    let fixtures: Vec<Value> =
        serde_json::from_str(PARTIAL_IMAGE_PAIRS).expect("valid fixture JSON");

    for fixture in fixtures {
        assert!(serde_json::from_value::<ServerToClient>(fixture).is_err());
    }
}

#[test]
fn noncanonical_or_non_v4_uuids_are_rejected() {
    let fixtures: Vec<Value> = serde_json::from_str(INVALID_UUIDS).expect("valid fixture JSON");

    for fixture in fixtures {
        let case = fixture["case"].as_str().expect("fixture case");
        let session_id = fixture["value"].as_str().expect("fixture UUID");
        let message = serde_json::json!({
            "type": "ExamComplete",
            "session_id": session_id,
            "total_time_seconds": 1
        });

        assert!(
            serde_json::from_value::<ClientToServer>(message).is_err(),
            "accepted invalid UUID fixture: {case}"
        );
    }
}
