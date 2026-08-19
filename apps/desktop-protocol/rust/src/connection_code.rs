use std::{error::Error, fmt, str::FromStr};

use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENTROPY_BYTES: usize = 5;
const ENCODED_LENGTH: usize = 8;
const DISPLAY_LENGTH: usize = 9;

/// A validated 40-bit Crockford Base32 pairing code in two four-character groups.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionCode {
    encoded: String,
    entropy: [u8; ENTROPY_BYTES],
}

impl ConnectionCode {
    /// Encodes exactly 40 bits into a connection code.
    #[must_use]
    pub fn from_entropy(entropy: [u8; ENTROPY_BYTES]) -> Self {
        let mut value = u64::from_be_bytes([
            0, 0, 0, entropy[0], entropy[1], entropy[2], entropy[3], entropy[4],
        ]);
        let mut encoded = [b'0'; DISPLAY_LENGTH];
        encoded[4] = b'-';

        for output_index in (0..ENCODED_LENGTH).rev() {
            let display_index = if output_index < 4 {
                output_index
            } else {
                output_index + 1
            };
            encoded[display_index] = ALPHABET[(value & 0x1f) as usize];
            value >>= 5;
        }

        Self {
            encoded: encoded.into_iter().map(char::from).collect(),
            entropy,
        }
    }

    /// Decodes the code back to its original 40-bit value.
    #[must_use]
    pub fn entropy(&self) -> [u8; ENTROPY_BYTES] {
        self.entropy
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.encoded
    }
}

impl fmt::Display for ConnectionCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.encoded)
    }
}

impl FromStr for ConnectionCode {
    type Err = ConnectionCodeError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let bytes = value.as_bytes();
        if bytes.len() != DISPLAY_LENGTH || bytes[4] != b'-' {
            return Err(ConnectionCodeError);
        }

        if bytes
            .iter()
            .enumerate()
            .any(|(index, byte)| index != 4 && !ALPHABET.contains(byte))
        {
            return Err(ConnectionCodeError);
        }

        let mut decoded = 0_u64;
        for byte in bytes.iter().copied().filter(|byte| *byte != b'-') {
            let Some(digit) = ALPHABET.iter().position(|candidate| *candidate == byte) else {
                return Err(ConnectionCodeError);
            };
            decoded = (decoded << 5) | digit as u64;
        }
        let decoded = decoded.to_be_bytes();

        Ok(Self {
            encoded: value.to_owned(),
            entropy: [decoded[3], decoded[4], decoded[5], decoded[6], decoded[7]],
        })
    }
}

impl Serialize for ConnectionCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ConnectionCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectionCodeError;

impl fmt::Display for ConnectionCodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(
            "connection code must contain two Crockford Base32 groups separated by a hyphen",
        )
    }
}

impl Error for ConnectionCodeError {}

/// Generates a pairing code with operating-system cryptographic randomness.
#[must_use]
pub fn generate_connection_code() -> ConnectionCode {
    let mut entropy = [0_u8; ENTROPY_BYTES];
    OsRng.fill_bytes(&mut entropy);
    ConnectionCode::from_entropy(entropy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_encoding_and_round_trip() {
        let cases = [
            ([0x00, 0x00, 0x00, 0x00, 0x00], "0000-0000"),
            ([0xff, 0xff, 0xff, 0xff, 0xff], "ZZZZ-ZZZZ"),
            ([0x3c, 0x91, 0xa7, 0x52, 0xf8], "7J8T-EMQR"),
        ];

        for (entropy, expected) in cases {
            let code = ConnectionCode::from_entropy(entropy);
            assert_eq!(code.as_str(), expected);
            assert_eq!(code.entropy(), entropy);
            assert_eq!(expected.parse::<ConnectionCode>(), Ok(code));
        }
    }

    #[test]
    fn rejects_noncanonical_codes() {
        for invalid in [
            "7J8TEMQR",
            "7J8T-EMQ",
            "7J8T-EMQO",
            "7j8t-emqr",
            "7J8T_EMQR",
        ] {
            assert!(
                invalid.parse::<ConnectionCode>().is_err(),
                "accepted {invalid}"
            );
        }
    }

    #[test]
    fn generated_code_has_a_valid_format() {
        let generated = generate_connection_code();
        assert_eq!(generated.as_str().parse::<ConnectionCode>(), Ok(generated));
    }
}
