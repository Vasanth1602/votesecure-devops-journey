import hashlib
import os
import random
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, Optional

import jwt
import psycopg2
import redis
import socketio
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from psycopg2.extras import RealDictCursor

load_dotenv()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


class Config:
    port = int(os.getenv("PORT", "5000"))

    db_host = os.getenv("DB_HOST", "")
    db_port = int(os.getenv("DB_PORT", "5432"))
    db_name = os.getenv("DB_NAME", "")
    db_user = os.getenv("DB_USER", "")
    db_password = os.getenv("DB_PASSWORD", "")

    redis_host = os.getenv("REDIS_HOST", "localhost")
    redis_port = int(os.getenv("REDIS_PORT", "6379"))

    jwt_access_secret = os.getenv("JWT_ACCESS_SECRET", "")
    jwt_refresh_secret = os.getenv("JWT_REFRESH_SECRET", "")
    jwt_access_expiry = os.getenv("JWT_ACCESS_EXPIRY", "15m")
    jwt_refresh_expiry = os.getenv("JWT_REFRESH_EXPIRY", "7d")

    encryption_key = os.getenv("ENCRYPTION_KEY", "")

    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")

    client_url = os.getenv("CLIENT_URL", "http://localhost:5173")

    admin_name = os.getenv("ADMIN_NAME", "").strip()
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD", "")


def parse_expiry(value: str) -> timedelta:
    if value.endswith("m"):
        return timedelta(minutes=int(value[:-1]))
    if value.endswith("h"):
        return timedelta(hours=int(value[:-1]))
    if value.endswith("d"):
        return timedelta(days=int(value[:-1]))
    return timedelta(minutes=15)


def validate_env() -> None:
    required = [
        "JWT_ACCESS_SECRET",
        "JWT_REFRESH_SECRET",
        "ENCRYPTION_KEY",
        "DB_HOST",
        "DB_PORT",
        "DB_NAME",
        "DB_USER",
        "DB_PASSWORD",
        "ADMIN_NAME",
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD",
    ]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required env variables: {', '.join(missing)}")

    if len(Config.encryption_key.encode("utf-8")) != 32:
        raise RuntimeError("ENCRYPTION_KEY must be exactly 32 bytes for AES-256-CBC")

    if not Config.admin_email or "@" not in Config.admin_email:
        raise RuntimeError("ADMIN_EMAIL must be a valid email")

    if not Config.admin_password or len(Config.admin_password) < 8:
        raise RuntimeError("ADMIN_PASSWORD must be at least 8 characters")


def db_connect():
    return psycopg2.connect(
        host=Config.db_host,
        port=Config.db_port,
        dbname=Config.db_name,
        user=Config.db_user,
        password=Config.db_password,
        cursor_factory=RealDictCursor,
    )


redis_client = redis.Redis(host=Config.redis_host, port=Config.redis_port, decode_responses=True)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def sign_access_token(user: Dict[str, Any]) -> str:
    payload = {
        "id": str(user["id"]),
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "exp": now_utc() + parse_expiry(Config.jwt_access_expiry),
    }
    return jwt.encode(payload, Config.jwt_access_secret, algorithm="HS256")


def sign_refresh_token(user: Dict[str, Any]) -> str:
    payload = {
        "id": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "exp": now_utc() + parse_expiry(Config.jwt_refresh_expiry),
    }
    return jwt.encode(payload, Config.jwt_refresh_secret, algorithm="HS256")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def generate_otp() -> str:
    return f"{random.randint(100000, 999999)}"


def otp_expiry(minutes: int = 10) -> datetime:
    return now_utc() + timedelta(minutes=minutes)


