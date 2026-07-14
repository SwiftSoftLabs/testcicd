import requests

def test_get_marketing_homepage_public_access():
    base_url = "http://localhost:3000"
    url = f"{base_url}/"
    timeout = 30
    # No authentication required per PRD for this endpoint
    
    try:
        response = requests.get(url, timeout=timeout)
    except requests.RequestException as e:
        assert False, f"Request to {url} failed with exception: {e}"
    
    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"
    content_type = response.headers.get("Content-Type", "")
    assert "text/html" in content_type.lower(), f"Expected 'text/html' content type but got '{content_type}'"
    assert len(response.text) > 0, "Response HTML content is empty"

test_get_marketing_homepage_public_access()