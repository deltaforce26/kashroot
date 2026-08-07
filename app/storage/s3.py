"""S3-compatible MediaStorage backend (AWS S3, MinIO, any S3 API).

boto3 is imported lazily so that merely importing ``app.storage`` (or app modules that
type-hint the protocol) never pays the boto3 import cost — and tests that use the
in-memory fake never need it at all.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.storage.base import DEFAULT_URL_EXPIRY_SECONDS, content_disposition_for_key

if TYPE_CHECKING:
    from app.core.config import Settings


class S3MediaStorage:
    """MediaStorage over an S3-compatible endpoint.

    All configuration is passed at construction — this class never reads settings, so
    a test (or a second bucket) can build one against any endpoint.
    """

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        region: str = "us-east-1",
    ) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            # Pinned explicitly: MinIO and most S3-compatibles need path-style
            # addressing, and presigned URLs embed the region — never rely on the
            # ambient AWS environment for either.
            region_name=region,
            config=Config(
                s3={"addressing_style": "path"},
                connect_timeout=5,
                read_timeout=30,
            ),
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self.bucket, Key=key, Body=data, ContentType=content_type
        )

    def get_url(self, key: str, *, expires_in: int = DEFAULT_URL_EXPIRY_SECONDS) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                # Forced on the response: inline for images, attachment for PDFs
                # (blocks PDF-polyglot script execution in the browser viewer).
                "ResponseContentDisposition": content_disposition_for_key(key),
            },
            ExpiresIn=expires_in,
        )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return False
            raise
        return True


def s3_storage_from_settings(settings: Settings) -> S3MediaStorage:
    """Factory: the only place settings are read, and only at construction time."""
    return S3MediaStorage(
        bucket=settings.s3_bucket,
        endpoint_url=settings.s3_endpoint_url,
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key,
        region=settings.s3_region,
    )
