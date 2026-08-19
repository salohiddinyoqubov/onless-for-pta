pub const SERVICE_TYPE: &str = "_onless-exam._tcp.local.";
pub const DEFAULT_WS_PORT: u16 = 8765;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfo {
    pub server_id: String,
    pub server_name: String,
    pub ws_port: u16,
    pub protocol_version: String,
    pub room_id: Option<String>,
    pub client_count: u16,
    pub max_clients: u16,
}

impl ServerInfo {
    #[must_use]
    pub fn to_txt_properties(&self) -> Vec<(&'static str, String)> {
        let mut properties = vec![
            ("id", self.server_id.clone()),
            ("version", self.protocol_version.clone()),
            ("clients", self.client_count.to_string()),
            ("max", self.max_clients.to_string()),
        ];
        if let Some(room_id) = &self.room_id {
            properties.push(("room", room_id.clone()));
        }
        properties
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_complete_txt_properties() {
        let info = ServerInfo {
            server_id: "server-a".into(),
            server_name: "Exam room".into(),
            ws_port: DEFAULT_WS_PORT,
            protocol_version: "1.0".into(),
            room_id: Some("room-12".into()),
            client_count: 5,
            max_clients: 30,
        };

        assert_eq!(
            info.to_txt_properties(),
            vec![
                ("id", "server-a".into()),
                ("version", "1.0".into()),
                ("clients", "5".into()),
                ("max", "30".into()),
                ("room", "room-12".into()),
            ]
        );
    }

    #[test]
    fn omits_an_unassigned_room() {
        let info = ServerInfo {
            server_id: "server-a".into(),
            server_name: "Exam room".into(),
            ws_port: DEFAULT_WS_PORT,
            protocol_version: "1.0".into(),
            room_id: None,
            client_count: 0,
            max_clients: 30,
        };

        assert_eq!(info.to_txt_properties().len(), 4);
    }
}
