package com.example.orders.order;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.example.orders.api.CreateOrderRequest;
import com.example.orders.api.OrderResponse;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Illustrative order creation. The parts that matter for this fix are the
 * transaction propagation and the outbox write.
 */
@Service
public class OrderService {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final PricingService pricing;

    public OrderService(JdbcTemplate jdbc, ObjectMapper objectMapper, PricingService pricing) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.pricing = pricing;
    }

    /**
     * {@code MANDATORY} is the enforcement, not documentation: this method must
     * run inside the transaction that claimed the idempotency key. If someone
     * later calls it from outside that path, it fails immediately rather than
     * quietly creating orders that no key protects.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public OrderResponse create(CreateOrderRequest request) {
        UUID orderId = UUID.randomUUID();
        BigDecimal total = pricing.total(request);
        Instant now = Instant.now();

        jdbc.update("""
                INSERT INTO orders (id, customer_id, status, total, currency, created_at)
                VALUES (?, ?, 'PLACED', ?, ?, ?)
                """,
                orderId, request.customerId(), total, request.currency(),
                java.sql.Timestamp.from(now));

        for (CreateOrderRequest.Line line : request.lines()) {
            jdbc.update("""
                    INSERT INTO order_line (order_id, sku_id, quantity)
                    VALUES (?, ?, ?)
                    """, orderId, line.skuId(), line.quantity());
        }

        // Side effects go through the outbox rather than happening here.
        //
        // Calling the payment provider inline would put a network call inside the
        // transaction that holds the idempotency claim: the lock is held for as
        // long as the provider takes, and a timeout leaves us unable to say
        // whether the charge happened. Recording intent and acting on it after
        // commit means a retried request rolls the intent back with everything
        // else, and the relay's own retries are safe because they carry the
        // order id as their deduplication key.
        enqueue(orderId, "order.placed", new OrderPlaced(orderId, request.customerId(), total));

        return new OrderResponse(orderId, request.customerId(), "PLACED",
                total, request.currency(), now);
    }

    private void enqueue(UUID orderId, String eventType, Object payload) {
        try {
            jdbc.update("""
                    INSERT INTO order_outbox (order_id, event_type, payload)
                    VALUES (?, ?, ?::jsonb)
                    """, orderId, eventType, objectMapper.writeValueAsString(payload));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("outbox payload is not serializable", e);
        }
    }

    private record OrderPlaced(UUID orderId, UUID customerId, BigDecimal total) {
    }

    /** Placeholder for whatever prices an order today. */
    public interface PricingService {
        BigDecimal total(CreateOrderRequest request);
    }
}
