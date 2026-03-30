import os
import json
import base64
import subprocess
import tempfile
import time
from typing import Generator

import requests as http_requests
from requests.auth import HTTPDigestAuth
from openai import OpenAI


SYSTEM_PROMPT = """You are an AI assistant that controls a Philips 55OLED706 Android TV.

The TV runs Android TV. Use the tools to navigate and control it.

Navigation keys: CursorUp, CursorDown, CursorLeft, CursorRight, Confirm (OK/Enter), Back, Home
Media keys: Play, Pause, Stop, Rewind, FastForward
Other: VolumeUp, VolumeDown, Mute, Standby

Strategy:
- Always take a screenshot first to understand the current state
- Navigate step by step, confirm each action with a screenshot
- If you need clarification from the user, ask them directly in your response
- When looking for an app, use get_apps first to find the exact package name
- Be efficient — don't take unnecessary screenshots
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": "Take a screenshot of the TV screen to see what is currently displayed. Always do this before navigating.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "press_key",
            "description": "Press a remote control button on the TV.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Key name: CursorUp, CursorDown, CursorLeft, CursorRight, Confirm, Back, Home, VolumeUp, VolumeDown, Play, Pause, Stop, Rewind, FastForward, Mute, Standby"
                    },
                    "times": {
                        "type": "integer",
                        "description": "Number of times to press the key. Defaults to 1.",
                        "default": 1
                    }
                },
                "required": ["key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "launch_app",
            "description": "Launch an app on the TV by Android package name and class name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "package_name": {"type": "string", "description": "Android package name"},
                    "class_name": {"type": "string", "description": "Android activity class name"}
                },
                "required": ["package_name", "class_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_apps",
            "description": "Get the list of all installed apps on the TV with their package names.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "type_text",
            "description": "Type text on the TV using ADB input (for search fields).",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to type"}
                },
                "required": ["text"]
            }
        }
    }
]


def _tv_post(path: str, data: dict) -> dict:
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")
    auth = HTTPDigestAuth(
        os.environ.get("TV_AUTH_USER", "claude01"),
        os.environ.get("TV_AUTH_KEY", "")
    )
    try:
        r = http_requests.post(
            f"https://{tv_ip}:1926/6/{path}",
            json=data, auth=auth, verify=False, timeout=5
        )
        return {"ok": True, "status": r.status_code}
    except Exception as e:
        return {"error": str(e)}


def _tv_get(path: str) -> dict:
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")
    auth = HTTPDigestAuth(
        os.environ.get("TV_AUTH_USER", "claude01"),
        os.environ.get("TV_AUTH_KEY", "")
    )
    try:
        r = http_requests.get(
            f"https://{tv_ip}:1926/6/{path}",
            auth=auth, verify=False, timeout=5
        )
        return r.json() if r.text else {}
    except Exception as e:
        return {"error": str(e)}


def _take_screenshot() -> str:
    """Returns base64-encoded PNG string."""
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")
    subprocess.run(["adb", "connect", f"{tv_ip}:5555"], capture_output=True, timeout=5)
    subprocess.run(
        ["adb", "-s", f"{tv_ip}:5555", "shell", "screencap", "-p", "/sdcard/screen.png"],
        capture_output=True, timeout=10
    )
    tmp = tempfile.mktemp(suffix=".png")
    subprocess.run(
        ["adb", "-s", f"{tv_ip}:5555", "pull", "/sdcard/screen.png", tmp],
        capture_output=True, timeout=10
    )
    with open(tmp, "rb") as f:
        data = base64.b64encode(f.read()).decode()
    os.unlink(tmp)
    return data


def run_agent_loop(user_message: str) -> Generator[dict, None, None]:
    """Generator that yields SSE event dicts."""
    from db import save_message, get_history

    save_message("user", user_message)
    history = get_history()

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    model = os.environ.get("OPENAI_MODEL", "gpt-5.4")
    tv_ip = os.environ.get("TV_IP", "192.168.31.194")

    for _ in range(20):
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=2000
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            text = msg.content or ""
            save_message("assistant", text)
            yield {"type": "message", "text": text}
            yield {"type": "done"}
            return

        messages.append(msg)
        tool_results = []

        for tc in msg.tool_calls:
            name = tc.function.name
            args = json.loads(tc.function.arguments)

            yield {"type": "action", "tool": name, "args": args}

            if name == "take_screenshot":
                img_b64 = _take_screenshot()
                yield {"type": "screenshot", "data": img_b64}
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": [
                        {"type": "text", "text": "Screenshot taken:"},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                    ]
                })

            elif name == "press_key":
                key = args["key"]
                times = args.get("times", 1)
                for _ in range(times):
                    _tv_post("input/key", {"key": key})
                    time.sleep(0.3)
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"ok": True, "key": key, "times": times})
                })

            elif name == "launch_app":
                _tv_post("activities/launch", {
                    "intent": {
                        "component": {
                            "packageName": args["package_name"],
                            "className": args["class_name"]
                        },
                        "action": "android.intent.action.MAIN"
                    }
                })
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": '{"ok": true}'
                })

            elif name == "get_apps":
                data = _tv_get("applications")
                apps = data.get("applications", [])
                summary = [
                    {
                        "label": a.get("label", ""),
                        "package": a.get("intent", {}).get("component", {}).get("packageName", ""),
                        "class": a.get("intent", {}).get("component", {}).get("className", "")
                    }
                    for a in apps
                ]
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"applications": summary})
                })

            elif name == "type_text":
                text = args["text"].replace(" ", "%s")
                subprocess.run(
                    ["adb", "-s", f"{tv_ip}:5555", "shell", "input", "text", text],
                    capture_output=True, timeout=10
                )
                tool_results.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": '{"ok": true}'
                })

        messages.extend(tool_results)

    yield {"type": "error", "text": "Превышен лимит итераций (20)"}
    yield {"type": "done"}
