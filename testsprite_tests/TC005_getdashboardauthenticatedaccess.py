import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://localhost:3000"
USERNAME = "sayudha.wibisana@swiftsoftlabs.com"
PASSWORD = "em1nem333Yudha"
TIMEOUT = 30

def test_get_dashboard_authenticated_access():
    session = requests.Session()
    auth = HTTPBasicAuth(USERNAME, PASSWORD)

    # Try accessing /dashboard without authentication
    try:
        response_unauth = session.get(f"{BASE_URL}/dashboard", timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        assert False, f"Unexpected exception on unauthenticated /dashboard request: {e}"

    # Validate that unauthenticated access is denied via 401 or redirect to login (302 or 307)
    assert response_unauth.status_code in (401, 302, 307), \
        f"Expected status code 401, 302, or 307 for unauthenticated /dashboard request, got {response_unauth.status_code}"
    if response_unauth.status_code in (302, 307):
        location = response_unauth.headers.get("Location", "")
        assert "/login" in location, f"Expected redirect to /login but got redirect to {location}"

    # Now authenticate by calling a login endpoint or by basic auth session
    # There is no explicit login API documented; assume basic auth can be used directly.

    # Perform authenticated GET to /dashboard
    try:
        response_auth = session.get(f"{BASE_URL}/dashboard", auth=auth, timeout=TIMEOUT)
    except requests.RequestException as e:
        assert False, f"Unexpected exception on authenticated /dashboard request: {e}"

    # Validate authenticated access is successful with status 200
    assert response_auth.status_code == 200, f"Expected status code 200 for authenticated /dashboard request, got {response_auth.status_code}"

    # Validate content type is HTML (commonly text/html)
    content_type = response_auth.headers.get("Content-Type", "")
    assert "text/html" in content_type.lower(), f"Expected Content-Type to include 'text/html', got '{content_type}'"

    # Validate presence of sidebar navigation in HTML response content
    body_text = response_auth.text.lower()
    sidebar_present = "sidebar" in body_text or "navigation" in body_text or "nav" in body_text
    assert sidebar_present, "Expected HTML content to include 'sidebar' or 'navigation'"

# Run the test
test_get_dashboard_authenticated_access()
