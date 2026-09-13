package com.example.orders.idempotency;

/**
 * Failure modes of the idempotency layer, each mapped to a distinct status in
 * {@link com.example.orders.api.ApiExceptionHandler}. They are separate types
 * because callers react differently: one is a client bug, one is "wait and ask
 * again", one is internal.
 */
public final class IdempotencyExceptions {

    private IdempotencyExceptions() {
    }

    /** Header absent or malformed. Client error; nothing was written. */
    public static class MissingKey extends RuntimeException {
        public MissingKey(String message) {
            super(message);
        }
    }

    /**
     * The key was used before with a different payload. This is never a retry —
     * it is a client that failed to mint a new key for a new intent. Answering
     * it with the stored order would hand back the wrong order.
     */
    public static class KeyReusedWithDifferentPayload extends RuntimeException {
        public KeyReusedWithDifferentPayload(String message) {
            super(message);
        }
    }

    /**
     * A request with this key is still running (only reachable in the two-phase
     * variant, or after a crash mid-request). The caller should retry the same
     * key after a short delay — not mint a new one.
     */
    public static class InProgress extends RuntimeException {
        public InProgress(String message) {
            super(message);
        }
    }

    /**
     * Internal invariant broken: the key is claimed and COMPLETED but the row
     * could not be read back. Signals a bug, not a client problem.
     */
    public static class InconsistentRecord extends IllegalStateException {
        public InconsistentRecord(String message) {
            super(message);
        }
    }
}
