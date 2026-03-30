from flask import Flask, jsonify, request, send_file
import requests
from requests.auth import HTTPDigestAuth
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)

TV_IP = "192.168.31.194"
TV_API = f"https://{TV_IP}:1926/6"
AUTH = HTTPDigestAuth("claude01", "2ace7b0ad9884c8dce777c6e7f5dcfd6ddfcb6bb10223037b9d56c8f8402564d")
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
