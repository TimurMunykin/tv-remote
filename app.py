import json
from flask import Flask, jsonify, request, send_file, Response, stream_with_context
import requests
from requests.auth import HTTPDigestAuth
import urllib3
import subprocess
import tempfile
import os
from db import init_db, get_history, clear_history

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)

# Initialize DB on startup
if os.environ.get("DATABASE_URL"):
    try:
        init_db()
    except Exception as e:
        print(f"DB init skipped: {e}")

TV_IP = os.environ.get("TV_IP", "192.168.31.194")
TV_API = f"https://{TV_IP}:1926/6"
AUTH = HTTPDigestAuth(
    os.environ.get("TV_AUTH_USER", "claude01"),
    os.environ.get("TV_AUTH_KEY", "")
)
TIMEOUT = 5


def tv_get(path):
    try:
        r = requests.get(f"{TV_API}/{path}", auth=AUTH, verify=False, timeout=TIMEOUT)
        return r.json() if r.text else {}
    except Exception as e:
        return {"error": str(e)}


def tv_post(path, data=None):
    try:
        r = requests.post(f"{TV_API}/{path}", json=data or {}, auth=AUTH, verify=False, timeout=TIMEOUT)
        return {"ok": True, "status": r.status_code}
    except Exception as e:
        return {"error": str(e)}


@app.route("/")
def index():
    return send_file("static/index.html")


@app.route("/api/status")
def status():
    power = tv_get("powerstate")
    volume = tv_get("audio/volume")
    current = tv_get("activities/current")
    return jsonify({"power": power, "volume": volume, "activity": current})


@app.route("/api/power", methods=["POST"])
def power():
    state = request.json.get("state", "On")
    return jsonify(tv_post("powerstate", {"powerstate": state}))


@app.route("/api/key", methods=["POST"])
def key():
    k = request.json.get("key")
    if not k:
        return jsonify({"error": "no key"}), 400
    return jsonify(tv_post("input/key", {"key": k}))


@app.route("/api/volume", methods=["POST"])
def volume():
    vol = request.json.get("volume")
    muted = request.json.get("muted")
    data = {}
    if vol is not None:
        data["current"] = int(vol)
    if muted is not None:
        data["muted"] = bool(muted)
    return jsonify(tv_post("audio/volume", data))


@app.route("/api/launch", methods=["POST"])
def launch():
    app_data = request.json
    return jsonify(tv_post("activities/launch", app_data))


@app.route("/api/apps")
def apps():
    return jsonify(tv_get("applications"))


@app.route("/api/ambilight/power", methods=["POST"])
def ambilight_power():
    return jsonify(tv_post("ambilight/power", request.json))


@app.route("/api/ambilight/config")
def ambilight_config():
    return jsonify(tv_get("ambilight/currentconfiguration"))


@app.route("/api/screenshot")
def screenshot():
    try:
        subprocess.run(["adb", "connect", f"{TV_IP}:5555"], capture_output=True, timeout=5)
        subprocess.run(["adb", "-s", f"{TV_IP}:5555", "shell", "screencap", "-p", "/sdcard/screen.png"],
                       capture_output=True, timeout=10)
        tmp = tempfile.mktemp(suffix=".png")
        subprocess.run(["adb", "-s", f"{TV_IP}:5555", "pull", "/sdcard/screen.png", tmp],
                       capture_output=True, timeout=10)
        return send_file(tmp, mimetype="image/png")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/chat", methods=["POST"])
def chat():
    message = (request.json or {}).get("message", "").strip()
    if not message:
        return jsonify({"error": "empty message"}), 400

    from agent import run_agent_loop

    def generate():
        try:
            for event in run_agent_loop(message):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.route("/api/chat/history")
def chat_history():
    if not os.environ.get("DATABASE_URL"):
        return jsonify([])
    return jsonify(get_history())


@app.route("/api/chat/clear", methods=["POST"])
def chat_clear():
    if os.environ.get("DATABASE_URL"):
        clear_history()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
