use serde::{Deserialize, Deserializer, Serializer, de};
use uuid::{Uuid, Variant, Version};

const INVALID_UUID_MESSAGE: &str =
    "expected a canonical lowercase hyphenated RFC 4122 UUID version 4";

fn parse(value: &str) -> Result<Uuid, &'static str> {
    let uuid = Uuid::parse_str(value).map_err(|_| INVALID_UUID_MESSAGE)?;

    if value != uuid.hyphenated().to_string()
        || uuid.get_version() != Some(Version::Random)
        || uuid.get_variant() != Variant::RFC4122
    {
        return Err(INVALID_UUID_MESSAGE);
    }

    Ok(uuid)
}

fn is_v4(uuid: &Uuid) -> bool {
    uuid.get_version() == Some(Version::Random) && uuid.get_variant() == Variant::RFC4122
}

pub fn serialize<S>(uuid: &Uuid, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if !is_v4(uuid) {
        return Err(serde::ser::Error::custom(INVALID_UUID_MESSAGE));
    }

    serializer.serialize_str(&uuid.hyphenated().to_string())
}

pub fn deserialize<'de, D>(deserializer: D) -> Result<Uuid, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    parse(&value).map_err(de::Error::custom)
}

pub mod option {
    use super::{INVALID_UUID_MESSAGE, is_v4, parse};
    use serde::{Deserialize, Deserializer, Serializer, de};
    use uuid::Uuid;

    // Serde's `with` module convention requires a reference to the field's exact type.
    #[allow(clippy::ref_option)]
    pub fn serialize<S>(uuid: &Option<Uuid>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match uuid {
            Some(value) if is_v4(value) => {
                serializer.serialize_some(&value.hyphenated().to_string())
            }
            Some(_) => Err(serde::ser::Error::custom(INVALID_UUID_MESSAGE)),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<Uuid>, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<String>::deserialize(deserializer)?
            .map(|value| parse(&value).map_err(de::Error::custom))
            .transpose()
    }
}
