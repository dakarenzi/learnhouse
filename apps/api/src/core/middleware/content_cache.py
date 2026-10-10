"""Keep all content-file responses out of shared caches, including errors."""

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ContentNoStoreMiddleware:
    """Override cache policy for every /content response, including auth errors."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or "/content/" not in scope.get("path", ""):
            await self.app(scope, receive, send)
            return

        async def no_store_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != b"cache-control"
                ]
                headers.append((b"cache-control", b"private, no-store"))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, no_store_send)
