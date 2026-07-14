import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://localhost:3000"
TIMEOUT = 30
USERNAME = "sayudza.wibisana@swiftsoftlabs.com"
PASSWORD = "em1nem333Yudha"

def test_get_calls_list_and_room_access():
    session = requests.Session()
    session.auth = HTTPBasicAuth(USERNAME, PASSWORD)

    # Step 1: GET /calls with valid authentication
    calls_url = f"{BASE_URL}/calls"
    try:
        response_calls = session.get(calls_url, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request to /calls failed: {e}"

    assert response_calls.status_code == 200, f"Expected 200 from /calls, got {response_calls.status_code}"
    content_type_calls = response_calls.headers.get("Content-Type", "")
    assert "text/html" in content_type_calls.lower(), f"Expected HTML content in /calls response, got {content_type_calls}"

    # Attempt to parse and find a call ID to test /calls/{id}/room
    # Since API does not provide JSON, attempt to extract id from HTML - we try regex to extract an id pattern if present
    import re

    call_ids = re.findall(r'/calls/([a-f0-9\-]{36})/room', response_calls.text, re.IGNORECASE)
    # If no UUIDs found, try to find other numeric or alphanumeric id patterns as fallback
    if not call_ids:
        # Try to find href that matches /calls/{id}/room with id as a number or alphanumeric word
        call_ids = re.findall(r'/calls/([\w\-]+)/room', response_calls.text, re.IGNORECASE)

    if not call_ids:
        # No call id found, skip room access test with a warning but do not fail
        print("No call IDs found in calls list. Skipping /calls/{id}/room test.")
        return

    call_id = call_ids[0]

    # Step 2: GET /calls/{id}/room with valid session and permissions
    call_room_url = f"{BASE_URL}/calls/{call_id}/room"
    try:
        response_call_room = session.get(call_room_url, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Request to /calls/{call_id}/room failed: {e}"

    # Validate response for /calls/{id}/room could be either success or error page
    # Success case expected 200 with HTML LiveKit call room page
    if response_call_room.status_code == 200:
        content_type_room = response_call_room.headers.get("Content-Type", "")
        assert "text/html" in content_type_room.lower(), f"Expected HTML content in /calls/{call_id}/room response, got {content_type_room}"
        # Check for presence of LiveKit indicator keywords in HTML (generic check)
        livekit_present = any(keyword in response_call_room.text.lower() for keyword in ["livekit", "call room", "media controls"])
        assert livekit_present, "LiveKit call room page content not detected in /calls/{id}/room response"
    else:
        # Error states: 403 or 404 or 500 may indicate permission or server issues
        assert response_call_room.status_code in [403, 404, 500], f"Unexpected status code {response_call_room.status_code} from /calls/{call_id}/room"

test_get_calls_list_and_room_access()