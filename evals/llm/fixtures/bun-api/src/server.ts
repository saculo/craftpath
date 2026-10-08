import { handle } from "./app";

Bun.serve({ port: 3000, fetch: handle });
