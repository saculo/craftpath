package com.example.orders.api;

import java.math.BigDecimal;
import java.util.UUID;

public record OrderResponse(UUID id, String status, BigDecimal total) {
}
