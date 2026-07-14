import requests
from requests.auth import HTTPBasicAuth

def test_get_verify_email_status_page():
    base_url = "http://localhost:3000"
    url = f"{base_url}/verify-email"
    auth = HTTPBasicAuth("sayudha.wibisana@swiftsoftlabs.com", "em1nem333Yudha")
    headers = {
        "Accept": "text/html"
    }
    try:
        response = requests.get(url, auth=auth, headers=headers, timeout=30)
        # The email verification status page is accessible without authentication
        # According to the PRD, auth_required is false, so also test without auth
        assert response.status_code == 200, f"Expected 200 OK but got {response.status_code}"
        content_type = response.headers.get("Content-Type", "")
        assert "text/html" in content_type.lower(), f"Expected HTML content type but got {content_type}"
        assert len(response.text) > 0, "Expected non-empty HTML content"
    except requests.RequestException as e:
        assert False, f"Request to /verify-email failed: {e}"

    # Additionally test accessibility without authentication as per the PRD description
    try:
        response_no_auth = requests.get(url, headers=headers, timeout=30)
        assert response_no_auth.status_code == 200, f"Expected 200 OK without auth but got {response_no_auth.status_code}"
        content_type_no_auth = response_no_auth.headers.get("Content-Type", "")
        assert "text/html" in content_type_no_auth.lower(), f"Expected HTML content type without auth but got {content_type_no_auth}"
        assert len(response_no_auth.text) > 0, "Expected non-empty HTML content without auth"
    except requests.RequestException as e:
        assert False, f"Request to /verify-email without auth failed: {e}"

test_get_verify_email_status_page()