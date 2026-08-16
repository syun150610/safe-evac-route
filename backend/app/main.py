from fastapi import FastAPI

from app.api.router import api_router

app = FastAPI(title="Safe Evac Route API")
app.include_router(api_router)
