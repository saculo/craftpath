package com.example.orders.api;

import java.net.URI;
import java.util.UUID;

import com.example.orders.idempotency.IdempotencyContext;
import com.example.orders.idempotency.IdempotencyExceptions;
import com.example.orders.idempotency.IdempotencyProperties;
import com.example.orders.idempotency.IdempotentExecutor;
import com.example.orders.idempotency.RequestFingerprint;
import com.example.orders.idempotency.StoredResponse;
import com.example.orders.order.OrderService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.validation.Valid;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders")
public class OrderController {

    private static final Logger log = LoggerFactory.getLogger(OrderController.class);

    static final String SCOPE = "POST /orders";
    static final String KEY_HEADER = "Idempotency-Key";
    static final String REPLAYED_HEADER = "Idempotency-Replayed";

    /** Long enough for a UUID or an opaque client token, short enough to index well. */
    private static final int MAX_KEY_LENGTH = 255;

    private final IdempotentExecutor executor;
    private final RequestFingerprint fingerprint;
    private final OrderService orders;
    private final CurrentCaller currentCaller;
    private final ObjectMapper objectMapper;
    private final IdempotencyProperties properties;

    public OrderController(IdempotentExecutor executor,
                           RequestFingerprint fingerprint,
                           OrderService orders,
                           CurrentCaller currentCaller,
                           ObjectMapper objectMapper,
                           IdempotencyProperties properties) {
        this.executor = executor;
        this.fingerprint = fingerprint;
        this.orders = orders;
        this.currentCaller = currentCaller;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    /**
     * Creates an order, at most once per {@code Idempotency-Key}.
     *
     * <p>Boundary contract:
     * <ul>
     *   <li>201 with {@code Location} — the order was created by this call</li>
     *   <li>201 with {@code Idempotency-Replayed: true} — a retry; the stored
     *       response of the original call, byte for byte</li>
     *   <li>400 — missing or malformed key, or a payload that fails validation;
     *       nothing written either way</li>
     *   <li>409 with {@code Retry-After} — same key still in flight</li>
     *   <li>422 — key reused with a different payload</li>
     * </ul>
     *
     * <p>Bean validation runs before anything here executes, so an invalid
     * payload never reaches the claim and never consumes a key.
     */
    @PostMapping
    public ResponseEntity<String> create(
            @RequestHeader(value = KEY_HEADER, required = false) String rawKey,
            @Valid @RequestBody CreateOrderRequest request) {

        UUID principalId = currentCaller.id();
        String key = requireKey(rawKey, principalId);

        IdempotencyContext context = new IdempotencyContext(
                SCOPE, principalId, key, fingerprint.of(request));

        StoredResponse response = executor.execute(context, () -> createOrder(request));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (response.resourceId() != null) {
            headers.setLocation(URI.create("/orders/" + response.resourceId()));
        }
        if (response.replayed()) {
            headers.set(REPLAYED_HEADER, "true");
        }
        return ResponseEntity.status(response.status()).headers(headers).body(response.body());
    }

    /** Runs inside the idempotency transaction; see {@code IdempotentTransaction}. */
    private StoredResponse createOrder(CreateOrderRequest request) {
        OrderResponse created = orders.create(request);
        return new StoredResponse(201, serialize(created), created.id(), false);
    }

    private String serialize(OrderResponse order) {
        try {
            return objectMapper.writeValueAsString(order);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("order response is not serializable", e);
        }
    }

    private String requireKey(String rawKey, UUID principalId) {
        String key = rawKey == null ? null : rawKey.trim();
        if (key == null || key.isEmpty()) {
            if (!properties.requireKey()) {
                // Rollout window: old mobile builds have no key yet. Log so we can
                // watch the number fall to zero before flipping requireKey on.
                log.warn("create order without {} header: principal={}", KEY_HEADER, principalId);
                return "legacy-" + UUID.randomUUID();
            }
            throw new IdempotencyExceptions.MissingKey(
                    KEY_HEADER + " header is required for POST /orders");
        }
        if (key.length() > MAX_KEY_LENGTH) {
            throw new IdempotencyExceptions.MissingKey(
                    KEY_HEADER + " must be at most " + MAX_KEY_LENGTH + " characters");
        }
        return key;
    }
}
