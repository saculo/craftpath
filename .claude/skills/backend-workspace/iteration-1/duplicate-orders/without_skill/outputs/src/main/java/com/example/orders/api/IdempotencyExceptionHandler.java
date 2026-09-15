package com.example.orders.api;

import com.example.orders.idempotency.IdempotencyInProgressException;
import com.example.orders.idempotency.IdempotencyKeyMissingException;
import com.example.orders.idempotency.IdempotencyKeyReusedException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.MissingRequestHeaderException;

@RestControllerAdvice
public class IdempotencyExceptionHandler {

    @ExceptionHandler({IdempotencyKeyMissingException.class, MissingRequestHeaderException.class})
    ProblemDetail missing(Exception e) {
        return problem(HttpStatus.BAD_REQUEST, "idempotency-key-required",
                "POST /orders requires an Idempotency-Key header (8..200 chars, unique per user action).");
    }

    @ExceptionHandler(IdempotencyKeyReusedException.class)
    ProblemDetail reused(IdempotencyKeyReusedException e) {
        return problem(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency-key-reused", e.getMessage());
    }

    @ExceptionHandler(IdempotencyInProgressException.class)
    ProblemDetail inProgress(IdempotencyInProgressException e) {
        ProblemDetail pd = problem(HttpStatus.CONFLICT, "idempotency-in-progress", e.getMessage());
        pd.setProperty("retryAfterMillis", 500);
        return pd;
    }

    private ProblemDetail problem(HttpStatus status, String type, String detail) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, detail);
        pd.setType(URI.create("https://errors.example.com/" + type));
        return pd;
    }
}
