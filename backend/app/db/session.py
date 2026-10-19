"""TigerData (Timescale/Postgres) connection.

The app runs without a database when USE_DATABASE=false; every call site must
tolerate `None` so the demo never dies on a connection error.
"""

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine | None:
    global _engine, _SessionLocal
    settings = get_settings()
    if not settings.use_database or not settings.tigerdata_url:
        return None
    if _engine is None:
        # psycopg3 driver; TigerData requires sslmode=require in the URL.
        # The console hands out either postgres:// or postgresql://.
        url = settings.tigerdata_url
        for scheme in ("postgresql://", "postgres://"):
            if url.startswith(scheme):
                url = "postgresql+psycopg://" + url[len(scheme):]
                break
        # Pooling has to differ by host. A long-lived uvicorn process wants a
        # real pool; a serverless function does not. Each concurrent Vercel
        # instance gets its own process, so a pool of 5 there means 5 held
        # connections *per instance* and Timescale's connection ceiling is hit
        # under trivial load. NullPool opens one connection per request and
        # closes it, trading a little latency for not falling over.
        if os.environ.get("VERCEL"):
            _engine = create_engine(url, pool_pre_ping=True, poolclass=NullPool)
        else:
            _engine = create_engine(url, pool_pre_ping=True, pool_size=5)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


@contextmanager
def get_session() -> Iterator[Session | None]:
    if get_engine() is None or _SessionLocal is None:
        yield None
        return
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
