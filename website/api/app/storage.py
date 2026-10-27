# SPDX-License-Identifier: MIT
"""Where library files live: an S3 bucket (SeaweedFS in Compose); a dict in tests."""
from typing import BinaryIO, Protocol

from .config import settings


class Storage(Protocol):
    def put(self, key: str, data: BinaryIO, content_type: str = "application/octet-stream") -> None: ...
    def get(self, key: str) -> bytes | None: ...
    def delete(self, key: str) -> None: ...


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, key: str, data: BinaryIO, content_type: str = "application/octet-stream") -> None:
        self.objects[key] = data.read()

    def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


class S3Storage:
    def __init__(self) -> None:
        import boto3  # imported here: tests do not need it

        self._s3 = boto3.client(
            "s3", endpoint_url=settings.s3_endpoint, aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key, region_name="us-east-1",
        )

    def put(self, key: str, data: BinaryIO, content_type: str = "application/octet-stream") -> None:
        self._s3.upload_fileobj(data, settings.s3_bucket, key, ExtraArgs={"ContentType": content_type})

    def get(self, key: str) -> bytes | None:
        try:
            return self._s3.get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()
        except self._s3.exceptions.NoSuchKey:
            return None

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=settings.s3_bucket, Key=key)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = S3Storage() if settings.s3_endpoint else MemoryStorage()
    return _storage
