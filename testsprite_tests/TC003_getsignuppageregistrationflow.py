import requests
from requests.auth import HTTPBasicAuth

def test_getsignuppageregistrationflow():
    base_url = "http://localhost:3000"
    url = f"{base_url}/signup"
    auth = HTTPBasicAuth("sayudha.wibisana@swiftsoftlabs.com", "em1nem333Yudha")
    headers = {
        "Accept": "text/html"
    }

    try:
        response = requests.get(url, auth=auth, headers=headers, timeout=30)
    except requests.RequestException as e:
        assert False, f"HTTP request failed: {e}"

    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
    content_type = response.headers.get("Content-Type", "")
    assert "text/html" in content_type, f"Expected 'text/html' in Content-Type but got {content_type}"
    assert "<html" in response.text.lower(), "Response does not contain expected HTML content"

test_getsignuppageregistrationflow()