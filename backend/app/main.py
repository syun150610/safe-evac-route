from fastapi import FastAPI
from app.db.database import engine
from app.models import post  # noqa: F401 — registers model with Base
from app.db.database import Base

Base.metadata.create_all(bind=engine)

app = FastAPI(title="saigai_map API")


@app.get("/health")
def health():
    return {"status": "ok"}
