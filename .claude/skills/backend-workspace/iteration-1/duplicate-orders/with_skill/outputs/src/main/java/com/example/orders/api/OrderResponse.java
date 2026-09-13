package com.example.orders.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record OrderResponse(
        UUID id,
        UUID customerId,
        String status,
        BigDecimal total,
        String currency,
        Instant createdAt) {
}
