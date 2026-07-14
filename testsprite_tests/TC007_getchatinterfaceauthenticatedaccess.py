import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://localhost:3000"
AUTH_CREDENTIALS = ("sayudha.wibisana@swiftsoftlabs.com", "em1nem333Yudha")
TIMEOUT = 30

def test_get_chat_interface_authenticated_access():
    chat_url = f"{BASE_URL}/chat"
    session = requests.Session()

    # Test with valid authentication
    try:
        response = session.get(chat_url, auth=HTTPBasicAuth(*AUTH_CREDENTIALS), timeout=TIMEOUT, allow_redirects=True)
    except requests.RequestException as e:
        assert False, f"Request to /chat with authentication failed: {e}"

    # Assert status code 200 and HTML content for authenticated access
    assert response.status_code == 200, f"Expected 200 OK for authenticated /chat, got {response.status_code}"
    content_type = response.headers.get("Content-Type", "")
    assert "text/html" in content_type.lower(), f"Expected HTML content-type, got {content_type}"
    # Heuristic checks for chat interface contents
    body_lower = response.text.lower()
    assert ("conversation" in body_lower or "chat" in body_lower) and ("message" in body_lower or "thread" in body_lower), \
        "Response HTML does not appear to contain conversations and message threads"

    # Test without authentication (no credentials)
    try:
        response_no_auth = session.get(chat_url, timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Request to /chat without authentication failed: {e}"

    # Assert 401 Unauthorized or redirect to login (302, 303, or 307)
    assert response_no_auth.status_code in (401, 302, 303, 307), (
        f"Expected 401 Unauthorized or redirect (302/303/307) for unauthenticated /chat, got {response_no_auth.status_code}"
    )
    if response_no_auth.status_code in (302, 303, 307):
        location = response_no_auth.headers.get("Location", "")
        assert "/login" in location.lower(), f"Redirect location expected to include /login, got {location}"

test_get_chat_interface_authenticated_access()
