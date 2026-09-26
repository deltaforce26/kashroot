"""Tests for `app.services.twilio_whatsapp` — real `httpx.Client`s over
`httpx.MockTransport`, never a live Twilio call.
"""

from __future__ import annotations

import json
import unittest

import httpx

from app.services.twilio_consts import TWILIO_BODY_MAX_CHARS
from app.services.twilio_whatsapp import (
    NullWhatsAppSender,
    TwilioWhatsAppSender,
    truncate_body,
)


def _mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class TruncateBodyTests(unittest.TestCase):
    def test_short_text_unchanged(self) -> None:
        self.assertEqual(truncate_body("hello"), "hello")

    def test_long_text_is_cut_to_the_limit(self) -> None:
        text = "x" * (TWILIO_BODY_MAX_CHARS + 500)

        truncated = truncate_body(text)

        self.assertLessEqual(len(truncated), TWILIO_BODY_MAX_CHARS)
        self.assertTrue(truncated.endswith("(truncated)"))

    def test_exactly_at_limit_unchanged(self) -> None:
        text = "x" * TWILIO_BODY_MAX_CHARS

        self.assertEqual(truncate_body(text), text)


class TwilioWhatsAppSenderFreeformTests(unittest.TestCase):
    def test_sends_freeform_body_with_summary_and_link(self) -> None:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["form"] = dict(
                pair.split("=", 1) for pair in request.content.decode().split("&")
            )
            captured["auth"] = request.headers.get("authorization")

            return httpx.Response(201, json={"sid": "SM123"})

        sender = TwilioWhatsAppSender(
            account_sid="ACxxx",
            auth_token="tok",
            from_number="whatsapp:+14155238886",
            to_number="whatsapp:+972500000000",
            client=_mock_client(handler),
        )
        sender.send(summary="hello world", link="https://example.com/x")

        self.assertIn("Body", captured["form"])
        self.assertIsNotNone(captured["auth"])  # Basic auth header present

    def test_no_link_omits_link_from_body(self) -> None:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = request.content.decode()

            return httpx.Response(201, json={"sid": "SM123"})

        sender = TwilioWhatsAppSender(
            account_sid="ACxxx",
            auth_token="tok",
            from_number="whatsapp:+1",
            to_number="whatsapp:+972",
            client=_mock_client(handler),
        )
        sender.send(summary="just a result", link=None)

        self.assertIn("just", captured["body"])

    def test_non_2xx_raises(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(400, text="bad request")

        sender = TwilioWhatsAppSender(
            account_sid="ACxxx",
            auth_token="tok",
            from_number="whatsapp:+1",
            to_number="whatsapp:+972",
            client=_mock_client(handler),
        )
        with self.assertRaises(RuntimeError):
            sender.send(summary="x", link=None)


class TwilioWhatsAppSenderContentTemplateTests(unittest.TestCase):
    def test_uses_content_sid_and_variables_when_configured(self) -> None:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            form = dict(pair.split("=", 1) for pair in request.content.decode().split("&"))
            captured["form"] = form

            return httpx.Response(201, json={"sid": "SM123"})

        sender = TwilioWhatsAppSender(
            account_sid="ACxxx",
            auth_token="tok",
            from_number="whatsapp:+1",
            to_number="whatsapp:+972",
            content_sid="HXabc",
            client=_mock_client(handler),
        )
        sender.send(summary="the summary", link="https://example.com/y")

        self.assertIn("ContentSid", captured["form"])
        self.assertNotIn("Body", captured["form"])

    def test_content_variables_carry_summary_and_link(self) -> None:
        captured = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import urllib.parse

            form = urllib.parse.parse_qs(request.content.decode())
            captured["variables"] = json.loads(form["ContentVariables"][0])

            return httpx.Response(201, json={"sid": "SM123"})

        sender = TwilioWhatsAppSender(
            account_sid="ACxxx",
            auth_token="tok",
            from_number="whatsapp:+1",
            to_number="whatsapp:+972",
            content_sid="HXabc",
            client=_mock_client(handler),
        )
        sender.send(summary="the summary", link="https://example.com/y")

        self.assertEqual(captured["variables"]["1"], "the summary")
        self.assertEqual(captured["variables"]["2"], "https://example.com/y")


class NullWhatsAppSenderTests(unittest.TestCase):
    def test_send_does_nothing_and_never_raises(self) -> None:
        NullWhatsAppSender().send(summary="anything", link="https://x")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
