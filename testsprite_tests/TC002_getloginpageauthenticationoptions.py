import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://localhost:3000"
USERNAME = "sayudha.wibisana@swiftsoftlabs.com"
PASSWORD = "em1nem333Yudha"

def test_get_login_page_authentication_options():
    url = f"{BASE_URL}/login"
    try:
        response = requests.get(url, timeout=30)
        # The login page should be accessible without authentication
        assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"
        content = response.text.lower()
        # Check for login options: email/password and passkey in the HTML content
        assert ("email" in content or "password" in content), "Login page missing email/password options"
        assert "passkey" in content, "Login page missing passkey login option"
    except requests.RequestException as e:
        assert False, f"Request to /login failed: {e}"

test_get_login_page_authentication_options()