package com.example.orders.idempotency;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;

import org.springframework.stereotype.Component;

/**
 * Hashes the <em>canonical</em> form of a validated request payload.
 *
 * <p>Hashing the raw bytes would be simpler but wrong in practice: a retry is
 * re-serialized by the client and can differ in key order or whitespace while
 * meaning exactly the same thing. That would turn a legitimate retry into a 422.
 * Serializing the parsed DTO with properties sorted gives a form that is stable
 * across such cosmetic differences and still changes when any field changes.
 *
 * <p>Consequence worth knowing: fields the DTO does not model are invisible to
 * the hash. Keep the DTO complete.
 */
@Component
public class RequestFingerprint {

    private final ObjectMapper canonical = JsonMapper.builder()
            .enable(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY)
            .build();

    public String of(Object payload) {
        try {
            byte[] json = canonical.writeValueAsBytes(payload);
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(sha256.digest(json));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalArgumentException("payload is not serializable for fingerprinting", e);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Constant-time compare; the hash is not a secret but the habit is cheap. */
    public boolean matches(String a, String b) {
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8));
    }
}