def parse_iso_datetime(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def encrypt_text(plain_text: str) -> str:
    key = Config.encryption_key.encode("utf-8")
    iv = get_random_bytes(16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    data = plain_text.encode("utf-8")
    pad = 16 - (len(data) % 16)
    data += bytes([pad] * pad)
    encrypted = cipher.encrypt(data)
    return f"{iv.hex()}:{encrypted.hex()}"


def send_email(subject: str, body_html: str, recipient: str) -> None:
    if not all([Config.smtp_host, Config.smtp_user, Config.smtp_pass, recipient]):
        raise RuntimeError("SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in backend/.env")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"VoteSecure <{Config.smtp_user}>"
    msg["To"] = recipient
    msg.set_content("This email requires HTML support.")
    msg.add_alternative(body_html, subtype="html")

    try:
        with smtplib.SMTP(Config.smtp_host, Config.smtp_port, timeout=15) as server:
            server.starttls()
            server.login(Config.smtp_user, Config.smtp_pass)
            server.send_message(msg)
    except Exception as exc:
        raise RuntimeError(f"Failed to send email: {exc}") from exc


def send_otp_email(email: str, otp: str) -> None:
    send_email(
        "Your OTP Verification Code",
        f"<h2>VoteSecure</h2><p>Your OTP code is: <strong style='font-size:24px'>{otp}</strong></p><p>Expires in 10 minutes.</p>",
        email,
    )


def send_vote_confirmation_email(email: str, election_title: str, candidate_name: str) -> None:
    send_email(
        "Vote Confirmation",
        f"<h2>Vote Confirmed!</h2><p>You have successfully voted in <strong>{election_title}</strong> for <strong>{candidate_name}</strong>. Your vote is encrypted and secured.</p>",
        email,
    )


def error(message: str, code: int) -> None:
    raise HTTPException(status_code=code, detail={"error": message})


def compute_hash(previous_hash: str, event_data: Dict[str, Any]) -> str:
    return hashlib.sha256((previous_hash + str(event_data)).encode("utf-8")).hexdigest()


def audit_log(
    event_type: str,
    actor_id: Optional[str],
    actor_email: Optional[str],
    target_id: Optional[str],
    target_type: Optional[str],
    description: str,
    ip_address: Optional[str],
) -> None:
    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT current_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1")
            prev = cur.fetchone()
            previous_hash = prev["current_hash"] if prev else "0" * 64
            event = {
                "eventType": event_type,
                "actorId": actor_id,
                "actorEmail": actor_email,
                "targetId": target_id,
                "targetType": target_type,
                "description": description,
                "createdAt": now_utc().isoformat(),
            }
            current_hash = compute_hash(previous_hash, event)
            cur.execute(
                """
                INSERT INTO audit_logs
                (event_type, actor_id, actor_email, target_id, target_type, description, ip_address, previous_hash, current_hash)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    event_type,
                    actor_id,
                    actor_email,
                    target_id,
                    target_type,
                    description,
                    ip_address,
                    previous_hash,
                    current_hash,
                ),
            )
    finally:
        conn.close()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials or not credentials.scheme.lower() == "bearer":
        error("No token provided", status.HTTP_401_UNAUTHORIZED)

    token = credentials.credentials
    if redis_client.get(f"blacklist:{token}"):
        error("Token revoked", status.HTTP_401_UNAUTHORIZED)

    try:
        payload = jwt.decode(token, Config.jwt_access_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        error("Invalid or expired token", status.HTTP_401_UNAUTHORIZED)

    payload["token"] = token
    return payload


def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        error("Admin access required", status.HTTP_403_FORBIDDEN)
    return user


def as_json(data: Any, status_code: int = 200):
    return JSONResponse(content=data, status_code=status_code)


def to_iso(row: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def format_exception(exc: HTTPException):
    if isinstance(exc.detail, dict):
        return exc.detail
    return {"error": str(exc.detail)}


fastapi_app = FastAPI()

client_origins = [origin.strip() for origin in Config.client_url.split(",") if origin.strip()]
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=client_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=client_origins)
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)


@sio.event
async def connect(sid, environ, auth):
    return


@sio.on("joinElection")
async def join_election(sid, election_id):
    await sio.enter_room(sid, f"election:{election_id}")


@sio.on("leaveElection")
async def leave_election(sid, election_id):
    await sio.leave_room(sid, f"election:{election_id}")


async def emit_results_update(election_id: str, payload: Dict[str, Any]):
    await sio.emit("resultsUpdated", payload, room=f"election:{election_id}")


async def emit_status_change(election_id: str, status_value: str):
    await sio.emit("electionStatusChanged", {"electionId": election_id, "status": status_value}, room=f"election:{election_id}")


def login_rate_limit(request: Request, max_requests: int = 5, window_seconds: int = 60):
    key = f"rate:{request.client.host if request.client else 'unknown'}:{request.url.path}"
    count = redis_client.incr(key)
    if count == 1:
        redis_client.expire(key, window_seconds)
    if count > max_requests:
        error("Too many requests. Please slow down.", status.HTTP_429_TOO_MANY_REQUESTS)


def build_election_results(election_id: str) -> Dict[str, Any]:
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.id as candidate_id, c.name, c.party, COUNT(v.id)::int as vote_count
                FROM candidates c
                LEFT JOIN votes v ON v.candidate_id = c.id
                WHERE c.election_id = %s
                GROUP BY c.id, c.name, c.party
                ORDER BY vote_count DESC
                """,
                (election_id,),
            )
            rows = [to_iso(r) for r in cur.fetchall()]
            total_votes = sum(int(r.get("vote_count") or 0) for r in rows)
            for row in rows:
                vote_count = int(row.get("vote_count") or 0)
                row["percentage"] = round((vote_count / total_votes) * 100, 2) if total_votes else 0
            return {"results": rows, "total_votes": total_votes}
    finally:
        conn.close()


@fastapi_app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content=format_exception(exc))


@fastapi_app.get("/health")
async def health():
    return {"status": "ok"}


@fastapi_app.post("/api/auth/register")
async def register(request: Request):
    body = await request.json()
    name = str(body.get("name", "")).strip()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    role = body.get("role")

    if not name or "@" not in email or len(password) < 8 or role != "voter":
        return as_json({"error": "Invalid registration payload"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cur.fetchone():
                return as_json({"error": "Email already exists"}, 409)

            cur.execute(
                """
                INSERT INTO users (name, email, password_hash, role, is_verified, otp_code, otp_expires_at)
                VALUES (%s,%s,%s,%s,TRUE,NULL,NULL)
                """,
                (name, email, hash_password(password), "voter"),
            )

        return as_json({"message": "Registration successful. You can now log in."}, 201)
    finally:
        conn.close()


@fastapi_app.post("/api/auth/verify-otp")
async def verify_otp(request: Request):
    body = await request.json()
    email = str(body.get("email", "")).strip().lower()
    otp = str(body.get("otp", "")).strip()
    if "@" not in email or len(otp) != 6:
        return as_json({"error": "Invalid OTP payload"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s LIMIT 1", (email,))
            user = cur.fetchone()
            if not user or not user.get("otp_code") or user["otp_code"] != otp:
                return as_json({"error": "Invalid OTP"}, 400)
            if not user.get("otp_expires_at") or user["otp_expires_at"] < now_utc():
                return as_json({"error": "OTP has expired"}, 400)

            cur.execute(
                """
                UPDATE users
                SET is_verified = TRUE, otp_code = NULL, otp_expires_at = NULL, updated_at = NOW()
                WHERE id = %s
                """,
                (str(user["id"]),),
            )

        audit_log(
            "USER_VERIFIED",
            str(user["id"]),
            user["email"],
            str(user["id"]),
            "user",
            "User verified OTP and activated account",
            request.client.host if request.client else None,
        )
        return {"message": "Email verified. You can now log in."}
    finally:
        conn.close()


@fastapi_app.post("/api/auth/resend-otp")
async def resend_otp(request: Request):
    body = await request.json()
    email = str(body.get("email", "")).strip().lower()
    if "@" not in email:
        return as_json({"error": "Invalid email"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s LIMIT 1", (email,))
            user = cur.fetchone()
            if not user:
                return as_json({"error": "User not found"}, 404)
            if user.get("is_verified"):
                return as_json({"error": "Account is already verified"}, 400)

            otp = generate_otp()
            cur.execute(
                "UPDATE users SET otp_code = %s, otp_expires_at = %s, updated_at = NOW() WHERE id = %s",
                (otp, otp_expiry(), str(user["id"])),
            )

            try:
                send_otp_email(email, otp)
            except RuntimeError as exc:
                return as_json({"error": str(exc)}, 503)

        return {"message": "OTP resent successfully"}
    finally:
        conn.close()


@fastapi_app.post("/api/auth/login")
async def login(request: Request):
    login_rate_limit(request)
    body = await request.json()
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if "@" not in email or not password:
        return as_json({"error": "Invalid login payload"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE email = %s LIMIT 1", (email,))
            user = cur.fetchone()
            if not user or not verify_password(password, user["password_hash"]):
                return as_json({"error": "Invalid credentials"}, 401)

            access_token = sign_access_token(user)
            refresh_token = sign_refresh_token(user)
            cur.execute(
                "UPDATE users SET refresh_token = %s, updated_at = NOW() WHERE id = %s",
                (refresh_token, str(user["id"])),
            )

        audit_log(
            "USER_LOGIN",
            str(user["id"]),
            user["email"],
            str(user["id"]),
            "user",
            "User logged in",
            request.client.host if request.client else None,
        )

        return {
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "user": {
                "id": str(user["id"]),
                "name": user["name"],
                "email": user["email"],
                "role": user["role"],
            },
        }
    finally:
        conn.close()


@fastapi_app.post("/api/auth/refresh")
async def refresh_token(request: Request):
    body = await request.json()
    old_token = body.get("refreshToken")
    if not old_token:
        return as_json({"error": "refreshToken is required"}, 400)

    try:
        payload = jwt.decode(old_token, Config.jwt_refresh_secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return as_json({"error": "Invalid refresh token"}, 401)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM users WHERE id = %s LIMIT 1", (payload["id"],))
            user = cur.fetchone()
            if not user or user.get("refresh_token") != old_token:
                return as_json({"error": "Refresh token mismatch"}, 401)

            access_token = sign_access_token(user)
            new_refresh = sign_refresh_token(user)
            cur.execute(
                "UPDATE users SET refresh_token = %s, updated_at = NOW() WHERE id = %s",
                (new_refresh, str(user["id"])),
            )

        return {"accessToken": access_token, "refreshToken": new_refresh}
    finally:
        conn.close()


@fastapi_app.post("/api/auth/logout")
async def logout(request: Request, user=Depends(get_current_user)):
    token = user.get("token")
    try:
        decoded = jwt.decode(token, Config.jwt_access_secret, algorithms=["HS256"], options={"verify_exp": False})
        exp = decoded.get("exp", 0)
        ttl = max(1, int(exp - datetime.now(timezone.utc).timestamp()))
    except Exception:
        ttl = 60

    redis_client.setex(f"blacklist:{token}", ttl, "1")

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("UPDATE users SET refresh_token = NULL, updated_at = NOW() WHERE id = %s", (user["id"],))

        audit_log(
            "USER_LOGOUT",
            str(user["id"]),
            user.get("email"),
            str(user["id"]),
            "user",
            "User logged out",
            request.client.host if request.client else None,
        )
    finally:
        conn.close()

    return {"message": "Logged out"}


@fastapi_app.get("/api/auth/me")
async def me(user=Depends(get_current_user)):
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
    }


def get_election_by_id(election_id: str) -> Optional[Dict[str, Any]]:
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            election = cur.fetchone()
            return to_iso(election) if election else None
    finally:
        conn.close()


@fastapi_app.post("/api/elections")
async def create_election(request: Request, user=Depends(require_admin)):
    body = await request.json()
    title = str(body.get("title", "")).strip()
    description = body.get("description")
    start_time = body.get("start_time")
    end_time = body.get("end_time")

    if not title or not start_time or not end_time:
        return as_json({"error": "Invalid election payload"}, 400)

    start_dt = parse_iso_datetime(start_time)
    end_dt = parse_iso_datetime(end_time)
    if not start_dt or not end_dt:
        return as_json({"error": "Invalid date format for start_time or end_time"}, 400)
    if end_dt <= start_dt:
        return as_json({"error": "end_time must be after start_time"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO elections (title, description, start_time, end_time, status, created_by)
                VALUES (%s,%s,%s,%s,'upcoming',%s)
                RETURNING *
                """,
                (title, description, start_dt, end_dt, user["id"]),
            )
            row = to_iso(cur.fetchone())

        audit_log(
            "ELECTION_CREATED",
            user["id"],
            user["email"],
            row["id"],
            "election",
            f"Election created: {title}",
            request.client.host if request.client else None,
        )
        return as_json(row, 201)
    finally:
        conn.close()


@fastapi_app.get("/api/elections")
async def get_elections(user=Depends(get_current_user)):
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.*,
                       COUNT(DISTINCT c.id) AS candidate_count,
                       COUNT(DISTINCT v.voter_id) AS voter_count
                FROM elections e
                LEFT JOIN candidates c ON c.election_id = e.id
                LEFT JOIN votes v ON v.election_id = e.id
                GROUP BY e.id
                ORDER BY e.start_time DESC
                """
            )
            return [to_iso(row) for row in cur.fetchall()]
    finally:
        conn.close()


@fastapi_app.get("/api/elections/{election_id}")
async def get_election(election_id: str, user=Depends(get_current_user)):
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            election = cur.fetchone()
            if not election:
                return as_json({"error": "Election not found"}, 404)

            cur.execute("SELECT * FROM candidates WHERE election_id = %s ORDER BY created_at ASC", (election_id,))
            candidates = [to_iso(row) for row in cur.fetchall()]
            payload = to_iso(election)
            payload["candidates"] = candidates
            return payload
    finally:
        conn.close()


@fastapi_app.put("/api/elections/{election_id}")
async def update_election(election_id: str, request: Request, user=Depends(require_admin)):
    body = await request.json()
    title = str(body.get("title", "")).strip()
    description = body.get("description")
    start_time = body.get("start_time")
    end_time = body.get("end_time")

    if not title or not start_time or not end_time:
        return as_json({"error": "Invalid election payload"}, 400)

    start_dt = parse_iso_datetime(start_time)
    end_dt = parse_iso_datetime(end_time)
    if not start_dt or not end_dt:
        return as_json({"error": "Invalid date format for start_time or end_time"}, 400)
    if end_dt <= start_dt:
        return as_json({"error": "end_time must be after start_time"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            current = cur.fetchone()
            if not current:
                return as_json({"error": "Election not found"}, 404)
            if current["status"] != "upcoming":
                return as_json({"error": "Only upcoming elections can be updated"}, 400)

            cur.execute(
                """
                UPDATE elections
                SET title = %s, description = %s, start_time = %s, end_time = %s, updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                (title, description, start_dt, end_dt, election_id),
            )
            updated = to_iso(cur.fetchone())

        audit_log(
            "ELECTION_UPDATED",
            user["id"],
            user["email"],
            election_id,
            "election",
            f"Election updated: {title}",
            request.client.host if request.client else None,
        )
        return updated
    finally:
        conn.close()


transition_map = {"upcoming": ["active"], "active": ["closed"], "closed": []}


@fastapi_app.patch("/api/elections/{election_id}/status")
async def update_election_status(election_id: str, request: Request, user=Depends(require_admin)):
    body = await request.json()
    status_value = body.get("status")
    if status_value not in ["active", "closed"]:
        return as_json({"error": "status must be active or closed"}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            existing = cur.fetchone()
            if not existing:
                return as_json({"error": "Election not found"}, 404)

            current = existing["status"]
            if status_value not in transition_map.get(current, []):
                return as_json({"error": f"Invalid status transition from {current} to {status_value}"}, 400)

            cur.execute(
                "UPDATE elections SET status = %s, updated_at = NOW() WHERE id = %s RETURNING *",
                (status_value, election_id),
            )
            updated = to_iso(cur.fetchone())

        audit_log(
            "ELECTION_STATUS_CHANGED",
            user["id"],
            user["email"],
            election_id,
            "election",
            f"Election status changed from {current} to {status_value}",
            request.client.host if request.client else None,
        )

        await emit_status_change(election_id, status_value)
        return updated
    finally:
        conn.close()


@fastapi_app.delete("/api/elections/{election_id}")
async def delete_election(election_id: str, request: Request, user=Depends(require_admin)):
    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            election = cur.fetchone()
            if not election:
                return as_json({"error": "Election not found"}, 404)
            if election["status"] != "upcoming":
                return as_json({"error": "Only upcoming elections can be deleted"}, 400)

            cur.execute("DELETE FROM elections WHERE id = %s", (election_id,))

        audit_log(
            "ELECTION_DELETED",
            user["id"],
            user["email"],
            election_id,
            "election",
            f"Election deleted: {election['title']}",
            request.client.host if request.client else None,
        )
        return {"message": "Election deleted successfully"}
    finally:
        conn.close()


def validate_candidate_payload(body: Dict[str, Any]) -> Optional[str]:
    name = str(body.get("name", "")).strip()
    if not name:
        return "name is required"
    photo_url = body.get("photo_url")
    if photo_url and not str(photo_url).startswith(("http://", "https://")):
        return "photo_url must be a valid URL"
    return None


@fastapi_app.post("/api/elections/{election_id}/candidates")
async def add_candidate(election_id: str, request: Request, user=Depends(require_admin)):
    body = await request.json()
    validation_error = validate_candidate_payload(body)
    if validation_error:
        return as_json({"error": validation_error}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            election = cur.fetchone()
            if not election:
                return as_json({"error": "Election not found"}, 404)
            if election["status"] != "upcoming":
                return as_json({"error": "Candidates can only be added to upcoming elections"}, 400)

            cur.execute(
                """
                INSERT INTO candidates (election_id, name, party, bio, photo_url)
                VALUES (%s,%s,%s,%s,%s)
                RETURNING *
                """,
                (election_id, body.get("name"), body.get("party"), body.get("bio"), body.get("photo_url")),
            )
            candidate = to_iso(cur.fetchone())

        audit_log(
            "CANDIDATE_ADDED",
            user["id"],
            user["email"],
            candidate["id"],
            "candidate",
            f"Candidate added: {candidate['name']}",
            request.client.host if request.client else None,
        )
        return as_json(candidate, 201)
    finally:
        conn.close()


@fastapi_app.get("/api/elections/{election_id}/candidates")
async def get_candidates(election_id: str, user=Depends(get_current_user)):
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM candidates WHERE election_id = %s ORDER BY created_at ASC", (election_id,))
            return [to_iso(row) for row in cur.fetchall()]
    finally:
        conn.close()


@fastapi_app.put("/api/elections/{election_id}/candidates/{candidate_id}")
async def update_candidate(election_id: str, candidate_id: str, request: Request, user=Depends(require_admin)):
    body = await request.json()
    validation_error = validate_candidate_payload(body)
    if validation_error:
        return as_json({"error": validation_error}, 400)

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            election = cur.fetchone()
            if not election:
                return as_json({"error": "Election not found"}, 404)
            if election["status"] != "upcoming":
                return as_json({"error": "Candidates can only be updated for upcoming elections"}, 400)

            cur.execute(
                """
                UPDATE candidates
                SET name = %s, party = %s, bio = %s, photo_url = %s
                WHERE id = %s AND election_id = %s
                RETURNING *
                """,
                (body.get("name"), body.get("party"), body.get("bio"), body.get("photo_url"), candidate_id, election_id),
            )
            candidate = cur.fetchone()
            if not candidate:
                return as_json({"error": "Candidate not found"}, 404)

        candidate_json = to_iso(candidate)
        audit_log(
            "CANDIDATE_UPDATED",
            user["id"],
            user["email"],
            candidate_id,
            "candidate",
            f"Candidate updated: {candidate_json['name']}",
            request.client.host if request.client else None,
        )
        return candidate_json
    finally:
        conn.close()


@fastapi_app.delete("/api/elections/{election_id}/candidates/{candidate_id}")
async def delete_candidate(election_id: str, candidate_id: str, request: Request, user=Depends(require_admin)):
    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s", (election_id,))
            election = cur.fetchone()
            if not election:
                return as_json({"error": "Election not found"}, 404)
            if election["status"] != "upcoming":
                return as_json({"error": "Candidates can only be deleted from upcoming elections"}, 400)

            cur.execute("SELECT * FROM candidates WHERE id = %s AND election_id = %s", (candidate_id, election_id))
            existing = cur.fetchone()
            if not existing:
                return as_json({"error": "Candidate not found"}, 404)

            cur.execute("DELETE FROM candidates WHERE id = %s AND election_id = %s", (candidate_id, election_id))

        audit_log(
            "CANDIDATE_DELETED",
            user["id"],
            user["email"],
            candidate_id,
            "candidate",
            f"Candidate deleted: {existing['name']}",
            request.client.host if request.client else None,
        )
        return {"message": "Candidate deleted successfully"}
    finally:
        conn.close()


@fastapi_app.post("/api/votes")
async def cast_vote(request: Request, user=Depends(get_current_user)):
    if user.get("role") != "voter":
        return as_json({"error": "Only voters can cast votes"}, 403)

    body = await request.json()
    election_id = body.get("election_id")
    candidate_id = body.get("candidate_id")

    try:
        uuid.UUID(str(election_id))
        uuid.UUID(str(candidate_id))
    except ValueError:
        return as_json({"error": "Invalid vote payload"}, 400)

    conn = db_connect()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM elections WHERE id = %s LIMIT 1", (election_id,))
                election = cur.fetchone()
                if not election:
                    return as_json({"error": "Election not found"}, 404)
                if election["status"] != "active":
                    return as_json({"error": "Election is not active"}, 400)

                cur.execute(
                    "SELECT * FROM candidates WHERE id = %s AND election_id = %s LIMIT 1",
                    (candidate_id, election_id),
                )
                candidate = cur.fetchone()
                if not candidate:
                    return as_json({"error": "Candidate does not belong to this election"}, 400)

                cur.execute(
                    "SELECT id FROM votes WHERE voter_id = %s AND election_id = %s LIMIT 1",
                    (user["id"], election_id),
                )
                if cur.fetchone():
                    return as_json({"error": "You have already voted in this election"}, 403)

                payload = {
                    "voter_id": user["id"],
                    "candidate_id": candidate_id,
                    "election_id": election_id,
                    "timestamp": now_utc().isoformat(),
                }
                receipt = encrypt_text(str(payload))

                cur.execute(
                    """
                    INSERT INTO votes (election_id, voter_id, candidate_id, encrypted_ballot)
                    VALUES (%s,%s,%s,%s)
                    """,
                    (election_id, user["id"], candidate_id, receipt),
                )

        # Vote persistence above is the critical step. Post-vote notifications should not fail the request.
        try:
            send_vote_confirmation_email(user["email"], election["title"], candidate["name"])
        except Exception as exc:
            print(f"Warning: vote confirmation email failed: {exc}")

        try:
            results_payload = build_election_results(str(election_id))
            await emit_results_update(str(election_id), results_payload)
        except Exception as exc:
            print(f"Warning: live results update failed: {exc}")

        try:
            audit_log(
                "VOTE_CAST",
                user["id"],
                user["email"],
                str(election_id),
                "election",
                f"Vote cast for election {election['title']}",
                request.client.host if request.client else None,
            )
        except Exception as exc:
            print(f"Warning: audit logging failed after vote cast: {exc}")

        return as_json({"message": "Vote cast successfully", "receipt": receipt}, 201)
    except psycopg2.Error as exc:
        if exc.pgcode == "23505":
            return as_json({"error": "You have already voted in this election"}, 403)
        raise
    finally:
        conn.close()


@fastapi_app.get("/api/votes/status/{election_id}")
async def vote_status(election_id: str, user=Depends(get_current_user)):
    if user.get("role") != "voter":
        return as_json({"error": "Only voters can access vote status"}, 403)

    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT candidate_id FROM votes WHERE voter_id = %s AND election_id = %s LIMIT 1",
                (user["id"], election_id),
            )
            row = cur.fetchone()
            if not row:
                return {"hasVoted": False, "candidateId": None}
            return {"hasVoted": True, "candidateId": str(row["candidate_id"])}
    finally:
        conn.close()


@fastapi_app.get("/api/results/{election_id}")
async def get_results(election_id: str, user=Depends(get_current_user)):
    conn = db_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM elections WHERE id = %s LIMIT 1", (election_id,))
            election = cur.fetchone()
            if not election:
                return as_json({"error": "Election not found"}, 404)

            if user["role"] == "voter" and election["status"] != "closed":
                cur.execute(
                    "SELECT id FROM votes WHERE voter_id = %s AND election_id = %s LIMIT 1",
                    (user["id"], election_id),
                )
                if not cur.fetchone():
                    return as_json({"error": "Results available only after voting or election closure"}, 403)

            cur.execute(
                """
                SELECT v.candidate_id, c.name, c.party, COUNT(*)::int AS vote_count
                FROM votes v
                JOIN candidates c ON v.candidate_id = c.id
                WHERE v.election_id = %s
                GROUP BY v.candidate_id, c.name, c.party
                ORDER BY vote_count DESC
                """,
                (election_id,),
            )
            results = [to_iso(row) for row in cur.fetchall()]
            total_votes = sum(int(row["vote_count"]) for row in results)
            for row in results:
                votes = int(row["vote_count"])
                row["percentage"] = round((votes / total_votes) * 100, 2) if total_votes else 0

            return {"election": to_iso(election), "results": results, "total_votes": total_votes}
    finally:
        conn.close()


@fastapi_app.get("/api/audit")
async def get_audit_logs(page: int = 1, limit: int = 50, event_type: Optional[str] = None, user=Depends(require_admin)):
    page = max(1, int(page))
    limit = min(200, max(1, int(limit)))
    offset = (page - 1) * limit

    conn = db_connect()
    try:
        with conn.cursor() as cur:
            if event_type:
                cur.execute(
                    """
                    SELECT * FROM audit_logs
                    WHERE event_type = %s
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (event_type, limit, offset),
                )
                logs = [to_iso(row) for row in cur.fetchall()]

                cur.execute("SELECT COUNT(*)::int AS total FROM audit_logs WHERE event_type = %s", (event_type,))
                total = cur.fetchone()["total"]
            else:
                cur.execute(
                    """
                    SELECT * FROM audit_logs
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                    """,
                    (limit, offset),
                )
                logs = [to_iso(row) for row in cur.fetchall()]

                cur.execute("SELECT COUNT(*)::int AS total FROM audit_logs")
                total = cur.fetchone()["total"]

            total_pages = max(1, (total + limit - 1) // limit)
            return {"logs": logs, "total": total, "page": page, "totalPages": total_pages}
    finally:
        conn.close()


@fastapi_app.on_event("startup")
async def on_startup():
    validate_env()

    schema_path = Path(__file__).parent / "db" / "schema.sql"
    if not schema_path.exists():
        raise RuntimeError("Database schema file not found")

    conn = db_connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(schema_path.read_text(encoding="utf-8"))

            cur.execute(
                """
                INSERT INTO users (name, email, password_hash, role, is_verified)
                VALUES (%s,%s,%s,'admin',TRUE)
                ON CONFLICT (email)
                DO UPDATE SET
                  name = EXCLUDED.name,
                  password_hash = EXCLUDED.password_hash,
                  role = 'admin',
                  is_verified = TRUE,
                  updated_at = NOW()
                """,
                (Config.admin_name, Config.admin_email, hash_password(Config.admin_password)),
            )
    finally:
        conn.close()
