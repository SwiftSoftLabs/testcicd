import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://localhost:3000"
USERNAME = "sayudha.wibisana@swiftsoftlabs.com"
PASSWORD = "em1nem333Yudha"
TIMEOUT = 30

def test_get_email_inbox_and_compose_pages():
    session = requests.Session()
    session.auth = HTTPBasicAuth(USERNAME, PASSWORD)
    headers = {
        "Accept": "text/html"
    }

    # Test /email with valid authentication
    try:
        resp_email = session.get(f"{BASE_URL}/email", headers=headers, timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Request to /email with auth failed: {e}"
    else:
        # Should be 200 or redirect and content-type text/html if 200
        assert resp_email.status_code == 200 or (300 <= resp_email.status_code < 400), \
            f"/email expected 200 or redirect but got {resp_email.status_code}"
        if resp_email.status_code == 200:
            content_type = resp_email.headers.get("Content-Type", "")
            assert "text/html" in content_type.lower(), f"/email expected HTML content but got {content_type}"
            assert len(resp_email.text) > 0, "/email returned empty response body"
        else:
            location = resp_email.headers.get("Location", "")
            assert "/login" in location.lower() or "/signin" in location.lower(), \
                f"/email with auth redirected to unexpected location: {location}"

    # Test /email/compose with valid authentication
    try:
        resp_compose = session.get(f"{BASE_URL}/email/compose", headers=headers, timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Request to /email/compose with auth failed: {e}"
    else:
        # Should be 200 or redirect and content-type text/html if 200
        assert resp_compose.status_code == 200 or (300 <= resp_compose.status_code < 400), \
            f"/email/compose expected 200 or redirect but got {resp_compose.status_code}"
        if resp_compose.status_code == 200:
            content_type = resp_compose.headers.get("Content-Type", "")
            assert "text/html" in content_type.lower(), f"/email/compose expected HTML content but got {content_type}"
            assert len(resp_compose.text) > 0, "/email/compose returned empty response body"
        else:
            location = resp_compose.headers.get("Location", "")
            assert "/login" in location.lower() or "/signin" in location.lower(), \
                f"/email/compose with auth redirected to unexpected location: {location}"

    # Test /email without authentication
    try:
        resp_email_noauth = requests.get(f"{BASE_URL}/email", headers=headers, timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Request to /email without auth failed: {e}"
    else:
        # Expect 401 or 3xx redirect to login
        assert resp_email_noauth.status_code in [401, 302, 303, 307, 308], \
            f"/email without auth expected 401 or redirect but got {resp_email_noauth.status_code}"
        if 300 <= resp_email_noauth.status_code < 400:
            location = resp_email_noauth.headers.get("Location", "")
            assert "/login" in location.lower() or "/signin" in location.lower(), \
                f"/email without auth redirected to unexpected location: {location}"

    # Test /email/compose without authentication
    try:
        resp_compose_noauth = requests.get(f"{BASE_URL}/email/compose", headers=headers, timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Request to /email/compose without auth failed: {e}"
    else:
        # Expect 401 or 3xx redirect to login
        assert resp_compose_noauth.status_code in [401, 302, 303, 307, 308], \
            f"/email/compose without auth expected 401 or redirect but got {resp_compose_noauth.status_code}"
        if 300 <= resp_compose_noauth.status_code < 400:
            location = resp_compose_noauth.headers.get("Location", "")
            assert "/login" in location.lower() or "/signin" in location.lower(), \
                f"/email/compose without auth redirected to unexpected location: {location}"

test_get_email_inbox_and_compose_pages()
