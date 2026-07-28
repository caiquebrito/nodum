"""Shared utilities imported by every module in this fixture project."""


def get_db_connection():
    """Return a handle to the shared database connection."""
    return {"status": "connected"}


def log(message):
    """Write a message to the shared application log."""
    print(f"[log] {message}")


class Config:
    """Application-wide configuration, read by every module."""

    def __init__(self, env="development"):
        self.env = env
