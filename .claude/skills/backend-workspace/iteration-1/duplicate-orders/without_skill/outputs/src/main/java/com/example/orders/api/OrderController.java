package com.example.orders.api;

import com.example.orders.domain.OrderService;
import com.example.orders.idempotency.IdempotencyScope;
import com.example.orders.idempotency.IdempotencyService;
import com.example.orders.idempotency.StoredResponse;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import java.net.URI;
import java.security.Principal;
import java.util.UUID;
import org.springframework.http.HttpStatus;
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

    private static final String SCOPE = "POST /orders";

    private final IdempotencyService idempotency;
    private final OrderService orders;
    private final ObjectMapper json;

    public OrderController(IdempotencyService idempotency, OrderService orders, ObjectMapper json) {
        this.idempotency = idempotency;
        this.orders = orders;
        this.json = json;
    }

    /**
     * Creating an order is not naturally idempotent, so the client supplies the
     * identity of the <em>attempt</em>: a UUID generated once, when the user taps
     * "Place order", and reused for every network retry of that same tap.
     *
     * <p>The header is required. Making it optional means the flaky-client bug is one
     * forgotten header away from returning, and it makes the server's guarantee
     * conditional on client discipline we cannot audit.
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> createOrder(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateOrderRequest request,
            Principal principal) {

        UUID customerId = UUID.fromString(principal.getName());
        var scope = new IdempotencyScope(SCOPE, customerId, idempotencyKey);

        var outcome = idempotency.execute(scope, request, () -> {
            OrderResponse created = orders.placeOrder(customerId, request, idempotencyKey);
            return new StoredResponse(HttpStatus.CREATED.value(), serialize(created), created.id());
        });

        var body = outcome.response();
        return ResponseEntity.status(body.status())
                .contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", idempotencyKey)
                // Lets clients and dashboards distinguish "created" from "already had one".
                .header("Idempotent-Replayed", Boolean.toString(outcome.replayed()))
                .location(URI.create("/orders/" + body.resourceId()))
                .body(body.bodyJson());
    }

    private String serialize(OrderResponse response) {
        try {
            return json.writeValueAsString(response);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot serialize order response", e);
        }
    }
}
