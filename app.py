import logging
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
CACHE_TTL_SECONDS = 300  # 5 minutes cache default

# Simple in-memory cache
_cache = {
    "data": None,
    "timestamp": 0
}


def clean_html_and_extract_items(content_html, date_str, doc_link, entry_idx):
    """
    Parses the HTML content of a feed entry and breaks it down by <h3> tags
    into distinct update items.
    """
    if not content_html:
        return []

    soup = BeautifulSoup(content_html, "html.parser")
    # Ensure all hyperlinks open in a new tab safely
    for a in soup.find_all("a"):
        a["target"] = "_blank"
        a["rel"] = "noopener noreferrer"

    h3_tags = soup.find_all("h3")
    items = []

    if not h3_tags:
        # Fallback if no <h3> headers are present
        raw_text = soup.get_text(separator=" ", strip=True)
        items.append({
            "id": f"upd-{entry_idx}-0",
            "category": "Update",
            "html": str(soup),
            "text": raw_text,
            "date": date_str,
            "link": doc_link
        })
        return items

    for item_idx, h3 in enumerate(h3_tags):
        category = h3.get_text(strip=True) or "Update"
        
        # Collect all sibling elements until the next <h3>
        body_elements = []
        curr = h3.next_sibling
        while curr and curr.name != "h3":
            # Collect tag or text node
            if getattr(curr, "name", None) is not None or (isinstance(curr, str) and curr.strip()):
                body_elements.append(curr)
            curr = curr.next_sibling

        # Construct HTML for this item
        item_soup = BeautifulSoup("", "html.parser")
        for el in body_elements:
            # Append copy or element
            if hasattr(el, "extract"):
                item_soup.append(el)
            else:
                item_soup.append(str(el))

        item_html = str(item_soup).strip()
        item_text = item_soup.get_text(separator=" ", strip=True)

        items.append({
            "id": f"upd-{entry_idx}-{item_idx}",
            "category": category,
            "html": item_html,
            "text": item_text,
            "date": date_str,
            "link": doc_link
        })

    return items


def fetch_and_parse_feed(force_refresh=False):
    """
    Fetches the BigQuery Atom feed and parses it into structured JSON.
    Uses in-memory cache unless force_refresh is True or cache is expired.
    """
    now = time.time()
    if not force_refresh and _cache["data"] is not None and (now - _cache["timestamp"]) < CACHE_TTL_SECONDS:
        cached_result = dict(_cache["data"])
        cached_result["cached"] = True
        return cached_result

    logger.info("Fetching BigQuery release notes XML from %s...", FEED_URL)
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; BigQueryReleaseNotesApp/1.0; +https://cloud.google.com/bigquery)"
    }
    response = requests.get(FEED_URL, headers=headers, timeout=12)
    response.raise_for_status()

    # Parse XML
    root = ET.fromstring(response.content)
    ns = {"atom": "http://www.w3.org/2005/Atom"}

    feed_title_el = root.find("atom:title", ns)
    feed_title = feed_title_el.text if feed_title_el is not None else "BigQuery - Release notes"

    feed_updated_el = root.find("atom:updated", ns)
    feed_updated = feed_updated_el.text if feed_updated_el is not None else ""

    entries_data = []
    all_categories = set()
    total_updates = 0

    atom_entries = root.findall("atom:entry", ns)
    for entry_idx, entry in enumerate(atom_entries):
        title_el = entry.find("atom:title", ns)
        date_str = title_el.text.strip() if title_el is not None and title_el.text else "Recent Update"

        link_el = entry.find("atom:link", ns)
        doc_link = link_el.attrib.get("href", "") if link_el is not None else ""

        id_el = entry.find("atom:id", ns)
        entry_id = id_el.text.strip() if id_el is not None and id_el.text else f"entry-{entry_idx}"

        updated_el = entry.find("atom:updated", ns)
        updated_val = updated_el.text.strip() if updated_el is not None and updated_el.text else ""

        content_el = entry.find("atom:content", ns)
        content_html = content_el.text if content_el is not None and content_el.text else ""

        # Parse individual items
        items = clean_html_and_extract_items(content_html, date_str, doc_link, entry_idx)
        for it in items:
            all_categories.add(it["category"])
            total_updates += 1

        entries_data.append({
            "id": entry_id,
            "date": date_str,
            "link": doc_link,
            "updated": updated_val,
            "items": items
        })

    result = {
        "feed_title": feed_title,
        "feed_link": FEED_URL,
        "feed_updated": feed_updated,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "cached": False,
        "total_entries": len(entries_data),
        "total_updates": total_updates,
        "categories": sorted(list(all_categories)),
        "entries": entries_data
    }

    _cache["data"] = result
    _cache["timestamp"] = now
    return result


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/release-notes")
def get_release_notes():
    force_refresh = request.args.get("refresh", "").lower() in ("true", "1", "yes")
    try:
        data = fetch_and_parse_feed(force_refresh=force_refresh)
        return jsonify({
            "success": True,
            "data": data
        })
    except Exception as e:
        logger.exception("Failed to fetch release notes: %s", e)
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
