package com.example.orders.idempotency;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;

/**
 * Canonical hash of a request body, used to detect a client reusing one key for two
 * different requests.
 *
 * <p>Canonicalization matters: {@code {"a":1,"b":2}} and {@code {"b":2,"a":1}} are the
 * same request and must hash the same, otherwise a client that serializes from a
 * HashMap will get spurious 422s. Sorting map keys gives us that cheaply.
 */
public final class RequestFingerprint {

    private static final ObjectMapper CANONICAL = JsonMapper.builder()
            .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
            .build();

    private RequestFingerprint() {
    }

    public static byte[] of(Object requestBody) {
        try {
            byte[] canonical = CANONICAL.writeValueAsBytes(requestBody);
            return MessageDigest.getInstance("SHA-256").digest(canonical);
        } catch (JsonProcessingException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("cannot fingerprint request", e);
        }
    }

    /** Constant-time-ish comparison; not security critical, but cheap to do right. */
    public static boolean matches(byte[] a, byte[] b) {
        return MessageDigest.isEqual(a, b) || Arrays.equals(a, b);
    }

    public static String toHex(byte[] digest) {
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }

    public static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
