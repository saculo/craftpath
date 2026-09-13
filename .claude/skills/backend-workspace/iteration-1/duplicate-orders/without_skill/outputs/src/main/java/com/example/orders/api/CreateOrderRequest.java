package com.example.orders.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Positive;
import java.util.List;
import java.util.UUID;

public record CreateOrderRequest(
        @NotEmpty @Valid List<Line> lines,
        UUID shippingAddressId) {

    public record Line(UUID skuId, @Positive int quantity) {
    }
}
