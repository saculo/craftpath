package com.example.orders.api;

import com.example.orders.idempotency.IdempotencyExceptions;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Maps idempotency failures to statuses a client can actually act on.
 *
 * <p>The distinction that matters to a retrying mobile client: 409 means "retry
 * this same key", 422 means "your key is wrong, do not retry it", 400 means "fix
 * the request". Collapsing these into one status is what makes clients retry
 * things that will never succeed.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(IdempotencyExceptions.MissingKey.class)
    public ProblemDetail handleMissingKey(IdempotencyExceptions.MissingKey e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
        problem.setTitle("Missing idempotency key");
        problem.setType(java.net.URI.create("https://errors.example.com/idempotency-key-missing"));
        return problem;
    }

    @ExceptionHandler(IdempotencyExceptions.KeyReusedWithDifferentPayload.class)
    public ProblemDetail handleKeyReuse(IdempotencyExceptions.KeyReusedWithDifferentPayload e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.UNPROCESSABLE_ENTITY, e.getMessage());
        problem.setTitle("Idempotency key reused");
        problem.setType(java.net.URI.create("https://errors.example.com/idempotency-key-reused"));
        return problem;
    }

    @ExceptionHandler(IdempotencyExceptions.InProgress.class)
    public ResponseEntity<ProblemDetail> handleInProgress(IdempotencyExceptions.InProgress e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, e.getMessage());
        problem.setTitle("Request in progress");
        problem.setType(java.net.URI.create("https://errors.example.com/idempotency-in-progress"));
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .header("Retry-After", "1")
                .body(problem);
    }

    @ExceptionHandler(IdempotencyExceptions.InconsistentRecord.class)
    public ProblemDetail handleInconsistent(IdempotencyExceptions.InconsistentRecord e) {
        // Our bug, not the caller's. Detail stays server-side.
        log.error("idempotency invariant violated", e);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR,
                "The request could not be completed. Retry with the same Idempotency-Key.");
        problem.setTitle("Internal error");
        return problem;
    }
}
