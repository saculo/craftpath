/** The request handler: routes are matched on method and path. */
export function handle(request: Request): Response {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
        return new Response("hello");
    }
    return new Response("not found", { status: 404 });
}
