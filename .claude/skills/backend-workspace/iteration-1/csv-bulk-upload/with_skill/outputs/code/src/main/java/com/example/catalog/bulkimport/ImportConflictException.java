package com.example.catalog.bulkimport;

/** A request that conflicts with existing state. Nothing was written. */
public class ImportConflictException extends RuntimeException {

    private final String code;

    public ImportConflictException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
