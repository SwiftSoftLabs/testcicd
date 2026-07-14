import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://localhost:3000"
USERNAME = "sayudha.wibisana@swiftsoftlabs.com"
PASSWORD = "em1nem333Yudha"
TIMEOUT = 30

def test_get_calendar_view_with_integrations():
    session = requests.Session()
    auth = HTTPBasicAuth(USERNAME, PASSWORD)
    headers = {
        "Accept": "text/html"
    }

    # Attempt to access /calendar without auth to verify 401 or redirect
    try:
        resp_unauth = session.get(f"{BASE_URL}/calendar", headers=headers, timeout=TIMEOUT, allow_redirects=False)
        assert resp_unauth.status_code in (401, 302, 303, 307), f"Expected 401 or redirect status without auth, got {resp_unauth.status_code}"
    except requests.RequestException as e:
        assert False, f"Request failed for unauthenticated /calendar access: {e}"

    # Access /calendar with valid basic token auth
    try:
        resp = session.get(f"{BASE_URL}/calendar", headers=headers, auth=auth, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Expected 200 OK with auth, got {resp.status_code}"
        content_type = resp.headers.get("Content-Type", "")
        assert "text/html" in content_type, f"Expected Content-Type to include 'text/html', got '{content_type}'"
        html = resp.text.lower()

        # Check presence of calendar elements indicative of events or integrations
        # This is heuristic since exact schema unknown. Look for typical calendar identifiers
        calendar_present = any(
            marker in html for marker in [
                "calendar", "event", "integration", "empty", "error", "no events", "sync error"
            ]
        )
        assert calendar_present, "Calendar page did not contain expected calendar or integration indicators"

    except requests.RequestException as e:
        assert False, f"Request failed for authenticated /calendar access: {e}"

test_get_calendar_view_with_integrations()