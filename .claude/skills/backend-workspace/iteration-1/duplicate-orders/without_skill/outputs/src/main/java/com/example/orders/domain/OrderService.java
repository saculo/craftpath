package com.example.orders.domain;

import com.example.orders.api.CreateOrderRequest;
import com.example.orders.api.OrderResponse;
import java.util.UUID;

/**
 * Illustrative business operation.
 *
 * <p>Contract required by {@link com.example.orders.idempotency.IdempotencyService}:
 * this method must be callable inside a caller-managed transaction and must have
 * <b>no side effects outside that transaction</b>. Anything external — payment
 * capture, confirmation email, warehouse notification — goes to an outbox table
 * written in the same transaction, and is published after commit. Otherwise a
 * rollback that is invisible to the idempotency ledger becomes a real-world action
 * with no order behind it.
 */
public interface OrderService {

    OrderResponse placeOrder(UUID customerId, CreateOrderRequest request, String idempotencyKey);
}
